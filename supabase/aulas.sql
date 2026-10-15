-- Horários das aulas para uma instalação nova (depois do schema.sql).
-- Banco que já tem aulas antigas: use atualizacao-datas.sql.
-- inicio usa fuso de Brasília (-03). vagas = bicicletas disponíveis no horário.
-- preco_pix_de = preço "de" (riscado) quando há promoção no Pix; null = sem promoção.

with nova (titulo, inicio, vagas, preco_pix, preco_cartao, preco_pix_de) as (
values
  ('Dom, 01/11 · 08:00', '2026-11-01 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Dom, 01/11 · 09:00', '2026-11-01 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Seg, 02/11 · 08:00', '2026-11-02 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Seg, 02/11 · 09:00', '2026-11-02 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sáb, 07/11 · 08:00', '2026-11-07 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sáb, 07/11 · 09:00', '2026-11-07 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Dom, 08/11 · 08:00', '2026-11-08 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Dom, 08/11 · 09:00', '2026-11-08 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sáb, 14/11 · 08:00', '2026-11-14 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sáb, 14/11 · 09:00', '2026-11-14 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Dom, 15/11 · 08:00', '2026-11-15 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Dom, 15/11 · 09:00', '2026-11-15 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sex, 20/11 · 08:00', '2026-11-20 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sex, 20/11 · 09:00', '2026-11-20 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sáb, 21/11 · 08:00', '2026-11-21 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sáb, 21/11 · 09:00', '2026-11-21 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Dom, 22/11 · 08:00', '2026-11-22 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Dom, 22/11 · 09:00', '2026-11-22 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sex, 27/11 · 07:00', '2026-11-27 07:00:00-03'::timestamptz, 25, 25, 35, 50),
  ('Sex, 27/11 · 18:00', '2026-11-27 18:00:00-03'::timestamptz, 25, 25, 35, 50),
  ('Sex, 27/11 · 19:00', '2026-11-27 19:00:00-03'::timestamptz, 25, 25, 35, 50),
  ('Sex, 27/11 · 20:00', '2026-11-27 20:00:00-03'::timestamptz, 25, 25, 35, 50),
  ('Sáb, 05/12 · 08:00', '2026-12-05 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sáb, 05/12 · 09:00', '2026-12-05 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Dom, 06/12 · 08:00', '2026-12-06 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Dom, 06/12 · 09:00', '2026-12-06 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sáb, 12/12 · 08:00', '2026-12-12 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sáb, 12/12 · 09:00', '2026-12-12 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Dom, 13/12 · 08:00', '2026-12-13 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Dom, 13/12 · 09:00', '2026-12-13 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sáb, 19/12 · 08:00', '2026-12-19 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Sáb, 19/12 · 09:00', '2026-12-19 09:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Dom, 20/12 · 08:00', '2026-12-20 08:00:00-03'::timestamptz, 25, 50, 60, null::int),
  ('Dom, 20/12 · 09:00', '2026-12-20 09:00:00-03'::timestamptz, 25, 50, 60, null::int)
)
insert into public.aulas (titulo, inicio, vagas, preco_pix, preco_cartao, preco_pix_de)
select n.titulo, n.inicio, n.vagas, n.preco_pix, n.preco_cartao, n.preco_pix_de
from nova n
where not exists (select 1 from public.aulas a where a.inicio = n.inicio and a.ativa);
