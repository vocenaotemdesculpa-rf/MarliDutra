/**
 * Lista os grupos do WhatsApp da instância para você descobrir o JID
 * (aquele código terminado em @g.us) do grupo que vai receber os leads.
 *
 * Uso:  node scripts/listar-grupos.mjs
 * Requer EVOLUTION_API_URL, EVOLUTION_INSTANCE e EVOLUTION_API_KEY no .env
 */

import { readFileSync } from 'node:fs';

function carregarEnv() {
  try {
    const conteudo = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const linha of conteudo.split(/\r?\n/)) {
      const limpa = linha.trim();
      if (!limpa || limpa.startsWith('#')) continue;
      const separador = limpa.indexOf('=');
      if (separador < 1) continue;
      const chave = limpa.slice(0, separador).trim();
      const valor = limpa.slice(separador + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[chave]) process.env[chave] = valor;
    }
  } catch {
    // Sem .env: assume que as variáveis já estão no ambiente.
  }
}

carregarEnv();

const base = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
const instancia = process.env.EVOLUTION_INSTANCE;
const apikey = process.env.EVOLUTION_API_KEY;

if (!base || !instancia || !apikey) {
  console.error('Faltam variáveis. Preencha o .env a partir do .env.example.');
  process.exit(1);
}

const url = `${base}/group/fetchAllGroups/${encodeURIComponent(instancia)}?getParticipants=false`;

const resposta = await fetch(url, { headers: { apikey } });

if (!resposta.ok) {
  console.error(`Evolution respondeu ${resposta.status}:`, (await resposta.text()).slice(0, 400));
  process.exit(1);
}

const grupos = await resposta.json();
const lista = Array.isArray(grupos) ? grupos : (grupos.data || []);

if (!lista.length) {
  console.log('Nenhum grupo encontrado nesta instância.');
  process.exit(0);
}

console.log(`\n${lista.length} grupo(s) encontrado(s):\n`);
for (const grupo of lista) {
  console.log(`  ${grupo.subject || '(sem nome)'}`);
  console.log(`  EVOLUTION_GROUP_ID=${grupo.id}\n`);
}
