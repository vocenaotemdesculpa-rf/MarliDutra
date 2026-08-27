/**
 * Função da Netlify — mesma finalidade da versão da Vercel.
 * O netlify.toml redireciona /api/enviar-lead para cá, então o
 * front-end usa a mesma URL nas duas hospedagens.
 */

const { processarLead, diagnostico, normalizarGrupo } = require('../../lib/evolution');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { Allow: 'GET, POST, OPTIONS' }, body: '' };
  }

  // Ver comentário na versão da Vercel (api/enviar-lead.js).
  if (event.httpMethod === 'GET') {
    const teste = (event.queryStringParameters || {}).teste;
    const grupo = process.env.EVOLUTION_GROUP_ID || '';
    const podeTestar = Boolean(teste) && Boolean(grupo) &&
      (teste === grupo || normalizarGrupo(teste) === normalizarGrupo(grupo));

    const relatorio = await diagnostico(podeTestar);
    if (teste && !podeTestar) {
      relatorio.teste = 'NÃO EXECUTADO: o valor de ?teste= precisa ser exatamente o EVOLUTION_GROUP_ID configurado.';
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(relatorio)
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { Allow: 'GET, POST, OPTIONS', 'Content-Type': 'application/json' },
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
