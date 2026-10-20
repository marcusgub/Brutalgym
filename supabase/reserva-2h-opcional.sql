-- Regra das 2 horas OPCIONAL por aula (rode UMA vez no SQL Editor do Supabase, banco já existente):
--  * nova opção "reservas só abrem 2h antes" ao criar/editar a aula (padrão: DESLIGADA)
--  * aulas que já existem passam a ficar com as reservas abertas desde já
-- Pode rodar de novo sem problema.

alter table public.aulas add column if not exists reserva_2h boolean not null default false;

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
