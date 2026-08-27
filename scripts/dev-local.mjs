/**
 * Servidor local para testar o site COM o envio para o grupo funcionando.
 *
 * Abrir o index.html direto da pasta não funciona: a rota /api/enviar-lead é
 * uma função de servidor, que só existe na Vercel/Netlify. Este script sobe
 * o site e essa função juntos na sua máquina.
 *
 * Uso:
 *   1. Preencha o .env (copie de .env.example)
 *   2. node scripts/dev-local.mjs
 *   3. Abra http://localhost:3000
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PORTA = Number(process.env.PORT) || 3000;

function carregarEnv() {
  try {
    const conteudo = readFileSync(join(RAIZ, '.env'), 'utf8');
    for (const linha of conteudo.split(/\r?\n/)) {
      const limpa = linha.trim();
      if (!limpa || limpa.startsWith('#')) continue;
      const corte = limpa.indexOf('=');
      if (corte < 1) continue;
      const chave = limpa.slice(0, corte).trim();
      const valor = limpa.slice(corte + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[chave]) process.env[chave] = valor;
    }
    return true;
  } catch {
    return false;
  }
}

const temEnv = carregarEnv();

const require = createRequire(join(RAIZ, 'package.json'));
const handler = require('./api/enviar-lead.js');

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4'
};

function lerCorpo(req) {
  return new Promise((resolve) => {
    let dados = '';
    req.on('data', (pedaco) => { dados += pedaco; });
    req.on('end', () => resolve(dados));
  });
}

async function atender(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/enviar-lead') {
    const corpo = req.method === 'POST' ? await lerCorpo(req) : '';
    let parseado = null;
    try { parseado = corpo ? JSON.parse(corpo) : null; } catch { parseado = null; }

    const reqShim = { method: req.method, url: req.url, headers: req.headers, socket: req.socket, body: parseado };
    const resShim = {
      _status: 200,
      status(codigo) { this._status = codigo; return this; },
      setHeader(chave, valor) { res.setHeader(chave, valor); },
      json(objeto) {
        res.writeHead(this._status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(objeto, null, 1));
      },
      end() { res.writeHead(this._status); res.end(); }
    };

    console.log(`${req.method} /api/enviar-lead`);
    return handler(reqShim, resShim);
  }

  // Impede sair da pasta do projeto via ../
  const relativo = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\.]+)/, '');
  const caminho = join(RAIZ, url.pathname === '/' ? 'index.html' : relativo);

  try {
    const arquivo = await readFile(caminho);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(caminho).toLowerCase()] || 'application/octet-stream' });
    res.end(arquivo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Arquivo não encontrado: ' + url.pathname);
  }
}

const servidor = createServer(atender);

function subir(porta, tentativasRestantes) {
  // Sem limpar, o callback da tentativa anterior continua registrado e a
  // porta que falhou acaba sendo anunciada junto com a que deu certo.
  servidor.removeAllListeners('error');
  servidor.removeAllListeners('listening');

  servidor.once('error', (erro) => {
    if (erro.code === 'EADDRINUSE' && tentativasRestantes > 0) {
      console.log('  Porta ' + porta + ' ocupada, tentando ' + (porta + 1) + '...');
      return subir(porta + 1, tentativasRestantes - 1);
    }
    console.error('Não foi possível subir o servidor:', erro.message);
    process.exit(1);
  });

  servidor.listen(porta, () => anunciar(porta));
}

function anunciar(PORTA) {
  console.log('\n  Site local:   http://localhost:' + PORTA);
  console.log('  Diagnóstico:  http://localhost:' + PORTA + '/api/enviar-lead\n');

  if (!temEnv) {
    console.log('  ATENÇÃO: nenhum arquivo .env encontrado.');
    console.log('  Copie o .env.example para .env e preencha antes de testar o envio.\n');
  } else {
    const faltando = ['EVOLUTION_API_URL', 'EVOLUTION_INSTANCE', 'EVOLUTION_API_KEY', 'EVOLUTION_GROUP_ID']
      .filter((v) => !process.env[v]);
    if (faltando.length) console.log('  ATENÇÃO: faltam no .env: ' + faltando.join(', ') + '\n');
  }

  console.log('  Ctrl+C para parar.\n');
}

subir(PORTA, 10);
