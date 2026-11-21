# Bike no Galpão

Sistema MVP de reserva e controle de acesso para as aulas de spinning (só mobile).

- **Cliente** (`index.html`): entra com Google ou e-mail, escolhe o dia, o horário e a bike no mapa, reserva, recebe o QR Code e paga por Pix ou cartão. Aula lotada tem fila de espera. "Minha conta" mostra reservas, fila e a ficha de saúde.
- **Equipe** (`admin.html`, com senha): reservas e pagamentos (com bike e canceladas), criar/editar aulas (com bikes em manutenção), fila de espera (aviso por WhatsApp), mapa da sala, PAR-Q, Pix e link do cartão, senha do instrutor.
- **Instrutor** (`checkin.html`, senha própria): scanner de QR Code na entrada.
- O QR Code vale uma única entrada. Pagamento é confirmado manualmente (sem integração automática).

## Como funciona por dentro

Site estático (HTML, CSS e JavaScript, sem build) + banco no [Supabase](https://supabase.com). Hospedagem no Netlify, ligada a este repositório.

| Arquivo | O que é |
| --- | --- |
| `index.html`, `cliente.js`, `conta.js` | Páginas do cliente (agenda, mapa, reserva) e conta (login, cadastro, ficha de saúde) |
| `admin.html`, `admin.js` | Painel da equipe |
| `checkin.html`, `checkin.js` | Check-in (scanner) do instrutor |
| `config.js` | Configurações (Supabase, chave Pix, link do Mercado Pago, logo) |
| `styles.css`, `common.js` | Visual e funções compartilhadas |
| `supabase/schema.sql` | Tabelas e funções do banco |
| `supabase/limpar-aulas.sql` | Tira todas as datas do banco (aulas passam a ser criadas no painel) |
| `supabase/excluir-aula.sql` | Permite excluir aula sem reservas pelo painel (banco já existente) |
| `supabase/reserva-2h-opcional.sql` | Regra das 2 horas opcional por aula (banco já existente) |
| `supabase/parq-historico.sql` | Histórico completo de PAR-Q e proteção contra excluir aula com reservas (já incluso no atualizar-tudo) |
| `supabase/v2-contas-mapa-fila.sql` | **V2:** contas, mapa de bikes e fila de espera (rode depois do atualizar-tudo ou do schema) |
| `supabase/v2-limpeza.sql` | Roda depois que o site V2 estiver no ar: fecha a reserva sem conta e a busca de QR por nome + celular |
| `supabase/atualizar-tudo.sql` | **Banco que já existe: rode só este** (traz tudo na versão final, sem apagar dados) |
| `supabase/parq-completo.sql` | PAR-Q: registro/comprovante, liberação presencial, exportação (banco já existente) |
| `supabase/gestao-v2.sql` | Editar aula, cancelamentos no histórico, Pix/link editáveis, senha do instrutor (banco já existente) |
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

## Versão 2 (login, mapa de bikes, fila)

1. **Supabase > SQL Editor:** rode `supabase/v2-contas-mapa-fila.sql` (o site antigo continua funcionando).
2. **Supabase > Authentication > Providers > Google:** ative e cole o *Client ID* e o *Client Secret* de um OAuth Client criado no Google Cloud (tipo *Web application*). No Google Cloud, em *Authorized redirect URIs*, coloque a URL de callback que o Supabase mostra nessa tela.
3. **Supabase > Authentication > URL Configuration:** em *Site URL* coloque `https://bikenogalpao.com.br` e em *Redirect URLs* o mesmo endereço (e o do Netlify, se usar).
4. **Supabase > Authentication > Providers > Email:** mantenha a confirmação de e-mail ligada (padrão). Conferir o texto do e-mail em *Email Templates*.
5. **Painel > Config > Mapa da sala:** ajuste as bikes por fileira para o desenho real da sala (padrão `5,5,5,5,5`).
6. Faça o merge da `develop` na `main` (o Netlify publica) e teste uma reserva com a sua conta.
7. Só então rode `supabase/v2-limpeza.sql`.

Quem já reservou antes da V2 mantém o QR Code (o link `?r=CODIGO` segue valendo), mas precisa criar conta e preencher a ficha de saúde de novo para reservar.

## Segurança

- Nunca coloque a chave `service_role` em nenhum arquivo.
- As tabelas não têm acesso direto pelo navegador; tudo passa por funções do banco. As do cliente (perfil, reserva, fila) exigem login; as da equipe e da instrutora exigem a senha.
- Tentativas de senha errada demoram propositalmente.

## Layout por aula, administradores e tela inicial

- **Layout por aula:** ao criar/editar uma aula no painel (aba Aulas) informe as bikes por fileira (atalhos 15, 20, 25, 30) ou deixe vazio para usar o layout padrão (aba Config).
- **Administradores pelo app:** aba **Equipe** do painel. Entre uma vez com a senha da equipe, adicione o e-mail de quem já criou conta no site. Quem é admin entra no painel com a própria conta (link "Sou administrador" na tela de senha).
- **18+:** o cadastro só aceita maiores de 18 anos (validado na tela e no banco).
- **Tela inicial:** benefícios do spinning, como funciona e próximas aulas.
- Rode `supabase/v2-contas-mapa-fila.sql` (idempotente) antes de publicar o site.
