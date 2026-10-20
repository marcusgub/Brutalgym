-- Tira TODAS as datas do banco para você criar as aulas pelo painel (aba Aulas).
-- Rode UMA vez no SQL Editor do Supabase (depois do gestao-aulas.sql).
--  * aula SEM reservas: é apagada
--  * aula COM reservas (inclusive de teste): fica desativada, para não perder pagamentos

delete from public.aulas a
where not exists (select 1 from public.reservas r where r.aula_id = a.id);

update public.aulas set ativa = false where ativa;

-- Conferir o que sobrou (deve ser só aulas desativadas que têm reserva):
select a.titulo, a.ativa, (select count(*) from public.reservas r where r.aula_id = a.id) as reservas
from public.aulas a order by a.inicio;
