<?php
// cue_api.php
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/util/api_common.php';

$catalog = require __DIR__ . '/script_catalog.php';
$passwords = loadPasswords()['departments'];
$cueDir = dirname(__DIR__) . '/show-cues';
$stateDir = __DIR__ . '/teleprompter_state';
$signalFile = $stateDir . '/cue_revisions.json';

function cueFile(string $dir, string $script, string $dept): string {
    return $dir . '/' . $script . '_' . $dept . '.json';
}

function emptyCueDoc(string $script, string $dept): array {
    return [
        'script' => $script,
        'department' => $dept,
        'revision' => 0,
        'cues' => [],
    ];
}

function normalizeCueDoc($doc, string $script, string $dept): array {
    if (!is_array($doc)) return emptyCueDoc($script, $dept);
    return [
        'script' => $script,
        'department' => $dept,
        'revision' => isset($doc['revision']) ? max(0, (int)$doc['revision']) : 0,
        'cues' => isset($doc['cues']) && is_array($doc['cues']) ? array_values($doc['cues']) : [],
    ];
}

function validateCue(array $cue): array {
    $id = isset($cue['id']) && is_string($cue['id']) ? trim($cue['id']) : '';
    if ($id !== '' && !preg_match('/^[A-Za-z0-9_-]{1,80}$/', $id)) {
        respondJson(400, ['ok' => false, 'error' => 'Invalid cue id']);
    }

    $number = isset($cue['number']) && is_string($cue['number']) ? trim($cue['number']) : '';
    $description = isset($cue['description']) && is_string($cue['description']) ? trim($cue['description']) : '';
    $color = isset($cue['color']) && is_string($cue['color']) ? trim($cue['color']) : '#ffd000';
    $anchor = isset($cue['anchor']) && is_array($cue['anchor']) ? $cue['anchor'] : [];
    $prompt = isset($anchor['prompt']) && is_string($anchor['prompt']) ? trim($anchor['prompt']) : '';
    $anchorType = isset($anchor['type']) && is_string($anchor['type']) ? strtolower(trim($anchor['type'])) : 'paragraph';

    if ($number === '' || strlen($number) > 24) respondJson(400, ['ok' => false, 'error' => 'Cue number is required']);
    if (strlen($description) > 120) respondJson(400, ['ok' => false, 'error' => 'Description too long']);
    if (!preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) respondJson(400, ['ok' => false, 'error' => 'Invalid colour']);
    if (!preg_match('/^p[0-9]{6}$/', $prompt)) respondJson(400, ['ok' => false, 'error' => 'Invalid prompt anchor']);
    if (!in_array($anchorType, ['paragraph', 'word'], true)) respondJson(400, ['ok' => false, 'error' => 'Invalid anchor type']);

    $anchorFraction = $anchor['fraction'] ?? 0;
    if (!is_numeric($anchorFraction)) {
        respondJson(400, ['ok' => false, 'error' => 'Invalid cue start position']);
    }
    $anchorFraction = (float)$anchorFraction;
    if ($anchorFraction < 0 || $anchorFraction > 1) {
        respondJson(400, ['ok' => false, 'error' => 'Invalid cue start position']);
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
            respondJson(400, ['ok' => false, 'error' => 'Invalid word anchor']);
        }

        $wordIndex = (int)$wordIndex;
        if ($wordIndex < 0 || $wordIndex > 10000) {
            respondJson(400, ['ok' => false, 'error' => 'Invalid word anchor']);
        }

        if (strlen($wordText) > 120) {
            respondJson(400, ['ok' => false, 'error' => 'Trigger word too long']);
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
            respondJson(400, ['ok' => false, 'error' => 'Invalid end prompt']);
        }
        if (!is_numeric($endFraction)) {
            respondJson(400, ['ok' => false, 'error' => 'Invalid end position']);
        }
        $endFraction = (float)$endFraction;
        if ($endFraction < 0 || $endFraction > 1) {
            respondJson(400, ['ok' => false, 'error' => 'Invalid end position']);
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
    if (!isValidId($script) || !isset($catalog[$script]) || !in_array($dept, TP_ALLOWED_DEPARTMENTS, true)) {
        respondJson(404, ['ok' => false, 'error' => 'Unknown script or department']);
    }
    $rawDoc = readJsonLocked(cueFile($cueDir, $script, $dept));
    $doc = normalizeCueDoc($rawDoc, $script, $dept);
    respondJson(200, ['ok' => true] + $doc);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respondJson(405, ['ok' => false, 'error' => 'POST required']);
}

$data = getRequestJson();
$dept = isset($data['department']) ? strtoupper((string)$data['department']) : '';
if (!in_array($dept, TP_ALLOWED_DEPARTMENTS, true)) {
    respondJson(404, ['ok' => false, 'error' => 'Unknown department']);
}
if ($action === 'logout') {
    clearAuthCookie('dept_' . strtolower($dept));
    respondJson(200, ['ok' => true, 'department' => $dept]);
}

requireDepartmentEditor($dept, $passwords);

if ($action === 'auth') {
    respondJson(200, ['ok' => true, 'department' => $dept]);
}

$script = isset($data['script']) ? (string)$data['script'] : '';
if (!isValidId($script) || !isset($catalog[$script])) {
    respondJson(404, ['ok' => false, 'error' => 'Unknown script']);
}

$file = cueFile($cueDir, $script, $dept);
$rawDoc = readJsonLocked($file);
$doc = normalizeCueDoc($rawDoc, $script, $dept);

if ($action === 'save') {
    $cue = validateCue(isset($data['cue']) && is_array($data['cue']) ? $data['cue'] : []);
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
    if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $id)) respondJson(400, ['ok' => false, 'error' => 'Invalid cue id']);
    $doc['cues'] = array_values(array_filter($doc['cues'], fn($c) => !is_array($c) || ($c['id'] ?? null) !== $id));
} else {
    respondJson(404, ['ok' => false, 'error' => 'Unknown action']);
}

$doc['revision']++;
if (!writeJsonLocked($file, $doc, true)) {
    respondJson(500, ['ok' => false, 'error' => 'Could not write cue file']);
}

updateRevisionSignal($signalFile, $stateDir, $script, $dept, $doc['revision']);
respondJson(200, ['ok' => true, 'revision' => $doc['revision'], 'cues' => $doc['cues']]);
