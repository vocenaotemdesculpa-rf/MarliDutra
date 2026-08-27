/**
 * Núcleo do envio de leads para o grupo do WhatsApp via Evolution API.
 * Usado pela função da Vercel (api/enviar-lead.js) e pela da Netlify
 * (netlify/functions/enviar-lead.js) — a apikey nunca sai do servidor.
 *
 * Variáveis de ambiente necessárias:
 *   EVOLUTION_API_URL   ex.: https://evolution.seudominio.com
 *   EVOLUTION_INSTANCE  ex.: mdutra
 *   EVOLUTION_API_KEY   apikey global ou da instância
 *   EVOLUTION_GROUP_ID  ex.: 120363000000000000@g.us
 */

const CAMPOS = ['nome', 'telefone', 'dono', 'destinacao', 'area', 'uf', 'inicio', 'fim'];
const LIMITE_CARACTERES = 160;

// Anti-spam simples em memória (vale por instância da função).
const RATE_JANELA_MS = 60 * 1000;
const RATE_MAX = 5;
const acessos = new Map();

function limitarPorIp(ip) {
  const agora = Date.now();
  const registros = (acessos.get(ip) || []).filter((t) => agora - t < RATE_JANELA_MS);
  registros.push(agora);
  acessos.set(ip, registros);

  // Evita crescimento infinito do Map em instâncias de vida longa.
  if (acessos.size > 500) {
    for (const [chave, lista] of acessos) {
      if (!lista.some((t) => agora - t < RATE_JANELA_MS)) acessos.delete(chave);
    }
  }

  return registros.length <= RATE_MAX;
}

function texto(valor) {
  return String(valor == null ? '' : valor)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, LIMITE_CARACTERES);
}

function validar(payload) {
  if (!payload || typeof payload !== 'object') return { erro: 'Dados inválidos.' };

  // Honeypot: campo invisível que só um robô preenche. É o único critério
  // que descarta o envio — de propósito. Regra por tempo de preenchimento
  // foi descartada: derrubaria lead de verdade (quem reabre o formulário já
  // preenchido conclui em poucos segundos).
  if (texto(payload.website)) return { erro: 'spam' };

  const dados = {};
  for (const campo of CAMPOS) {
    const valor = texto(payload[campo]);
    if (!valor) return { erro: 'Campo obrigatório ausente: ' + campo };
    dados[campo] = valor;
  }

  return { dados };
}

function linkWhatsApp(telefone) {
  const digitos = String(telefone).replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return 'https://wa.me/55' + digitos;
  if (digitos.length === 12 || digitos.length === 13) return 'https://wa.me/' + digitos;
  return null;
}

function agoraEmBrasilia() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date()).replace(', ', ' às ');
}

function montarMensagem(dados) {
  const link = linkWhatsApp(dados.telefone);

  return [
    '🏗️ *NOVO LEAD — Análise de INSS de Obra*',
    '',
    '*Nome:* ' + dados.nome,
    '*WhatsApp:* ' + dados.telefone,
    '*Dono da obra:* ' + dados.dono,
    '*Destinação:* ' + dados.destinacao,
    '*Área total:* ' + dados.area + ' m²',
    '*Estado (UF):* ' + dados.uf,
    '*Início da obra:* ' + dados.inicio,
    '*Término da obra:* ' + dados.fim,
    '',
    link ? '👉 Responder: ' + link : null,
    '_Recebido pelo site em ' + agoraEmBrasilia() + '_'
  ].filter(function (linha) { return linha !== null; }).join('\n');
}

async function postar(url, apikey, corpo) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apikey },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(10000)
  });
}

async function enviarParaGrupo(mensagem) {
  const base = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
  const instancia = process.env.EVOLUTION_INSTANCE;
  const apikey = process.env.EVOLUTION_API_KEY;
  const grupo = process.env.EVOLUTION_GROUP_ID;

  if (!base || !instancia || !apikey || !grupo) {
    throw new Error('Configuração da Evolution incompleta. Confira as variáveis de ambiente.');
  }

  const url = base + '/message/sendText/' + encodeURIComponent(instancia);

  // Evolution v2
  let resposta = await postar(url, apikey, { number: grupo, text: mensagem, linkPreview: false });

  // Evolution v1 usa outro formato de corpo — tenta de novo se o v2 for recusado.
  if (!resposta.ok && (resposta.status === 400 || resposta.status === 404)) {
    resposta = await postar(url, apikey, {
      number: grupo,
      options: { delay: 0, presence: 'composing' },
      textMessage: { text: mensagem }
    });
  }

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => '');
    throw new Error('Evolution respondeu ' + resposta.status + ': ' + detalhe.slice(0, 300));
  }

  return resposta.json().catch(() => ({}));
}

/**
 * Processa o lead e devolve { status, body } pronto para a resposta HTTP.
 */
async function processarLead(payload, ip) {
  if (!limitarPorIp(ip || 'desconhecido')) {
    return { status: 429, body: { ok: false, erro: 'Muitas tentativas. Aguarde um minuto.' } };
  }

  const { dados, erro } = validar(payload);

  if (erro === 'spam') {
    // Responde 200 de propósito: robô não descobre que foi barrado.
    return { status: 200, body: { ok: true } };
  }

  if (erro) return { status: 400, body: { ok: false, erro } };

  try {
    await enviarParaGrupo(montarMensagem(dados));
    return { status: 200, body: { ok: true } };
  } catch (e) {
    console.error('[enviar-lead] falha no envio:', e && e.message ? e.message : e);
    return { status: 502, body: { ok: false, erro: 'Não foi possível notificar o grupo.' } };
  }
}

module.exports = { processarLead, montarMensagem, validar, linkWhatsApp };
