-- Aulas de TESTE (rode no SQL Editor do Supabase). Os horários são relativos a "agora",
-- então funciona em qualquer dia:
--   * TESTE ABERTA   começa daqui a 1h30  -> reserva já liberada (dentro das 2h)
--   * TESTE FECHADA  começa amanhã        -> aparece bloqueada ("Reservas abrem ...")
-- Preço R$ 1 para testar Pix/cartão sem susto. Depois de testar, rode a limpeza abaixo.

insert into public.aulas (titulo, inicio, vagas, preco_pix, preco_cartao, preco_pix_de)
values
  ('TESTE ABERTA · não reservar', now() + interval '90 minutes', 3, 1, 1, null),
  ('TESTE FECHADA · não reservar', now() + interval '1 day', 3, 1, 1, null);

-- LIMPEZA (rode quando terminar; apaga as aulas de teste e as reservas delas):
-- delete from public.aulas where titulo like 'TESTE%';
