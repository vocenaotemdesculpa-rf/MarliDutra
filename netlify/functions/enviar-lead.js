/**
 * Função da Netlify — mesma finalidade da versão da Vercel.
 * O netlify.toml redireciona /api/enviar-lead para cá, então o
 * front-end usa a mesma URL nas duas hospedagens.
 */

const { processarLead } = require('../../lib/evolution');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { Allow: 'POST, OPTIONS' }, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { Allow: 'POST, OPTIONS', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, erro: 'Método não permitido.' })
    };
  }

  let payload = null;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    payload = null;
  }

  const cabecalhos = event.headers || {};
  const ip = (cabecalhos['x-forwarded-for'] || cabecalhos['client-ip'] || '')
    .split(',')[0].trim() || 'desconhecido';

  const { status, body } = await processarLead(payload, ip);

  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
};
