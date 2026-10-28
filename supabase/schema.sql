-- Brutal Gym: banco de dados (Supabase)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- Depois rode o comando da senha (as aulas são criadas pelo painel, aba Aulas)
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
  liberada boolean not null default false, -- true = equipe liberou as reservas antes das 2h
  link_cartao text, -- link do Mercado Pago só desta aula (vazio = usa o link geral)
  reserva_2h boolean not null default false -- true = reserva só abre 2h antes do início (regra opcional)
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
  criado_em timestamptz not null default now(),
  parq_em timestamptz,   -- quando o aluno declarou ter preenchido o PAR-Q
  parq_documento jsonb,  -- comprovante do PAR-Q: texto oficial, respostas, data/hora, IP e aparelho
  cancelada_em timestamptz, -- cancelada pela equipe (libera a vaga, fica no histórico)
  parq_sim boolean       -- true = respondeu "Sim" em alguma pergunta (só um alerta; as respostas não são guardadas)
);

create index if not exists reservas_aula_idx on public.reservas (aula_id);

create table if not exists public.config (
  chave text primary key,
  valor text not null
);

-- Pessoas que responderam "Sim" no PAR-Q (por celular). Só a equipe libera, presencialmente.
create table if not exists public.parq_pessoas (
  whatsapp text primary key,
  nome text not null,
  status text not null default 'pendente' check (status in ('pendente', 'liberado')),
  atualizado_em timestamptz not null default now()
);
alter table public.parq_pessoas enable row level security;
revoke all on public.parq_pessoas from anon, authenticated;

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
drop function if exists public.listar_aulas();
create or replace function public.listar_aulas()
returns table (
  id uuid, titulo text, inicio timestamptz, vagas int,
  reservadas int, preco_pix int, preco_cartao int, preco_pix_de int,
  abre_em timestamptz, aberta boolean, reserva_2h boolean
)
language sql
security definer
set search_path = public
as $$
  select a.id, a.titulo, a.inicio, a.vagas,
         (select count(*)::int from public.reservas r where r.aula_id = a.id and r.cancelada_em is null),
         a.preco_pix, a.preco_cartao, a.preco_pix_de,
         a.inicio - interval '2 hours',
         (now() < a.inicio and (not a.reserva_2h or a.liberada or now() >= a.inicio - interval '2 hours')),
         a.reserva_2h
  from public.aulas a
  where a.ativa and a.inicio > now()
  order by a.inicio;
$$;

drop function if exists public.reservar(uuid, text, text, text);
drop function if exists public.reservar(uuid, text, text, text, boolean);
create or replace function public.reservar(
  p_aula uuid, p_nome text, p_whatsapp text, p_metodo text, p_parq_respostas text[] default null
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
  v_parq boolean;
  v_sim boolean;
  v_doc jsonb;
  v_hdr json;
  v_ip text;
  v_ua text;
  v_cod text;
  v_try int := 0;
  i int;
begin
  if p_metodo not in ('pix', 'cartao') then raise exception 'metodo_invalido'; end if;
  -- PAR-Q: 7 respostas, cada uma 's' ou 'n'
  if p_parq_respostas is null or coalesce(array_length(p_parq_respostas, 1), 0) <> 7
     or exists (select 1 from unnest(p_parq_respostas) x where x is null or x not in ('s', 'n')) then
    raise exception 'parq_obrigatorio';
  end if;
  v_sim := 's' = any (p_parq_respostas);
  if char_length(v_nome) < 2 or char_length(v_nome) > 100 then raise exception 'nome_invalido'; end if;
  if char_length(v_zap) < 10 or char_length(v_zap) > 13 then raise exception 'whatsapp_invalido'; end if;

  -- PAR-Q: quem respondeu "Sim" (agora ou em reserva anterior, mesmo celular) só reserva depois
  -- que a equipe confirmar presencialmente que está apto(a) e liberar no painel.
  v_parq := v_sim
    or exists (select 1 from public.reservas r where r.whatsapp = v_zap and r.parq_sim is true)
    or exists (select 1 from public.parq_pessoas p where p.whatsapp = v_zap);
  if v_parq and not exists (select 1 from public.parq_pessoas p where p.whatsapp = v_zap and p.status = 'liberado') then
    raise exception 'parq_pendente';
  end if;

  -- trava a linha da aula para duas pessoas não pegarem a última vaga juntas
  select * into v_aula from public.aulas where id = p_aula and ativa for update;
  if not found then raise exception 'aula_nao_encontrada'; end if;

  -- se a aula usa a regra das 2 horas, a reserva só abre 2h antes (ou quando a equipe libera); sempre fecha no início
  if v_aula.reserva_2h and not v_aula.liberada and now() < v_aula.inicio - interval '2 hours' then raise exception 'ainda_nao_abriu'; end if;
  if now() >= v_aula.inicio then raise exception 'encerrada'; end if;

  -- mesma pessoa (mesmo nome e mesmo celular) não reserva a mesma aula duas vezes
  if exists (
    select 1 from public.reservas r
    where r.aula_id = p_aula
      and r.cancelada_em is null
      and r.whatsapp = v_zap
      and regexp_replace(lower(btrim(r.nome)), '\s+', ' ', 'g') = regexp_replace(lower(v_nome), '\s+', ' ', 'g')
  ) then raise exception 'ja_reservou'; end if;

  select count(*) into v_n from public.reservas where aula_id = p_aula and cancelada_em is null;
  if v_n >= v_aula.vagas then raise exception 'esgotado'; end if;

  -- registro do PAR-Q (comprovante): texto oficial + respostas + data/hora + origem da conexão
  begin
    v_hdr := nullif(current_setting('request.headers', true), '')::json;
    v_ip := split_part(coalesce(v_hdr ->> 'x-forwarded-for', v_hdr ->> 'cf-connecting-ip', ''), ',', 1);
    v_ua := left(coalesce(v_hdr ->> 'user-agent', ''), 300);
  exception when others then
    v_ip := null; v_ua := null;
  end;
  v_doc := public.parq_modelo() || jsonb_build_object(
    'respostas', to_jsonb(p_parq_respostas),
    'nome', v_nome, 'whatsapp', v_zap, 'aula', v_aula.titulo,
    'registrado_em', now(), 'ip', nullif(btrim(v_ip), ''), 'dispositivo', nullif(v_ua, '')
  );

  loop
    v_cod := '';
    for i in 1..8 loop
      v_cod := v_cod || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(gen_random_bytes(1), 0) % 32), 1);
    end loop;
    begin
      insert into public.reservas (aula_id, nome, whatsapp, metodo, codigo, parq_em, parq_sim, parq_documento)
      values (p_aula, v_nome, v_zap, p_metodo, v_cod, now(), v_parq, v_doc);
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

drop function if exists public.ver_reserva(text);
create or replace function public.ver_reserva(p_codigo text)
returns table (
  aula_titulo text, nome text, metodo text, pago boolean,
  usado_em timestamptz, preco int, link_cartao text, cancelada boolean
)
language sql
security definer
set search_path = public
as $$
  select a.titulo, r.nome, r.metodo, r.pago, r.usado_em,
         case when r.metodo = 'pix' then a.preco_pix else a.preco_cartao end,
         a.link_cartao,
         (r.cancelada_em is not null)
  from public.reservas r
  join public.aulas a on a.id = r.aula_id
  where r.codigo = upper(btrim(p_codigo));
$$;

-- ---------------------------------------------------------------- instrutora (exigem senha)

drop function if exists public.painel_listar(text, uuid);
drop function if exists public.painel_listar(text, uuid);
drop function if exists public.painel_listar(text, uuid);
drop function if exists public.painel_listar(text, uuid);
create or replace function public.painel_listar(p_senha text, p_aula uuid)
returns table (
  id uuid, nome text, whatsapp text, metodo text, codigo text,
  pago boolean, usado_em timestamptz, criado_em timestamptz, parq_sim boolean, cancelada_em timestamptz, parq_liberado boolean, parq_registrado boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  return query
    select r.id, r.nome, r.whatsapp, r.metodo, r.codigo, r.pago, r.usado_em, r.criado_em, r.parq_sim, r.cancelada_em,
           exists (select 1 from public.parq_pessoas p where p.whatsapp = r.whatsapp and p.status = 'liberado'),
           (r.parq_documento is not null)
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
drop function if exists public.painel_aulas(text);
create or replace function public.painel_aulas(p_senha text)
returns table (
  id uuid, titulo text, inicio timestamptz, vagas int, reservadas int, ativa boolean, liberada boolean,
  preco_pix int, preco_cartao int, preco_pix_de int, link_cartao text, reserva_2h boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  return query
    select a.id, a.titulo, a.inicio, a.vagas,
           (select count(*)::int from public.reservas r where r.aula_id = a.id and r.cancelada_em is null),
           a.ativa, a.liberada, a.preco_pix, a.preco_cartao, a.preco_pix_de, a.link_cartao, a.reserva_2h
    from public.aulas a
    where a.inicio > now() - interval '1 day'
    order by a.inicio;
end;
$$;

-- Cria uma aula nova pelo painel.
drop function if exists public.criar_aula(text, text, timestamptz, int, int, int, int);
drop function if exists public.criar_aula(text, text, timestamptz, int, int, int, int, text);
create or replace function public.criar_aula(
  p_senha text, p_titulo text, p_inicio timestamptz, p_vagas int,
  p_preco_pix int, p_preco_cartao int, p_preco_pix_de int default null, p_link_cartao text default null, p_reserva_2h boolean default false
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
  insert into public.aulas (titulo, inicio, vagas, preco_pix, preco_cartao, preco_pix_de, link_cartao, reserva_2h)
  values (btrim(p_titulo), p_inicio, p_vagas, p_preco_pix, p_preco_cartao, p_preco_pix_de, nullif(btrim(coalesce(p_link_cartao, '')), ''), coalesce(p_reserva_2h, false))
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

-- Exclui uma aula SEM reservas (com reservas: desative em vez de excluir).
create or replace function public.excluir_aula(p_senha text, p_aula uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  -- qualquer reserva (inclusive cancelada) impede excluir: o histórico do PAR-Q não pode ser perdido
  if exists (select 1 from public.reservas where aula_id = p_aula) then
    raise exception 'aula_com_reservas';
  end if;
  delete from public.aulas where id = p_aula;
  return 'ok';
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
  update public.reservas
     set cancelada_em = now()
   where id = p_reserva and not pago and usado_em is null and cancelada_em is null;
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
  if not public.senha_checkin_ok(p_senha) then raise exception 'senha_invalida'; end if;

  select * into r from public.reservas where codigo = upper(btrim(p_codigo));
  if not found then
    return query select 'invalido'::text, null::text, null::text, null::boolean, null::timestamptz, null::int;
    return;
  end if;

  select * into a from public.aulas where id = r.aula_id;

  if r.cancelada_em is not null then v_status := 'cancelada';
  elsif r.aula_id <> p_aula then v_status := 'horario_diferente';
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
  if not public.senha_checkin_ok(p_senha) then raise exception 'senha_invalida'; end if;

  update public.reservas
     set usado_em = now(),
         pago_em = case when not pago and p_marcar_pago then now() else pago_em end,
         pago = pago or p_marcar_pago
   where codigo = upper(btrim(p_codigo))
     and aula_id = p_aula
     and usado_em is null
     and cancelada_em is null
     and (pago or p_marcar_pago);

  if found then return 'ok'; end if;
  return 'nao_liberado';
end;
$$;

drop function if exists public.atualizar_aula(text, uuid, text, timestamptz, int, int, int, int, text);
create or replace function public.atualizar_aula(
  p_senha text, p_aula uuid, p_titulo text, p_inicio timestamptz, p_vagas int,
  p_preco_pix int, p_preco_cartao int, p_preco_pix_de int default null, p_link_cartao text default null, p_reserva_2h boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_ativas int;
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  if char_length(btrim(coalesce(p_titulo, ''))) < 3 then raise exception 'aula_invalida'; end if;
  if p_inicio is null then raise exception 'aula_invalida'; end if;
  if p_vagas is null or p_vagas < 1 or p_vagas > 200 then raise exception 'aula_invalida'; end if;
  if p_preco_pix is null or p_preco_pix < 0 or p_preco_cartao is null or p_preco_cartao < 0 then raise exception 'aula_invalida'; end if;
  select count(*) into v_ativas from public.reservas where aula_id = p_aula and cancelada_em is null;
  if p_vagas < v_ativas then raise exception 'vagas_menor_que_reservas'; end if;
  update public.aulas
     set titulo = btrim(p_titulo), inicio = p_inicio, vagas = p_vagas,
         preco_pix = p_preco_pix, preco_cartao = p_preco_cartao, preco_pix_de = p_preco_pix_de,
         link_cartao = nullif(btrim(coalesce(p_link_cartao, '')), ''),
         reserva_2h = coalesce(p_reserva_2h, false)
   where id = p_aula;
end;
$$;

create or replace function public.senha_checkin_ok(p_senha text)
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
    where chave in ('senha_hash', 'senha_checkin_hash') and valor = crypt(p_senha, valor)
  ) into ok;
  if not ok then
    perform pg_sleep(0.7); -- atrasa tentativas erradas
  end if;
  return ok;
end;
$$;

create or replace function public.checar_senha_checkin(p_senha text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select public.senha_checkin_ok(p_senha);
$$;

create or replace function public.checkin_aulas(p_senha text)
returns table (id uuid, titulo text, inicio timestamptz, vagas int, reservadas int, entraram int)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_checkin_ok(p_senha) then raise exception 'senha_invalida'; end if;
  return query
    select a.id, a.titulo, a.inicio, a.vagas,
           (select count(*)::int from public.reservas r where r.aula_id = a.id and r.cancelada_em is null),
           (select count(*)::int from public.reservas r where r.aula_id = a.id and r.cancelada_em is null and r.usado_em is not null)
    from public.aulas a
    where a.ativa and a.inicio > now() - interval '12 hours' and a.inicio < now() + interval '2 days'
    order by a.inicio;
end;
$$;

create or replace function public.definir_senha_checkin(p_senha text, p_nova text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  if char_length(coalesce(p_nova, '')) < 6 then raise exception 'senha_curta'; end if;
  insert into public.config (chave, valor) values ('senha_checkin_hash', crypt(p_nova, gen_salt('bf')))
  on conflict (chave) do update set valor = excluded.valor;
end;
$$;

create or replace function public.config_pagamento()
returns table (pix_chave text, pix_nome text, mp_link text)
language sql
security definer
set search_path = public
as $$
  select (select valor from public.config where chave = 'pix_chave'),
         (select valor from public.config where chave = 'pix_nome'),
         (select valor from public.config where chave = 'mp_link');
$$;

create or replace function public.salvar_pagamento(p_senha text, p_chave text, p_nome text, p_link text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v record;
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  for v in select * from (values ('pix_chave', btrim(coalesce(p_chave, ''))), ('pix_nome', btrim(coalesce(p_nome, ''))), ('mp_link', btrim(coalesce(p_link, '')))) t(k, val) loop
    if v.val = '' then
      delete from public.config where chave = v.k;  -- vazio = volta ao valor do config.js
    else
      insert into public.config (chave, valor) values (v.k, v.val)
      on conflict (chave) do update set valor = excluded.valor;
    end if;
  end loop;
end;
$$;

create or replace function public.registrar_parq(p_nome text, p_whatsapp text)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_zap text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_nome text := btrim(coalesce(p_nome, ''));
begin
  if char_length(v_zap) < 10 or char_length(v_zap) > 13 then return; end if;
  if char_length(v_nome) < 2 or char_length(v_nome) > 100 then return; end if;
  -- só cria a pendência; nunca desfaz uma liberação feita pela equipe
  insert into public.parq_pessoas (whatsapp, nome) values (v_zap, v_nome)
  on conflict (whatsapp) do nothing;
end;
$$;

create or replace function public.parq_painel(p_senha text)
returns table (whatsapp text, nome text, liberado boolean, atualizado_em timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  return query
    select x.whatsapp, x.nome, x.liberado, x.em from (
      select p.whatsapp, p.nome, (p.status = 'liberado') as liberado, p.atualizado_em as em
      from public.parq_pessoas p
      union all
      select r.whatsapp, max(r.nome), false, max(r.criado_em)
      from public.reservas r
      where r.parq_sim is true
        and not exists (select 1 from public.parq_pessoas p where p.whatsapp = r.whatsapp)
      group by r.whatsapp
    ) x
    order by x.liberado, x.em desc;
end;
$$;

create or replace function public.parq_liberar(p_senha text, p_whatsapp text, p_liberado boolean default true)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_nome text;
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  select r.nome into v_nome from public.reservas r where r.whatsapp = p_whatsapp order by r.criado_em desc limit 1;
  insert into public.parq_pessoas (whatsapp, nome, status, atualizado_em)
  values (p_whatsapp, coalesce(v_nome, 'Sem nome'), case when p_liberado then 'liberado' else 'pendente' end, now())
  on conflict (whatsapp) do update
    set status = excluded.status, atualizado_em = now();
end;
$$;

-- Texto oficial do PAR-Q (fonte única: o site lê daqui e o registro guarda esta versão).
-- Para mudar o texto, crie uma versão nova ('v2'...) para não alterar o que já foi assinado.
create or replace function public.parq_modelo()
returns jsonb
language sql
immutable
as $json$
  select $m${
    "versao": "v1",
    "perguntas": [
      "Algum médico já disse que você possui algum problema de coração e que só deveria realizar atividade física supervisionada por profissionais de saúde?",
      "Você sente dores no peito quando pratica atividade física?",
      "No último mês, você sentiu dores no peito quando praticou atividade física?",
      "Você apresenta desequilíbrio devido à tontura e/ou perda de consciência?",
      "Você possui algum problema ósseo ou articular que poderia ser piorado pela atividade física?",
      "Você toma atualmente algum medicamento para pressão arterial e/ou problema de coração?",
      "Sabe de alguma outra razão pela qual você não deve praticar atividade física?"
    ],
    "declaracao": "Declaro que preenchi o PAR-Q com informações verdadeiras, que estou ciente dos riscos da atividade física, assumo total responsabilidade pela minha participação na aula e autorizo o armazenamento das minhas respostas para fins de segurança e comprovação."
  }$m$::jsonb;
$json$;

create or replace function public.parq_documento(p_senha text, p_reserva uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v jsonb;
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  select r.parq_documento || jsonb_build_object('codigo', r.codigo, 'pago', r.pago, 'cancelada_em', r.cancelada_em)
    into v
    from public.reservas r where r.id = p_reserva;
  return v;
end;
$$;

create or replace function public.parq_exportar(p_senha text, p_aula uuid default null)
returns table (documento jsonb)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  return query
    select r.parq_documento || jsonb_build_object('codigo', r.codigo, 'cancelada_em', r.cancelada_em)
    from public.reservas r
    where r.parq_documento is not null and (p_aula is null or r.aula_id = p_aula)
    order by r.criado_em;
end;
$$;

create or replace function public.parq_historico(p_senha text)
returns table (
  id uuid, nome text, whatsapp text, aula text, registrado_em timestamptz,
  parq_sim boolean, liberado boolean, cancelada boolean, codigo text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  return query
    select r.id, r.nome, r.whatsapp, a.titulo, r.parq_em, r.parq_sim,
           exists (select 1 from public.parq_pessoas p where p.whatsapp = r.whatsapp and p.status = 'liberado'),
           (r.cancelada_em is not null), r.codigo
    from public.reservas r
    join public.aulas a on a.id = r.aula_id
    where r.parq_documento is not null
    order by r.parq_em desc;
end;
$$;
