// Funções compartilhadas entre a página do cliente e o painel da instrutora.
const cfg = window.BRUTAL_CONFIG;
const sb = configurado() ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function marca() {
  const logo = cfg.LOGO
    ? `<img src="${esc(cfg.LOGO)}" alt="${esc(cfg.MARCA || cfg.EVENTO)}">`
    : '<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="none" stroke="#FF5A1F" stroke-width="3"/><circle cx="14" cy="14" r="4" fill="#FF5A1F"/></svg><span>' + esc((cfg.MARCA || cfg.EVENTO || '').toUpperCase()) + '</span>';
  return `<div class="brand">${logo}</div>`;
}

const ERROS = {
  esgotado: 'Esse horário esgotou. Escolha outro.',
  aula_nao_encontrada: 'Essa aula não está mais disponível.',
  whatsapp_invalido: 'Confira o número do WhatsApp (com DDD).',
  nome_invalido: 'Digite seu nome completo.',
  metodo_invalido: 'Escolha Pix ou cartão.',
  senha_invalida: 'Senha incorreta.',
  tente_novamente: 'Não deu certo agora. Tente de novo.'
};

function msgErro(e) {
  const m = (e && e.message) || '';
  for (const k in ERROS) if (m.includes(k)) return ERROS[k];
  return 'Algo deu errado. Confira sua internet e tente de novo.';
}

function configurado() {
  return cfg.SUPABASE_URL && !cfg.SUPABASE_URL.startsWith('COLE_AQUI');
}
