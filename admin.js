// Painel da instrutora: reservas e pagamentos + scanner de entrada.
const app = document.getElementById('app');
const overlay = document.getElementById('resultado');
const KEY = 'brutal_senha';

let senha = '';
try { senha = sessionStorage.getItem(KEY) || ''; } catch (e) { /* ignora */ }
let aulas = [];
let aulaId = null;
let reservas = [];
let filtro = 'todos';
let aba = 'reservas';
let scanner = null;
let busy = false;

function aulaAtual() { return aulas.find((a) => a.id === aulaId); }

// ------------------------------------------------------------ login
function telaLogin(msg) {
  pararScanner();
  app.innerHTML = `${marca()}
    <div class="stack"><span class="eyebrow">Área da equipe</span><h1>Entrar</h1></div>
    <form id="login" class="stack">
      <div class="field"><label for="senha">Senha</label>
      <input id="senha" type="password" autocomplete="current-password" required></div>
      <p id="erro" class="err" role="alert">${esc(msg || '')}</p>
      <button class="btn" type="submit">Entrar</button>
    </form>`;
  document.getElementById('login').onsubmit = async (e) => {
    e.preventDefault();
    senha = document.getElementById('senha').value;
    const erro = document.getElementById('erro');
    erro.textContent = 'Verificando…';
    const ok = await senhaCorreta();
    if (ok === true) {
      try { sessionStorage.setItem(KEY, senha); } catch (x) { /* ignora */ }
      iniciar();
    } else {
      erro.textContent = ok === false ? 'Senha incorreta.' : 'Não consegui conectar. Tente de novo.';
    }
  };
}

async function senhaCorreta() {
  const { data, error } = await sb.rpc('checar_senha', { p_senha: senha });
  if (error) return null;
  return data === true;
}

function sair() {
  senha = '';
  try { sessionStorage.removeItem(KEY); } catch (e) { /* ignora */ }
  telaLogin();
}

// ------------------------------------------------------------ início
async function iniciar() {
  if (!sb) {
    app.innerHTML = marca() + '<p class="mut">Site ainda não configurado. Preencha o arquivo config.js.</p>';
    return;
  }
  if (!senha) return telaLogin();
  const ok = await senhaCorreta();
  if (ok !== true) { senha = ''; return telaLogin(ok === false ? 'Senha incorreta.' : 'Não consegui conectar.'); }
  const { data, error } = await sb.rpc('painel_aulas', { p_senha: senha });
  if (error) { app.innerHTML = marca() + `<p class="err">${esc(msgErro(error))}</p>`; return; }
  aulas = data;
  if (!aulaId && aulas.length) aulaId = (aulas.find((a) => a.ativa) || aulas[0]).id;
  await carregarReservas();
  desenhar();
}

async function carregarReservas() {
  if (!aulaId) { reservas = []; return; }
  const { data, error } = await sb.rpc('painel_listar', { p_senha: senha, p_aula: aulaId });
  if (error) {
    if ((error.message || '').includes('senha_invalida')) return sair();
    reservas = [];
    return;
  }
  reservas = data;
}

// ------------------------------------------------------------ layout
function desenhar() {
  pararScanner();
  const opcoes = aulas.map((a) => `<option value="${esc(a.id)}" ${a.id === aulaId ? 'selected' : ''}>${esc(a.titulo)}${a.ativa ? '' : ' (desativada)'}</option>`).join('');
  app.innerHTML = `
    <div class="row">${marca()}<button class="link" id="sair" style="min-height:44px">Sair</button></div>
    <div class="field"><label for="aula">Aula</label><select id="aula">${opcoes}</select></div>
    <div id="conteudo" class="stack"></div>
    <div class="nav">
      <button id="t-res" class="${aba === 'reservas' ? 'on' : ''}">Reservas</button>
      <button id="t-scan" class="${aba === 'scanner' ? 'on' : ''}">Scanner</button>
      <button id="t-aulas" class="${aba === 'aulas' ? 'on' : ''}">Aulas</button>
    </div>`;
  document.getElementById('sair').onclick = sair;
  document.getElementById('aula').onchange = async (e) => { aulaId = e.target.value; await carregarReservas(); desenhar(); };
  document.getElementById('t-res').onclick = () => { aba = 'reservas'; desenhar(); };
  document.getElementById('t-scan').onclick = () => { aba = 'scanner'; desenhar(); };
  document.getElementById('t-aulas').onclick = () => { aba = 'aulas'; desenhar(); };
  if (aba === 'reservas') listaReservas(); else if (aba === 'aulas') telaAulas(); else telaScanner();
}

// ------------------------------------------------------------ reservas e pagamentos
function listaReservas() {
  const box = document.getElementById('conteudo');
  const aula = aulaAtual();
  const pagos = reservas.filter((r) => r.pago).length;
  const pend = reservas.length - pagos;
  const pct = reservas.length ? Math.round((pagos / reservas.length) * 100) : 0;
  const visiveis = reservas.filter((r) => filtro === 'todos' || (filtro === 'pagos' ? r.pago : !r.pago));
  box.innerHTML = `
    <div class="card stack">
      <div class="row"><span class="mut">Pagamentos confirmados</span><span class="display" style="font-size:30px">${pagos} / ${reservas.length}</span></div>
      <div class="bar green"><i style="width:${pct}%"></i></div>
      <span class="mut small">${aula ? reservas.length + ' de ' + aula.vagas + ' vagas reservadas' : ''}</span>
    </div>
    <div class="tabs">
      <button data-f="todos" class="${filtro === 'todos' ? 'on' : ''}">Todos ${reservas.length}</button>
      <button data-f="pendentes" class="${filtro === 'pendentes' ? 'on' : ''}">Pendentes ${pend}</button>
      <button data-f="pagos" class="${filtro === 'pagos' ? 'on' : ''}">Pagos ${pagos}</button>
    </div>
    <div class="stack" id="itens">${visiveis.map(itemHtml).join('') || '<p class="mut">Nenhuma reserva aqui ainda.</p>'}</div>
    <p class="mut small center">Pix: confira no seu banco. Cartão: confira no Mercado Pago. Quem está como pago entra direto no check-in.</p>`;
  box.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { filtro = b.dataset.f; listaReservas(); }; });
  box.querySelectorAll('[data-pagar]').forEach((b) => { b.onclick = () => alterarPago(b.dataset.pagar, true, b); });
  box.querySelectorAll('[data-cancelar]').forEach((b) => { b.onclick = () => cancelar(b.dataset.cancelar, b.dataset.nome, b); });
  box.querySelectorAll('[data-desfazer]').forEach((b) => { b.onclick = () => alterarPago(b.dataset.desfazer, false, b); });
}

function itemHtml(r) {
  const metodo = r.metodo === 'pix' ? 'Pix' : 'Cartão';
  const dica = r.usado_em ? 'Já entrou' : r.pago ? 'Confirmado' : (r.metodo === 'pix' ? 'Conferir no banco' : 'Conferir no Mercado Pago');
  const direita = r.pago
    ? `<div class="stack" style="gap:2px;align-items:flex-end"><span class="badge ok">Pago</span><button class="link" data-desfazer="${esc(r.id)}" style="min-height:32px;font-size:13px">Desfazer</button></div>`
    : `<div class="stack" style="gap:2px;align-items:flex-end"><button class="btn sm" data-pagar="${esc(r.id)}">Confirmar pago</button><button class="link" data-cancelar="${esc(r.id)}" data-nome="${esc(r.nome)}" style="min-height:32px;font-size:13px;color:#ff8a65">Cancelar e liberar vaga</button></div>`;
  return `<div class="item ${r.pago ? '' : 'pend'}">
    <div class="stack" style="gap:2px"><div class="nm"><span>${esc(r.nome)}</span><span class="chip">${metodo}</span></div>
    <span class="mut small">${dica}</span></div>${direita}</div>`;
}

async function alterarPago(id, valor, botao) {
  botao.disabled = true;
  const { error } = await sb.rpc('marcar_pago', { p_senha: senha, p_reserva: id, p_pago: valor });
  if (error) { botao.disabled = false; alert(msgErro(error)); return; }
  await carregarReservas();
  listaReservas();
}

async function cancelar(id, nome, botao) {
  if (!confirm('Cancelar a reserva de ' + nome + ' e liberar a vaga?')) return;
  botao.disabled = true;
  const { data, error } = await sb.rpc('cancelar_reserva', { p_senha: senha, p_reserva: id });
  if (error || data !== 'ok') { botao.disabled = false; alert(error ? msgErro(error) : 'Não foi possível cancelar (reserva paga ou já usada).'); return; }
  const novas = await sb.rpc('painel_aulas', { p_senha: senha });
  if (!novas.error) aulas = novas.data;
  await carregarReservas();
  desenhar();
}

// ------------------------------------------------------------ aulas (criar, liberar, desativar)
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function statusAula(a) {
  const ini = new Date(a.inicio).getTime();
  const agora = Date.now();
  if (!a.ativa) return { txt: 'Desativada', cls: '' };
  if (ini <= agora) return { txt: 'Já começou', cls: '' };
  if (a.liberada) return { txt: 'Liberada pela equipe', cls: 'ok' };
  if (agora >= ini - 2 * 3600 * 1000) return { txt: 'Reservas abertas', cls: 'ok' };
  return { txt: 'Aguardando (abre 2h antes)', cls: 'wait' };
}

function quando(iso) {
  return new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

function telaAulas() {
  const box = document.getElementById('conteudo');
  const itens = aulas.map((a) => {
    const st = statusAula(a);
    const comecou = new Date(a.inicio).getTime() <= Date.now();
    return `<div class="card stack">
      <div class="row"><b style="font-size:18px">${esc(a.titulo)}</b><span class="badge ${st.cls === 'ok' ? 'ok' : st.cls === 'wait' ? 'wait' : ''}" style="${st.cls ? '' : 'background:var(--line)'}">${esc(st.txt)}</span></div>
      <span class="mut small">${a.reservadas} de ${a.vagas} vagas reservadas</span>
      ${comecou ? '' : `<div class="row">
        <button class="btn sm gray" data-lib="${esc(a.id)}" data-v="${a.liberada ? '0' : '1'}">${a.liberada ? 'Voltar à regra das 2h' : 'Liberar reservas agora'}</button>
        <button class="btn sm gray" data-ativa="${esc(a.id)}" data-v="${a.ativa ? '0' : '1'}">${a.ativa ? 'Desativar' : 'Ativar'}</button>
      </div>`}
    </div>`;
  }).join('');
  box.innerHTML = `
    <form id="nova" class="card stack" novalidate>
      <b style="font-size:18px">Nova aula</b>
      <div class="row" style="align-items:flex-end">
        <div class="field" style="flex:1"><label for="n-data">Data</label><input id="n-data" type="date" required></div>
        <div class="field" style="flex:1"><label for="n-hora">Hora</label><input id="n-hora" type="time" required></div>
      </div>
      <div class="row" style="align-items:flex-end">
        <div class="field" style="flex:1"><label for="n-vagas">Vagas</label><input id="n-vagas" type="number" inputmode="numeric" min="1" max="200" value="25" required></div>
        <div class="field" style="flex:1"><label for="n-pix">Pix R$</label><input id="n-pix" type="number" inputmode="numeric" min="0" value="50" required></div>
        <div class="field" style="flex:1"><label for="n-car">Cartão R$</label><input id="n-car" type="number" inputmode="numeric" min="0" value="60" required></div>
      </div>
      <div class="field"><label for="n-de">Pix "de" R$ (só se for promoção, senão deixe vazio)</label><input id="n-de" type="number" inputmode="numeric" min="0"></div>
      <p id="n-erro" class="err" role="alert"></p>
      <button class="btn" type="submit">Criar aula</button>
      <p class="mut small">Horário de Brasília. A aula nova nasce bloqueada e abre sozinha 2 horas antes.</p>
    </form>
    <h2>Aulas</h2>
    ${itens || '<p class="mut">Nenhuma aula.</p>'}`;
  document.getElementById('nova').onsubmit = criarAula;
  box.querySelectorAll('[data-lib]').forEach((b) => { b.onclick = () => editarAula(b.dataset.lib, { p_liberada: b.dataset.v === '1' }, b); });
  box.querySelectorAll('[data-ativa]').forEach((b) => { b.onclick = () => editarAula(b.dataset.ativa, { p_ativa: b.dataset.v === '1' }, b); });
}

async function recarregarAulas() {
  const r = await sb.rpc('painel_aulas', { p_senha: senha });
  if (!r.error) aulas = r.data;
}

async function editarAula(id, campos, botao) {
  botao.disabled = true;
  const { error } = await sb.rpc('editar_aula', { p_senha: senha, p_aula: id, ...campos });
  if (error) { botao.disabled = false; alert(msgErro(error)); return; }
  await recarregarAulas();
  desenhar();
}

async function criarAula(e) {
  e.preventDefault();
  const erro = document.getElementById('n-erro');
  const data = document.getElementById('n-data').value;
  const hora = document.getElementById('n-hora').value;
  if (!data || !hora) { erro.textContent = 'Escolha a data e a hora.'; return; }
  const [y, m, d] = data.split('-').map(Number);
  const dia = DIAS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  const titulo = `${dia}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} · ${hora}`;
  const de = document.getElementById('n-de').value;
  const botao = e.target.querySelector('button[type=submit]');
  botao.disabled = true;
  const { error } = await sb.rpc('criar_aula', {
    p_senha: senha,
    p_titulo: titulo,
    p_inicio: `${data}T${hora}:00-03:00`,
    p_vagas: Number(document.getElementById('n-vagas').value),
    p_preco_pix: Number(document.getElementById('n-pix').value),
    p_preco_cartao: Number(document.getElementById('n-car').value),
    p_preco_pix_de: de === '' ? null : Number(de)
  });
  if (error) { botao.disabled = false; erro.textContent = msgErro(error); return; }
  await recarregarAulas();
  desenhar();
}

// ------------------------------------------------------------ scanner
function telaScanner() {
  const box = document.getElementById('conteudo');
  const aula = aulaAtual();
  const entraram = reservas.filter((r) => r.usado_em).length;
  box.innerHTML = `
    <div class="card stack">
      <div class="row"><span class="mut">Entraram</span><span id="cnt" class="display" style="font-size:30px">${entraram} / ${aula ? aula.vagas : ''}</span></div>
      <div class="bar green"><i id="cntbar" style="width:${aula ? Math.round((entraram / aula.vagas) * 100) : 0}%"></i></div>
    </div>
    <div id="reader"></div>
    <p class="center" style="font-size:18px;font-weight:500">Aponte para o QR Code do cliente</p>
    <p id="camera-erro" class="err center" role="alert"></p>
    <form id="manual" class="row" style="align-items:flex-end">
      <div class="field" style="flex:1"><label for="cod">Ou digite o código</label>
      <input id="cod" autocapitalize="characters" autocomplete="off" maxlength="12" placeholder="ABCD2345"></div>
      <button class="btn sm" type="submit" style="height:52px">Ler</button>
    </form>`;
  document.getElementById('manual').onsubmit = (e) => {
    e.preventDefault();
    const v = document.getElementById('cod').value.trim();
    if (v) tratarCodigo(v.toUpperCase());
  };
  iniciarScanner();
}

function iniciarScanner() {
  if (typeof Html5Qrcode === 'undefined') {
    document.getElementById('camera-erro').textContent = 'Não consegui carregar o leitor. Use o código digitado.';
    return;
  }
  scanner = new Html5Qrcode('reader');
  scanner
    .start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 } }, (texto) => tratarCodigo(String(texto).trim().toUpperCase()), () => {})
    .catch(() => {
      const el = document.getElementById('camera-erro');
      if (el) el.textContent = 'Não consegui abrir a câmera. Permita o acesso à câmera no navegador ou digite o código.';
    });
}

function pararScanner() {
  if (scanner) {
    const s = scanner;
    scanner = null;
    s.stop().then(() => s.clear()).catch(() => {});
  }
}

async function tratarCodigo(codigo) {
  if (busy) return;
  busy = true;
  try { if (scanner) scanner.pause(true); } catch (e) { /* ignora */ }
  const { data, error } = await sb.rpc('ler_qr', { p_senha: senha, p_codigo: codigo, p_aula: aulaId });
  if (error || !data || !data[0]) {
    return mostrar('bad', 'Erro', error ? msgErro(error) : 'Tente ler de novo.', fechar);
  }
  const r = data[0];
  if (r.status === 'ok') {
    const res = await liberar(codigo, false);
    if (res === 'ok') return mostrar('ok', 'Entrada liberada', r.nome, fechar, 'Pagamento: pago');
    return mostrar('bad', 'Não liberou', 'Leia o QR Code de novo.', fechar);
  }
  if (r.status === 'pendente') return mostrarPendente(codigo, r);
  if (r.status === 'ja_usado') {
    const hora = r.usado_em ? new Date(r.usado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    return mostrar('bad', 'Código já utilizado', r.nome, fechar, hora ? 'Usado hoje às ' + hora : '');
  }
  if (r.status === 'horario_diferente') return mostrar('bad', 'Horário diferente', r.nome, fechar, 'Esta reserva é de outra aula.');
  return mostrar('bad', 'Código inválido', 'Esse código não existe.', fechar);
}

async function liberar(codigo, marcarPago) {
  const { data, error } = await sb.rpc('liberar', { p_senha: senha, p_codigo: codigo, p_aula: aulaId, p_marcar_pago: marcarPago });
  return error ? 'erro' : data;
}

function mostrar(tipo, titulo, nome, aoFechar, extra) {
  overlay.className = 'overlay ' + tipo;
  overlay.innerHTML = `<h1>${esc(titulo)}</h1>
    <span class="who">${esc(nome)}</span>
    ${extra ? `<p style="font-size:17px">${esc(extra)}</p>` : ''}
    <button class="btn" id="proximo">Próximo</button>`;
  overlay.hidden = false;
  document.getElementById('proximo').onclick = aoFechar;
}

function mostrarPendente(codigo, r) {
  overlay.className = 'overlay wait';
  overlay.innerHTML = `
    <span class="eyebrow">Check-in · ${esc((aulaAtual() || {}).titulo || '')}</span>
    <h1>QR Code lido</h1>
    <div class="card hot stack">
      <span class="display" style="font-size:30px">${esc(r.nome)}</span>
      <div class="row"><span class="mut">Pagamento</span><span class="badge wait">Pendente</span></div>
      <div class="row"><span class="mut">Forma escolhida</span><b>${r.metodo === 'pix' ? 'Pix' : 'Cartão'}</b></div>
      <div class="row"><span class="mut">Valor a receber</span><b>R$ ${esc(r.preco)}</b></div>
    </div>
    <p class="mut">Receba o pagamento agora e depois marque como pago. Se já recebeu, é só confirmar.</p>
    <button class="btn" id="pagar" style="margin-top:auto">Marcar como pago e liberar</button>
    <button class="btn gray" id="cancelar">Cancelar</button>`;
  overlay.hidden = false;
  document.getElementById('cancelar').onclick = fechar;
  document.getElementById('pagar').onclick = async () => {
    const res = await liberar(codigo, true);
    if (res === 'ok') mostrar('ok', 'Entrada liberada', r.nome, fechar, 'Pagamento: pago');
    else mostrar('bad', 'Não liberou', 'Leia o QR Code de novo.', fechar);
  };
}

async function fechar() {
  overlay.hidden = true;
  overlay.innerHTML = '';
  busy = false;
  await carregarReservas();
  if (aba === 'scanner') {
    const campo = document.getElementById('cod');
    if (campo) campo.value = '';
    const aula = aulaAtual();
    const entraram = reservas.filter((r) => r.usado_em).length;
    const cnt = document.getElementById('cnt');
    const barra = document.getElementById('cntbar');
    if (cnt && aula) cnt.textContent = entraram + ' / ' + aula.vagas;
    if (barra && aula) barra.style.width = Math.round((entraram / aula.vagas) * 100) + '%';
    try { if (scanner) scanner.resume(); } catch (e) { /* ignora */ }
  }
}

iniciar();
