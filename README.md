# Bike no Galpão

Sistema MVP de reserva e controle de acesso para as aulas de spinning (só mobile).

- **Cliente** (`index.html`): escolhe o dia e o horário, reserva, recebe o QR Code e paga por Pix ou cartão.
- **Equipe** (`admin.html`, com senha): reservas e pagamentos (com canceladas), criar/editar aulas, Pix e link do cartão, senha do instrutor.
- **Instrutor** (`checkin.html`, senha própria): scanner de QR Code na entrada.
- O QR Code vale uma única entrada. Pagamento é confirmado manualmente (sem integração automática).

## Como funciona por dentro

Site estático (HTML, CSS e JavaScript, sem build) + banco no [Supabase](https://supabase.com). Hospedagem no Netlify, ligada a este repositório.

| Arquivo | O que é |
| --- | --- |
| `index.html`, `cliente.js` | Páginas do cliente |
| `admin.html`, `admin.js` | Painel da equipe |
| `checkin.html`, `checkin.js` | Check-in (scanner) do instrutor |
| `config.js` | Configurações (Supabase, chave Pix, link do Mercado Pago, logo) |
| `styles.css`, `common.js` | Visual e funções compartilhadas |
| `supabase/schema.sql` | Tabelas e funções do banco |
| `supabase/limpar-aulas.sql` | Tira todas as datas do banco (aulas passam a ser criadas no painel) |
| `supabase/excluir-aula.sql` | Permite excluir aula sem reservas pelo painel (banco já existente) |
| `supabase/gestao-v2.sql` | Editar aula, cancelamentos no histórico, Pix/link editáveis, senha do instrutor (banco já existente) |
| `supabase/parq.sql` | PAR-Q obrigatório na reserva (banco já existente) |
| `supabase/gestao-aulas.sql` | Criar, ativar e liberar aulas pelo painel (banco já existente) |
| `supabase/regras-negocio.sql` | Regras: reserva abre 2h antes, sem reserva duplicada, cancelar não pagos (banco já existente) |

## Colocar no ar

1. **Supabase:** no *SQL Editor*, rode `supabase/schema.sql`. As aulas são criadas depois, no painel da equipe (aba **Aulas**).
2. **Senha da instrutora** (rodar no SQL Editor, trocando `SUA_SENHA`; ela não fica no repositório):

   ```sql
   insert into public.config (chave, valor)
   values ('senha_hash', extensions.crypt('SUA_SENHA', extensions.gen_salt('bf')))
   on conflict (chave) do update set valor = excluded.valor;
   ```
3. **`config.js`:** preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` (Supabase > Settings > API, chave *anon / public*), a chave Pix, o nome e o link do Mercado Pago.
4. **Netlify:** *Add new site > Import an existing project*, escolha este repositório, deixe *build command* vazio e *publish directory* como `/` (raiz).

Cada alteração enviada para o GitHub atualiza o site sozinha.

## Segurança

- Nunca coloque a chave `service_role` em nenhum arquivo.
- As tabelas não têm acesso direto pelo navegador; tudo passa por funções do banco, e as da instrutora exigem a senha.
- Tentativas de senha errada demoram propositalmente.
