// Página do cliente: horários -> reserva -> QR Code + pagamento.
const app = document.getElementById('app');
const GUARDADAS = 'brutal_reservas';
const TZ = 'America/Sao_Paulo';
const MOSTRAR = 3; // quantas aulas aparecem antes de "Quero ver todas"

function guardadas() {
  try { return JSON.parse(localStorage.getItem(GUARDADAS) || '[]'); } catch (e) { return []; }
}
function guardar(codigo) {
  try {
    const l = guardadas().filter((c) => c !== codigo);
    l.unshift(codigo);
    localStorage.setItem(GUARDADAS, JSON.stringify(l.slice(0, 5)));
  } catch (e) { /* sem armazenamento: segue sem guardar */ }
}

function diaChave(iso) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }); }
function diaTexto(iso) {
  const t = new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function horaTexto(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
// % de desconto no Pix (0 quando não há promoção)
function desconto(a) {
  return a.preco_pix_de && a.preco_pix_de > a.preco_pix
    ? Math.round((1 - a.preco_pix / a.preco_pix_de) * 100)
    : 0;
}

function semConfig() {
  app.innerHTML = marca() + '<p class="mut">Site ainda não configurado. Preencha a Project URL e a chave anon no arquivo config.js.</p>';
}

// ------------------------------------------------------------ 1. horários
async function telaHorarios() {
  if (!sb) return semConfig();
  app.innerHTML = marca() + '<p class="mut">Carregando horários…</p>';
  const { data, error } = await sb.rpc('listar_aulas');
  if (error) {
    app.innerHTML = marca() + `<p class="err">${esc(msgErro(error))}</p><button class="btn" id="tentar">Tentar de novo</button>`;
    document.getElementById('tentar').onclick = telaHorarios;
    return;
  }
  const minha = guardadas()[0];
  let html = marca() +
    '<div class="stack"><h1>Reserve sua bike</h1><p class="mut">Escolha o dia e o horário da aula de spinning.</p></div>';
  if (!data.length) html += '<p class="mut">Nenhum horário disponível por enquanto.</p>';

  let diaAtual = '';
  const itens = [];
  data.forEach((a) => {
    let bloco = '';
    const chave = diaChave(a.inicio);
    if (chave !== diaAtual) {
      diaAtual = chave;
      bloco += `<h2 class="day">${esc(diaTexto(a.inicio))}</h2>`;
    }
    const restam = a.vagas - a.reservadas;
    const pct = Math.min(100, Math.round((a.reservadas / a.vagas) * 100));
    const esgotado = restam <= 0;
    const poucas = !esgotado && restam <= 5;
    const off = desconto(a);
    const pix = off
      ? `Pix <s class="old">R$ ${esc(a.preco_pix_de)}</s> <b>R$ ${esc(a.preco_pix)}</b>`
      : `Pix <b>R$ ${esc(a.preco_pix)}</b>`;
    bloco += `<div class="card ${poucas || off ? 'hot' : ''} ${esgotado ? 'off' : ''} stack">
      <div class="row"><span class="time">${esc(horaTexto(a.inicio))}</span>
      <span class="${poucas ? 'badge wait' : 'mut small'}">${esgotado ? 'Esgotado' : poucas ? 'Últimas ' + restam + ' vagas' : restam + ' de ' + a.vagas + ' vagas'}</span></div>
      ${off && !esgotado ? `<div><span class="badge wait">${off}% OFF no Pix</span></div>` : ''}
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="row small"><span>${pix}</span><span class="mut">Cartão <b>R$ ${esc(a.preco_cartao)}</b></span></div>
      ${esgotado ? '' : `<button class="btn" data-aula="${esc(a.id)}">Reservar bike</button>`}
    </div>`;
    itens.push(bloco);
  });
  // Mostra só as primeiras aulas; o resto abre em "Quero ver todas"
  html += itens.slice(0, MOSTRAR).join('');
  if (itens.length > MOSTRAR) {
    html += `<button class="btn outline" id="todas">Quero ver todas as datas (+${itens.length - MOSTRAR})</button>
      <div id="mais" class="stack" hidden>${itens.slice(MOSTRAR).join('')}</div>`;
  }
  if (minha) html += '<button class="btn gray" id="minha">Ver minha reserva</button>';
  html += '<p class="mut small center">Pagamento por Pix ou cartão. Vagas limitadas por horário.</p>';
  app.innerHTML = html;
  app.querySelectorAll('[data-aula]').forEach((b) => {
    b.onclick = () => telaReserva(data.find((a) => a.id === b.dataset.aula));
  });
  const bt = document.getElementById('todas');
  if (bt) bt.onclick = () => { document.getElementById('mais').hidden = false; bt.remove(); };
  const bm = document.getElementById('minha');
  if (bm) bm.onclick = () => telaConfirmacao(minha);
}

// ------------------------------------------------------------ 2. reserva
function telaReserva(aula) {
  const off = desconto(aula);
  app.innerHTML = `
    <button class="link" id="voltar">‹ Voltar</button>
    <div class="stack">
      <span class="eyebrow">Você está reservando</span>
      <h1>${esc(aula.titulo)}</h1>
      <p class="mut">${esc(cfg.EVENTO)}</p>
    </div>
    <form id="form" class="stack" novalidate>
      <div class="field"><label for="nome">Nome completo</label>
        <input id="nome" name="nome" type="text" placeholder="Seu nome" autocomplete="name" required minlength="2" maxlength="100"></div>
      <div class="field"><label for="zap">WhatsApp</label>
        <input id="zap" name="zap" type="tel" placeholder="(11) 90000-0000" autocomplete="tel" inputmode="tel" required></div>
      <span style="font-size:15px;font-weight:500">Como você quer pagar?</span>
      <div class="pay">
        <button type="button" class="pix" data-metodo="pix"><b>Pix${off ? ' · ' + off + '% off' : ''}</b><strong>R$ ${esc(aula.preco_pix)}</strong><small>${off ? '<s>R$ ' + esc(aula.preco_pix_de) + '</s> · ' : ''}Chave Pix na próxima tela</small></button>
        <button type="button" class="card" data-metodo="cartao"><b>Cartão</b><strong>R$ ${esc(aula.preco_cartao)}</strong><small>Link de pagamento do Mercado Pago</small></button>
      </div>
      <p id="erro" class="err" role="alert"></p>
      <p class="mut small">Ao escolher a forma de pagamento, sua reserva é confirmada e o QR Code aparece na próxima tela. Pague até a hora da aula.</p>
    </form>`;
  document.getElementById('voltar').onclick = telaHorarios;
  const form = document.getElementById('form');
  const erro = document.getElementById('erro');
  form.querySelectorAll('[data-metodo]').forEach((b) => {
    b.onclick = async () => {
      erro.textContent = '';
      if (!form.reportValidity()) return;
      const botoes = form.querySelectorAll('button');
      botoes.forEach((x) => (x.disabled = true));
      const { data, error } = await sb.rpc('reservar', {
        p_aula: aula.id,
        p_nome: form.nome.value,
        p_whatsapp: form.zap.value,
        p_metodo: b.dataset.metodo
      });
      if (error || !data || !data[0]) {
        erro.textContent = msgErro(error);
        botoes.forEach((x) => (x.disabled = false));
        return;
      }
      guardar(data[0].r_codigo);
      telaConfirmacao(data[0].r_codigo);
    };
  });
}

// ------------------------------------------------------------ 3. QR Code + pagamento
async function telaConfirmacao(codigo) {
  app.innerHTML = marca() + '<p class="mut">Carregando sua reserva…</p>';
  const { data, error } = await sb.rpc('ver_reserva', { p_codigo: codigo });
  if (error || !data || !data[0]) {
    app.innerHTML = marca() + '<p class="err">Não encontrei essa reserva.</p><button class="btn" id="inicio">Voltar ao início</button>';
    document.getElementById('inicio').onclick = telaHorarios;
    return;
  }
  const r = data[0];
  const pix = r.metodo === 'pix';
  let pagamento;
  if (r.pago) {
    pagamento = '<div class="card hot stack"><span class="badge ok">Pagamento confirmado</span><p class="mut small">Pode ir tranquilo: é só mostrar o QR Code na entrada.</p></div>';
  } else if (pix) {
    pagamento = `<div class="card hot stack">
      <span class="eyebrow">Pague via Pix</span>
      <div class="row"><span class="mut">Valor</span><b>R$ ${esc(r.preco)}</b></div>
      <div class="row"><span class="mut">Chave Pix</span><b style="word-break:break-all;text-align:right">${esc(cfg.PIX_CHAVE)}</b></div>
      <div class="row"><span class="mut">Favorecido</span><b>${esc(cfg.PIX_NOME)}</b></div>
      <button class="btn outline" id="copiar">Copiar chave Pix</button></div>`;
  } else {
    pagamento = `<div class="card hot stack">
      <span class="eyebrow">Pague no cartão</span>
      <div class="row"><span class="mut">Valor</span><b>R$ ${esc(r.preco)}</b></div>
      <a class="btn" href="${esc(cfg.MERCADO_PAGO_LINK)}" target="_blank" rel="noopener">Pagar com cartão</a></div>`;
  }
  const texto = `Minha reserva no ${cfg.EVENTO}: ${r.aula_titulo}. Código: ${codigo}`;
  app.innerHTML = `
    ${marca()}
    <div class="row" style="justify-content:center;gap:10px"><svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#22C55E"/><path d="M9 16.5l4.5 4.5L23 11.5" stroke="#0B1F10" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h2>Bike reservada!</h2></div>
    <div class="qr"><canvas id="qr" role="img" aria-label="QR Code da reserva"></canvas><code>${esc(codigo)}</code></div>
    <div class="center stack" style="gap:2px"><span class="display" style="font-size:26px">${esc(r.nome)}</span><span class="mut">${esc(r.aula_titulo)} · ${esc(cfg.EVENTO)}</span></div>
    ${r.usado_em ? '<p class="err center">Este QR Code já foi usado na entrada.</p>' : ''}
    ${pagamento}
    <p class="mut small center">O QR Code vale uma única vez. Guarde esta página ou envie para o seu WhatsApp.</p>
    <a class="btn gray" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(texto)}">Enviar para meu WhatsApp</a>
    <button class="link" id="inicio" style="align-self:center">Voltar ao início</button>`;
  QRCode.toCanvas(document.getElementById('qr'), codigo, { width: 400, margin: 1 }, () => {});
  document.getElementById('inicio').onclick = telaHorarios;
  const c = document.getElementById('copiar');
  if (c) c.onclick = async () => {
    try { await navigator.clipboard.writeText(cfg.PIX_CHAVE); c.textContent = 'Chave copiada!'; }
    catch (e) { c.textContent = 'Copie manualmente a chave acima'; }
  };
}

telaHorarios();
