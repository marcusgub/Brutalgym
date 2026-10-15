-- Horários das aulas para uma instalação nova (depois do schema.sql).
-- Se o banco já existe e você só quer as datas de novembro/dezembro, use atualizacao-novembro.sql.
-- inicio usa fuso de Brasília (-03). vagas = bicicletas disponíveis no horário.
-- preco_pix_de = preço "de" (riscado) quando há promoção no Pix; deixe null sem promoção.

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
