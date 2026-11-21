// Página do cliente: agenda (dia -> horário -> bike no mapa) -> reserva -> QR Code + pagamento.
// Login, cadastro e "Minha conta" ficam em conta.js (carregado antes deste arquivo).
const app = document.getElementById('app');
const TZ = 'America/Sao_Paulo';

const SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SEM_LONGO = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function diaChave(iso) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }); }
function diaTexto(iso) {
  const t = new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function horaTexto(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
// 'AAAA-MM-DD' somado de n dias (ao meio-dia UTC, sem problema de horário de verão)
function somarDias(chave, n) {
  const [y, m, d] = chave.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}
function partesDia(chave) {
  const [y, m, d] = chave.split('-').map(Number);
  return { dow: new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(), dia: d, mes: m };
}
function tituloDia(chave) {
  const p = partesDia(chave);
  return `${SEM_LONGO[p.dow]}, ${p.dia} de ${MESES_LONGO[p.mes - 1]}`;
}
// títulos gerados pelo painel ("Dom, 22/11 · 09:00") repetem o dia e a hora: só mostra título quando é personalizado
function tituloPersonalizado(t) {
  return !/^(Dom|Seg|Ter|Qua|Qui|Sex|Sáb), \d{2}\/\d{2} · \d{2}:\d{2}$/.test(t || '');
}
// % de desconto no Pix (0 quando não há promoção)
function desconto(a) {
  return a.preco_pix_de && a.preco_pix_de > a.preco_pix
    ? Math.round((1 - a.preco_pix / a.preco_pix_de) * 100)
    : 0;
}
// "hoje às 06:00" ou "27/11 às 06:00"
function aberturaTexto(iso) {
  const hora = horaTexto(iso);
  if (diaChave(iso) === diaChave(new Date().toISOString())) return 'hoje às ' + hora;
  const dia = new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ });
  return dia + ' às ' + hora;
}
function dataBR(iso) { return new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ }); }

function semConfig() {
  app.innerHTML = marca() + '<p class="mut">Site ainda não configurado. Preencha a Project URL e a chave anon no arquivo config.js.</p>';
}

function aulaSel() { return ESTADO.aulas.find((a) => a.id === ESTADO.aulaId) || null; }
function estaLotada(a) { return a.reservadas >= a.vagas; }

// ------------------------------------------------------------ dados da agenda
async function carregarAgenda() {
  const [a, f] = await Promise.all([sb.rpc('listar_aulas'), sb.rpc('mapa_fileiras')]);
  if (a.error) throw a.error;
  ESTADO.aulas = a.data || [];
  if (!f.error && Array.isArray(f.data) && f.data.length) ESTADO.fileiras = f.data;
  ESTADO.minhas = {};
  if (ESTADO.user) {
    const r = await sb.rpc('minhas_reservas');
    (r.data || []).forEach((x) => { ESTADO.minhas[x.aula_id] = x; });
  }
  ESTADO.porDia = {};
  ESTADO.aulas.forEach((a2) => {
    const k = diaChave(a2.inicio);
    (ESTADO.porDia[k] = ESTADO.porDia[k] || []).push(a2);
  });
}

async function carregarMapa() {
  ESTADO.mapa = {};
  ESTADO.fila = null;
  const a = aulaSel();
  if (!a) return;
  const m = await sb.rpc('mapa_aula', { p_aula: a.id });
  if (a.id !== ESTADO.aulaId) return; // a pessoa já escolheu outra aula
  (m.data || []).forEach((x) => { ESTADO.mapa[x.bike] = x.estado; });
  // bike escolhida que ficou ocupada nesse meio tempo
  if (ESTADO.bike && ESTADO.mapa[ESTADO.bike]) ESTADO.bike = null;
  if (estaLotada(a)) {
    const f = await sb.rpc('fila_info', { p_aula: a.id });
    if (a.id === ESTADO.aulaId && f.data && f.data[0]) ESTADO.fila = f.data[0];
  }
}

// ------------------------------------------------------------ 0. tela inicial
async function telaInicio() {
  if (!sb) return semConfig();
  app.innerHTML = cabecalho() + `
    <section class="hero stack">
      <span class="eyebrow">Aula de spinning</span>
      <h1 class="display">Seu cardio<br><em>roots</em></h1>
      <p class="mut">Pedale ao ritmo da música, no seu nível, com a energia da turma. Escolha o dia, o horário e a sua bike.</p>
      <button class="btn" id="i-reservar">Reservar minha bike</button>
    </section>
    <section class="stack">
      <h2>Por que pedalar</h2>
      <div class="beneficios">
        <div class="card stack"><b>Condicionamento</b><span class="mut small">Treino cardiovascular que melhora o fôlego e a disposição.</span></div>
        <div class="card stack"><b>Baixo impacto</b><span class="mut small">Você pedala sentado, com menos impacto nas articulações que a corrida.</span></div>
        <div class="card stack"><b>Pernas e core</b><span class="mut small">Pernas, glúteos e abdômen trabalham juntos a cada música.</span></div>
        <div class="card stack"><b>Energia e bem-estar</b><span class="mut small">Exercício em grupo ajuda a liberar o estresse e manter a rotina.</span></div>
        <div class="card stack"><b>Para todos os níveis</b><span class="mut small">Você controla a carga da sua bike e o seu ritmo.</span></div>
      </div>
    </section>
    <section class="stack">
      <h2>Como funciona</h2>
      <ol class="passos-lista">
        <li><b>1</b><span>Crie sua conta e preencha a ficha de saúde (só na primeira vez).</span></li>
        <li><b>2</b><span>Escolha o dia, o horário e a bike no mapa da sala.</span></li>
        <li><b>3</b><span>Pague por Pix ou cartão e guarde o QR Code para a entrada.</span></li>
      </ol>
      <p class="mut small">Aulas para maiores de 18 anos. Em caso de dúvida sobre sua saúde, consulte um médico antes de treinar.</p>
    </section>
    <section class="stack" id="i-proximas"></section>
    <button class="btn" id="i-reservar2">Ver horários e reservar</button>`;
  ligarCabecalho();
  document.getElementById('i-reservar').onclick = telaAgenda;
  document.getElementById('i-reservar2').onclick = telaAgenda;
  try {
    await carregarAgenda();
    const prox = ESTADO.aulas.slice(0, 3);
    const alvo = document.getElementById('i-proximas');
    if (alvo && prox.length) {
      alvo.innerHTML = '<h2>Próximas aulas</h2>' + prox.map((a) => `<div class="card row">
        <div class="stack" style="gap:2px"><b>${esc(a.titulo)}</b><span class="mut small">${esc(diaTexto(a.inicio))} · ${esc(horaTexto(a.inicio))}</span></div>
        <span class="mut small">${a.reservadas >= a.vagas ? 'Lotada' : (a.vagas - a.reservadas) + ' vagas'}</span></div>`).join('');
    }
  } catch (e) { /* a lista de próximas aulas é opcional */ }
}

// ------------------------------------------------------------ 1. agenda
async function telaAgenda() {
  if (!sb) return semConfig();
  app.innerHTML = cabecalho() + '<p class="mut">Carregando horários…</p>';
  ligarCabecalho();
  try {
    if (ESTADO.user && !ESTADO.perfil) await carregarPerfil();
    await carregarAgenda();
  } catch (e) {
    app.innerHTML = cabecalho() + `<p class="err">${esc(msgErro(e))}</p><button class="btn" id="tentar">Tentar de novo</button>`;
    ligarCabecalho();
    document.getElementById('tentar').onclick = telaAgenda;
    return;
  }
  const dias = Object.keys(ESTADO.porDia).sort();
  if (!dias.length) {
    app.innerHTML = cabecalho() + '<div class="stack"><h1>Reserve sua bike</h1><p class="mut">Nenhum horário disponível por enquanto. Volte em breve.</p></div>';
    ligarCabecalho();
    return;
  }
  // faixa: só os dias que têm aula, a partir da próxima. Para datas mais distantes há a busca por data.
  ESTADO.faixa = dias;

  if (!ESTADO.dia || !ESTADO.porDia[ESTADO.dia]) ESTADO.dia = dias[0];
  if (!(ESTADO.porDia[ESTADO.dia] || []).some((a) => a.id === ESTADO.aulaId)) { ESTADO.aulaId = null; ESTADO.bike = null; }
  if (!ESTADO.aulaId && ESTADO.porDia[ESTADO.dia].length === 1 && ESTADO.porDia[ESTADO.dia][0].aberta) ESTADO.aulaId = ESTADO.porDia[ESTADO.dia][0].id;

  desenharAgenda();
  await carregarMapa();
  desenharMapa();
  desenharReserva();
}

function desenharAgenda() {
  const p = ESTADO.perfil;
  const banners = [];
  if (ESTADO.aviso) { banners.push(`<div class="card hot"><p class="small" role="status">${esc(ESTADO.aviso)}</p></div>`); ESTADO.aviso = ''; }
  if (ESTADO.user && p && p.parq_pendente) {
    banners.push('<div class="card hot"><p class="small">Sua ficha de saúde tem resposta "Sim". Procure o instrutor no local para liberar suas reservas.</p></div>');
  }
  app.innerHTML = `
    ${cabecalho()}
    ${banners.join('')}
    <div class="stack" style="gap:10px">
      <div class="passo"><b>1</b> Escolha o dia</div>
      <h1 id="dia-titulo">${esc(tituloDia(ESTADO.dia))}</h1>
    </div>
    <div class="dias" id="dias" role="group" aria-label="Dias com aula">${htmlDias()}</div>
    <div class="busca-data">
      <label for="busca-data">Procurar uma data</label>
      <input type="date" id="busca-data" min="${esc(ESTADO.faixa[0])}" max="${esc(ESTADO.faixa[ESTADO.faixa.length - 1])}">
      <p class="mut small" id="busca-msg" role="status"></p>
    </div>
    <div class="stack" style="gap:10px">
      <div class="passo"><b>2</b> Horário</div>
      <div class="stack" id="horarios" role="radiogroup" aria-label="Horários do dia">${htmlHorarios()}</div>
    </div>
    <div class="stack" style="gap:10px">
      <div class="passo"><b>3</b> Escolha sua bike no mapa</div>
      <div id="mapa"></div>
    </div>
    <div class="stack" id="reserva"></div>
    <div class="cta" id="cta-box"></div>`;
  ligarCabecalho();
  ligarDias();
  ligarHorarios();
  const on = document.querySelector('.dia.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function htmlDias() {
  return ESTADO.faixa.map((d, i) => {
    const p = partesDia(d);
    const tem = !!ESTADO.porDia[d];
    const sel = d === ESTADO.dia;
    const mes = (i === 0 || p.mes !== partesDia(ESTADO.faixa[i - 1]).mes) ? `<span class="dm">${MESES[p.mes - 1]}</span>` : '';
    return `<button type="button" class="dia ${sel ? 'on' : ''}" data-dia="${d}" ${tem ? '' : 'disabled'} aria-pressed="${sel}"
      aria-label="${esc(tituloDia(d))}${tem ? '' : ', sem aulas'}">
      <span class="dw">${SEM[p.dow]}</span><span class="dn">${p.dia}</span>${mes}<i class="${tem ? 'dot' : ''}"></i></button>`;
  }).join('');
}

async function irParaDia(d) {
  if (d === ESTADO.dia) return;
  ESTADO.dia = d;
  ESTADO.aulaId = null;
  ESTADO.bike = null;
  const doDia = ESTADO.porDia[ESTADO.dia] || [];
  if (doDia.length === 1 && doDia[0].aberta) ESTADO.aulaId = doDia[0].id;
  atualizarDiaEHorarios();
  await carregarMapa();
  desenharMapa();
  desenharReserva();
}

function ligarDias() {
  app.querySelectorAll('[data-dia]').forEach((b) => {
    b.onclick = () => irParaDia(b.dataset.dia);
  });
  const busca = document.getElementById('busca-data');
  if (busca) {
    busca.onchange = () => {
      const v = busca.value;
      const msg = document.getElementById('busca-msg');
      if (!v) { msg.textContent = ''; return; }
      // dia pedido, ou o próximo dia com aula depois dele
      const alvo = ESTADO.faixa.find((d) => d >= v) || ESTADO.faixa[ESTADO.faixa.length - 1];
      msg.textContent = alvo === v ? '' : `Sem aula em ${v.split('-').reverse().join('/')}. Mostrando o próximo dia com aula.`;
      irParaDia(alvo);
      const on = document.querySelector('.dia.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' });
    };
  }
}

function atualizarDiaEHorarios() {
  document.getElementById('dia-titulo').textContent = tituloDia(ESTADO.dia);
  document.getElementById('dias').innerHTML = htmlDias();
  document.getElementById('horarios').innerHTML = htmlHorarios();
  ligarDias();
  ligarHorarios();
  const on = document.querySelector('.dia.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  ESTADO.mapa = {};
  desenharMapa();
  desenharReserva();
}

function htmlHorarios() {
  const aulas = ESTADO.porDia[ESTADO.dia] || [];
  return aulas.map((a) => {
    const restam = a.vagas - a.reservadas;
    const lotada = restam <= 0;
    const fechada = !a.aberta;
    const sel = a.id === ESTADO.aulaId;
    const minha = ESTADO.minhas[a.id];
    const off = desconto(a);
    let status;
    if (minha) status = `<span class="slot-v ok">Sua reserva${minha.bike ? ' · bike ' + esc(minha.bike) : ''}</span>`;
    else if (fechada) status = `<span class="slot-v">Reservas abrem ${esc(aberturaTexto(a.abre_em))}</span>`;
    else if (lotada) status = '<span class="slot-v lotada">Lotada · fila de espera</span>';
    else if (restam <= 5) status = `<span class="slot-v poucas">Últimas ${restam} vagas</span>`;
    else status = `<span class="slot-v">${restam} vagas</span>`;
    const preco = off
      ? `Pix <s>R$ ${esc(a.preco_pix_de)}</s> <b>R$ ${esc(a.preco_pix)}</b> (${off}% off) · Cartão R$ ${esc(a.preco_cartao)}`
      : `Pix R$ ${esc(a.preco_pix)} · Cartão R$ ${esc(a.preco_cartao)}`;
    return `<button type="button" class="slot ${sel ? 'on' : ''} ${lotada || fechada ? 'off' : ''}" role="radio" aria-checked="${sel}" data-aula="${esc(a.id)}" ${fechada ? 'disabled' : ''}>
      <b class="time">${esc(horaTexto(a.inicio))}</b>
      ${tituloPersonalizado(a.titulo) ? `<span class="slot-t">${esc(a.titulo)}</span>` : ''}
      ${status}
      <span class="slot-p">${preco}</span></button>`;
  }).join('');
}

function ligarHorarios() {
  app.querySelectorAll('[data-aula]').forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.aula === ESTADO.aulaId) return;
      ESTADO.aulaId = b.dataset.aula;
      ESTADO.bike = null;
      document.getElementById('horarios').innerHTML = htmlHorarios();
      ligarHorarios();
      ESTADO.mapa = {};
      desenharMapa();
      desenharReserva();
      await carregarMapa();
      desenharMapa();
      desenharReserva();
    };
  });
}

// ---- mapa da sala
// Bike de spinning vista de lado (volante de inércia, selim, guidão e base), desenho próprio.
const ICONE_BIKE = '<svg viewBox="0 0 44 28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 25h36M13 25V19M31 25v-2"/><circle cx="29" cy="16" r="6"/><path d="M13 19L26 13M13 19l-3-11M6 8h8M29 16l5-11M31 5h7"/></svg>';

function htmlBike(n, bloqueada) {
  const est = ESTADO.mapa[n] || 'livre';
  const sel = ESTADO.bike === n && est === 'livre';
  const cls = sel ? 'sel' : est;
  const livre = est === 'livre' && !bloqueada;
  const nomes = { livre: 'livre', ocupada: 'ocupada', manutencao: 'em manutenção', minha: 'sua bike' };
  return `<button type="button" class="bike ${cls}" data-bike="${n}" ${livre ? '' : 'disabled'}
    aria-label="Bike ${n}, ${sel ? 'selecionada' : nomes[est]}" aria-pressed="${sel}">${ICONE_BIKE}<small>${n}</small></button>`;
}

function desenharMapa() {
  const alvo = document.getElementById('mapa');
  if (!alvo) return;
  const a = aulaSel();
  if (!a) { alvo.innerHTML = '<p class="mut small">Escolha um horário para ver as bikes livres.</p>'; return; }
  const lotada = estaLotada(a) || !a.aberta;
  let n = 0;
  const fileiras = (a.fileiras && a.fileiras.length ? a.fileiras : ESTADO.fileiras).map((qtd) => {
    let linha = '';
    for (let i = 0; i < qtd; i++) { n++; linha += htmlBike(n, lotada); }
    return `<div class="fileira">${linha}</div>`;
  }).join('');
  alvo.innerHTML = `<div class="sala">
      <div class="palco"><span></span><small>Palco do professor</small></div>
      <div class="fileira inst" aria-hidden="true"><div class="bike inst-bike">${ICONE_BIKE}<small>prof.</small></div></div>
      ${fileiras}
    </div>
    <ul class="legenda" aria-label="Legenda do mapa">
      <li class="livre">${ICONE_BIKE}Livre</li><li class="sel">${ICONE_BIKE}Selecionada</li>
      <li class="ocupada">${ICONE_BIKE}Ocupada</li><li class="minha">${ICONE_BIKE}Sua bike</li>
      <li class="manutencao">${ICONE_BIKE}Manutenção</li></ul>`;
  alvo.querySelectorAll('[data-bike]').forEach((b) => {
    b.onclick = () => {
      const num = Number(b.dataset.bike);
      ESTADO.bike = ESTADO.bike === num ? null : num;
      desenharMapa();
      desenharReserva();
    };
  });
}

// ---- resumo e botão principal
function desenharReserva() {
  const alvo = document.getElementById('reserva');
  if (!alvo) return;
  const a = aulaSel();
  const minha = a && ESTADO.minhas[a.id];
  const lotada = a && estaLotada(a);
  const pct = a ? Math.min(100, Math.round((a.reservadas / a.vagas) * 100)) : 0;
  const bikeTxt = !a ? '—' : minha ? (minha.bike ? 'nº ' + minha.bike : 'Reservada') : lotada ? 'sem bike livre' : ESTADO.bike ? 'nº ' + ESTADO.bike : 'escolha no mapa';

  let aviso = '';
  let botao;
  if (!a) {
    botao = '<button class="btn" disabled>Escolha um horário</button>';
  } else if (minha) {
    aviso = '<p class="small mut">Você já tem reserva nesta aula.</p>';
    botao = '<button class="btn" id="cta">Ver minha reserva</button>';
  } else if (!a.aberta) {
    aviso = `<p class="small mut">As reservas desta aula abrem ${esc(aberturaTexto(a.abre_em))}.</p>`;
    botao = '<button class="btn gray" disabled>Reservas ainda não abriram</button>';
  } else if (lotada) {
    const f = ESTADO.fila;
    const total = f ? f.total : a.na_fila;
    if (f && f.posicao) {
      aviso = `<div class="card hot"><p class="small">Aula lotada. Você está na fila de espera: ${esc(f.posicao)}º de ${esc(total)}. A equipe avisa pelo WhatsApp se abrir vaga.</p></div>`;
      botao = '<button class="btn gray" id="cta">Sair da fila de espera</button>';
    } else {
      aviso = `<div class="card hot"><p class="small">Aula lotada. ${total ? esc(total) + (total === 1 ? ' pessoa está' : ' pessoas estão') + ' na fila.' : 'Ninguém está na fila ainda.'} Entre também e a equipe avisa pelo WhatsApp se abrir vaga.</p></div>`;
      botao = '<button class="btn" id="cta">Entrar na fila de espera</button>';
    }
  } else if (!ESTADO.bike) {
    botao = '<button class="btn" disabled>Escolha sua bike</button>';
  } else {
    botao = '<button class="btn" id="cta">Continuar</button>';
  }

  alvo.innerHTML = `
    <div class="card stack">
      <b style="font-size:18px">Sua reserva</b>
      <div class="kv"><span>Dia</span><span>${esc(tituloDia(ESTADO.dia))}</span></div>
      <div class="kv"><span>Aula</span><span>${a ? esc(horaTexto(a.inicio)) + (tituloPersonalizado(a.titulo) ? ', ' + esc(a.titulo) : '') : '—'}</span></div>
      <div class="kv"><span>Bike</span><span>${esc(bikeTxt)}</span></div>
      <div class="kv"><span>Ocupação</span><b>${a ? esc(a.reservadas) + '/' + esc(a.vagas) : '—'}</b></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>
    ${aviso}`;
  document.getElementById('cta-box').innerHTML = botao;
  const cta = document.getElementById('cta');
  if (cta) cta.onclick = () => aoContinuar(cta);
}

async function aoContinuar(botao) {
  const a = aulaSel();
  if (!a) return;
  const minha = ESTADO.minhas[a.id];
  if (minha) return telaConfirmacao(minha.codigo);

  if (estaLotada(a)) {
    const pend = { dia: ESTADO.dia, aula: a.id, acao: 'fila' };
    if (!ESTADO.user) { pendencia(pend); return telaCriarConta(); }
    if (ESTADO.fila && ESTADO.fila.posicao) {
      botao.disabled = true;
      await sb.rpc('sair_fila', { p_aula: a.id });
    } else {
      if (!(await garantirCadastro(pend))) return;
      botao.disabled = true;
      const { error } = await sb.rpc('entrar_fila', { p_aula: a.id });
      if (error) ESTADO.aviso = msgErro(error);
      if (error && /parq_obrigatorio/.test(error.message || '')) { pendencia(pend); return telaCadastro2(); }
    }
    return telaAgenda();
  }

  if (!ESTADO.bike) return;
  const pend = { dia: ESTADO.dia, aula: a.id, bike: ESTADO.bike };
  if (!ESTADO.user) { pendencia(pend); return telaCriarConta(); }
  if (!(await garantirCadastro(pend))) return;
  telaCheckout();
}

// ------------------------------------------------------------ 2. checkout (confirmação de saúde, aviso e pagamento)
async function telaCheckout() {
  if (!ESTADO.aulas.length) {
    try { await carregarAgenda(); } catch (e) { return telaAgenda(); }
  }
  const aula = aulaSel();
  if (!aula || !ESTADO.bike) return telaAgenda();
  if (!ESTADO.perfil) await carregarPerfil();
  const p = ESTADO.perfil;
  if (!ESTADO.user || !p) return telaEntrar();
  if (!p.parq_ok || !p.perfil_completo) return garantirCadastro({ dia: ESTADO.dia, aula: aula.id, bike: ESTADO.bike });

  const off = desconto(aula);
  app.innerHTML = `
    <button class="link" id="voltar">‹ Voltar</button>
    <div class="stack">
      <span class="eyebrow">Você está reservando</span>
      <h1>Bike ${esc(ESTADO.bike)}</h1>
      <p class="mut">${esc(tituloDia(diaChave(aula.inicio)))} · ${esc(horaTexto(aula.inicio))}${tituloPersonalizado(aula.titulo) ? ' · ' + esc(aula.titulo) : ''}</p>
      <p class="mut small">${esc(p.nome)} · ${esc(cfg.EVENTO)}</p>
    </div>
    <form id="form" class="stack" novalidate>
      <div class="card stack">
        <b style="color:var(--or);text-transform:uppercase;letter-spacing:1px;font-size:13px">Ficha de saúde em dia</b>
        <p class="small mut">Preenchida em ${esc(dataBR(p.parq_em))}, vale até ${esc(dataBR(p.parq_valido_ate))}.</p>
        <label class="aceite"><input id="confirma" name="confirma" type="checkbox" required> <span>Confirmo que minha saúde não teve alterações desde o preenchimento da ficha de saúde (PAR-Q).</span></label>
      </div>
      <div class="card hot stack aviso">
        <b>Atenção</b>
        <p class="small">Se você não comparecer à aula, <b>não haverá reposição nem reembolso</b> do valor pago.</p>
        <label class="aceite"><input id="aceite" name="aceite" type="checkbox" required> <span>Li e estou de acordo</span></label>
      </div>
      <span style="font-size:15px;font-weight:500">Como você quer pagar?</span>
      <div class="pay">
        <button type="button" class="pix" data-metodo="pix"><b>Pix${off ? ' · ' + off + '% off' : ''}</b><strong>R$ ${esc(aula.preco_pix)}</strong><small>${off ? '<s>R$ ' + esc(aula.preco_pix_de) + '</s> · ' : ''}Chave Pix na próxima tela</small></button>
        <button type="button" class="card" data-metodo="cartao"><b>Cartão</b><strong>R$ ${esc(aula.preco_cartao)}</strong><small>Link de pagamento do Mercado Pago</small></button>
      </div>
      <p id="erro" class="err" role="alert"></p>
      <p class="mut small">Ao escolher a forma de pagamento, sua reserva é confirmada e o QR Code aparece na próxima tela. Pague até a hora da aula.</p>
    </form>`;
  document.getElementById('voltar').onclick = telaAgenda;
  const form = document.getElementById('form');
  const erro = document.getElementById('erro');
  form.querySelectorAll('[data-metodo]').forEach((b) => {
    b.onclick = async () => {
      erro.textContent = '';
      if (!form.reportValidity()) {
        erro.textContent = 'Marque a confirmação de saúde e o aviso para continuar.';
        return;
      }
      const botoes = form.querySelectorAll('button');
      botoes.forEach((x) => (x.disabled = true));
      const { data, error } = await sb.rpc('reservar_v2', {
        p_aula: aula.id, p_bike: ESTADO.bike, p_metodo: b.dataset.metodo, p_confirma_saude: true
      });
      if (error || !data || !data[0]) {
        const m = (error && error.message) || '';
        // a bike (ou a aula) mudou enquanto a pessoa decidia: volta ao mapa com o aviso
        if (/bike_ocupada|bike_indisponivel|esgotado|encerrada|aula_nao_encontrada|ainda_nao_abriu/.test(m)) {
          ESTADO.bike = null;
          ESTADO.aviso = msgErro(error);
          return telaAgenda();
        }
        if (/parq_obrigatorio/.test(m)) { pendencia({ dia: ESTADO.dia, aula: aula.id, bike: ESTADO.bike }); return telaCadastro2(msgErro(error)); }
        if (/perfil_incompleto/.test(m)) { pendencia({ dia: ESTADO.dia, aula: aula.id, bike: ESTADO.bike }); return telaCadastro1(msgErro(error)); }
        if (/nao_autenticado/.test(m)) { ESTADO.user = null; return telaEntrar(msgErro(error)); }
        erro.textContent = msgErro(error);
        botoes.forEach((x) => (x.disabled = false));
        return;
      }
      ESTADO.bike = null;
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
    document.getElementById('inicio').onclick = telaAgenda;
    return;
  }
  const r = data[0];
  if (r.cancelada) {
    app.innerHTML = marca() + '<p class="err">Essa reserva foi cancelada pela equipe. Faça uma nova reserva se ainda quiser participar.</p><button class="btn" id="inicio">Ver horários</button>';
    document.getElementById('inicio').onclick = telaAgenda;
    return;
  }
  // Pix e link do cartão podem ser trocados no painel; se não houver, usa o config.js
  let pg = {};
  try { const c = await sb.rpc('config_pagamento'); pg = (c.data && c.data[0]) || {}; } catch (e) { /* usa o config.js */ }
  const pixChave = pg.pix_chave || cfg.PIX_CHAVE;
  const pixNome = pg.pix_nome || cfg.PIX_NOME;
  const linkCartao = r.link_cartao || pg.mp_link || cfg.MERCADO_PAGO_LINK;
  const pix = r.metodo === 'pix';
  let pagamento;
  let pixCodigo = '';
  if (r.pago) {
    pagamento = '<div class="card hot stack"><span class="badge ok">Pagamento confirmado</span><p class="mut small">Pode ir tranquilo: é só mostrar o QR Code na entrada.</p></div>';
  } else if (pix) {
    try {
      pixCodigo = PixBR.gerar({ chave: pixChave, nome: pixNome, cidade: cfg.PIX_CIDADE, valor: r.preco, txid: codigo, descricao: 'Reserva ' + codigo });
    } catch (e) { pixCodigo = ''; }
    pagamento = `<div class="card hot stack">
      <span class="eyebrow">Pague via Pix</span>
      <div class="row"><span class="mut">Valor</span><b>R$ ${esc(r.preco)}</b></div>
      ${pixCodigo ? `<p class="small">Abra o app do seu banco, escolha <b>Pix copia e cola</b> (ou leia o QR Code do Pix abaixo) e confira o valor de <b>R$ ${esc(r.preco)}</b> antes de pagar.</p>
      <button class="btn" id="copiar">Copiar Pix copia e cola</button>
      <div class="qr" style="align-self:center"><canvas id="pixqr" role="img" aria-label="QR Code do Pix"></canvas></div>` : ''}
      <div class="row"><span class="mut">Chave Pix</span><b style="word-break:break-all;text-align:right">${esc(pixChave)}</b></div>
      <div class="row"><span class="mut">Favorecido</span><b>${esc(pixNome)}</b></div>
      ${pixCodigo ? '' : '<button class="btn outline" id="copiar">Copiar chave Pix</button>'}</div>`;
  } else {
    pagamento = `<div class="card hot stack">
      <span class="eyebrow">Pague no cartão</span>
      <div class="row"><span class="mut">Valor</span><b>R$ ${esc(r.preco)}</b></div>
      <a class="btn" href="${esc(linkCartao)}" target="_blank" rel="noopener">Pagar com cartão</a></div>`;
  }
  const bikeTxt = r.bike ? ` · Bike ${r.bike}` : '';
  const texto = `Minha reserva no ${cfg.EVENTO}: ${r.aula_titulo}${bikeTxt}. Código: ${codigo}`;
  app.innerHTML = `
    ${ESTADO.user ? cabecalho() : marca()}
    <div class="row" style="justify-content:center;gap:10px"><svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#22C55E"/><path d="M9 16.5l4.5 4.5L23 11.5" stroke="#0B1F10" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h2>Bike reservada!</h2></div>
    <div class="qr"><canvas id="qr" role="img" aria-label="QR Code da reserva"></canvas><code>${esc(codigo)}</code></div>
    <div class="center stack" style="gap:2px"><span class="display" style="font-size:26px">${esc(r.nome)}</span>
      <span class="mut">${esc(r.aula_titulo)}${r.bike ? ' · <b style="color:var(--or)">Bike ' + esc(r.bike) + '</b>' : ''} · ${esc(cfg.EVENTO)}</span></div>
    ${r.usado_em ? '<p class="err center">Este QR Code já foi usado na entrada.</p>' : ''}
    ${pagamento}
    <p class="mut small center">O QR Code vale uma única vez. Guarde esta página ou encontre-a em Minha conta.</p>
    <a class="btn gray" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(texto)}">Enviar para meu WhatsApp</a>
    <button class="link" id="inicio" style="align-self:center">Voltar ao início</button>`;
  ligarCabecalho();
  try {
    QRCode.toCanvas(document.getElementById('qr'), codigo, { width: 400, margin: 1 }, (err) => {
      if (err) document.getElementById('qr').style.display = 'none'; // sem QR: o código ao lado ainda vale na entrada
    });
  } catch (e) { document.getElementById('qr').style.display = 'none'; }
  document.getElementById('inicio').onclick = telaAgenda;
  const pq = document.getElementById('pixqr');
  if (pq && pixCodigo) QRCode.toCanvas(pq, pixCodigo, { width: 400, margin: 1 }, () => {});
  const c = document.getElementById('copiar');
  if (c) c.onclick = async () => {
    try { await navigator.clipboard.writeText(pixCodigo || pixChave); c.textContent = pixCodigo ? 'Código copiado! Cole no app do banco' : 'Chave copiada!'; }
    catch (e) { c.textContent = 'Copie manualmente a chave acima'; }
  };
}

// ------------------------------------------------------------ início
async function iniciar() {
  if (!sb) return semConfig();
  let recuperando = false;
  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'PASSWORD_RECOVERY') { recuperando = true; telaNovaSenha(); }
    if (evento === 'SIGNED_OUT') { ESTADO.user = null; ESTADO.perfil = null; }
  });
  // volta do Google, do link de confirmação de e-mail ou do link de recuperar senha
  const voltouDoLogin = /access_token|[?&]code=|type=recovery/.test(location.hash + location.search);
  const user = await sessao();
  if (voltouDoLogin) history.replaceState(null, '', location.pathname);
  if (recuperando) return;
  // link enviado pela equipe: ?r=CODIGO abre direto o QR da reserva
  const r = new URLSearchParams(location.search).get('r');
  if (r && /^[A-Za-z0-9]{4,12}$/.test(r)) return telaConfirmacao(r.toUpperCase());
  if (user && voltouDoLogin) return aposLogin();
  if (lerPendencia && lerPendencia()) return telaAgenda();
  telaInicio();
}
iniciar();
