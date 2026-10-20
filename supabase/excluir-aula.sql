-- Permite excluir aula sem reservas pelo painel (rode UMA vez no SQL Editor).

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
  if exists (select 1 from public.reservas where aula_id = p_aula) then
    raise exception 'aula_com_reservas';
  end if;
  delete from public.aulas where id = p_aula;
  return 'ok';
end;
$$;
