// Check-in da entrada (instrutor): scanner de QR Code com senha própria.
// Essa senha só abre esta tela; o painel completo (admin.html) tem outra senha.
const app = document.getElementById('app');
const overlay = document.getElementById('resultado');
const KEY = 'brutal_senha_checkin';
const TZ = 'America/Sao_Paulo';

let senha = '';
try { senha = sessionStorage.getItem(KEY) || ''; } catch (e) { /* ignora */ }
let aulas = [];
let aulaId = null;
let scanner = null;
let busy = false;

function aulaAtual() { return aulas.find((a) => a.id === aulaId); }

// ------------------------------------------------------------ login
function telaLogin(msg) {
  pararScanner();
  app.innerHTML = `${marca()}
    <div class="stack"><span class="eyebrow">Check-in da aula</span><h1>Entrar</h1></div>
    <form id="login" class="stack">
      <div class="field"><label for="senha">Senha do instrutor</label>
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
  const { data, error } = await sb.rpc('checar_senha_checkin', { p_senha: senha });
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
  await carregarAulas();
  desenhar();
}

async function carregarAulas() {
  const { data, error } = await sb.rpc('checkin_aulas', { p_senha: senha });
  if (error) {
    if ((error.message || '').includes('senha_invalida')) return sair();
    return;
  }
  aulas = data;
  if (!aulaId || !aulas.some((a) => a.id === aulaId)) {
    // escolhe a aula mais próxima de agora
    const agora = Date.now();
    const prox = aulas.slice().sort((x, y) => Math.abs(new Date(x.inicio) - agora) - Math.abs(new Date(y.inicio) - agora))[0];
    aulaId = prox ? prox.id : null;
  }
}

function horaAula(a) {
  return new Date(a.inicio).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

// ------------------------------------------------------------ tela do scanner
function desenhar() {
  pararScanner();
  if (!aulas.length) {
    app.innerHTML = `<div class="row">${marca()}<button class="link" id="sair" style="min-height:44px">Sair</button></div>
      <p class="mut">Nenhuma aula por perto agora. A lista mostra as aulas de hoje e de amanhã.</p>
      <button class="btn gray" id="atualizar">Atualizar</button>`;
    document.getElementById('sair').onclick = sair;
    document.getElementById('atualizar').onclick = async () => { await carregarAulas(); desenhar(); };
    return;
  }
  const opcoes = aulas.map((a) => `<option value="${esc(a.id)}" ${a.id === aulaId ? 'selected' : ''}>${esc(horaAula(a))}</option>`).join('');
  const aula = aulaAtual();
  app.innerHTML = `
    <div class="row">${marca()}<button class="link" id="sair" style="min-height:44px">Sair</button></div>
    <div class="field"><label for="aula">Aula</label><select id="aula">${opcoes}</select></div>
    <div class="card stack">
      <div class="row"><span class="mut">Entraram</span><span id="cnt" class="display" style="font-size:30px">${aula.entraram} / ${aula.reservadas}</span></div>
      <div class="bar green"><i id="cntbar" style="width:${aula.reservadas ? Math.round((aula.entraram / aula.reservadas) * 100) : 0}%"></i></div>
      <span class="mut small">${aula.reservadas} de ${aula.vagas} vagas reservadas</span>
    </div>
    <div id="reader"></div>
    <p class="center" style="font-size:18px;font-weight:500">Aponte para o QR Code do cliente</p>
    <p id="camera-erro" class="err center" role="alert"></p>
    <form id="manual" class="row" style="align-items:flex-end">
      <div class="field" style="flex:1"><label for="cod">Ou digite o código</label>
      <input id="cod" autocapitalize="characters" autocomplete="off" maxlength="12" placeholder="ABCD2345"></div>
      <button class="btn sm" type="submit" style="height:52px">Ler</button>
    </form>`;
  document.getElementById('sair').onclick = sair;
  document.getElementById('aula').onchange = (e) => { aulaId = e.target.value; desenhar(); };
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
    const hora = r.usado_em ? new Date(r.usado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '';
    return mostrar('bad', 'Código já utilizado', r.nome, fechar, hora ? 'Usado hoje às ' + hora : '');
  }
  if (r.status === 'cancelada') return mostrar('bad', 'Reserva cancelada', r.nome, fechar, 'Essa reserva foi cancelada pela equipe.');
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
    <span class="eyebrow">Check-in · ${esc(horaAula(aulaAtual() || { inicio: new Date().toISOString() }))}</span>
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
  await carregarAulas();
  const aula = aulaAtual();
  const campo = document.getElementById('cod');
  if (campo) campo.value = '';
  const cnt = document.getElementById('cnt');
  const barra = document.getElementById('cntbar');
  if (cnt && aula) cnt.textContent = aula.entraram + ' / ' + aula.reservadas;
  if (barra && aula) barra.style.width = (aula.reservadas ? Math.round((aula.entraram / aula.reservadas) * 100) : 0) + '%';
  try { if (scanner) scanner.resume(); } catch (e) { /* ignora */ }
}

iniciar();
