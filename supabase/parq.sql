-- PAR-Q na reserva (rode UMA vez no SQL Editor do Supabase, banco já existente):
--  * a reserva exige a declaração do PAR-Q; guarda quando foi feita e se houve algum "Sim"
--  * o painel mostra o alerta "PAR-Q: Sim" ao lado do nome
-- Pode rodar de novo sem problema.

alter table public.reservas add column if not exists parq_em timestamptz;
alter table public.reservas add column if not exists parq_sim boolean;

drop function if exists public.reservar(uuid, text, text, text);
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

drop function if exists public.painel_listar(text, uuid);
create or replace function public.painel_listar(p_senha text, p_aula uuid)
returns table (
  id uuid, nome text, whatsapp text, metodo text, codigo text,
  pago boolean, usado_em timestamptz, criado_em timestamptz, parq_sim boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  return query
    select r.id, r.nome, r.whatsapp, r.metodo, r.codigo, r.pago, r.usado_em, r.criado_em, r.parq_sim
    from public.reservas r
    where r.aula_id = p_aula
    order by r.criado_em;
end;
$$;

