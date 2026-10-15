-- Regras de negócio (rode UMA vez no SQL Editor do Supabase, banco já existente):
--  * reserva só abre 2 horas antes da aula (antes disso a aula aparece bloqueada)
--  * mesma pessoa (mesmo nome + mesmo celular) não reserva a mesma aula duas vezes
--  * painel da equipe: cancelar reserva não paga e liberar a vaga
-- Pode rodar de novo sem problema.

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
         (now() >= a.inicio - interval '2 hours' and now() < a.inicio)
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
  if now() < v_aula.inicio - interval '2 hours' then raise exception 'ainda_nao_abriu'; end if;
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

-- Aulas para o painel da equipe (inclui aula em andamento e as de ontem).
create or replace function public.painel_aulas(p_senha text)
returns table (id uuid, titulo text, inicio timestamptz, vagas int, reservadas int)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.senha_ok(p_senha) then raise exception 'senha_invalida'; end if;
  return query
    select a.id, a.titulo, a.inicio, a.vagas,
           (select count(*)::int from public.reservas r where r.aula_id = a.id)
    from public.aulas a
    where a.ativa and a.inicio > now() - interval '1 day'
    order by a.inicio;
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

