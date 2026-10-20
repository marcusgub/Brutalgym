-- Gestão v2 (rode UMA vez no SQL Editor do Supabase, banco já existente):
--  * editar tudo da aula; cancelamentos ficam no histórico (aba Canceladas) e liberam a vaga
--  * Pix, favorecido e link do Mercado Pago editáveis no painel (e link por aula)
--  * senha própria do instrutor para a tela de check-in (definida no painel)
-- Pode rodar de novo sem problema.

alter table public.reservas add column if not exists cancelada_em timestamptz;
alter table public.aulas add column if not exists link_cartao text;

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
         (select count(*)::int from public.reservas r where r.aula_id = a.id and r.cancelada_em is null),
         a.preco_pix, a.preco_cartao, a.preco_pix_de,
         a.inicio - interval '2 hours',
         (now() < a.inicio and (a.liberada or now() >= a.inicio - interval '2 hours'))
  from public.aulas a
  where a.ativa and a.inicio > now()
  order by a.inicio;
$$;

create or replace function public.reservar(
  p_aula uuid, p_nome text, p_whatsapp text, p_metodo text, p_parq_sim boolean default null
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
  if p_parq_sim is null then raise exception 'parq_obrigatorio'; end if;
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
      and r.cancelada_em is null
      and r.whatsapp = v_zap
      and regexp_replace(lower(btrim(r.nome)), '\s+', ' ', 'g') = regexp_replace(lower(v_nome), '\s+', ' ', 'g')
  ) then raise exception 'ja_reservou'; end if;

  select count(*) into v_n from public.reservas where aula_id = p_aula and cancelada_em is null;
  if v_n >= v_aula.vagas then raise exception 'esgotado'; end if;

  loop
    v_cod := '';
    for i in 1..8 loop
      v_cod := v_cod || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(gen_random_bytes(1), 0) % 32), 1);
    end loop;
    begin
      insert into public.reservas (aula_id, nome, whatsapp, metodo, codigo, parq_em, parq_sim)
      values (p_aula, v_nome, v_zap, p_metodo, v_cod, now(), p_parq_sim);
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

drop function if exists public.painel_listar(text, uuid);
create or replace function public.painel_listar(p_senha text, p_aula uuid)
returns table (
  id uuid, nome text, whatsapp text, metodo text, codigo text,
  pago boolean, usado_em timestamptz, criado_em timestamptz, parq_sim boolean, cancelada_em timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  return query
    select r.id, r.nome, r.whatsapp, r.metodo, r.codigo, r.pago, r.usado_em, r.criado_em, r.parq_sim, r.cancelada_em
    from public.reservas r
    where r.aula_id = p_aula
    order by r.criado_em;
end;
$$;

drop function if exists public.painel_aulas(text);
create or replace function public.painel_aulas(p_senha text)
returns table (
  id uuid, titulo text, inicio timestamptz, vagas int, reservadas int, ativa boolean, liberada boolean,
  preco_pix int, preco_cartao int, preco_pix_de int, link_cartao text
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
           a.ativa, a.liberada, a.preco_pix, a.preco_cartao, a.preco_pix_de, a.link_cartao
    from public.aulas a
    where a.inicio > now() - interval '1 day'
    order by a.inicio;
end;
$$;

drop function if exists public.criar_aula(text, text, timestamptz, int, int, int, int);
create or replace function public.criar_aula(
  p_senha text, p_titulo text, p_inicio timestamptz, p_vagas int,
  p_preco_pix int, p_preco_cartao int, p_preco_pix_de int default null, p_link_cartao text default null
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
  insert into public.aulas (titulo, inicio, vagas, preco_pix, preco_cartao, preco_pix_de, link_cartao)
  values (btrim(p_titulo), p_inicio, p_vagas, p_preco_pix, p_preco_cartao, p_preco_pix_de, nullif(btrim(coalesce(p_link_cartao, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.atualizar_aula(
  p_senha text, p_aula uuid, p_titulo text, p_inicio timestamptz, p_vagas int,
  p_preco_pix int, p_preco_cartao int, p_preco_pix_de int default null, p_link_cartao text default null
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
         link_cartao = nullif(btrim(coalesce(p_link_cartao, '')), '')
   where id = p_aula;
end;
$$;

create or replace function public.excluir_aula(p_senha text, p_aula uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  if exists (select 1 from public.reservas where aula_id = p_aula and cancelada_em is null) then
    raise exception 'aula_com_reservas';
  end if;
  delete from public.aulas where id = p_aula;
  return 'ok';
end;
$$;

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
