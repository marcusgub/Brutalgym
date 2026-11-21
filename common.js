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
  ja_reservou: 'Você já tem reserva nessa aula com esse nome e WhatsApp. Toque em "Ver minha reserva".',
  ainda_nao_abriu: 'As reservas dessa aula só abrem 2 horas antes do início.',
  encerrada: 'As reservas dessa aula já encerraram.',
  parq_pendente: 'Pelo seu PAR-Q, a equipe precisa confirmar presencialmente que você está apto(a) antes da reserva. Procure o instrutor no local; assim que ele liberar, você consegue reservar.',
  parq_obrigatorio: 'Responda o PAR-Q antes de reservar.',
  vagas_menor_que_reservas: 'Já existem mais reservas do que essas vagas. Cancele reservas antes de reduzir.',
  senha_curta: 'Use uma senha com pelo menos 6 caracteres.',
  aula_com_reservas: 'Essa aula tem reservas. Desative em vez de excluir.',
  aula_invalida: 'Confira os dados da aula (data futura, vagas e preços).',
  senha_invalida: 'Senha incorreta.',
  tente_novamente: 'Não deu certo agora. Tente de novo.',
  nao_autenticado: 'Entre na sua conta para continuar.',
  perfil_incompleto: 'Complete seu cadastro para continuar.',
  nascimento_invalido: 'Confira a data de nascimento.',
  whatsapp_em_uso: 'Esse WhatsApp já está em outra conta. Entre com ela ou fale com a equipe.',
  parq_ja_respondido: 'Sua ficha de saúde já foi enviada. Para corrigir algo, fale com a equipe.',
  confirmacao_obrigatoria: 'Marque a confirmação de saúde para continuar.',
  bike_ocupada: 'Essa bike acabou de ser reservada por outra pessoa. Escolha outra.',
  bike_indisponivel: 'Essa bike não está disponível. Escolha outra.',
  aula_com_vaga: 'Abriu vaga nessa aula! Escolha uma bike e reserve.',
  mapa_invalido: 'Mapa inválido. Use números de 1 a 15 separados por vírgula (máximo 10 fileiras), ex.: 5,5,5,5,5.',
  mapa_com_reservas: 'Existem reservas em bikes que deixariam de existir. Cancele essas reservas antes de mudar o mapa.',
  bike_com_reserva: 'Há reserva nessa bike. Cancele a reserva antes de tirar a bike de uso.'
};

function msgErro(e) {
  const m = (e && e.message) || '';
  for (const k in ERROS) if (m.includes(k)) return ERROS[k];
  return 'Algo deu errado. Confira sua internet e tente de novo.';
}

function configurado() {
  return cfg.SUPABASE_URL && !cfg.SUPABASE_URL.startsWith('COLE_AQUI');
}
