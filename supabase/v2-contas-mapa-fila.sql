-- V2: CONTAS (login), MAPA DE BIKES e FILA DE ESPERA.
-- Rode UMA vez no SQL Editor do Supabase, DEPOIS do atualizar-tudo.sql (ou do schema.sql, em banco novo).
-- Pode rodar de novo sem problema. Não apaga nenhum dado.
-- O site antigo continua funcionando até você publicar o novo. Depois que o site novo estiver no ar,
-- rode o v2-limpeza.sql (fecha as portas antigas: reserva sem conta e busca de QR por nome + celular).

-- ---------------------------------------------------------------- auxiliares

-- WhatsApp só com dígitos, sem o 55 do país (10 ou 11 dígitos)
create or replace function public.norm_zap(p text)
returns text
language sql
immutable
as $$
  select case when length(d) > 11 and left(d, 2) = '55' then substr(d, 3) else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

-- ---------------------------------------------------------------- tabelas

-- Uma linha por conta. Os dados de contato e a ficha de saúde (PAR-Q) ficam aqui.
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  email text,
  whatsapp text,       -- só dígitos, sem 55
  nascimento date,
  parq_em timestamptz, -- quando a ficha de saúde foi preenchida (vale 12 meses)
  parq_sim boolean,    -- true = respondeu "Sim" em alguma pergunta
  parq_documento jsonb, -- comprovante: texto oficial, respostas, data/hora, IP e aparelho
  admin boolean not null default false, -- administrador (entra no painel com a própria conta)
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- um WhatsApp por conta: impede refazer a ficha com outra conta para fugir de um "Sim"
create unique index if not exists perfis_whatsapp_unico on public.perfis (whatsapp) where whatsapp is not null;
alter table public.perfis enable row level security;
revoke all on public.perfis from anon, authenticated;

-- reservas: quem reservou (conta) e qual bike
alter table public.reservas add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.reservas add column if not exists bike int;
create index if not exists reservas_user_idx on public.reservas (user_id);
-- a mesma bike não pode ser reservada duas vezes na mesma aula (reserva cancelada libera a bike)
create unique index if not exists reservas_bike_unica on public.reservas (aula_id, bike)
  where bike is not null and cancelada_em is null;

-- aulas: bikes em manutenção nesta aula
alter table public.aulas add column if not exists bikes_bloqueadas int[] not null default '{}';
-- layout da sala desta aula (bikes por fileira). Vazio = usa o layout padrão do painel (Config).
alter table public.aulas add column if not exists fileiras int[];
-- perfis já criados por uma versão anterior deste arquivo
alter table public.perfis add column if not exists admin boolean not null default false;

create table if not exists public.fila_espera (
  id uuid primary key default gen_random_uuid(),
  aula_id uuid not null references public.aulas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now(),
  avisado_em timestamptz,
  unique (aula_id, user_id)
);
alter table public.fila_espera enable row level security;
revoke all on public.fila_espera from anon, authenticated;

-- ---------------------------------------------------------------- mapa da sala

-- Bikes por fileira, ex.: {5,5,5,5,5} = 25 bikes. Muda no painel (Config > Mapa da sala).
create or replace function public.mapa_fileiras()
returns int[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select string_to_array(valor, ',')::int[] from public.config where chave = 'mapa_fileiras'),
    array[5, 5, 5, 5, 5]
  );
$$;

-- Total de bikes de um layout (null = layout padrão)
create or replace function public.aula_total(p int[])
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(x), 0)::int from unnest(coalesce(p, public.mapa_fileiras())) x;
$$;

-- Texto "4,4,4,4" -> int[]. Vazio = null (usa o padrão). Máx. 10 fileiras de 1 a 15 bikes e 100 no total.
create or replace function public.parse_fileiras(p text)
returns int[]
language plpgsql
immutable
as $$
declare
  v int[];
  x int;
begin
  if p is null or btrim(p) = '' then return null; end if;
  begin
    select array_agg(btrim(t)::int) into v from unnest(string_to_array(p, ',')) t;
  exception when others then
    raise exception 'mapa_invalido';
  end;
  if v is null or cardinality(v) < 1 or cardinality(v) > 10 then raise exception 'mapa_invalido'; end if;
  foreach x in array v loop
    if x < 1 or x > 15 then raise exception 'mapa_invalido'; end if;
  end loop;
  if (select sum(y) from unnest(v) y) > 100 then raise exception 'mapa_invalido'; end if;
  return v;
end;
$$;

-- tira repetidas e números fora do layout
drop function if exists public.norm_bikes(int[]);
create or replace function public.norm_bikes(p int[], p_fileiras int[] default null)
returns int[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct b order by b), '{}'::int[])
  from unnest(coalesce(p, '{}'::int[])) b
  where b between 1 and public.aula_total(p_fileiras);
$$;

-- vagas da aula = bikes do layout menos as em manutenção
create or replace function public.aulas_calcula_vagas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.bikes_bloqueadas := public.norm_bikes(new.bikes_bloqueadas, new.fileiras);
  new.vagas := greatest(1, public.aula_total(new.fileiras) - coalesce(cardinality(new.bikes_bloqueadas), 0));
  return new;
end;
$$;
revoke all on function public.aulas_calcula_vagas() from public, anon, authenticated;

drop trigger if exists aulas_vagas_trg on public.aulas;
create trigger aulas_vagas_trg
  before insert or update of bikes_bloqueadas, fileiras on public.aulas
  for each row execute function public.aulas_calcula_vagas();
drop function if exists public.total_bikes();

-- ---------------------------------------------------------------- administradores (pela própria conta)

create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select pf.admin from public.perfis pf where pf.id = auth.uid()), false);
$$;

-- Quem é administrador entra no painel sem a senha compartilhada: as funções do painel já chamam
-- senha_ok / senha_checkin_ok, então basta elas aceitarem a conta de admin.
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
  if auth.uid() is not null and public.eh_admin() then return true; end if;
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
  if auth.uid() is not null and public.eh_admin() then return true; end if;
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

create or replace function public.listar_admins(p_senha text)
returns table (id uuid, nome text, email text)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  return query select pf.id, pf.nome, pf.email from public.perfis pf where pf.admin order by pf.nome, pf.email;
end;
$$;

-- A pessoa precisa já ter criado conta no site (entrar uma vez com Google ou e-mail).
create or replace function public.adicionar_admin(p_senha text, p_email text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  update public.perfis set admin = true where lower(email) = lower(btrim(coalesce(p_email, '')));
  if not found then raise exception 'conta_nao_encontrada'; end if;
end;
$$;

create or replace function public.remover_admin(p_senha text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  if (select count(*) from public.perfis where admin) <= 1 then raise exception 'ultimo_admin'; end if;
  update public.perfis set admin = false where id = p_id;
end;
$$;

-- ---------------------------------------------------------------- conta e ficha de saúde

-- uso interno: grava WhatsApp e nascimento (e o nome, se vier) com as validações
create or replace function public._aplicar_perfil(p_uid uuid, p_nome text, p_whatsapp text, p_nasc text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_zap text := public.norm_zap(p_whatsapp);
  v_nasc date;
begin
  if p_nome is not null and (char_length(v_nome) < 3 or char_length(v_nome) > 100) then raise exception 'nome_invalido'; end if;
  if char_length(v_zap) not between 10 and 11 then raise exception 'whatsapp_invalido'; end if;
  begin
    v_nasc := p_nasc::date;
  exception when others then
    raise exception 'nascimento_invalido';
  end;
  if v_nasc is null or v_nasc > current_date or v_nasc < date '1900-01-01' then raise exception 'nascimento_invalido'; end if;
  if v_nasc > (current_date - interval '18 years')::date then raise exception 'menor_de_idade'; end if;
  begin
    update public.perfis
       set nome = coalesce(nullif(v_nome, ''), nome), whatsapp = v_zap, nascimento = v_nasc, atualizado_em = now()
     where id = p_uid;
  exception when unique_violation then
    raise exception 'whatsapp_em_uso';
  end;
end;
$$;
revoke all on function public._aplicar_perfil(uuid, text, text, text) from public, anon, authenticated;

-- true quando a ficha de saúde (ou uma anterior, do mesmo WhatsApp) tem "Sim" e a equipe ainda não liberou
create or replace function public.parq_bloqueado(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      coalesce((select pf.parq_sim from public.perfis pf where pf.id = p_uid), false)
      or exists (select 1 from public.perfis pf join public.parq_pessoas pp on public.norm_zap(pp.whatsapp) = pf.whatsapp where pf.id = p_uid)
      or exists (select 1 from public.perfis pf join public.reservas r on public.norm_zap(r.whatsapp) = pf.whatsapp and r.parq_sim is true where pf.id = p_uid)
    )
    and not exists (
      select 1 from public.perfis pf join public.parq_pessoas pp on public.norm_zap(pp.whatsapp) = pf.whatsapp and pp.status = 'liberado'
      where pf.id = p_uid
    );
$$;
revoke all on function public.parq_bloqueado(uuid) from public, anon, authenticated;

-- Perfil da conta logada (cria a linha na primeira vez, com os dados do Google ou do cadastro por e-mail).
drop function if exists public.meu_perfil();
create or replace function public.meu_perfil()
returns table (
  nome text, email text, whatsapp text, nascimento date, perfil_completo boolean,
  parq_ok boolean, parq_em timestamptz, parq_valido_ate timestamptz, parq_pendente boolean, admin boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  u record;
  p public.perfis%rowtype;
begin
  if v_uid is null then raise exception 'nao_autenticado'; end if;
  select id, email, raw_user_meta_data into u from auth.users where id = v_uid;
  if not found then raise exception 'nao_autenticado'; end if;

  insert into public.perfis (id, email, nome)
  values (
    v_uid, u.email,
    nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), '')
  )
  on conflict (id) do nothing;

  select * into p from public.perfis where id = v_uid;

  -- cadastro por e-mail: os dados do formulário vêm junto (valem mesmo se a confirmação do e-mail for em outro aparelho)
  if p.whatsapp is null and p.nascimento is null and (u.raw_user_meta_data ->> 'whatsapp') is not null then
    begin
      perform public._aplicar_perfil(v_uid, null, u.raw_user_meta_data ->> 'whatsapp', u.raw_user_meta_data ->> 'nascimento');
    exception when others then
      null; -- dado inválido ou WhatsApp já usado: a tela pede de novo
    end;
    select * into p from public.perfis where id = v_uid;
  end if;

  return query select
    p.nome, p.email, p.whatsapp, p.nascimento,
    (p.nome is not null and p.whatsapp is not null and p.nascimento is not null),
    (p.parq_documento is not null and p.parq_em >= now() - interval '12 months'),
    p.parq_em,
    p.parq_em + interval '12 months',
    public.parq_bloqueado(v_uid),
    p.admin;
end;
$$;

-- Passo 1 do cadastro: nome, WhatsApp e nascimento.
create or replace function public.salvar_perfil(p_nome text, p_whatsapp text, p_nascimento text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'nao_autenticado'; end if;
  perform * from public.meu_perfil(); -- garante que a linha existe
  perform public._aplicar_perfil(v_uid, coalesce(p_nome, ''), p_whatsapp, p_nascimento);
end;
$$;

-- Passo 2 do cadastro: ficha de saúde (PAR-Q). Vale 12 meses.
create or replace function public.salvar_parq(p_respostas text[])
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  p public.perfis%rowtype;
  v_sim boolean;
  v_doc jsonb;
  v_hdr json;
  v_ip text;
  v_ua text;
begin
  if v_uid is null then raise exception 'nao_autenticado'; end if;
  select * into p from public.perfis where id = v_uid for update;
  if not found or p.nome is null or p.whatsapp is null or p.nascimento is null then raise exception 'perfil_incompleto'; end if;

  if coalesce(array_length(p_respostas, 1), 0) <> 7
     or exists (select 1 from unnest(p_respostas) x where x is null or x not in ('s', 'n')) then
    raise exception 'parq_obrigatorio';
  end if;

  -- quem respondeu "Sim" não refaz a ficha para trocar a resposta: só a equipe libera, presencialmente
  if p.parq_documento is not null and p.parq_em >= now() - interval '12 months' and coalesce(p.parq_sim, false) then
    raise exception 'parq_ja_respondido';
  end if;

  v_sim := 's' = any (p_respostas);

  begin
    v_hdr := nullif(current_setting('request.headers', true), '')::json;
    v_ip := split_part(coalesce(v_hdr ->> 'x-forwarded-for', v_hdr ->> 'cf-connecting-ip', ''), ',', 1);
    v_ua := left(coalesce(v_hdr ->> 'user-agent', ''), 300);
  exception when others then
    v_ip := null; v_ua := null;
  end;

  v_doc := public.parq_modelo() || jsonb_build_object(
    'respostas', to_jsonb(p_respostas),
    'nome', p.nome, 'whatsapp', p.whatsapp, 'email', p.email, 'nascimento', p.nascimento,
    'registrado_em', now(), 'ip', nullif(btrim(v_ip), ''), 'dispositivo', nullif(v_ua, '')
  );

  update public.perfis
     set parq_em = now(), parq_sim = v_sim, parq_documento = v_doc, atualizado_em = now()
   where id = v_uid;

  -- "Sim": entra na lista de pendentes do painel (aba PAR-Q), até a equipe liberar
  if v_sim and not exists (select 1 from public.parq_pessoas pp where public.norm_zap(pp.whatsapp) = p.whatsapp) then
    insert into public.parq_pessoas (whatsapp, nome) values (p.whatsapp, p.nome)
    on conflict (whatsapp) do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------- agenda e mapa (cliente)

drop function if exists public.listar_aulas();
create or replace function public.listar_aulas()
returns table (
  id uuid, titulo text, inicio timestamptz, vagas int,
  reservadas int, preco_pix int, preco_cartao int, preco_pix_de int,
  abre_em timestamptz, aberta boolean, reserva_2h boolean, na_fila int, fileiras int[]
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
         a.reserva_2h,
         (select count(*)::int from public.fila_espera f where f.aula_id = a.id),
         coalesce(a.fileiras, public.mapa_fileiras())
  from public.aulas a
  where a.ativa and a.inicio > now()
  order by a.inicio;
$$;

-- Bikes que NÃO estão livres nesta aula. Não mostra quem reservou; só marca a bike da própria pessoa ('minha').
create or replace function public.mapa_aula(p_aula uuid)
returns table (bike int, estado text)
language sql
stable
security definer
set search_path = public
as $$
  select r.bike, case when r.user_id is not null and r.user_id = auth.uid() then 'minha' else 'ocupada' end
  from public.reservas r
  where r.aula_id = p_aula and r.cancelada_em is null and r.bike is not null
  union all
  select b, 'manutencao'
  from public.aulas a, unnest(a.bikes_bloqueadas) b
  where a.id = p_aula;
$$;

-- ---------------------------------------------------------------- reserva

create or replace function public.reservar_v2(p_aula uuid, p_bike int, p_metodo text, p_confirma_saude boolean)
returns table (r_codigo text, r_aula text, r_nome text, r_metodo text, r_preco int, r_bike int)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  p public.perfis%rowtype;
  v_aula public.aulas%rowtype;
  v_n int;
  v_doc jsonb;
  v_hdr json;
  v_ip text;
  v_ua text;
  v_cod text;
  v_con text;
  v_try int := 0;
  i int;
begin
  if v_uid is null then raise exception 'nao_autenticado'; end if;
  if p_metodo not in ('pix', 'cartao') then raise exception 'metodo_invalido'; end if;

  select * into p from public.perfis where id = v_uid;
  if not found or p.nome is null or p.whatsapp is null or p.nascimento is null then raise exception 'perfil_incompleto'; end if;
  if p.parq_documento is null or p.parq_em < now() - interval '12 months' then raise exception 'parq_obrigatorio'; end if;
  if not coalesce(p_confirma_saude, false) then raise exception 'confirmacao_obrigatoria'; end if;
  -- "Sim" no PAR-Q: só reserva depois que a equipe confirmar presencialmente e liberar no painel
  if public.parq_bloqueado(v_uid) then raise exception 'parq_pendente'; end if;

  -- trava a linha da aula: duas pessoas não pegam a última vaga (nem a mesma bike) juntas
  select * into v_aula from public.aulas where id = p_aula and ativa for update;
  if not found then raise exception 'aula_nao_encontrada'; end if;
  if v_aula.reserva_2h and not v_aula.liberada and now() < v_aula.inicio - interval '2 hours' then raise exception 'ainda_nao_abriu'; end if;
  if now() >= v_aula.inicio then raise exception 'encerrada'; end if;

  -- uma reserva por pessoa em cada aula (também pega reservas antigas feitas sem conta, pelo mesmo WhatsApp)
  if exists (
    select 1 from public.reservas r
    where r.aula_id = p_aula and r.cancelada_em is null
      and (r.user_id = v_uid or public.norm_zap(r.whatsapp) = p.whatsapp)
  ) then raise exception 'ja_reservou'; end if;

  select count(*) into v_n from public.reservas where aula_id = p_aula and cancelada_em is null;
  if v_n >= v_aula.vagas then raise exception 'esgotado'; end if;

  if p_bike is null or p_bike < 1 or p_bike > public.aula_total(v_aula.fileiras) or p_bike = any (v_aula.bikes_bloqueadas) then
    raise exception 'bike_indisponivel';
  end if;
  if exists (select 1 from public.reservas r where r.aula_id = p_aula and r.cancelada_em is null and r.bike = p_bike) then
    raise exception 'bike_ocupada';
  end if;

  begin
    v_hdr := nullif(current_setting('request.headers', true), '')::json;
    v_ip := split_part(coalesce(v_hdr ->> 'x-forwarded-for', v_hdr ->> 'cf-connecting-ip', ''), ',', 1);
    v_ua := left(coalesce(v_hdr ->> 'user-agent', ''), 300);
  exception when others then
    v_ip := null; v_ua := null;
  end;

  -- comprovante da reserva: a ficha de saúde da conta + a confirmação feita agora
  v_doc := p.parq_documento || jsonb_build_object(
    'reaproveitado', true,
    'preenchido_original_em', to_jsonb(p.parq_em),
    'confirmacao', 'Confirmo que minha saúde não teve alterações desde o preenchimento do PAR-Q.',
    'nome', p.nome, 'whatsapp', p.whatsapp, 'aula', v_aula.titulo,
    'registrado_em', now(), 'ip', nullif(btrim(v_ip), ''), 'dispositivo', nullif(v_ua, '')
  );

  loop
    v_cod := '';
    for i in 1..8 loop
      v_cod := v_cod || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(gen_random_bytes(1), 0) % 32), 1);
    end loop;
    begin
      insert into public.reservas (aula_id, nome, whatsapp, metodo, codigo, parq_em, parq_sim, parq_documento, user_id, bike)
      values (p_aula, p.nome, p.whatsapp, p_metodo, v_cod, now(), coalesce(p.parq_sim, false), v_doc, v_uid, p_bike);
      exit;
    exception when unique_violation then
      get stacked diagnostics v_con = constraint_name;
      if v_con = 'reservas_bike_unica' then raise exception 'bike_ocupada'; end if;
      v_try := v_try + 1;
      if v_try > 5 then raise exception 'tente_novamente'; end if;
    end;
  end loop;

  delete from public.fila_espera where aula_id = p_aula and user_id = v_uid;

  return query select v_cod, v_aula.titulo, p.nome, p_metodo,
    case when p_metodo = 'pix' then v_aula.preco_pix else v_aula.preco_cartao end, p_bike;
end;
$$;

-- Reservas da conta (aulas que ainda não passaram).
create or replace function public.minhas_reservas()
returns table (codigo text, aula_id uuid, aula_titulo text, inicio timestamptz, bike int, metodo text, pago boolean, usado_em timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'nao_autenticado'; end if;
  return query
    select r.codigo, r.aula_id, a.titulo, a.inicio, r.bike, r.metodo, r.pago, r.usado_em
    from public.reservas r
    join public.aulas a on a.id = r.aula_id
    where r.user_id = auth.uid() and r.cancelada_em is null and a.inicio > now() - interval '12 hours'
    order by a.inicio;
end;
$$;

-- QR Code + pagamento de uma reserva, pelo código (o link enviado pela equipe usa isso)
drop function if exists public.ver_reserva(text);
create or replace function public.ver_reserva(p_codigo text)
returns table (
  aula_titulo text, nome text, metodo text, pago boolean,
  usado_em timestamptz, preco int, link_cartao text, cancelada boolean, bike int
)
language sql
security definer
set search_path = public
as $$
  select a.titulo, r.nome, r.metodo, r.pago, r.usado_em,
         case when r.metodo = 'pix' then a.preco_pix else a.preco_cartao end,
         a.link_cartao,
         (r.cancelada_em is not null),
         r.bike
  from public.reservas r
  join public.aulas a on a.id = r.aula_id
  where r.codigo = upper(btrim(p_codigo));
$$;

-- ---------------------------------------------------------------- fila de espera

create or replace function public.entrar_fila(p_aula uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  p public.perfis%rowtype;
  v_aula public.aulas%rowtype;
  v_n int;
begin
  if v_uid is null then raise exception 'nao_autenticado'; end if;
  select * into p from public.perfis where id = v_uid;
  if not found or p.nome is null or p.whatsapp is null or p.nascimento is null then raise exception 'perfil_incompleto'; end if;
  if p.parq_documento is null or p.parq_em < now() - interval '12 months' then raise exception 'parq_obrigatorio'; end if;
  if public.parq_bloqueado(v_uid) then raise exception 'parq_pendente'; end if;

  select * into v_aula from public.aulas where id = p_aula and ativa;
  if not found or now() >= v_aula.inicio then raise exception 'aula_nao_encontrada'; end if;
  if exists (
    select 1 from public.reservas r
    where r.aula_id = p_aula and r.cancelada_em is null and (r.user_id = v_uid or public.norm_zap(r.whatsapp) = p.whatsapp)
  ) then raise exception 'ja_reservou'; end if;

  select count(*) into v_n from public.reservas where aula_id = p_aula and cancelada_em is null;
  if v_n < v_aula.vagas then raise exception 'aula_com_vaga'; end if;

  insert into public.fila_espera (aula_id, user_id) values (p_aula, v_uid)
  on conflict (aula_id, user_id) do nothing;
end;
$$;

create or replace function public.sair_fila(p_aula uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'nao_autenticado'; end if;
  delete from public.fila_espera where aula_id = p_aula and user_id = auth.uid();
end;
$$;

-- Quantas pessoas estão na fila da aula e a posição de quem está logado (null = fora da fila).
create or replace function public.fila_info(p_aula uuid)
returns table (total int, posicao int)
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*)::int from public.fila_espera where aula_id = p_aula),
         (select x.pos from (
            select f.user_id, (row_number() over (order by f.criado_em, f.id))::int as pos
            from public.fila_espera f where f.aula_id = p_aula
          ) x where x.user_id = auth.uid());
$$;

-- Filas da conta logada. tem_vaga = abriu bike desde que a pessoa entrou na fila.
create or replace function public.minhas_filas()
returns table (aula_id uuid, aula_titulo text, inicio timestamptz, posicao int, total int, tem_vaga boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'nao_autenticado'; end if;
  return query
    select f.aula_id, a.titulo, a.inicio,
           (select count(*)::int from public.fila_espera f2 where f2.aula_id = f.aula_id and (f2.criado_em, f2.id) <= (f.criado_em, f.id)),
           (select count(*)::int from public.fila_espera f2 where f2.aula_id = f.aula_id),
           ((select count(*) from public.reservas r where r.aula_id = a.id and r.cancelada_em is null) < a.vagas)
    from public.fila_espera f
    join public.aulas a on a.id = f.aula_id
    where f.user_id = auth.uid() and a.ativa and a.inicio > now()
    order by a.inicio;
end;
$$;

-- ---------------------------------------------------------------- painel da equipe (exigem senha)

drop function if exists public.painel_listar(text, uuid);
create or replace function public.painel_listar(p_senha text, p_aula uuid)
returns table (
  id uuid, nome text, whatsapp text, metodo text, codigo text,
  pago boolean, usado_em timestamptz, criado_em timestamptz, parq_sim boolean, cancelada_em timestamptz,
  parq_liberado boolean, parq_registrado boolean, bike int
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
           exists (select 1 from public.parq_pessoas p where public.norm_zap(p.whatsapp) = public.norm_zap(r.whatsapp) and p.status = 'liberado'),
           (r.parq_documento is not null),
           r.bike
    from public.reservas r
    where r.aula_id = p_aula
    order by r.criado_em;
end;
$$;

drop function if exists public.painel_aulas(text);
create or replace function public.painel_aulas(p_senha text)
returns table (
  id uuid, titulo text, inicio timestamptz, vagas int, reservadas int, ativa boolean, liberada boolean,
  preco_pix int, preco_cartao int, preco_pix_de int, link_cartao text, reserva_2h boolean,
  bikes_bloqueadas int[], na_fila int, fileiras int[]
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
           a.ativa, a.liberada, a.preco_pix, a.preco_cartao, a.preco_pix_de, a.link_cartao, a.reserva_2h,
           a.bikes_bloqueadas,
           (select count(*)::int from public.fila_espera f where f.aula_id = a.id),
           coalesce(a.fileiras, public.mapa_fileiras())
    from public.aulas a
    where a.inicio > now() - interval '1 day'
    order by a.inicio;
end;
$$;

-- Criar aula. Layout (bikes por fileira, ex.: '4,4,4,4'; vazio = padrão) e bikes em manutenção definem as vagas.
drop function if exists public.criar_aula_v2(text, text, timestamptz, int, int, int, text, boolean, int[]);
create or replace function public.criar_aula_v2(
  p_senha text, p_titulo text, p_inicio timestamptz,
  p_preco_pix int, p_preco_cartao int, p_preco_pix_de int default null, p_link_cartao text default null,
  p_reserva_2h boolean default false, p_bikes_bloqueadas int[] default '{}', p_fileiras text default null
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
  if p_preco_pix is null or p_preco_pix < 0 or p_preco_cartao is null or p_preco_cartao < 0 then raise exception 'aula_invalida'; end if;
  insert into public.aulas (titulo, inicio, preco_pix, preco_cartao, preco_pix_de, link_cartao, reserva_2h, bikes_bloqueadas, fileiras)
  values (btrim(p_titulo), p_inicio, p_preco_pix, p_preco_cartao, p_preco_pix_de,
          nullif(btrim(coalesce(p_link_cartao, '')), ''), coalesce(p_reserva_2h, false), coalesce(p_bikes_bloqueadas, '{}'),
          public.parse_fileiras(p_fileiras))
  returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.atualizar_aula_v2(text, uuid, text, timestamptz, int, int, int, text, boolean, int[]);
create or replace function public.atualizar_aula_v2(
  p_senha text, p_aula uuid, p_titulo text, p_inicio timestamptz,
  p_preco_pix int, p_preco_cartao int, p_preco_pix_de int default null, p_link_cartao text default null,
  p_reserva_2h boolean default false, p_bikes_bloqueadas int[] default '{}', p_fileiras text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_fil int[] := public.parse_fileiras(p_fileiras);
  v_bloq int[] := public.norm_bikes(p_bikes_bloqueadas, public.parse_fileiras(p_fileiras));
  v_ativas int;
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  if char_length(btrim(coalesce(p_titulo, ''))) < 3 then raise exception 'aula_invalida'; end if;
  if p_inicio is null then raise exception 'aula_invalida'; end if;
  if p_preco_pix is null or p_preco_pix < 0 or p_preco_cartao is null or p_preco_cartao < 0 then raise exception 'aula_invalida'; end if;

  perform 1 from public.aulas where id = p_aula for update; -- evita corrida com uma reserva sendo feita agora
  select count(*) into v_ativas from public.reservas where aula_id = p_aula and cancelada_em is null;
  if v_ativas > public.aula_total(v_fil) - cardinality(v_bloq) then raise exception 'vagas_menor_que_reservas'; end if;
  -- o layout não pode encolher por cima de uma bike já reservada
  if exists (select 1 from public.reservas where aula_id = p_aula and cancelada_em is null and bike > public.aula_total(v_fil)) then
    raise exception 'mapa_com_reservas';
  end if;
  if exists (select 1 from public.reservas where aula_id = p_aula and cancelada_em is null and bike = any (v_bloq)) then
    raise exception 'bike_com_reserva';
  end if;

  update public.aulas
     set titulo = btrim(p_titulo), inicio = p_inicio,
         preco_pix = p_preco_pix, preco_cartao = p_preco_cartao, preco_pix_de = p_preco_pix_de,
         link_cartao = nullif(btrim(coalesce(p_link_cartao, '')), ''),
         reserva_2h = coalesce(p_reserva_2h, false),
         fileiras = v_fil,
         bikes_bloqueadas = v_bloq
   where id = p_aula;
end;
$$;

-- Layout PADRÃO da sala (usado pelas aulas sem layout próprio): bikes por fileira, ex.: '5,5,5,5,5'.
create or replace function public.salvar_mapa(p_senha text, p_fileiras text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_arr int[] := public.parse_fileiras(p_fileiras);
  v_total int;
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  if v_arr is null then raise exception 'mapa_invalido'; end if;
  v_total := public.aula_total(v_arr);

  insert into public.config (chave, valor) values ('mapa_fileiras', array_to_string(v_arr, ','))
  on conflict (chave) do update set valor = excluded.valor;

  -- não deixa o padrão encolher por cima de quem já reservou uma bike que deixaria de existir
  if exists (
    select 1 from public.reservas r join public.aulas a on a.id = r.aula_id
    where a.inicio > now() and a.fileiras is null and r.cancelada_em is null and r.bike > v_total
  ) then raise exception 'mapa_com_reservas'; end if;

  -- recalcula bikes em manutenção e vagas das aulas futuras que usam o padrão (o gatilho faz as contas)
  update public.aulas set bikes_bloqueadas = bikes_bloqueadas where inicio > now() and fileiras is null;

  if exists (
    select 1 from public.aulas a
    where a.inicio > now() and a.fileiras is null
      and (select count(*) from public.reservas r where r.aula_id = a.id and r.cancelada_em is null) > a.vagas
  ) then raise exception 'mapa_com_reservas'; end if;
end;
$$;

-- Fila de espera de uma aula, na ordem de chegada.
create or replace function public.painel_fila(p_senha text, p_aula uuid)
returns table (id uuid, nome text, whatsapp text, criado_em timestamptz, avisado_em timestamptz, posicao int)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  return query
    select f.id, p.nome, p.whatsapp, f.criado_em, f.avisado_em,
           (row_number() over (order by f.criado_em, f.id))::int
    from public.fila_espera f
    join public.perfis p on p.id = f.user_id
    where f.aula_id = p_aula
    order by f.criado_em, f.id;
end;
$$;

create or replace function public.marcar_fila_avisado(p_senha text, p_fila uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  update public.fila_espera set avisado_em = now() where id = p_fila;
end;
$$;

create or replace function public.remover_da_fila(p_senha text, p_fila uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  delete from public.fila_espera where id = p_fila;
end;
$$;

-- Ficha de saúde de quem ainda não reservou (a lista de pendentes da aba PAR-Q usa isto).
create or replace function public.parq_documento_pessoa(p_senha text, p_whatsapp text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v jsonb;
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  select pf.parq_documento into v from public.perfis pf where pf.whatsapp = public.norm_zap(p_whatsapp);
  return v;
end;
$$;

-- Check-in: agora também devolve a bike da pessoa.
drop function if exists public.ler_qr(text, text, uuid);
create or replace function public.ler_qr(p_senha text, p_codigo text, p_aula uuid)
returns table (status text, nome text, metodo text, pago boolean, usado_em timestamptz, preco int, bike int)
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
    return query select 'invalido'::text, null::text, null::text, null::boolean, null::timestamptz, null::int, null::int;
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
    case when r.metodo = 'pix' then a.preco_pix else a.preco_cartao end, r.bike;
end;
$$;

-- ---------------------------------------------------------------- quem pode chamar o quê

-- só logado
revoke all on function public.meu_perfil() from public, anon;
revoke all on function public.salvar_perfil(text, text, text) from public, anon;
revoke all on function public.salvar_parq(text[]) from public, anon;
revoke all on function public.reservar_v2(uuid, int, text, boolean) from public, anon;
revoke all on function public.minhas_reservas() from public, anon;
revoke all on function public.entrar_fila(uuid) from public, anon;
revoke all on function public.sair_fila(uuid) from public, anon;
revoke all on function public.minhas_filas() from public, anon;
grant execute on function public.meu_perfil() to authenticated;
grant execute on function public.salvar_perfil(text, text, text) to authenticated;
grant execute on function public.salvar_parq(text[]) to authenticated;
grant execute on function public.reservar_v2(uuid, int, text, boolean) to authenticated;
grant execute on function public.minhas_reservas() to authenticated;
grant execute on function public.entrar_fila(uuid) to authenticated;
grant execute on function public.sair_fila(uuid) to authenticated;
grant execute on function public.minhas_filas() to authenticated;
