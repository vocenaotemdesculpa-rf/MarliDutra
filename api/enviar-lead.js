/**
 * Função serverless da Vercel — recebe o formulário do site e repassa
 * para o grupo do WhatsApp via Evolution API.
 * Rota pública: POST /api/enviar-lead
 */

const { processarLead, diagnostico } = require('../lib/evolution');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(204).end();
  }

  // Diagnóstico: abrir /api/enviar-lead no navegador mostra o que está
  // configurado (nunca a apikey). Acrescentar ?teste=<EVOLUTION_GROUP_ID>
  // dispara uma mensagem de teste — o group id funciona como senha simples
  // para ninguém de fora conseguir mandar mensagem no grupo.
  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const teste = url.searchParams.get('teste');
    const grupo = process.env.EVOLUTION_GROUP_ID || '';
    const podeTestar = Boolean(teste) && Boolean(grupo) && teste === grupo;

    const relatorio = await diagnostico(podeTestar);
    if (teste && !podeTestar) {
      relatorio.teste = 'NÃO EXECUTADO: o valor de ?teste= precisa ser exatamente o EVOLUTION_GROUP_ID configurado.';
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(relatorio);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
  }

  let payload = req.body;

  // A Vercel já entrega o corpo parseado quando o content-type é JSON,
  // mas se vier como string a gente resolve aqui.
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (e) { payload = null; }
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) || 'desconhecido';

  const { status, body } = await processarLead(payload, ip);
  return res.status(status).json(body);
};
