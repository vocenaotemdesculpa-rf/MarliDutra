/**
 * Função serverless da Vercel — recebe o formulário do site e repassa
 * para o grupo do WhatsApp via Evolution API.
 * Rota pública: POST /api/enviar-lead
 */

const { processarLead } = require('../lib/evolution');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
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
