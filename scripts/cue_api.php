<?php
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

$catalog = require __DIR__ . '/script_catalog.php';
$passwordConfig = require __DIR__ . '/passwords.php';
$passwords = is_array($passwordConfig) && is_array($passwordConfig['departments'] ?? null)
    ? $passwordConfig['departments']
    : [];
unset($passwordConfig);
require_once __DIR__ . '/auth_cookie.php';
$allowedDepartments = ['FS', 'LX', 'SND', 'STG'];
$cueDir = dirname(__DIR__) . '/show-cues';
$stateDir = __DIR__ . '/teleprompter_state';
$signalFile = $stateDir . '/cue_revisions.json';

function respond_json(int $status, array $body): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

function valid_id(string $value): bool {
    return (bool)preg_match('/^[A-Za-z0-9_-]+$/', $value);
}

function request_json(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function cue_file(string $dir, string $script, string $dept): string {
    // script and dept have already been allow-listed; never use arbitrary paths.
    return $dir . '/' . $script . '_' . $dept . '.json';
}

function empty_doc(string $script, string $dept): array {
    return [
        'script' => $script,
        'department' => $dept,
        'revision' => 0,
        'cues' => [],
    ];
}

function normalize_doc($doc, string $script, string $dept): array {
    if (!is_array($doc)) return empty_doc($script, $dept);
    return [
        'script' => $script,
        'department' => $dept,
        'revision' => isset($doc['revision']) ? max(0, (int)$doc['revision']) : 0,
        'cues' => isset($doc['cues']) && is_array($doc['cues']) ? array_values($doc['cues']) : [],
    ];
}

function read_doc(string $file, string $script, string $dept): array {
    if (!is_file($file)) return empty_doc($script, $dept);
    $raw = file_get_contents($file);
    if ($raw === false || trim($raw) === '') return empty_doc($script, $dept);
    return normalize_doc(json_decode($raw, true), $script, $dept);
}

function update_revision_signal(string $signalFile, string $stateDir, string $script, string $dept, int $revision): void {
    if (!is_dir($stateDir) && !mkdir($stateDir, 0775, true) && !is_dir($stateDir)) return;

    $fp = @fopen($signalFile, 'c+');
    if ($fp === false) return;
    if (!@flock($fp, LOCK_EX)) { fclose($fp); return; }

    rewind($fp);
    $raw = stream_get_contents($fp);
    $map = ($raw === false || trim($raw) === '') ? [] : json_decode($raw, true);
    if (!is_array($map)) $map = [];

    $key = $script . '_' . $dept;
    $map[$key] = [
        'script' => $script,
        'department' => $dept,
        'revision' => $revision,
        'updatedAt' => microtime(true),
    ];

    $encoded = json_encode($map, JSON_UNESCAPED_SLASHES);
    if ($encoded !== false) {
        rewind($fp);
        ftruncate($fp, 0);
        fwrite($fp, $encoded);
        fflush($fp);
    }

    flock($fp, LOCK_UN);
    fclose($fp);
}

function require_editor_password(string $dept, array $passwords): void {
    $provided = $_SERVER['HTTP_X_CUE_KEY'] ?? '';
    $expected = $passwords[$dept] ?? null;
    $role = 'dept_' . strtolower($dept);

    $headerOk = is_string($expected) && $expected !== '' &&
        is_string($provided) && $provided !== '' && hash_equals($expected, $provided);
    $cookieOk = is_string($expected) && tp_auth_cookie_valid($role, $expected);

    if (!$headerOk && !$cookieOk) {
        respond_json(403, ['ok' => false, 'error' => 'Authentication failed']);
    }

    if ($headerOk) {
        tp_issue_auth_cookie($role, $expected);
    }
}

function validate_cue(array $cue): array {
    $id = isset($cue['id']) && is_string($cue['id']) ? trim($cue['id']) : '';
    if ($id !== '' && !preg_match('/^[A-Za-z0-9_-]{1,80}$/', $id)) {
        respond_json(400, ['ok' => false, 'error' => 'Invalid cue id']);
    }

    $number = isset($cue['number']) && is_string($cue['number']) ? trim($cue['number']) : '';
    $description = isset($cue['description']) && is_string($cue['description']) ? trim($cue['description']) : '';
    $color = isset($cue['color']) && is_string($cue['color']) ? trim($cue['color']) : '#ffd000';
    $anchor = isset($cue['anchor']) && is_array($cue['anchor']) ? $cue['anchor'] : [];
    $prompt = isset($anchor['prompt']) && is_string($anchor['prompt']) ? trim($anchor['prompt']) : '';
    $anchorType = isset($anchor['type']) && is_string($anchor['type']) ? strtolower(trim($anchor['type'])) : 'paragraph';

    if ($number === '' || strlen($number) > 24) respond_json(400, ['ok'=>false,'error'=>'Cue number is required']);
    if (strlen($description) > 120) respond_json(400, ['ok'=>false,'error'=>'Description too long']);
    if (!preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) respond_json(400, ['ok'=>false,'error'=>'Invalid colour']);
    if (!preg_match('/^p[0-9]{6}$/', $prompt)) respond_json(400, ['ok'=>false,'error'=>'Invalid prompt anchor']);
    if (!in_array($anchorType, ['paragraph', 'word'], true)) respond_json(400, ['ok'=>false,'error'=>'Invalid anchor type']);

    $normalizedAnchor = [
        'type' => $anchorType,
        'prompt' => $prompt,
    ];

    if ($anchorType === 'word') {
        $wordIndex = $anchor['wordIndex'] ?? null;
        $wordText = isset($anchor['text']) && is_string($anchor['text']) ? trim($anchor['text']) : '';

        if (!is_int($wordIndex) && !(is_string($wordIndex) && ctype_digit($wordIndex))) {
            respond_json(400, ['ok'=>false,'error'=>'Invalid word anchor']);
        }

        $wordIndex = (int)$wordIndex;
        if ($wordIndex < 0 || $wordIndex > 10000) {
            respond_json(400, ['ok'=>false,'error'=>'Invalid word anchor']);
        }

        if (strlen($wordText) > 120) {
            respond_json(400, ['ok'=>false,'error'=>'Trigger word too long']);
        }

        $normalizedAnchor['wordIndex'] = $wordIndex;
        $normalizedAnchor['text'] = $wordText;
    }

    $normalizedEndAnchor = null;
    if (isset($cue['endAnchor']) && is_array($cue['endAnchor'])) {
        $endPrompt = isset($cue['endAnchor']['prompt']) && is_string($cue['endAnchor']['prompt'])
            ? trim($cue['endAnchor']['prompt']) : '';
        $endFraction = $cue['endAnchor']['fraction'] ?? 0;
        if (!preg_match('/^p[0-9]{6}$/', $endPrompt)) {
            respond_json(400, ['ok'=>false,'error'=>'Invalid end prompt']);
        }
        if (!is_numeric($endFraction)) {
            respond_json(400, ['ok'=>false,'error'=>'Invalid end position']);
        }
        $endFraction = (float)$endFraction;
        if ($endFraction < 0 || $endFraction > 1) {
            respond_json(400, ['ok'=>false,'error'=>'Invalid end position']);
        }
        $normalizedEndAnchor = [
            'prompt' => $endPrompt,
            'fraction' => $endFraction,
        ];
    }

    return [
        'id' => $id,
        'number' => $number,
        'description' => $description,
        'color' => strtolower($color),
        'anchor' => $normalizedAnchor,
        'endAnchor' => $normalizedEndAnchor,
    ];
}

$action = $_GET['action'] ?? 'get';

if ($action === 'get') {
    $script = isset($_GET['script']) ? (string)$_GET['script'] : '';
    $dept = isset($_GET['dept']) ? strtoupper((string)$_GET['dept']) : '';
    if (!valid_id($script) || !isset($catalog[$script]) || !in_array($dept, $allowedDepartments, true)) {
        respond_json(404, ['ok'=>false,'error'=>'Unknown script or department']);
    }
    $doc = read_doc(cue_file($cueDir, $script, $dept), $script, $dept);
    respond_json(200, ['ok'=>true] + $doc);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond_json(405, ['ok'=>false,'error'=>'POST required']);
}

$data = request_json();
$dept = isset($data['department']) ? strtoupper((string)$data['department']) : '';
if (!in_array($dept, $allowedDepartments, true)) {
    respond_json(404, ['ok'=>false,'error'=>'Unknown department']);
}
if ($action === 'logout') {
    tp_clear_auth_cookie('dept_' . strtolower($dept));
    respond_json(200, ['ok'=>true, 'department'=>$dept]);
}

require_editor_password($dept, $passwords);

if ($action === 'auth') {
    respond_json(200, ['ok'=>true, 'department'=>$dept]);
}

$script = isset($data['script']) ? (string)$data['script'] : '';
if (!valid_id($script) || !isset($catalog[$script])) {
    respond_json(404, ['ok'=>false,'error'=>'Unknown script']);
}

if (!is_dir($cueDir) && !mkdir($cueDir, 0775, true) && !is_dir($cueDir)) {
    respond_json(500, ['ok'=>false,'error'=>'Cue directory is not writable']);
}

$file = cue_file($cueDir, $script, $dept);
$fp = fopen($file, 'c+');
if ($fp === false) respond_json(500, ['ok'=>false,'error'=>'Cue file is not writable']);
if (!flock($fp, LOCK_EX)) { fclose($fp); respond_json(500, ['ok'=>false,'error'=>'Could not lock cue file']); }

try {
    rewind($fp);
    $raw = stream_get_contents($fp);
    $doc = ($raw === false || trim($raw) === '')
        ? empty_doc($script, $dept)
        : normalize_doc(json_decode($raw, true), $script, $dept);

    if ($action === 'save') {
        $cue = validate_cue(isset($data['cue']) && is_array($data['cue']) ? $data['cue'] : []);
        if ($cue['id'] === '') $cue['id'] = strtolower($dept) . '-' . bin2hex(random_bytes(8));

        $found = false;
        foreach ($doc['cues'] as $i => $existing) {
            if (is_array($existing) && ($existing['id'] ?? null) === $cue['id']) {
                $doc['cues'][$i] = $cue;
                $found = true;
                break;
            }
        }
        if (!$found) $doc['cues'][] = $cue;
    } elseif ($action === 'delete') {
        $id = isset($data['id']) ? (string)$data['id'] : '';
        if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $id)) respond_json(400, ['ok'=>false,'error'=>'Invalid cue id']);
        $doc['cues'] = array_values(array_filter($doc['cues'], fn($c) => !is_array($c) || ($c['id'] ?? null) !== $id));
    } else {
        respond_json(404, ['ok'=>false,'error'=>'Unknown action']);
    }

    $doc['revision']++;
    $encoded = json_encode($doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($encoded === false) respond_json(500, ['ok'=>false,'error'=>'Could not encode cue file']);

    rewind($fp);
    if (!ftruncate($fp, 0) || fwrite($fp, $encoded . "\n") === false || !fflush($fp)) {
        respond_json(500, ['ok'=>false,'error'=>'Could not write cue file']);
    }

    flock($fp, LOCK_UN);
    fclose($fp);

    update_revision_signal($signalFile, $stateDir, $script, $dept, $doc['revision']);

    respond_json(200, ['ok'=>true, 'revision'=>$doc['revision'], 'cues'=>$doc['cues']]);
} catch (Throwable $e) {
    flock($fp, LOCK_UN);
    fclose($fp);
    respond_json(500, ['ok'=>false,'error'=>'Cue update failed']);
}
