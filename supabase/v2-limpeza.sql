-- V2 LIMPEZA: rode UMA vez, SÓ DEPOIS que o site novo (com login) estiver no ar.
-- Fecha as portas antigas, que deixariam driblar a regra "só reserva quem tem conta":
--   reservar()            reserva com nome + WhatsApp, sem conta e sem bike
--   recuperar_reservas()  entrega o QR Code de alguém que souber só o nome + WhatsApp
--   parq_valido(), registrar_parq(), parq_origem()   PAR-Q por nome + WhatsApp (agora é por conta)
--   criar_aula(), atualizar_aula()                   versões antigas, com "vagas" digitado à mão
-- Não apaga nenhuma reserva nem PAR-Q já registrado.

drop function if exists public.reservar(uuid, text, text, text, text[], boolean);
drop function if exists public.recuperar_reservas(text, text);
drop function if exists public.parq_valido(text, text);
drop function if exists public.registrar_parq(text, text);
drop function if exists public.parq_origem(text, text);
drop function if exists public.criar_aula(text, text, timestamptz, int, int, int, int, text, boolean);
drop function if exists public.atualizar_aula(text, uuid, text, timestamptz, int, int, int, int, text, boolean);
