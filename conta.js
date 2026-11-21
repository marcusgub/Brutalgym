// Conta do cliente: login (Google ou e-mail), cadastro em 2 passos (contato + ficha de saúde),
// recuperar senha e "Minha conta". Usa o Supabase Auth. As telas de agenda ficam em cliente.js.
// Carregado ANTES de cliente.js (que define `app` e liga tudo no fim).

const ESTADO = {
  user: null,       // conta logada (Supabase Auth)
  perfil: null,     // retorno de meu_perfil()
  aulas: [], porDia: {}, faixa: [],
  fileiras: [5, 5, 5, 5, 5],
  dia: null, aulaId: null, bike: null,
  mapa: {},         // bike -> 'ocupada' | 'manutencao' | 'minha'
  fila: null,       // { total, posicao } da aula escolhida
  minhas: {},       // aula_id -> minha reserva
  aviso: ''
};

const VOLTAR = 'brutal_voltar';
// guarda o que a pessoa estava fazendo (aula/bike/fila) para retomar depois do login
function pendencia(v) {
  try { if (v) sessionStorage.setItem(VOLTAR, JSON.stringify(v)); else sessionStorage.removeItem(VOLTAR); } catch (e) { /* segue sem guardar */ }
}
function lerPendencia() {
  try { return JSON.parse(sessionStorage.getItem(VOLTAR) || 'null'); } catch (e) { return null; }
}

// ------------------------------------------------------------ utilitários
function normZap(z) {
  const d = String(z || '').replace(/\D/g, '');
  return d.length > 11 && d.startsWith('55') ? d.slice(2) : d;
}
function fmtZap(z) {
  const n = normZap(z);
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return n;
}
function mascaraZap(input) {
  input.addEventListener('input', () => {
    const d = input.value.replace(/\D/g, '').slice(0, 11);
    let t = d;
    if (d.length > 6) t = `(${d.slice(0, 2)}) ${d.slice(2, d.length > 10 ? 7 : 6)}-${d.slice(d.length > 10 ? 7 : 6)}`;
    else if (d.length > 2) t = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    input.value = t;
  });
}
function hojeISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }

function validarContato(nome, zap, nasc) {
  if (String(nome || '').trim().split(/\s+/).filter(Boolean).length < 2) return 'Digite seu nome completo (nome e sobrenome).';
  const z = normZap(zap);
  if (z.length < 10 || z.length > 11) return 'Confira o WhatsApp (com DDD).';
  if (!nasc) return 'Informe a data de nascimento.';
  if (nasc > hojeISO() || nasc < '1900-01-01') return 'Confira a data de nascimento.';
  const lim = new Date(); lim.setFullYear(lim.getFullYear() - 18);
  if (nasc > lim.toLocaleDateString('sv-SE')) return 'As aulas são só para maiores de 18 anos.';
  return '';
}

function msgAuth(e) {
  const m = ((e && e.message) || '').toLowerCase();
  if (m.includes('invalid login')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (m.includes('already registered')) return 'Esse e-mail já tem conta. Entre ou recupere a senha.';
  if (m.includes('password') && (m.includes('characters') || m.includes('weak'))) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas. Espere um pouco e tente de novo.';
  if (m.includes('invalid email') || m.includes('unable to validate email')) return 'Confira o e-mail digitado.';
  return 'Não deu certo agora. Confira sua internet e tente de novo.';
}

const ICONE_OLHO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICONE_GOOGLE = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

function campoSenha(id, rotulo, auto) {
  return `<div class="field"><label for="${id}">${rotulo}</label>
    <div class="senha"><input id="${id}" type="password" autocomplete="${auto}" placeholder="Mínimo de 8 caracteres" minlength="8" required>
    <button type="button" class="olho" aria-label="Mostrar senha" data-olho="${id}">${ICONE_OLHO}</button></div></div>`;
}
function ligarOlhos() {
  app.querySelectorAll('[data-olho]').forEach((b) => {
    b.onclick = () => {
      const i = document.getElementById(b.dataset.olho);
      const ver = i.type === 'password';
      i.type = ver ? 'text' : 'password';
      b.setAttribute('aria-label', ver ? 'Ocultar senha' : 'Mostrar senha');
    };
  });
}
function botaoGoogle() {
  return `<div class="ou"><span>ou</span></div>
    <button type="button" class="btn google" id="google">${ICONE_GOOGLE}<span>Continuar com Google</span></button>`;
}
function ligarGoogle(erroEl) {
  const b = document.getElementById('google');
  b.onclick = async () => {
    b.disabled = true;
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    if (error) {
      b.disabled = false;
      erroEl.textContent = 'Não consegui abrir o login do Google. Tente de novo ou use e-mail e senha.';
    }
  };
}

// ------------------------------------------------------------ topo (logo + entrar / conta)
function cabecalho() {
  const u = ESTADO.user;
  const nome = (ESTADO.perfil && ESTADO.perfil.nome) || (u && u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || '';
  const ini = (nome || (u && u.email) || '?').trim().charAt(0).toUpperCase();
  const lado = u
    ? `<button class="avatar" id="h-conta" aria-label="Minha conta">${esc(ini)}</button>`
    : '<button class="link entrar" id="h-entrar">Entrar</button>';
  return `<div class="row topo"><button type="button" class="logo-btn" id="h-inicio" aria-label="Voltar ao início">${marca()}</button>${lado}</div>`;
}
function ligarCabecalho() {
  const ini = document.getElementById('h-inicio');
  if (ini) ini.onclick = () => irParaInicio();
  const c = document.getElementById('h-conta');
  if (c) c.onclick = telaConta;
  const e = document.getElementById('h-entrar');
  if (e) e.onclick = () => telaEntrar();
}

// ------------------------------------------------------------ perfil
async function sessao() {
  const { data } = await sb.auth.getSession();
  ESTADO.user = (data && data.session && data.session.user) || null;
  return ESTADO.user;
}

async function carregarPerfil() {
  const { data, error } = await sb.rpc('meu_perfil');
  if (error || !data || !data[0]) {
    if (error && /nao_autenticado|jwt/i.test(error.message || '')) {
      await sb.auth.signOut().catch(() => {});
      ESTADO.user = null;
    }
    ESTADO.perfil = null;
    return null;
  }
  ESTADO.perfil = data[0];
  return ESTADO.perfil;
}

// Depois de qualquer login: completa o cadastro (passos 1 e 2) e volta para o que a pessoa fazia.
async function aposLogin() {
  app.innerHTML = cabecalho() + '<p class="mut">Entrando…</p>';
  await sessao();
  const p = await carregarPerfil();
  if (!p) return telaEntrar('Não consegui carregar sua conta. Entre de novo.');
  if (!p.perfil_completo) return telaCadastro1();
  if (!p.parq_ok) return telaCadastro2();
  return retomar();
}

async function retomar() {
  const pend = lerPendencia();
  pendencia(null);
  if (pend && pend.aula) {
    ESTADO.dia = pend.dia || ESTADO.dia;
    ESTADO.aulaId = pend.aula;
    ESTADO.bike = pend.bike || null;
    if (pend.acao === 'fila') {
      const { error } = await sb.rpc('entrar_fila', { p_aula: pend.aula });
      ESTADO.aviso = error ? msgErro(error) : 'Você entrou na fila de espera.';
      return telaAgenda();
    }
    if (pend.bike) return telaCheckout();
  }
  return telaAgenda();
}

// Garante cadastro completo antes de reservar/entrar na fila. Devolve true se pode seguir.
async function garantirCadastro(pend) {
  if (!ESTADO.perfil) await carregarPerfil();
  const p = ESTADO.perfil;
  if (!ESTADO.user || !p) { pendencia(pend); telaEntrar(); return false; }
  if (!p.perfil_completo) { pendencia(pend); telaCadastro1(); return false; }
  if (!p.parq_ok) { pendencia(pend); telaCadastro2(); return false; }
  return true;
}

// ------------------------------------------------------------ entrar
function telaEntrar(msg) {
  app.innerHTML = `
    <button class="link" id="voltar">‹ Voltar</button>
    <div class="stack"><span class="eyebrow">Bem-vindo de volta</span><h1>Entrar</h1><p class="mut">Entre para reservar sua bike.</p></div>
    <form id="f" class="stack" novalidate>
      <div class="field"><label for="email">E-mail</label>
        <input id="email" type="email" placeholder="voce@email.com" autocomplete="email" inputmode="email" required></div>
      ${campoSenha('senha', 'Senha', 'current-password')}
      <button class="link" type="button" id="esqueci" style="min-height:32px">Esqueci minha senha</button>
      <p id="erro" class="err" role="alert">${esc(msg || '')}</p>
      <button class="btn" type="submit">Entrar</button>
    </form>
    ${botaoGoogle()}
    <p class="center small mut">Ainda não tem conta? <button class="link inline" id="criar" type="button">Criar conta</button></p>`;
  ligarOlhos();
  const erro = document.getElementById('erro');
  ligarGoogle(erro);
  document.getElementById('voltar').onclick = () => { pendencia(null); telaAgenda(); };
  document.getElementById('criar').onclick = () => telaCriarConta();
  document.getElementById('esqueci').onclick = () => telaEsqueci(document.getElementById('email').value);
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const botao = e.target.querySelector('button[type=submit]');
    erro.textContent = '';
    if (!document.getElementById('email').value.trim() || !document.getElementById('senha').value) {
      erro.textContent = 'Preencha o e-mail e a senha.';
      return;
    }
    botao.disabled = true;
    const { error } = await sb.auth.signInWithPassword({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('senha').value
    });
    if (error) { botao.disabled = false; erro.textContent = msgAuth(error); return; }
    aposLogin();
  };
}

// ------------------------------------------------------------ criar conta (passo 1 de 2)
function telaCriarConta() {
  app.innerHTML = `
    <button class="link" id="voltar">‹ Voltar</button>
    <div class="stack"><span class="eyebrow">Passo 1 de 2</span><h1>Criar conta</h1>
      <p class="mut">Seus dados de contato. No passo seguinte vem a ficha de saúde.</p></div>
    <form id="f" class="stack" novalidate>
      <div class="field"><label for="nome">Nome completo</label>
        <input id="nome" type="text" placeholder="Seu nome" autocomplete="name" maxlength="100" required></div>
      <div class="field"><label for="email">E-mail</label>
        <input id="email" type="email" placeholder="voce@email.com" autocomplete="email" inputmode="email" required></div>
      <div class="duo">
        <div class="field"><label for="zap">WhatsApp</label>
          <input id="zap" type="tel" placeholder="(11) 91234-5678" autocomplete="tel" inputmode="tel" required></div>
        <div class="field"><label for="nasc">Data de nascimento</label>
          <input id="nasc" type="date" min="1900-01-01" max="${hojeISO()}" autocomplete="bday" required></div>
      </div>
      ${campoSenha('senha', 'Senha', 'new-password')}
      <p id="erro" class="err" role="alert"></p>
      <button class="btn" type="submit">Continuar</button>
      <p class="mut small center">No próximo passo você preenche a ficha de saúde. É rápido.</p>
    </form>
    ${botaoGoogle()}
    <p class="center small mut">Já tem conta? <button class="link inline" id="entrar" type="button">Entrar</button></p>`;
  ligarOlhos();
  mascaraZap(document.getElementById('zap'));
  const erro = document.getElementById('erro');
  ligarGoogle(erro);
  document.getElementById('voltar').onclick = () => { pendencia(null); telaAgenda(); };
  document.getElementById('entrar').onclick = () => telaEntrar();
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    erro.textContent = '';
    const nome = document.getElementById('nome').value.trim();
    const email = document.getElementById('email').value.trim();
    const zap = document.getElementById('zap').value;
    const nasc = document.getElementById('nasc').value;
    const senha = document.getElementById('senha').value;
    if (!email) { erro.textContent = 'Informe seu e-mail.'; return; }
    const ruim = validarContato(nome, zap, nasc);
    if (ruim) { erro.textContent = ruim; return; }
    if (senha.length < 8) { erro.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
    const botao = e.target.querySelector('button[type=submit]');
    botao.disabled = true;
    const { data, error } = await sb.auth.signUp({
      email, password: senha,
      options: {
        emailRedirectTo: location.origin + location.pathname,
        data: { full_name: nome, whatsapp: normZap(zap), nascimento: nasc }
      }
    });
    if (error) { botao.disabled = false; erro.textContent = msgAuth(error); return; }
    // e-mail já cadastrado: o Supabase não dá erro (para não revelar quem tem conta), só devolve sem identidades
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      botao.disabled = false;
      erro.textContent = 'Esse e-mail já tem conta. Entre ou recupere a senha.';
      return;
    }
    if (data.session) { aposLogin(); return; }
    telaConfirmeEmail(email);
  };
}

function telaConfirmeEmail(email) {
  app.innerHTML = `${marca()}
    <div class="stack"><span class="eyebrow">Quase lá</span><h1>Confirme seu e-mail</h1>
      <p class="mut">Enviamos um link para <b style="color:var(--txt)">${esc(email)}</b>. Abra o e-mail e toque no link para continuar com a ficha de saúde.</p>
      <p class="mut small">Não chegou? Veja a caixa de spam. O link abre este site já com a sua conta.</p></div>
    <button class="btn gray" id="entrar">Já confirmei, entrar</button>`;
  document.getElementById('entrar').onclick = () => telaEntrar();
}

// ------------------------------------------------------------ recuperar senha
function telaEsqueci(email) {
  app.innerHTML = `
    <button class="link" id="voltar">‹ Voltar</button>
    <div class="stack"><span class="eyebrow">Recuperar acesso</span><h1>Esqueci a senha</h1>
      <p class="mut">Digite seu e-mail e enviamos um link para criar uma senha nova.</p></div>
    <form id="f" class="stack" novalidate>
      <div class="field"><label for="email">E-mail</label>
        <input id="email" type="email" value="${esc(email || '')}" autocomplete="email" inputmode="email" required></div>
      <p id="erro" class="err" role="alert"></p>
      <button class="btn" type="submit">Enviar link</button>
    </form>`;
  document.getElementById('voltar').onclick = () => telaEntrar();
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const erro = document.getElementById('erro');
    const v = document.getElementById('email').value.trim();
    if (!v) { erro.textContent = 'Informe seu e-mail.'; return; }
    const botao = e.target.querySelector('button[type=submit]');
    botao.disabled = true;
    const { error } = await sb.auth.resetPasswordForEmail(v, { redirectTo: location.origin + location.pathname });
    botao.disabled = false;
    erro.style.color = error ? '' : 'var(--okchip)';
    erro.textContent = error ? msgAuth(error) : 'Se esse e-mail tem conta, o link já está a caminho.';
  };
}

function telaNovaSenha() {
  app.innerHTML = `${marca()}
    <div class="stack"><span class="eyebrow">Recuperar acesso</span><h1>Senha nova</h1></div>
    <form id="f" class="stack" novalidate>
      ${campoSenha('senha', 'Nova senha', 'new-password')}
      <p id="erro" class="err" role="alert"></p>
      <button class="btn" type="submit">Salvar e entrar</button>
    </form>`;
  ligarOlhos();
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const erro = document.getElementById('erro');
    const s = document.getElementById('senha').value;
    if (s.length < 8) { erro.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
    const botao = e.target.querySelector('button[type=submit]');
    botao.disabled = true;
    const { error } = await sb.auth.updateUser({ password: s });
    if (error) { botao.disabled = false; erro.textContent = msgAuth(error); return; }
    aposLogin();
  };
}

// ------------------------------------------------------------ passo 1 de 2 para quem já tem login (Google ou cadastro incompleto)
function telaCadastro1(msg) {
  const p = ESTADO.perfil || {};
  app.innerHTML = `
    <div class="stack"><span class="eyebrow">Passo 1 de 2</span><h1>Seus dados</h1>
      <p class="mut">Confirme seus dados de contato. No passo seguinte vem a ficha de saúde.</p></div>
    <form id="f" class="stack" novalidate>
      <div class="field"><label for="nome">Nome completo</label>
        <input id="nome" type="text" value="${esc(p.nome || '')}" placeholder="Seu nome" autocomplete="name" maxlength="100" required></div>
      <div class="field"><label for="email">E-mail</label>
        <input id="email" type="email" value="${esc(p.email || (ESTADO.user && ESTADO.user.email) || '')}" readonly></div>
      <div class="duo">
        <div class="field"><label for="zap">WhatsApp</label>
          <input id="zap" type="tel" value="${esc(p.whatsapp ? fmtZap(p.whatsapp) : '')}" placeholder="(11) 91234-5678" autocomplete="tel" inputmode="tel" required></div>
        <div class="field"><label for="nasc">Data de nascimento</label>
          <input id="nasc" type="date" min="1900-01-01" max="${hojeISO()}" value="${esc(p.nascimento || '')}" autocomplete="bday" required></div>
      </div>
      <p id="erro" class="err" role="alert">${esc(msg || '')}</p>
      <button class="btn" type="submit">Continuar</button>
      <button class="link" type="button" id="sair">Sair da conta</button>
    </form>`;
  mascaraZap(document.getElementById('zap'));
  document.getElementById('sair').onclick = sairConta;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const erro = document.getElementById('erro');
    erro.textContent = '';
    const nome = document.getElementById('nome').value.trim();
    const zap = document.getElementById('zap').value;
    const nasc = document.getElementById('nasc').value;
    const ruim = validarContato(nome, zap, nasc);
    if (ruim) { erro.textContent = ruim; return; }
    const botao = e.target.querySelector('button[type=submit]');
    botao.disabled = true;
    const { error } = await sb.rpc('salvar_perfil', { p_nome: nome, p_whatsapp: normZap(zap), p_nascimento: nasc });
    if (error) { botao.disabled = false; erro.textContent = msgErro(error); return; }
    await carregarPerfil();
    if (ESTADO.perfil && ESTADO.perfil.parq_ok) return retomar();
    telaCadastro2();
  };
}

// ------------------------------------------------------------ passo 2 de 2: ficha de saúde (PAR-Q)
async function telaCadastro2(msg) {
  app.innerHTML = marca() + '<p class="mut">Carregando…</p>';
  const m = await sb.rpc('parq_modelo');
  const modelo = m.data;
  if (m.error || !modelo || !modelo.perguntas) {
    app.innerHTML = marca() + '<p class="err">Não consegui carregar a ficha de saúde. Confira sua internet e tente de novo.</p><button class="btn" id="tentar">Tentar de novo</button>';
    document.getElementById('tentar').onclick = () => telaCadastro2(msg);
    return;
  }
  const PARQ = modelo.perguntas;
  const renovando = ESTADO.perfil && ESTADO.perfil.parq_em && !ESTADO.perfil.parq_ok;
  app.innerHTML = `
    <div class="stack"><span class="eyebrow">${renovando ? 'Ficha de saúde vencida' : 'Passo 2 de 2'}</span><h1>Ficha de saúde</h1>
      <p class="mut">${renovando ? 'Sua ficha tem mais de 12 meses. Responda de novo para continuar reservando.' : 'Questionário de prontidão para atividade física (PAR-Q). Você preenche uma vez e vale por 12 meses.'}</p></div>
    <form id="form" class="stack" novalidate>
      <div class="card stack parq">
        <p class="mut small">Leia com atenção e marque Sim ou Não em todas as perguntas.</p>
        ${PARQ.map((q, i) => `<div class="q"><p>${i + 1}. ${esc(q)}</p>
          <div class="opts"><label><input type="radio" name="q${i}" value="s" required> Sim</label><label><input type="radio" name="q${i}" value="n"> Não</label></div></div>`).join('')}
        <p id="parq-alerta" class="err small" hidden>Você respondeu "Sim" em alguma pergunta. Procure orientação de um profissional de saúde. Sua reserva só será liberada depois que a equipe confirmar presencialmente que você está apto(a).</p>
        <label class="aceite"><input id="parq-ok" name="parqok" type="checkbox" required> <span>${esc(modelo.declaracao)}</span></label>
      </div>
      <p id="erro" class="err" role="alert">${esc(msg || '')}</p>
      <button class="btn" type="submit">Concluir cadastro</button>
      <button class="link" type="button" id="sair">Sair da conta</button>
    </form>`;
  document.getElementById('sair').onclick = sairConta;
  const form = document.getElementById('form');
  form.addEventListener('change', () => {
    document.getElementById('parq-alerta').hidden = !PARQ.some((_, i) => form['q' + i].value === 's');
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const erro = document.getElementById('erro');
    erro.textContent = '';
    if (!form.reportValidity()) { erro.textContent = 'Responda todas as perguntas e marque a declaração para continuar.'; return; }
    const botao = form.querySelector('button[type=submit]');
    botao.disabled = true;
    const { error } = await sb.rpc('salvar_parq', { p_respostas: PARQ.map((_, i) => form['q' + i].value) });
    if (error) { botao.disabled = false; erro.textContent = msgErro(error); return; }
    await carregarPerfil();
    if (ESTADO.perfil && ESTADO.perfil.parq_pendente) return telaFichaPendente();
    retomar();
  };
}

function telaFichaPendente() {
  pendencia(null);
  app.innerHTML = `${marca()}
    <div class="stack"><span class="eyebrow">Ficha recebida</span><h1>Falta a liberação</h1>
      <p class="mut">Você respondeu "Sim" em alguma pergunta da ficha de saúde. Procure o instrutor no local: depois que ele confirmar presencialmente que você está apto(a), suas reservas são liberadas.</p></div>
    <button class="btn" id="agenda">Ver agenda</button>`;
  document.getElementById('agenda').onclick = telaAgenda;
}

// ------------------------------------------------------------ minha conta
async function telaConta() {
  if (!ESTADO.user) return telaEntrar();
  app.innerHTML = cabecalho() + '<p class="mut">Carregando…</p>';
  ligarCabecalho();
  const [p, r, f] = await Promise.all([carregarPerfil(), sb.rpc('minhas_reservas'), sb.rpc('minhas_filas')]);
  if (!p) return telaEntrar('Entre de novo para ver sua conta.');
  const reservas = (r.data || []);
  const filas = (f.data || []);
  const d = (v) => new Date(v).toLocaleDateString('pt-BR', { timeZone: TZ });
  const quando = (iso) => `${diaTexto(iso)} · ${horaTexto(iso)}`;

  const htmlReservas = reservas.map((x) => `<div class="card stack">
      <div class="row"><b style="font-size:18px">${esc(quando(x.inicio))}</b>${x.bike ? `<span class="chip">Bike ${esc(x.bike)}</span>` : ''}</div>
      <div class="row small"><span class="mut">${x.usado_em ? 'Já usada na entrada' : x.pago ? 'Pagamento confirmado' : 'Pagamento pendente'}</span>
        <span class="badge ${x.pago ? 'ok' : 'wait'}">${x.pago ? 'Pago' : 'Pendente'}</span></div>
      <button class="btn sm" data-qr="${esc(x.codigo)}">Ver QR Code${x.pago ? '' : ' e pagar'}</button>
    </div>`).join('') || '<p class="mut">Você ainda não tem aulas reservadas.</p>';

  const htmlFilas = filas.map((x) => `<div class="card ${x.tem_vaga ? 'hot' : ''} stack">
      <div class="row"><b style="font-size:18px">${esc(quando(x.inicio))}</b>
        ${x.tem_vaga ? '<span class="badge wait">Abriu vaga!</span>' : `<span class="chip">${esc(x.posicao)}º de ${esc(x.total)}</span>`}</div>
      <p class="mut small">${x.tem_vaga ? 'Tem bike livre agora. Quem reservar primeiro garante.' : 'A equipe avisa pelo WhatsApp se abrir vaga.'}</p>
      <div class="row">
        ${x.tem_vaga ? `<button class="btn sm" data-ver="${esc(x.aula_id)}" data-inicio="${esc(x.inicio)}">Escolher bike</button>` : ''}
        <button class="btn sm gray" data-sair-fila="${esc(x.aula_id)}">Sair da fila</button>
      </div></div>`).join('');

  let ficha;
  if (p.parq_pendente) ficha = '<span class="badge wait">Aguardando liberação</span><p class="mut small">Procure o instrutor no local para confirmar que você está apto(a).</p>';
  else if (p.parq_ok) ficha = `<span class="badge ok">Em dia</span><p class="mut small">Preenchida em ${esc(d(p.parq_em))}. Vale até ${esc(d(p.parq_valido_ate))}.</p>`;
  else ficha = `<span class="badge wait">${p.parq_em ? 'Vencida' : 'Não preenchida'}</span><button class="btn sm" id="ficha">Preencher ficha de saúde</button>`;

  app.innerHTML = `
    ${cabecalho()}
    <button class="link" id="voltar">‹ Ver agenda</button>
    <h1>Minha conta</h1>
    <div class="card stack">
      <b style="font-size:20px">${esc(p.nome || '')}</b>
      <span class="mut small">${esc(p.email || '')}</span>
      <span class="mut small">WhatsApp ${esc(p.whatsapp ? fmtZap(p.whatsapp) : '—')}</span>
    </div>
    <h2>Próximas aulas</h2>
    <div class="stack">${htmlReservas}</div>
    ${filas.length ? `<h2>Fila de espera</h2><div class="stack">${htmlFilas}</div>` : ''}
    <h2>Ficha de saúde</h2>
    <div class="card stack">${ficha}</div>
    <button class="btn gray" id="sair">Sair da conta</button>`;
  ligarCabecalho();
  document.getElementById('voltar').onclick = telaAgenda;
  document.getElementById('sair').onclick = sairConta;
  const fb = document.getElementById('ficha');
  if (fb) fb.onclick = () => telaCadastro2();
  app.querySelectorAll('[data-qr]').forEach((b) => { b.onclick = () => telaConfirmacao(b.dataset.qr); });
  app.querySelectorAll('[data-ver]').forEach((b) => {
    b.onclick = () => { ESTADO.aulaId = b.dataset.ver; ESTADO.dia = diaChave(b.dataset.inicio); ESTADO.bike = null; telaAgenda(); };
  });
  app.querySelectorAll('[data-sair-fila]').forEach((b) => {
    b.onclick = async () => { b.disabled = true; await sb.rpc('sair_fila', { p_aula: b.dataset.sairFila }); telaConta(); };
  });
}

async function sairConta() {
  await sb.auth.signOut().catch(() => {});
  ESTADO.user = null; ESTADO.perfil = null; ESTADO.minhas = {}; ESTADO.bike = null; ESTADO.fila = null;
  pendencia(null);
  telaAgenda();
}
