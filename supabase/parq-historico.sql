-- Histórico completo do PAR-Q (rode UMA vez no SQL Editor do Supabase, banco já existente):
--  * lista todos os PAR-Q registrados (aptos e "Sim"), de qualquer aula, mesmo de aulas já passadas
--  * excluir aula passa a ser impossível se ela tiver qualquer reserva (inclusive cancelada), para não perder o histórico
-- (O atualizar-tudo.sql já traz isso; este arquivo é só se você não quiser rodar tudo de novo.)

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
