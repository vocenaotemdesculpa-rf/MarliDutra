# Envio automático dos leads para o grupo do WhatsApp

Quando alguém conclui o formulário do site:

1. Os dados da obra são enviados para o **grupo interno no WhatsApp**, via Evolution API.
2. Confirmado o envio, o visitante vai para a **página de obrigado** (`obrigado.html`).

O WhatsApp do visitante **não** é aberto — o contato parte da equipe, a partir da
mensagem que chega no grupo.

Se o envio falhar, o visitante **não** avança para a página de obrigado: continua no
resumo, com o aviso do erro e o botão "Tentar novamente". Assim ninguém vê
"recebemos seus dados" quando nada chegou.

## Por que existe uma função no servidor

A apikey da Evolution **não pode** ficar no HTML: qualquer visitante abriria o
código-fonte, copiaria a chave e passaria a enviar mensagens pela sua instância do
WhatsApp. Por isso a página chama `/api/enviar-lead`, e é essa função — no servidor —
que guarda a chave e conversa com a Evolution.

## Arquivos

| Arquivo | Função |
|---|---|
| `lib/evolution.js` | Valida o lead, monta a mensagem e envia para a Evolution |
| `api/enviar-lead.js` | Endpoint na Vercel |
| `netlify/functions/enviar-lead.js` | Mesmo endpoint na Netlify |
| `netlify.toml` | Faz `/api/enviar-lead` funcionar também na Netlify |
| `scripts/listar-grupos.mjs` | Descobre o ID do grupo |
| `obrigado.html` | Página exibida após o envio |
| `scripts/dev-local.mjs` | Servidor local para testar antes de publicar |
| `.env.example` | Modelo das variáveis |

## Passo 1 — Variáveis de ambiente

Quatro valores são necessários:

| Variável | O que é |
|---|---|
| `EVOLUTION_API_URL` | URL da sua Evolution, sem barra no final |
| `EVOLUTION_INSTANCE` | Nome da instância conectada ao WhatsApp da M.Dutra |
| `EVOLUTION_API_KEY` | apikey global ou da instância |
| `EVOLUTION_GROUP_ID` | ID do grupo que recebe os leads, terminado em `@g.us` |

**Na Vercel:** Settings → Environment Variables → adicione as quatro → *Redeploy*.
**Na Netlify:** Site configuration → Environment variables → adicione as quatro → *Deploy*.

Para testar na sua máquina, copie `.env.example` para `.env` e preencha. O `.env` está
no `.gitignore` e não vai para o repositório.

## Passo 2 — Descobrir o ID do grupo

Com o `.env` preenchido (menos o `EVOLUTION_GROUP_ID`), rode:

```bash
node scripts/listar-grupos.mjs
```

Ele lista os grupos da instância já no formato pronto para colar:

```
  Leads M.Dutra
  EVOLUTION_GROUP_ID=120363000000000000@g.us
```

Requisito: o número da instância precisa **ser membro** do grupo.

## Testando na sua máquina

Abrir o `index.html` direto da pasta **não funciona**: a rota `/api/enviar-lead` é uma
função de servidor, que só existe quando o site está publicado. Localmente ela não
existe, o envio cai em 404 e nada chega no grupo.

Para testar de verdade na sua máquina, com o `.env` preenchido:

```bash
node scripts/dev-local.mjs
```

Ele sobe o site e a função juntos e mostra o endereço no terminal (usa a porta 3000,
ou a próxima livre). Abra esse endereço e preencha o formulário normalmente. Para ver
só a configuração, abra `/api/enviar-lead` no navegador.

## Passo 3 — Conferir

Preencha o formulário no site publicado. A mensagem deve chegar no grupo assim:

```
🏗️ NOVO LEAD — Análise de INSS de Obra

Nome: Fulano de Teste
WhatsApp: (48) 99999-9999
Dono da obra: Pessoa física
Destinação: Industrial (galpão e barracão)
Área total: 320 m²
Estado (UF): SC — Santa Catarina
Início da obra: 03/2023
Término da obra: 08/2024

👉 Responder: https://wa.me/5548999999999
Recebido pelo site em 27/08/2026 às 09:39
```

O link "Responder" abre a conversa direto com o cliente — é só clicar.

## Proteções incluídas

- **Honeypot:** campo invisível no formulário. Se vier preenchido, é robô: o envio é
  descartado e a resposta finge sucesso, para o robô não descobrir que foi barrado.
- **Rate limit:** no máximo 5 envios por minuto por IP.
- **Sanitização:** quebras de linha e caracteres de controle são removidos dos campos,
  para ninguém conseguir forjar linhas falsas dentro da mensagem do grupo.
- **Campos obrigatórios:** um lead incompleto é recusado antes de chamar a Evolution.

Não há bloqueio por tempo de preenchimento — seria fácil derrubar lead de verdade
(quem reabre o formulário já preenchido conclui em poucos segundos).

## Compatibilidade

A função envia no formato da **Evolution v2** e, se receber 400 ou 404, repete
automaticamente no formato da **v1**. Funciona nas duas versões sem configuração extra.

## Se o lead não chegar no grupo

1. Veja o log da função (Vercel: Deployments → Functions; Netlify: Functions → Logs).
   Erros aparecem como `[enviar-lead] falha no envio: ...`.
2. `Configuração da Evolution incompleta` → falta variável de ambiente, ou faltou
   fazer redeploy depois de cadastrar.
3. `Evolution respondeu 401` → apikey errada.
4. `Evolution respondeu 404` → nome da instância errado, ou URL com barra sobrando.
5. `Evolution respondeu 400` → confira o `EVOLUTION_GROUP_ID` (precisa terminar em
   `@g.us`) e se a instância está no grupo.
