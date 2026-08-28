<?php
/**
 * Versão PHP da função que envia o lead para o grupo do WhatsApp.
 *
 * Existe porque hospedagem compartilhada (Hostinger, cPanel, Locaweb) roda PHP
 * e NÃO executa a função Node de api/enviar-lead.js — lá aquele arquivo nunca
 * roda e a rota devolve 404.
 *
 * Credenciais: variáveis de ambiente, ou o arquivo api/config.php
 * (copie de api/config.exemplo.php). A apikey nunca sai do servidor.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const LIMITE_CARACTERES = 160;
const RATE_JANELA_SEGUNDOS = 60;
const RATE_MAX = 5;

/** Lê as credenciais do ambiente ou do config.php. */
function carregarConfig(): array
{
    $cfg = [
        'url'      => getenv('EVOLUTION_API_URL') ?: '',
        'instance' => getenv('EVOLUTION_INSTANCE') ?: '',
        'apikey'   => getenv('EVOLUTION_API_KEY') ?: '',
        'grupo'    => getenv('EVOLUTION_GROUP_ID') ?: '',
    ];

    $arquivo = __DIR__ . '/config.php';
    if (is_readable($arquivo)) {
        $doArquivo = include $arquivo;
        if (is_array($doArquivo)) {
            foreach ($cfg as $chave => $valor) {
                if ($valor === '' && !empty($doArquivo[$chave])) {
                    $cfg[$chave] = (string) $doArquivo[$chave];
                }
            }
        }
    }

    $cfg['url'] = rtrim($cfg['url'], '/');

    return $cfg;
}

/** Remove quebras de linha e caracteres de controle, para ninguém forjar
 *  linhas extras dentro da mensagem que chega no grupo. */
function texto($valor): string
{
    $s = is_scalar($valor) ? (string) $valor : '';
    $s = preg_replace('/[\x00-\x1F\x7F]/u', ' ', $s) ?? '';
    $s = preg_replace('/\s{2,}/u', ' ', $s) ?? '';
    $s = trim($s);

    return function_exists('mb_substr')
        ? mb_substr($s, 0, LIMITE_CARACTERES)
        : substr($s, 0, LIMITE_CARACTERES);
}

/** O ID que a Evolution mostra vem só com os dígitos; a API exige @g.us. */
function normalizarGrupo(string $valor): string
{
    $limpo = trim($valor);
    if ($limpo === '') {
        return '';
    }
    if (strpos($limpo, '@') !== false) {
        return $limpo;
    }

    $digitos = preg_replace('/\D/', '', $limpo) ?? '';
    // IDs de grupo são bem mais longos que um número de telefone.
    return strlen($digitos) >= 15 ? $digitos . '@g.us' : $limpo;
}

function linkWhatsApp(string $telefone): ?string
{
    $digitos = preg_replace('/\D/', '', $telefone) ?? '';
    $tamanho = strlen($digitos);

    if ($tamanho === 10 || $tamanho === 11) {
        return 'https://wa.me/55' . $digitos;
    }
    if ($tamanho === 12 || $tamanho === 13) {
        return 'https://wa.me/' . $digitos;
    }

    return null;
}

function agoraEmBrasilia(): string
{
    try {
        $agora = new DateTime('now', new DateTimeZone('America/Sao_Paulo'));
        return $agora->format('d/m/Y \à\s H:i');
    } catch (Exception $e) {
        return date('d/m/Y \à\s H:i');
    }
}

/**
 * @return array{dados?: array<string,string>, erro?: string}
 */
function validar($payload): array
{
    if (!is_array($payload)) {
        return ['erro' => 'Dados inválidos.'];
    }

    // Honeypot: campo invisível que só um robô preenche.
    if (texto($payload['website'] ?? '') !== '') {
        return ['erro' => 'spam'];
    }

    $campos = ['nome', 'telefone', 'dono', 'destinacao', 'area', 'uf', 'inicio', 'fim'];
    $dados = [];

    foreach ($campos as $campo) {
        $valor = texto($payload[$campo] ?? '');
        if ($valor === '') {
            return ['erro' => 'Campo obrigatório ausente: ' . $campo];
        }
        $dados[$campo] = $valor;
    }

    return ['dados' => $dados];
}

function montarMensagem(array $d): string
{
    $link = linkWhatsApp($d['telefone']);

    $linhas = [
        '🏗️ *NOVO LEAD — Análise de INSS de Obra*',
        '',
        '*Nome:* ' . $d['nome'],
        '*WhatsApp:* ' . $d['telefone'],
        '*Dono da obra:* ' . $d['dono'],
        '*Destinação:* ' . $d['destinacao'],
        '*Área total:* ' . $d['area'] . ' m²',
        '*Estado (UF):* ' . $d['uf'],
        '*Início da obra:* ' . $d['inicio'],
        '*Término da obra:* ' . $d['fim'],
        '',
    ];

    if ($link !== null) {
        $linhas[] = '👉 Responder: ' . $link;
    }

    $linhas[] = '_Recebido pelo site em ' . agoraEmBrasilia() . '_';

    return implode("\n", $linhas);
}

/**
 * @return array{status: int, corpo: string, erroRede: string}
 */
function postar(string $url, string $apikey, array $corpo): array
{
    $json = json_encode($corpo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $json,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'apikey: ' . $apikey],
        ]);
        $resposta = curl_exec($ch);
        $status   = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $erroRede = curl_error($ch);
        curl_close($ch);

        return [
            'status'   => $status,
            'corpo'    => is_string($resposta) ? $resposta : '',
            'erroRede' => $erroRede,
        ];
    }

    // Sem cURL habilitado, tenta pelo stream do PHP.
    $contexto = stream_context_create([
        'http' => [
            'method'        => 'POST',
            'header'        => "Content-Type: application/json\r\napikey: " . $apikey . "\r\n",
            'content'       => $json,
            'timeout'       => 15,
            'ignore_errors' => true,
        ],
    ]);

    $resposta = @file_get_contents($url, false, $contexto);
    $status = 0;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
        $status = (int) $m[1];
    }

    return [
        'status'   => $status,
        'corpo'    => is_string($resposta) ? $resposta : '',
        'erroRede' => $resposta === false ? 'Não foi possível conectar na Evolution.' : '',
    ];
}

/** @throws RuntimeException */
function enviarParaGrupo(string $mensagem, array $cfg): void
{
    $grupo = normalizarGrupo($cfg['grupo']);

    if ($cfg['url'] === '' || $cfg['instance'] === '' || $cfg['apikey'] === '' || $grupo === '') {
        throw new RuntimeException('Configuração da Evolution incompleta. Confira o api/config.php.');
    }

    $url = $cfg['url'] . '/message/sendText/' . rawurlencode($cfg['instance']);

    // Evolution v2
    $r = postar($url, $cfg['apikey'], ['number' => $grupo, 'text' => $mensagem, 'linkPreview' => false]);

    // Evolution v1 usa outro formato de corpo.
    if ($r['status'] === 400 || $r['status'] === 404) {
        $r = postar($url, $cfg['apikey'], [
            'number'      => $grupo,
            'options'     => ['delay' => 0, 'presence' => 'composing'],
            'textMessage' => ['text' => $mensagem],
        ]);
    }

    if ($r['erroRede'] !== '') {
        throw new RuntimeException('Não foi possível conectar na Evolution: ' . $r['erroRede']);
    }

    if ($r['status'] < 200 || $r['status'] >= 300) {
        throw new RuntimeException('Evolution respondeu ' . $r['status'] . ': ' . substr($r['corpo'], 0, 300));
    }
}

function limitarPorIp(string $ip): bool
{
    $arquivo = sys_get_temp_dir() . '/mdutra-leads-rate.json';
    $agora = time();

    $registros = [];
    if (is_readable($arquivo)) {
        $conteudo = @file_get_contents($arquivo);
        if (is_string($conteudo)) {
            $decodificado = json_decode($conteudo, true);
            if (is_array($decodificado)) {
                $registros = $decodificado;
            }
        }
    }

    $doIp = array_values(array_filter(
        $registros[$ip] ?? [],
        static fn($t) => is_int($t) && ($agora - $t) < RATE_JANELA_SEGUNDOS
    ));
    $doIp[] = $agora;
    $registros[$ip] = $doIp;

    // Limpa IPs que já saíram da janela, para o arquivo não crescer sem fim.
    foreach ($registros as $chave => $lista) {
        $vivos = array_filter($lista, static fn($t) => is_int($t) && ($agora - $t) < RATE_JANELA_SEGUNDOS);
        if (empty($vivos)) {
            unset($registros[$chave]);
        }
    }

    @file_put_contents($arquivo, json_encode($registros), LOCK_EX);

    return count($doIp) <= RATE_MAX;
}

function diagnostico(bool $fazerTeste, array $cfg): array
{
    $avisos = [];

    $config = [
        'EVOLUTION_API_URL'  => $cfg['url'] !== '' ? $cfg['url'] : '(NAO DEFINIDA)',
        'EVOLUTION_INSTANCE' => $cfg['instance'] !== '' ? $cfg['instance'] : '(NAO DEFINIDA)',
        'EVOLUTION_API_KEY'  => $cfg['apikey'] !== ''
            ? '(definida, ' . strlen($cfg['apikey']) . ' caracteres)'
            : '(NAO DEFINIDA)',
        'EVOLUTION_GROUP_ID' => $cfg['grupo'] !== '' ? $cfg['grupo'] : '(NAO DEFINIDA)',
    ];

    if ($cfg['url'] === '') {
        $avisos[] = 'EVOLUTION_API_URL não está definida.';
    } else {
        if (!preg_match('#^https?://#i', $cfg['url'])) {
            $avisos[] = 'EVOLUTION_API_URL precisa começar com http:// ou https://';
        }
        if (preg_match('#/manager#i', $cfg['url'])) {
            $avisos[] = 'EVOLUTION_API_URL não deve incluir /manager — use só o domínio.';
        }
    }

    if ($cfg['instance'] === '') {
        $avisos[] = 'EVOLUTION_INSTANCE não está definida.';
    } elseif (preg_match('/^[0-9A-F]{8,}-[0-9A-F-]+$/i', $cfg['instance'])) {
        $avisos[] = 'EVOLUTION_INSTANCE parece ser o ID/hash da instância, não o NOME dela. '
            . 'Use o nome que aparece no Manager (ex.: mdutra).';
    }

    if ($cfg['apikey'] === '') {
        $avisos[] = 'EVOLUTION_API_KEY não está definida.';
    }

    if ($cfg['grupo'] === '') {
        $avisos[] = 'EVOLUTION_GROUP_ID não está definida.';
    } else {
        $config['grupoQueSeraUsado'] = normalizarGrupo($cfg['grupo']);
        if (!preg_match('/@g\.us$/', $config['grupoQueSeraUsado'])) {
            $avisos[] = 'EVOLUTION_GROUP_ID não parece um ID de grupo. Deve ser o número '
                . 'longo do grupo (18 dígitos), com ou sem @g.us no final.';
        }
    }

    $resultado = [
        'endpoint'      => 'PHP',
        'phpVersao'     => PHP_VERSION,
        'curlDisponivel' => function_exists('curl_init'),
        'configuracao'  => $config,
        'avisos'        => $avisos,
    ];

    if (!$fazerTeste) {
        $resultado['proximoPasso'] = empty($avisos)
            ? 'Configuração parece correta. Para disparar uma mensagem de teste no grupo, '
                . 'acrescente ?teste=SEU_EVOLUTION_GROUP_ID no fim desta URL.'
            : 'Corrija os avisos acima e recarregue esta página.';
        return $resultado;
    }

    try {
        enviarParaGrupo(
            "✅ *Teste de configuração*\n\n"
            . 'Se esta mensagem chegou, o site já consegue enviar os leads para este grupo.',
            $cfg
        );
        $resultado['teste'] = 'MENSAGEM ENVIADA — confira o grupo no WhatsApp.';
    } catch (Throwable $e) {
        $resultado['teste'] = 'FALHOU: ' . $e->getMessage();
        $resultado['comoInterpretar'] = [
            '401 ou 403' => 'apikey incorreta.',
            '404'        => 'nome da instância errado, ou EVOLUTION_API_URL incorreta.',
            '400'        => 'EVOLUTION_GROUP_ID inválido, ou a instância não é membro do grupo.',
            'conectar'   => 'A Evolution não respondeu: URL errada, servidor fora do ar ou porta bloqueada.',
        ];
    }

    return $resultado;
}

function responder(int $status, array $corpo): void
{
    http_response_code($status);
    echo json_encode($corpo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

// ---------------------------------------------------------------- roteamento

$cfg = carregarConfig();
$metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($metodo === 'OPTIONS') {
    header('Allow: GET, POST, OPTIONS');
    http_response_code(204);
    exit;
}

// Diagnóstico pelo navegador. O group id serve de senha simples para ninguém
// de fora conseguir usar a rota para mandar mensagem no grupo.
if ($metodo === 'GET') {
    $teste = isset($_GET['teste']) ? (string) $_GET['teste'] : '';
    $podeTestar = $teste !== '' && $cfg['grupo'] !== ''
        && ($teste === $cfg['grupo'] || normalizarGrupo($teste) === normalizarGrupo($cfg['grupo']));

    $relatorio = diagnostico($podeTestar, $cfg);
    if ($teste !== '' && !$podeTestar) {
        $relatorio['teste'] = 'NÃO EXECUTADO: o valor de ?teste= precisa ser exatamente o EVOLUTION_GROUP_ID configurado.';
    }

    responder(200, $relatorio);
}

if ($metodo !== 'POST') {
    header('Allow: GET, POST, OPTIONS');
    responder(405, ['ok' => false, 'erro' => 'Método não permitido.']);
}

$bruto = file_get_contents('php://input');
$payload = json_decode(is_string($bruto) ? $bruto : '', true);

$ip = '';
foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_CLIENT_IP', 'REMOTE_ADDR'] as $chave) {
    if (!empty($_SERVER[$chave])) {
        $ip = trim(explode(',', (string) $_SERVER[$chave])[0]);
        break;
    }
}

if (!limitarPorIp($ip !== '' ? $ip : 'desconhecido')) {
    responder(429, ['ok' => false, 'erro' => 'Muitas tentativas. Aguarde um minuto.']);
}

$validado = validar($payload);

// Robô: responde 200 de propósito, para não descobrir que foi barrado.
if (($validado['erro'] ?? '') === 'spam') {
    responder(200, ['ok' => true]);
}

if (isset($validado['erro'])) {
    responder(400, ['ok' => false, 'erro' => $validado['erro']]);
}

try {
    enviarParaGrupo(montarMensagem($validado['dados']), $cfg);
    responder(200, ['ok' => true]);
} catch (Throwable $e) {
    error_log('[enviar-lead] falha no envio: ' . $e->getMessage());
    responder(502, ['ok' => false, 'erro' => 'Não foi possível notificar o grupo.']);
}
