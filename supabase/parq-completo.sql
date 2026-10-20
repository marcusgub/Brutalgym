-- PAR-Q completo (rode UMA vez no SQL Editor do Supabase, banco já existente).
-- Substitui parq.sql, parq-trava.sql, parq-liberacao.sql e parq-registro.sql (apagados do repositório).
-- Pré-requisito: gestao-v2.sql e reserva-2h-opcional.sql já rodados.
--  * o aluno responde as 7 perguntas e aceita a declaração; tudo fica registrado como comprovante
--  * quem responde "Sim" só reserva depois que a equipe liberar presencialmente (aba PAR-Q do painel)
--  * painel: "Ver PAR-Q" (imprimir/salvar PDF) e exportação da planilha da aula
-- Pode rodar de novo sem problema.

alter table public.reservas add column if not exists parq_em timestamptz;
alter table public.reservas add column if not exists parq_sim boolean;
alter table public.reservas add column if not exists parq_documento jsonb;

-- Pessoas que responderam "Sim" no PAR-Q (por celular). Só a equipe libera, presencialmente.
create table if not exists public.parq_pessoas (
  whatsapp text primary key,
  nome text not null,
  status text not null default 'pendente' check (status in ('pendente', 'liberado')),
  atualizado_em timestamptz not null default now()
);
alter table public.parq_pessoas enable row level security;
revoke all on public.parq_pessoas from anon, authenticated;

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
