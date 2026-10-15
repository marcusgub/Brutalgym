-- Atualização para as novas datas (27/11 a 06/12) e preço promocional no Pix.
-- Cole no SQL Editor do Supabase e clique em Run (uma vez só).
--
-- CONFIRA OS VALORES ANTES DE RODAR:
--   27/11: Pix R$ 25 (50% off, "de" R$ 50) e cartão R$ 60
--   demais datas: Pix R$ 50 e cartão R$ 60
-- Para mudar depois, veja o fim deste arquivo.

-- 1) Coluna do preço "de" (para mostrar o desconto riscado)
alter table public.aulas add column if not exists preco_pix_de int;

-- 2) listar_aulas passa a devolver o preço "de"
drop function if exists public.listar_aulas();
create function public.listar_aulas()
returns table (
  id uuid, titulo text, inicio timestamptz, vagas int,
  reservadas int, preco_pix int, preco_cartao int, preco_pix_de int
)
language sql
security definer
set search_path = public
as $$
  select a.id, a.titulo, a.inicio, a.vagas,
         (select count(*)::int from public.reservas r where r.aula_id = a.id),
         a.preco_pix, a.preco_cartao, a.preco_pix_de
  from public.aulas a
  where a.ativa
  order by a.inicio;
$$;

-- 3) Tira do ar a aula antiga de 31/10 (as reservas dela continuam guardadas)
update public.aulas set ativa = false
where inicio = '2026-10-31 06:00:00-03';

-- 4) Novas aulas (25 bikes cada)
insert into public.aulas (titulo, inicio, vagas, preco_pix, preco_cartao, preco_pix_de) values
  ('Sex, 27/11 · 08:00', '2026-11-27 08:00:00-03', 25, 25, 60, 50),
  ('Sáb, 28/11 · 08:00', '2026-11-28 08:00:00-03', 25, 50, 60, null),
  ('Sáb, 28/11 · 09:00', '2026-11-28 09:00:00-03', 25, 50, 60, null),
  ('Dom, 29/11 · 08:00', '2026-11-29 08:00:00-03', 25, 50, 60, null),
  ('Dom, 29/11 · 09:00', '2026-11-29 09:00:00-03', 25, 50, 60, null),
  ('Sáb, 05/12 · 08:00', '2026-12-05 08:00:00-03', 25, 50, 60, null),
  ('Sáb, 05/12 · 09:00', '2026-12-05 09:00:00-03', 25, 50, 60, null),
  ('Dom, 06/12 · 08:00', '2026-12-06 08:00:00-03', 25, 50, 60, null),
  ('Dom, 06/12 · 09:00', '2026-12-06 09:00:00-03', 25, 50, 60, null);

-- Para mudar preços depois (exemplos, rode quando precisar):
--   update public.aulas set preco_pix = 50, preco_cartao = 60 where inicio >= '2026-11-28';
--   update public.aulas set preco_pix = 25, preco_pix_de = 50 where inicio = '2026-11-27 08:00:00-03';
--   update public.aulas set vagas = 20 where titulo = 'Sáb, 28/11 · 09:00';
