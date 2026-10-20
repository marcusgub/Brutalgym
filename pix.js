// Gera o "Pix copia e cola" (BR Code estático) com o valor já preenchido.
// Sem integração com banco: o app do cliente lê o código e já traz valor e favorecido.
(function () {
  function campo(id, valor) {
    const v = String(valor);
    return id + String(v.length).padStart(2, '0') + v;
  }

  function crc16(texto) { // CRC16-CCITT (0x1021, início 0xFFFF)
    let crc = 0xffff;
    for (let i = 0; i < texto.length; i++) {
      crc ^= texto.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  // Maiúsculas, sem acento e só letras/números/espaço (padrão exigido pelo BR Code)
  function limpo(t, max) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  // o = { chave, nome, cidade, valor (número), txid, descricao, estatico }  (texto já no formato final)
  function montar(o) {
    let conta = campo('00', 'br.gov.bcb.pix') + campo('01', o.chave);
    if (o.descricao && 4 + conta.length + 4 + o.descricao.length <= 99) conta += campo('02', o.descricao);
    let p = campo('00', '01') + (o.estatico ? campo('01', '11') : '') +
      campo('26', conta) + campo('52', '0000') + campo('53', '986');
    if (o.valor) p += campo('54', Number(o.valor).toFixed(2));
    p += campo('58', 'BR') + campo('59', o.nome) + campo('60', o.cidade) + campo('62', campo('05', o.txid || '***'));
    p += '6304';
    return p + crc16(p);
  }

  window.PixBR = {
    montar,
    crc16,
    // versão para o site: limpa os textos e usa o código da reserva como identificação
    gerar: function (o) {
      return montar({
        chave: String(o.chave).trim(),
        nome: limpo(o.nome, 25) || 'RECEBEDOR',
        cidade: limpo(o.cidade, 15) || 'SAO PAULO',
        valor: o.valor,
        estatico: true,
        txid: String(o.txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***',
        descricao: limpo(o.descricao, 30)
      });
    }
  };
})();
