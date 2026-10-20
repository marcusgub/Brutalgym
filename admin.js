// Painel da equipe: reservas e pagamentos, aulas (criar/editar/liberar) e configurações de pagamento.
// O check-in da entrada (scanner) fica na página checkin.html, com senha própria.
const app = document.getElementById('app');
const KEY = 'brutal_senha';
const TZ = 'America/Sao_Paulo';
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

let senha = '';
try { senha = sessionStorage.getItem(KEY) || ''; } catch (e) { /* ignora */ }
let aulas = [];
let aulaId = null;
let reservas = [];
let filtro = 'todos';
let aba = 'reservas';
let parqLista = [];
let editando = null; // id da aula em edição na aba Aulas

function aulaAtual() { return aulas.find((a) => a.id === aulaId); }
function ativas() { return reservas.filter((r) => !r.cancelada_em); }

// ------------------------------------------------------------ login
function telaLogin(msg) {
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

async function recarregarAulas() {
  const r = await sb.rpc('painel_aulas', { p_senha: senha });
  if (!r.error) aulas = r.data;
  if (aulaId && !aulas.some((a) => a.id === aulaId)) aulaId = null;
  if (!aulaId && aulas.length) aulaId = (aulas.find((a) => a.ativa) || aulas[0]).id;
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
  const opcoes = aulas.map((a) => `<option value="${esc(a.id)}" ${a.id === aulaId ? 'selected' : ''}>${esc(a.titulo)}${a.ativa ? '' : ' (desativada)'}</option>`).join('');
  app.innerHTML = `
    <div class="row">${marca()}<button class="link" id="sair" style="min-height:44px">Sair</button></div>
    ${aba === 'reservas' ? `<div class="field"><label for="aula">Aula</label><select id="aula">${opcoes}</select></div>` : ''}
    <div id="conteudo" class="stack"></div>
    <div class="nav">
      <button id="t-res" class="${aba === 'reservas' ? 'on' : ''}">Reservas</button>
      <button id="t-aulas" class="${aba === 'aulas' ? 'on' : ''}">Aulas</button>
      <button id="t-parq" class="${aba === 'parq' ? 'on' : ''}">PAR-Q</button>
      <button id="t-conf" class="${aba === 'config' ? 'on' : ''}">Config</button>
    </div>`;
  document.getElementById('sair').onclick = sair;
  const sel = document.getElementById('aula');
  if (sel) sel.onchange = async (e) => { aulaId = e.target.value; await carregarReservas(); desenhar(); };
  document.getElementById('t-res').onclick = () => { aba = 'reservas'; desenhar(); };
  document.getElementById('t-aulas').onclick = () => { aba = 'aulas'; desenhar(); };
  document.getElementById('t-parq').onclick = () => { aba = 'parq'; desenhar(); };
  document.getElementById('t-conf').onclick = () => { aba = 'config'; desenhar(); };
  if (aba === 'reservas') listaReservas();
  else if (aba === 'aulas') telaAulas();
  else if (aba === 'parq') telaParq();
  else telaConfig();
}

// ------------------------------------------------------------ reservas e pagamentos
function listaReservas() {
  const box = document.getElementById('conteudo');
  const aula = aulaAtual();
  const ok = ativas();
  const canceladas = reservas.filter((r) => r.cancelada_em);
  const pagos = ok.filter((r) => r.pago).length;
  const pend = ok.length - pagos;
  const pct = ok.length ? Math.round((pagos / ok.length) * 100) : 0;
  const visiveis = filtro === 'canceladas' ? canceladas
    : ok.filter((r) => filtro === 'todos' || (filtro === 'pagos' ? r.pago : !r.pago));
  box.innerHTML = `
    <div class="card stack">
      <div class="row"><span class="mut">Pagamentos confirmados</span><span class="display" style="font-size:30px">${pagos} / ${ok.length}</span></div>
      <div class="bar green"><i style="width:${pct}%"></i></div>
      <span class="mut small">${aula ? ok.length + ' de ' + aula.vagas + ' vagas reservadas' : ''}</span>
    </div>
    <div class="tabs" style="flex-wrap:wrap">
      <button data-f="todos" class="${filtro === 'todos' ? 'on' : ''}">Todos ${ok.length}</button>
      <button data-f="pendentes" class="${filtro === 'pendentes' ? 'on' : ''}">Pendentes ${pend}</button>
      <button data-f="pagos" class="${filtro === 'pagos' ? 'on' : ''}">Pagos ${pagos}</button>
      <button data-f="canceladas" class="${filtro === 'canceladas' ? 'on' : ''}">Canceladas ${canceladas.length}</button>
    </div>
    <div class="stack" id="itens">${visiveis.map(itemHtml).join('') || '<p class="mut">Nenhuma reserva aqui ainda.</p>'}</div>
    <button class="btn gray" id="exportar">Exportar PAR-Q desta aula (planilha)</button>
    <p class="mut small center">Pix: confira no seu banco. Cartão: confira no Mercado Pago. Quem está como pago entra direto no check-in.</p>`;
  box.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { filtro = b.dataset.f; listaReservas(); }; });
  box.querySelectorAll('[data-parq]').forEach((b) => { b.onclick = () => verParq(b.dataset.parq); });
  const ex = document.getElementById('exportar');
  if (ex) ex.onclick = exportarParq;
  box.querySelectorAll('[data-pagar]').forEach((b) => { b.onclick = () => alterarPago(b.dataset.pagar, true, b); });
  box.querySelectorAll('[data-cancelar]').forEach((b) => { b.onclick = () => cancelar(b.dataset.cancelar, b.dataset.nome, b); });
  box.querySelectorAll('[data-desfazer]').forEach((b) => { b.onclick = () => alterarPago(b.dataset.desfazer, false, b); });
}

function dataHora(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

function itemHtml(r) {
  const metodo = r.metodo === 'pix' ? 'Pix' : 'Cartão';
  const parq = r.parq_sim !== true ? ''
    : r.parq_liberado ? '<span class="chip" style="background:var(--okchip);color:#0b1f10">PAR-Q: liberado</span>'
    : '<span class="chip" style="background:var(--or);color:#111">PAR-Q: Sim</span>';
  if (r.cancelada_em) {
    return `<div class="item" style="opacity:.75">
      <div class="stack" style="gap:2px"><div class="nm"><span>${esc(r.nome)}</span><span class="chip">${metodo}</span></div>
      <span class="mut small">Cancelada em ${esc(dataHora(r.cancelada_em))}</span></div>
      <span class="chip" style="background:var(--bad)">Cancelada</span></div>`;
  }
  const dica = r.usado_em ? 'Já entrou' : r.pago ? 'Confirmado' : (r.metodo === 'pix' ? 'Conferir no banco' : 'Conferir no Mercado Pago');
  const direita = r.pago
    ? `<div class="stack" style="gap:2px;align-items:flex-end"><span class="badge ok">Pago</span><button class="link" data-desfazer="${esc(r.id)}" style="min-height:32px;font-size:13px">Desfazer</button></div>`
    : `<div class="stack" style="gap:2px;align-items:flex-end"><button class="btn sm" data-pagar="${esc(r.id)}">Confirmar pago</button><button class="link" data-cancelar="${esc(r.id)}" data-nome="${esc(r.nome)}" style="min-height:32px;font-size:13px;color:#ff8a65">Cancelar e liberar vaga</button></div>`;
  return `<div class="item ${r.pago ? '' : 'pend'}">
    <div class="stack" style="gap:2px"><div class="nm"><span>${esc(r.nome)}</span><span class="chip">${metodo}</span>${parq}</div>
    <span class="mut small">${dica}</span>${r.parq_registrado ? `<button class="link" data-parq="${esc(r.id)}" style="min-height:32px;font-size:13px;color:var(--or)">Ver PAR-Q</button>` : '<span class="mut small">PAR-Q não registrado</span>'}</div>${direita}</div>`;
}

async function alterarPago(id, valor, botao) {
  botao.disabled = true;
  const { error } = await sb.rpc('marcar_pago', { p_senha: senha, p_reserva: id, p_pago: valor });
  if (error) { botao.disabled = false; alert(msgErro(error)); return; }
  await carregarReservas();
  listaReservas();
}

async function cancelar(id, nome, botao) {
  if (!confirm('Cancelar a reserva de ' + nome + ' e liberar a vaga? Ela fica guardada na aba Canceladas.')) return;
  botao.disabled = true;
  const { data, error } = await sb.rpc('cancelar_reserva', { p_senha: senha, p_reserva: id });
  if (error || data !== 'ok') { botao.disabled = false; alert(error ? msgErro(error) : 'Não foi possível cancelar (reserva paga ou já usada).'); return; }
  await recarregarAulas();
  await carregarReservas();
  desenhar();
}

// ------------------------------------------------------------ aulas (criar, editar, liberar, desativar)
function partesBR(iso) {
  const s = new Date(iso).toLocaleString('sv-SE', { timeZone: TZ }); // 2026-11-27 07:00:00
  return { data: s.slice(0, 10), hora: s.slice(11, 16) };
}

function tituloAuto(data, hora) {
  const [y, m, d] = data.split('-').map(Number);
  const dia = DIAS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  return `${dia}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} · ${hora}`;
}

function statusAula(a) {
  const ini = new Date(a.inicio).getTime();
  const agora = Date.now();
  if (!a.ativa) return { txt: 'Desativada', cls: '' };
  if (ini <= agora) return { txt: 'Já começou', cls: '' };
  if (!a.reserva_2h) return { txt: 'Reservas abertas', cls: 'ok' };
  if (a.liberada) return { txt: 'Liberada pela equipe', cls: 'ok' };
  if (agora >= ini - 2 * 3600 * 1000) return { txt: 'Reservas abertas', cls: 'ok' };
  return { txt: 'Aguardando (abre 2h antes)', cls: 'wait' };
}

// Formulário usado para criar (a = null) e para editar uma aula.
function formAulaHtml(id, a) {
  const p = a ? partesBR(a.inicio) : { data: '', hora: '' };
  return `<form id="${id}" class="stack" novalidate>
    <div class="row" style="align-items:flex-end">
      <div class="field" style="flex:1"><label>Data</label><input name="data" type="date" value="${esc(p.data)}" required></div>
      <div class="field" style="flex:1"><label>Hora</label><input name="hora" type="time" value="${esc(p.hora)}" required></div>
    </div>
    <div class="row" style="align-items:flex-end">
      <div class="field" style="flex:1"><label>Vagas</label><input name="vagas" type="number" inputmode="numeric" min="1" max="200" value="${a ? esc(a.vagas) : 25}" required></div>
      <div class="field" style="flex:1"><label>Pix R$</label><input name="pix" type="number" inputmode="numeric" min="0" value="${a ? esc(a.preco_pix) : 50}" required></div>
      <div class="field" style="flex:1"><label>Cartão R$</label><input name="car" type="number" inputmode="numeric" min="0" value="${a ? esc(a.preco_cartao) : 60}" required></div>
    </div>
    <div class="field"><label>Pix "de" R$ (só se for promoção, senão deixe vazio)</label><input name="de" type="number" inputmode="numeric" min="0" value="${a && a.preco_pix_de != null ? esc(a.preco_pix_de) : ''}"></div>
    <div class="field"><label>Link do cartão só desta aula (vazio = usa o link geral)</label><input name="link" type="url" inputmode="url" placeholder="https://mpago.li/..." value="${a && a.link_cartao ? esc(a.link_cartao) : ''}"></div>
    <div class="field"><label>Título (vazio = gerado pela data e hora)</label><input name="titulo" type="text" maxlength="60" value="${a ? esc(a.titulo) : ''}"></div>
    <label class="aceite"><input name="r2h" type="checkbox" ${a && a.reserva_2h ? 'checked' : ''}> <span>Reservas só abrem 2 horas antes do início (opcional)</span></label>
    <p class="err" data-erro role="alert"></p>
    <div class="row"><button class="btn" type="submit">${a ? 'Salvar alterações' : 'Criar aula'}</button>${a ? '<button class="btn gray" type="button" data-cancelar-edicao>Fechar</button>' : ''}</div>
  </form>`;
}

function lerFormAula(form, a) {
  const f = form.elements;
  const erro = form.querySelector('[data-erro]');
  const data = f.data.value;
  const hora = f.hora.value;
  if (!data || !hora) { erro.textContent = 'Escolha a data e a hora.'; return null; }
  let titulo = f.titulo.value.trim();
  const mudouHorario = a && partesBR(a.inicio).data + partesBR(a.inicio).hora !== data + hora;
  if (!titulo || (a && titulo === a.titulo && mudouHorario)) titulo = tituloAuto(data, hora);
  const de = f.de.value;
  return {
    p_senha: senha,
    p_titulo: titulo,
    p_inicio: `${data}T${hora}:00-03:00`,
    p_vagas: Number(f.vagas.value),
    p_preco_pix: Number(f.pix.value),
    p_preco_cartao: Number(f.car.value),
    p_preco_pix_de: de === '' ? null : Number(de),
    p_link_cartao: f.link.value.trim() || null,
    p_reserva_2h: f.r2h.checked
  };
}

function telaAulas() {
  const box = document.getElementById('conteudo');
  const itens = aulas.map((a) => {
    if (editando === a.id) {
      return `<div class="card hot stack"><b style="font-size:18px">Editar aula</b>${formAulaHtml('ed', a)}</div>`;
    }
    const st = statusAula(a);
    const comecou = new Date(a.inicio).getTime() <= Date.now();
    return `<div class="card stack">
      <div class="row"><b style="font-size:18px">${esc(a.titulo)}</b><span class="badge ${st.cls === 'ok' ? 'ok' : st.cls === 'wait' ? 'wait' : ''}" style="${st.cls ? '' : 'background:var(--line)'}">${esc(st.txt)}</span></div>
      <span class="mut small">${a.reservadas} de ${a.vagas} vagas · Pix R$ ${esc(a.preco_pix)}${a.preco_pix_de != null ? ' (de ' + esc(a.preco_pix_de) + ')' : ''} · Cartão R$ ${esc(a.preco_cartao)}${a.link_cartao ? ' · link próprio' : ''}</span>
      <div class="row">
        <button class="btn sm gray" data-editar="${esc(a.id)}">Editar</button>
        ${comecou || !a.reserva_2h ? '' : `<button class="btn sm gray" data-lib="${esc(a.id)}" data-v="${a.liberada ? '0' : '1'}">${a.liberada ? 'Voltar à regra das 2h' : 'Liberar reservas agora'}</button>`}
        <button class="btn sm gray" data-ativa="${esc(a.id)}" data-v="${a.ativa ? '0' : '1'}">${a.ativa ? 'Desativar' : 'Ativar'}</button>
      </div>
      ${a.reservadas === 0 ? `<button class="link" data-excluir="${esc(a.id)}" data-nome="${esc(a.titulo)}" style="min-height:32px;font-size:13px;color:#ff8a65">Excluir aula</button>` : ''}
    </div>`;
  }).join('');
  box.innerHTML = `
    <div class="card stack"><b style="font-size:18px">Nova aula</b>${formAulaHtml('nova', null)}
      <p class="mut small">Horário de Brasília. Sem a opção das 2 horas, as reservas abrem assim que a aula é criada e fecham no horário de início.</p></div>
    <h2>Aulas</h2>
    ${itens || '<p class="mut">Nenhuma aula.</p>'}`;
  document.getElementById('nova').onsubmit = criarAula;
  const ed = document.getElementById('ed');
  if (ed) {
    ed.onsubmit = (e) => salvarEdicao(e, aulas.find((a) => a.id === editando));
    ed.querySelector('[data-cancelar-edicao]').onclick = () => { editando = null; telaAulas(); };
  }
  box.querySelectorAll('[data-editar]').forEach((b) => { b.onclick = () => { editando = b.dataset.editar; telaAulas(); }; });
  box.querySelectorAll('[data-lib]').forEach((b) => { b.onclick = () => editarAula(b.dataset.lib, { p_liberada: b.dataset.v === '1' }, b); });
  box.querySelectorAll('[data-ativa]').forEach((b) => { b.onclick = () => editarAula(b.dataset.ativa, { p_ativa: b.dataset.v === '1' }, b); });
  box.querySelectorAll('[data-excluir]').forEach((b) => { b.onclick = () => excluirAula(b.dataset.excluir, b.dataset.nome, b); });
}

async function editarAula(id, campos, botao) {
  botao.disabled = true;
  const { error } = await sb.rpc('editar_aula', { p_senha: senha, p_aula: id, ...campos });
  if (error) { botao.disabled = false; alert(msgErro(error)); return; }
  await recarregarAulas();
  desenhar();
}

async function excluirAula(id, nome, botao) {
  if (!confirm('Excluir a aula ' + nome + '? Isso não pode ser desfeito.')) return;
  botao.disabled = true;
  const { error } = await sb.rpc('excluir_aula', { p_senha: senha, p_aula: id });
  if (error) { botao.disabled = false; alert(msgErro(error)); return; }
  await recarregarAulas();
  await carregarReservas();
  desenhar();
}

async function criarAula(e) {
  e.preventDefault();
  const form = e.target;
  const args = lerFormAula(form, null);
  if (!args) return;
  const botao = form.querySelector('button[type=submit]');
  botao.disabled = true;
  const { error } = await sb.rpc('criar_aula', args);
  if (error) { botao.disabled = false; form.querySelector('[data-erro]').textContent = msgErro(error); return; }
  await recarregarAulas();
  desenhar();
}

async function salvarEdicao(e, aula) {
  e.preventDefault();
  const form = e.target;
  const args = lerFormAula(form, aula);
  if (!args) return;
  const botao = form.querySelector('button[type=submit]');
  botao.disabled = true;
  const { error } = await sb.rpc('atualizar_aula', { ...args, p_aula: aula.id });
  if (error) { botao.disabled = false; form.querySelector('[data-erro]').textContent = msgErro(error); return; }
  editando = null;
  await recarregarAulas();
  await carregarReservas();
  desenhar();
}

// ------------------------------------------------------------ PAR-Q preenchido (comprovante)
function dataBR(iso) {
  return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: TZ }) : '';
}

function parqHtml(d) {
  const perg = (d.perguntas || []).map((q, i) => `<tr><td>${i + 1}. ${esc(q)}</td><td style="text-align:center;font-weight:700">${(d.respostas || [])[i] === 's' ? 'SIM' : 'NÃO'}</td></tr>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>PAR-Q · ${esc(d.nome)}</title>
  <style>body{font:15px/1.4 Arial,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#111}
  h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:14px 0}td{border:1px solid #999;padding:8px;vertical-align:top}
  .m{color:#444;font-size:13px}.box{border:1px solid #999;padding:10px;margin:14px 0}@media print{button{display:none}}</style></head><body>
  <button onclick="print()" style="float:right;padding:10px 16px;font-size:15px">Imprimir / salvar PDF</button>
  <h1>QUESTIONÁRIO DE PRONTIDÃO PARA ATIVIDADE FÍSICA (PAR-Q)</h1>
  <p class="m">${esc((cfg.MARCA || cfg.EVENTO || ''))} · registro eletrônico (modelo ${esc(d.versao || '')})</p>
  <p><b>Nome:</b> ${esc(d.nome)}<br><b>WhatsApp:</b> ${esc(fmtZap(d.whatsapp))}<br><b>Aula:</b> ${esc(d.aula)}<br><b>Código da reserva:</b> ${esc(d.codigo)}<br><b>Preenchido em:</b> ${esc(dataBR(d.registrado_em))}</p>
  <table>${perg}</table>
  <div class="box"><b>Declaração aceita:</b><br>${esc(d.declaracao)}</div>
  <p class="m">IP: ${esc(d.ip || 'não disponível')}<br>Aparelho: ${esc(d.dispositivo || 'não disponível')}</p>
  </body></html>`;
}

async function verParq(id) {
  const { data, error } = await sb.rpc('parq_documento', { p_senha: senha, p_reserva: id });
  if (error || !data) { alert(error ? msgErro(error) : 'Esta reserva não tem PAR-Q registrado.'); return; }
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela. Permita pop-ups para este site e tente de novo.'); return; }
  w.document.write(parqHtml(data));
  w.document.close();
}

async function exportarParq() {
  const { data, error } = await sb.rpc('parq_exportar', { p_senha: senha, p_aula: aulaId });
  if (error) { alert(msgErro(error)); return; }
  if (!data.length) { alert('Nenhum PAR-Q registrado nesta aula.'); return; }
  const perguntas = (data[0].documento.perguntas || []).map((_, i) => 'P' + (i + 1));
  const cab = ['Aula', 'Nome', 'WhatsApp', 'Código', 'Preenchido em', ...perguntas, 'Declaração aceita', 'IP', 'Aparelho', 'Cancelada em'];
  const linhas = data.map(({ documento: d }) => [
    d.aula, d.nome, d.whatsapp, d.codigo, dataBR(d.registrado_em),
    ...(d.respostas || []).map((r) => (r === 's' ? 'Sim' : 'Não')),
    'Sim', d.ip || '', d.dispositivo || '', d.cancelada_em ? dataBR(d.cancelada_em) : ''
  ]);
  const csv = [cab, ...linhas].map((l) => l.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'parq-' + (aulaAtual() ? aulaAtual().titulo.replace(/[^\w]+/g, '-') : 'aula') + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ------------------------------------------------------------ PAR-Q (liberação presencial)
function fmtZap(z) {
  const d = String(z).replace(/\D/g, '');
  const n = d.length > 11 ? d.slice(-11) : d;
  return n.length === 11 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` : (n.length === 10 ? `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}` : d);
}

async function telaParq() {
  const box = document.getElementById('conteudo');
  box.innerHTML = '<p class="mut">Carregando…</p>';
  const { data, error } = await sb.rpc('parq_painel', { p_senha: senha });
  if (error) { box.innerHTML = `<p class="err">${esc(msgErro(error))}</p>`; return; }
  parqLista = data;
  const pend = data.filter((p) => !p.liberado);
  const lib = data.filter((p) => p.liberado);
  const item = (p) => `<div class="item ${p.liberado ? '' : 'pend'}">
    <div class="stack" style="gap:2px"><div class="nm"><span>${esc(p.nome)}</span></div>
    <a class="mut small" href="tel:+${esc(String(p.whatsapp).startsWith('55') ? p.whatsapp : '55' + p.whatsapp)}">${esc(fmtZap(p.whatsapp))}</a></div>
    ${p.liberado
      ? `<div class="stack" style="gap:2px;align-items:flex-end"><span class="badge ok">Liberado</span><button class="link" data-bloq="${esc(p.whatsapp)}" style="min-height:32px;font-size:13px">Desfazer</button></div>`
      : `<button class="btn sm" data-lib="${esc(p.whatsapp)}" data-nome="${esc(p.nome)}">Liberar</button>`}</div>`;
  box.innerHTML = `
    <div class="card stack">
      <b style="font-size:18px">PAR-Q com resposta "Sim"</b>
      <p class="mut small">Essas pessoas só conseguem reservar depois que você confirmar, presencialmente, que estão aptas. Ao liberar, o celular fica liberado para todas as aulas.</p>
    </div>
    <h2>Pendentes ${pend.length}</h2>
    <div class="stack">${pend.map(item).join('') || '<p class="mut">Ninguém pendente.</p>'}</div>
    <h2>Liberados ${lib.length}</h2>
    <div class="stack">${lib.map(item).join('') || '<p class="mut">Ninguém liberado ainda.</p>'}</div>`;
  box.querySelectorAll('[data-lib]').forEach((b) => { b.onclick = () => liberarParq(b.dataset.lib, true, 'Confirma que você verificou presencialmente que ' + b.dataset.nome + ' está apta(o) para a atividade física?', b); });
  box.querySelectorAll('[data-bloq]').forEach((b) => { b.onclick = () => liberarParq(b.dataset.bloq, false, 'Desfazer a liberação desta pessoa? Ela volta a ficar pendente.', b); });
}

async function liberarParq(whatsapp, liberado, pergunta, botao) {
  if (!confirm(pergunta)) return;
  botao.disabled = true;
  const { error } = await sb.rpc('parq_liberar', { p_senha: senha, p_whatsapp: whatsapp, p_liberado: liberado });
  if (error) { botao.disabled = false; alert(msgErro(error)); return; }
  await carregarReservas();
  telaParq();
}

// ------------------------------------------------------------ configurações (pagamento e senha do instrutor)
async function telaConfig() {
  const box = document.getElementById('conteudo');
  box.innerHTML = '<p class="mut">Carregando…</p>';
  const { data } = await sb.rpc('config_pagamento');
  const pg = (data && data[0]) || {};
  box.innerHTML = `
    <form id="pg" class="card stack" novalidate>
      <b style="font-size:18px">Pagamento</b>
      <p class="mut small">Valem para todas as aulas (o link do cartão pode ser trocado só em uma aula, em Aulas > Editar). Deixar vazio volta ao valor do arquivo config.js.</p>
      <div class="field"><label for="c-chave">Chave Pix</label><input id="c-chave" type="text" autocomplete="off" value="${esc(pg.pix_chave || cfg.PIX_CHAVE || '')}"></div>
      <div class="field"><label for="c-nome">Nome do favorecido do Pix</label><input id="c-nome" type="text" autocomplete="off" value="${esc(pg.pix_nome || cfg.PIX_NOME || '')}"></div>
      <div class="field"><label for="c-link">Link do cartão (Mercado Pago)</label><input id="c-link" type="url" inputmode="url" value="${esc(pg.mp_link || cfg.MERCADO_PAGO_LINK || '')}"></div>
      <p id="pg-msg" class="err" role="alert"></p>
      <button class="btn" type="submit">Salvar pagamento</button>
    </form>
    <form id="sn" class="card stack" novalidate>
      <b style="font-size:18px">Check-in do instrutor</b>
      <p class="mut small">O instrutor usa a página de check-in, com senha própria (ela só abre o scanner de entrada, não o painel). Defina ou troque a senha aqui, com pelo menos 6 caracteres.</p>
      <div class="field"><label for="c-senha">Senha do instrutor</label><input id="c-senha" type="text" autocomplete="off" autocapitalize="none" minlength="6"></div>
      <p id="sn-msg" class="err" role="alert"></p>
      <button class="btn" type="submit">Salvar senha do instrutor</button>
      <a class="btn gray" href="checkin.html" target="_blank" rel="noopener">Abrir tela de check-in</a>
    </form>`;
  document.getElementById('pg').onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pg-msg');
    const botao = e.target.querySelector('button[type=submit]');
    botao.disabled = true;
    const { error } = await sb.rpc('salvar_pagamento', {
      p_senha: senha,
      p_chave: document.getElementById('c-chave').value,
      p_nome: document.getElementById('c-nome').value,
      p_link: document.getElementById('c-link').value
    });
    botao.disabled = false;
    msg.style.color = error ? '' : 'var(--okchip)';
    msg.textContent = error ? msgErro(error) : 'Pagamento salvo.';
  };
  document.getElementById('sn').onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('sn-msg');
    const nova = document.getElementById('c-senha').value;
    if (nova.length < 6) { msg.style.color = ''; msg.textContent = 'Use pelo menos 6 caracteres.'; return; }
    const botao = e.target.querySelector('button[type=submit]');
    botao.disabled = true;
    const { error } = await sb.rpc('definir_senha_checkin', { p_senha: senha, p_nova: nova });
    botao.disabled = false;
    msg.style.color = error ? '' : 'var(--okchip)';
    msg.textContent = error ? msgErro(error) : 'Senha do instrutor salva.';
    if (!error) document.getElementById('c-senha').value = '';
  };
}

iniciar();
