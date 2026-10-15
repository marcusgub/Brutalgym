-- Brutal Gym: banco de dados (Supabase)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- Depois rode, em outra execução, o supabase/aulas.sql (horários) e o comando da senha
-- (a senha NÃO fica neste arquivo, para não ir parar no GitHub).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tabelas

create table if not exists public.aulas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  inicio timestamptz not null,
  vagas int not null default 25 check (vagas > 0),
  preco_pix int not null default 60,
  preco_cartao int not null default 60,
  preco_pix_de int, -- preço "de" (riscado) quando há promoção no Pix
  ativa boolean not null default true,
  liberada boolean not null default false -- true = equipe liberou as reservas antes das 2h
);

create table if not exists public.reservas (
  id uuid primary key default gen_random_uuid(),
  aula_id uuid not null references public.aulas(id) on delete cascade,
  nome text not null,
  whatsapp text not null,
  metodo text not null check (metodo in ('pix', 'cartao')),
  codigo text not null unique,
  pago boolean not null default false,
  pago_em timestamptz,
  usado_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists reservas_aula_idx on public.reservas (aula_id);

create table if not exists public.config (
  chave text primary key,
  valor text not null
);

-- Ninguém (anon) mexe nas tabelas direto: tudo passa pelas funções abaixo.
alter table public.aulas enable row level security;
alter table public.reservas enable row level security;
alter table public.config enable row level security;
revoke all on public.aulas, public.reservas, public.config from anon, authenticated;

-- ---------------------------------------------------------------- senha

create or replace function public.senha_ok(p_senha text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  ok boolean;
begin
  select exists (
    select 1 from public.config
    where chave = 'senha_hash' and valor = crypt(p_senha, valor)
  ) into ok;
  if not ok then
    perform pg_sleep(0.7); -- atrasa tentativas erradas
  end if;
  return ok;
end;
$$;

create or replace function public.checar_senha(p_senha text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select public.senha_ok(p_senha);
$$;

-- ---------------------------------------------------------------- cliente

-- Regra: a reserva de cada aula só abre 2 horas antes do início e fecha no início.
-- Antes disso a aula aparece na lista, mas bloqueada (aberta = false, abre_em = quando abre).
drop function if exists public.listar_aulas();
create or replace function public.listar_aulas()
returns table (
  id uuid, titulo text, inicio timestamptz, vagas int,
  reservadas int, preco_pix int, preco_cartao int, preco_pix_de int,
  abre_em timestamptz, aberta boolean
)
language sql
security definer
set search_path = public
as $$
  select a.id, a.titulo, a.inicio, a.vagas,
         (select count(*)::int from public.reservas r where r.aula_id = a.id),
         a.preco_pix, a.preco_cartao, a.preco_pix_de,
         a.inicio - interval '2 hours',
         (now() < a.inicio and (a.liberada or now() >= a.inicio - interval '2 hours'))
  from public.aulas a
  where a.ativa and a.inicio > now()
  order by a.inicio;
$$;

create or replace function public.reservar(
  p_aula uuid, p_nome text, p_whatsapp text, p_metodo text
)
returns table (r_codigo text, r_aula text, r_nome text, r_metodo text, r_preco int)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_aula public.aulas%rowtype;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_zap text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_n int;
  v_cod text;
  v_try int := 0;
  i int;
begin
  if p_metodo not in ('pix', 'cartao') then raise exception 'metodo_invalido'; end if;
  if char_length(v_nome) < 2 or char_length(v_nome) > 100 then raise exception 'nome_invalido'; end if;
  if char_length(v_zap) < 10 or char_length(v_zap) > 13 then raise exception 'whatsapp_invalido'; end if;

  -- trava a linha da aula para duas pessoas não pegarem a última vaga juntas
  select * into v_aula from public.aulas where id = p_aula and ativa for update;
  if not found then raise exception 'aula_nao_encontrada'; end if;

  -- reserva só abre 2 horas antes da aula e fecha no horário de início
  if not v_aula.liberada and now() < v_aula.inicio - interval '2 hours' then raise exception 'ainda_nao_abriu'; end if;
  if now() >= v_aula.inicio then raise exception 'encerrada'; end if;

  -- mesma pessoa (mesmo nome e mesmo celular) não reserva a mesma aula duas vezes
  if exists (
    select 1 from public.reservas r
    where r.aula_id = p_aula
      and r.whatsapp = v_zap
      and regexp_replace(lower(btrim(r.nome)), '\s+', ' ', 'g') = regexp_replace(lower(v_nome), '\s+', ' ', 'g')
  ) then raise exception 'ja_reservou'; end if;

  select count(*) into v_n from public.reservas where aula_id = p_aula;
  if v_n >= v_aula.vagas then raise exception 'esgotado'; end if;

  loop
    v_cod := '';
    for i in 1..8 loop
      v_cod := v_cod || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(gen_random_bytes(1), 0) % 32), 1);
    end loop;
    begin
      insert into public.reservas (aula_id, nome, whatsapp, metodo, codigo)
      values (p_aula, v_nome, v_zap, p_metodo, v_cod);
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 5 then raise exception 'tente_novamente'; end if;
    end;
  end loop;

  return query select v_cod, v_aula.titulo, v_nome, p_metodo,
    case when p_metodo = 'pix' then v_aula.preco_pix else v_aula.preco_cartao end;
end;
$$;

create or replace function public.ver_reserva(p_codigo text)
returns table (
  aula_titulo text, nome text, metodo text, pago boolean,
  usado_em timestamptz, preco int
)
language sql
security definer
set search_path = public
as $$
  select a.titulo, r.nome, r.metodo, r.pago, r.usado_em,
         case when r.metodo = 'pix' then a.preco_pix else a.preco_cartao end
  from public.reservas r
  join public.aulas a on a.id = r.aula_id
  where r.codigo = upper(btrim(p_codigo));
$$;

-- ---------------------------------------------------------------- instrutora (exigem senha)

create or replace function public.painel_listar(p_senha text, p_aula uuid)
returns table (
  id uuid, nome text, whatsapp text, metodo text, codigo text,
  pago boolean, usado_em timestamptz, criado_em timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  return query
    select r.id, r.nome, r.whatsapp, r.metodo, r.codigo, r.pago, r.usado_em, r.criado_em
    from public.reservas r
    where r.aula_id = p_aula
    order by r.criado_em;
end;
$$;

create or replace function public.marcar_pago(p_senha text, p_reserva uuid, p_pago boolean default true)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  update public.reservas
     set pago = p_pago,
         pago_em = case when p_pago then now() else null end
   where id = p_reserva;
end;
$$;

-- Aulas para o painel da equipe (inclui desativadas, aula em andamento e as de ontem).
drop function if exists public.painel_aulas(text);
create or replace function public.painel_aulas(p_senha text)
returns table (id uuid, titulo text, inicio timestamptz, vagas int, reservadas int, ativa boolean, liberada boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  return query
    select a.id, a.titulo, a.inicio, a.vagas,
           (select count(*)::int from public.reservas r where r.aula_id = a.id),
           a.ativa, a.liberada
    from public.aulas a
    where a.inicio > now() - interval '1 day'
    order by a.inicio;
end;
$$;

-- Cria uma aula nova pelo painel.
create or replace function public.criar_aula(
  p_senha text, p_titulo text, p_inicio timestamptz, p_vagas int,
  p_preco_pix int, p_preco_cartao int, p_preco_pix_de int default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  if char_length(btrim(coalesce(p_titulo, ''))) < 3 then raise exception 'aula_invalida'; end if;
  if p_inicio is null or p_inicio <= now() then raise exception 'aula_invalida'; end if;
  if p_vagas is null or p_vagas < 1 or p_vagas > 200 then raise exception 'aula_invalida'; end if;
  if p_preco_pix is null or p_preco_pix < 0 or p_preco_cartao is null or p_preco_cartao < 0 then raise exception 'aula_invalida'; end if;
  insert into public.aulas (titulo, inicio, vagas, preco_pix, preco_cartao, preco_pix_de)
  values (btrim(p_titulo), p_inicio, p_vagas, p_preco_pix, p_preco_cartao, p_preco_pix_de)
  returning id into v_id;
  return v_id;
end;
$$;

-- Liga/desliga a aula (ativa) e libera as reservas antes das 2h (liberada). Null = não mexe.
create or replace function public.editar_aula(p_senha text, p_aula uuid, p_ativa boolean default null, p_liberada boolean default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  update public.aulas
     set ativa = coalesce(p_ativa, ativa),
         liberada = coalesce(p_liberada, liberada)
   where id = p_aula;
end;
$$;

-- Cancela uma reserva NÃO paga e libera a vaga. Reserva paga: desfaça o pagamento antes.
create or replace function public.cancelar_reserva(p_senha text, p_reserva uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  delete from public.reservas
   where id = p_reserva and not pago and usado_em is null;
  if found then return 'ok'; end if;
  return 'nao_cancelada';
end;
$$;

-- Lê um QR Code sem alterar nada. status: ok | pendente | ja_usado | horario_diferente | invalido
create or replace function public.ler_qr(p_senha text, p_codigo text, p_aula uuid)
returns table (status text, nome text, metodo text, pago boolean, usado_em timestamptz, preco int)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  r public.reservas%rowtype;
  a public.aulas%rowtype;
  v_status text;
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;

  select * into r from public.reservas where codigo = upper(btrim(p_codigo));
  if not found then
    return query select 'invalido'::text, null::text, null::text, null::boolean, null::timestamptz, null::int;
    return;
  end if;

  select * into a from public.aulas where id = r.aula_id;

  if r.aula_id <> p_aula then v_status := 'horario_diferente';
  elsif r.usado_em is not null then v_status := 'ja_usado';
  elsif not r.pago then v_status := 'pendente';
  else v_status := 'ok';
  end if;

  return query select v_status, r.nome, r.metodo, r.pago, r.usado_em,
    case when r.metodo = 'pix' then a.preco_pix else a.preco_cartao end;
end;
$$;

-- Libera a entrada (uma única vez). p_marcar_pago = true marca como pago na hora.
create or replace function public.liberar(p_senha text, p_codigo text, p_aula uuid, p_marcar_pago boolean default false)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;

  update public.reservas
     set usado_em = now(),
         pago_em = case when not pago and p_marcar_pago then now() else pago_em end,
         pago = pago or p_marcar_pago
   where codigo = upper(btrim(p_codigo))
     and aula_id = p_aula
     and usado_em is null
     and (pago or p_marcar_pago);

  if found then return 'ok'; end if;
  return 'nao_liberado';
end;
$$;
