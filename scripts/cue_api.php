<?php
// cue_api.php
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/api_common.php';

$catalog = require __DIR__ . '/script_catalog.php';
$passwords = tp_load_passwords()['departments'];
$cueDir = dirname(__DIR__) . '/show-cues';
$stateDir = __DIR__ . '/teleprompter_state';
$signalFile = $stateDir . '/cue_revisions.json';

function cue_file(string $dir, string $script, string $dept): string {
    return $dir . '/' . $script . '_' . $dept . '.json';
}

function empty_cue_doc(string $script, string $dept): array {
    return [
        'script' => $script,
        'department' => $dept,
        'revision' => 0,
        'cues' => [],
    ];
}

function normalize_cue_doc($doc, string $script, string $dept): array {
    if (!is_array($doc)) return empty_cue_doc($script, $dept);
    return [
        'script' => $script,
        'department' => $dept,
        'revision' => isset($doc['revision']) ? max(0, (int)$doc['revision']) : 0,
        'cues' => isset($doc['cues']) && is_array($doc['cues']) ? array_values($doc['cues']) : [],
    ];
}

function validate_cue(array $cue): array {
    $id = isset($cue['id']) && is_string($cue['id']) ? trim($cue['id']) : '';
    if ($id !== '' && !preg_match('/^[A-Za-z0-9_-]{1,80}$/', $id)) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid cue id']);
    }

    $number = isset($cue['number']) && is_string($cue['number']) ? trim($cue['number']) : '';
    $description = isset($cue['description']) && is_string($cue['description']) ? trim($cue['description']) : '';
    $color = isset($cue['color']) && is_string($cue['color']) ? trim($cue['color']) : '#ffd000';
    $anchor = isset($cue['anchor']) && is_array($cue['anchor']) ? $cue['anchor'] : [];
    $prompt = isset($anchor['prompt']) && is_string($anchor['prompt']) ? trim($anchor['prompt']) : '';
    $anchorType = isset($anchor['type']) && is_string($anchor['type']) ? strtolower(trim($anchor['type'])) : 'paragraph';

    if ($number === '' || strlen($number) > 24) tp_respond_json(400, ['ok'=>false,'error'=>'Cue number is required']);
    if (strlen($description) > 120) tp_respond_json(400, ['ok'=>false,'error'=>'Description too long']);
    if (!preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) tp_respond_json(400, ['ok'=>false,'error'=>'Invalid colour']);
    if (!preg_match('/^p[0-9]{6}$/', $prompt)) tp_respond_json(400, ['ok'=>false,'error'=>'Invalid prompt anchor']);
    if (!in_array($anchorType, ['paragraph', 'word'], true)) tp_respond_json(400, ['ok'=>false,'error'=>'Invalid anchor type']);

    $anchorFraction = $anchor['fraction'] ?? 0;
    if (!is_numeric($anchorFraction)) {
        tp_respond_json(400, ['ok'=>false,'error'=>'Invalid cue start position']);
    }
    $anchorFraction = (float)$anchorFraction;
    if ($anchorFraction < 0 || $anchorFraction > 1) {
        tp_respond_json(400, ['ok'=>false,'error'=>'Invalid cue start position']);
    }

    $normalizedAnchor = [
        'type' => $anchorType,
        'prompt' => $prompt,
        'fraction' => $anchorFraction,
    ];

    if ($anchorType === 'word') {
        $wordIndex = $anchor['wordIndex'] ?? null;
        $wordText = isset($anchor['text']) && is_string($anchor['text']) ? trim($anchor['text']) : '';

        if (!is_int($wordIndex) && !(is_string($wordIndex) && ctype_digit($wordIndex))) {
            tp_respond_json(400, ['ok'=>false,'error'=>'Invalid word anchor']);
        }

        $wordIndex = (int)$wordIndex;
        if ($wordIndex < 0 || $wordIndex > 10000) {
            tp_respond_json(400, ['ok'=>false,'error'=>'Invalid word anchor']);
        }

        if (strlen($wordText) > 120) {
            tp_respond_json(400, ['ok'=>false,'error'=>'Trigger word too long']);
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
            tp_respond_json(400, ['ok'=>false,'error'=>'Invalid end prompt']);
        }
        if (!is_numeric($endFraction)) {
            tp_respond_json(400, ['ok'=>false,'error'=>'Invalid end position']);
        }
        $endFraction = (float)$endFraction;
        if ($endFraction < 0 || $endFraction > 1) {
            tp_respond_json(400, ['ok'=>false,'error'=>'Invalid end position']);
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
    if (!tp_valid_id($script) || !isset($catalog[$script]) || !in_array($dept, TP_ALLOWED_DEPARTMENTS, true)) {
        tp_respond_json(404, ['ok'=>false,'error'=>'Unknown script or department']);
    }
    $rawDoc = tp_read_json_locked(cue_file($cueDir, $script, $dept));
    $doc = normalize_cue_doc($rawDoc, $script, $dept);
    tp_respond_json(200, ['ok'=>true] + $doc);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    tp_respond_json(405, ['ok'=>false,'error'=>'POST required']);
}

$data = tp_request_json();
$dept = isset($data['department']) ? strtoupper((string)$data['department']) : '';
if (!in_array($dept, TP_ALLOWED_DEPARTMENTS, true)) {
    tp_respond_json(404, ['ok'=>false,'error'=>'Unknown department']);
}
if ($action === 'logout') {
    tp_clear_auth_cookie('dept_' . strtolower($dept));
    tp_respond_json(200, ['ok'=>true, 'department'=>$dept]);
}

tp_require_department_editor($dept, $passwords);

if ($action === 'auth') {
    tp_respond_json(200, ['ok'=>true, 'department'=>$dept]);
}

$script = isset($data['script']) ? (string)$data['script'] : '';
if (!tp_valid_id($script) || !isset($catalog[$script])) {
    tp_respond_json(404, ['ok'=>false,'error'=>'Unknown script']);
}

$file = cue_file($cueDir, $script, $dept);
$rawDoc = tp_read_json_locked($file);
$doc = normalize_cue_doc($rawDoc, $script, $dept);

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
    if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $id)) tp_respond_json(400, ['ok'=>false,'error'=>'Invalid cue id']);
    $doc['cues'] = array_values(array_filter($doc['cues'], fn($c) => !is_array($c) || ($c['id'] ?? null) !== $id));
} else {
    tp_respond_json(404, ['ok'=>false,'error'=>'Unknown action']);
}

$doc['revision']++;
if (!tp_write_json_locked($file, $doc, true)) {
    tp_respond_json(500, ['ok'=>false,'error'=>'Could not write cue file']);
}

tp_update_revision_signal($signalFile, $stateDir, $script, $dept, $doc['revision']);
tp_respond_json(200, ['ok'=>true, 'revision'=>$doc['revision'], 'cues'=>$doc['cues']]);
