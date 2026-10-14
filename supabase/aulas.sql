-- Horários das aulas. Edite, adicione linhas e rode no SQL Editor do Supabase.
-- inicio usa fuso de Brasília (-03). vagas = bicicletas disponíveis no horário.

insert into public.aulas (titulo, inicio, vagas, preco_pix, preco_cartao) values
  ('Sáb, 31/10 · 06:00', '2026-10-31 06:00:00-03', 25, 60, 75);

-- Exemplo de outro horário (tire os dois traços para usar):
-- insert into public.aulas (titulo, inicio, vagas, preco_pix, preco_cartao) values
--   ('Sáb, 31/10 · 08:00', '2026-10-31 08:00:00-03', 25, 60, 75);
