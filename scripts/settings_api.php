<?php
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/api_common.php';

$passwords = tp_load_passwords()['departments'];
$stateDir = __DIR__ . '/teleprompter_state';
$settingsFile = $stateDir . '/department_settings.json';

function default_margin(): array {
    return ['side' => 'none', 'width' => 20];
}

function normalize_margin($margin): array {
    if (!is_array($margin)) return default_margin();
    $side = isset($margin['side']) && in_array($margin['side'], ['left', 'right'], true)
        ? $margin['side']
        : 'none';
    $width = isset($margin['width']) && is_numeric($margin['width'])
        ? (int)round((float)$margin['width'])
        : 20;
    return [
        'side' => $side,
        'width' => max(0, min(40, $width)),
    ];
}

function validate_margin($margin): array {
    if (!is_array($margin)) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid annotation margin']);
    }
    $side = $margin['side'] ?? null;
    $width = $margin['width'] ?? null;
    if (!is_string($side) || !in_array($side, ['none', 'left', 'right'], true) ||
        !is_numeric($width)) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid annotation margin']);
    }
    $numericWidth = (float)$width;
    if (!is_finite($numericWidth) || $numericWidth < 0 || $numericWidth > 40) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid annotation margin']);
    }
    return ['side' => $side, 'width' => (int)round($numericWidth)];
}

function empty_settings_doc(): array {
    return ['revision' => 0, 'departments' => []];
}

function normalize_settings_doc($doc): array {
    if (!is_array($doc)) return empty_settings_doc();
    $departments = [];
    if (isset($doc['departments']) && is_array($doc['departments'])) {
        foreach ($doc['departments'] as $department => $entry) {
            if (!is_string($department) || !is_array($entry)) continue;
            $departments[$department] = [
                'revision' => max(0, (int)($entry['revision'] ?? 0)),
                'annotationMargin' => normalize_margin($entry['annotationMargin'] ?? null),
            ];
        }
    }
    return [
        'revision' => max(0, (int)($doc['revision'] ?? 0)),
        'departments' => $departments,
    ];
}

function department_entry(array $doc, string $department): array {
    $entry = $doc['departments'][$department] ?? null;
    if (!is_array($entry)) {
        return ['revision' => 0, 'annotationMargin' => default_margin()];
    }
    return [
        'revision' => max(0, (int)($entry['revision'] ?? 0)),
        'annotationMargin' => normalize_margin($entry['annotationMargin'] ?? null),
    ];
}

$action = $_GET['action'] ?? 'get';

if ($action === 'get') {
    $department = isset($_GET['dept']) ? strtoupper((string)$_GET['dept']) : '';
    if (!in_array($department, TP_ALLOWED_DEPARTMENTS, true)) {
        tp_respond_json(404, ['ok' => false, 'error' => 'Unknown department']);
    }
    $rawDoc = tp_read_json_locked($settingsFile);
    $entry = department_entry(normalize_settings_doc($rawDoc), $department);
    tp_respond_json(200, ['ok' => true, 'department' => $department] + $entry);
}

if ($action !== 'save') {
    tp_respond_json(404, ['ok' => false, 'error' => 'Unknown action']);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    tp_respond_json(405, ['ok' => false, 'error' => 'POST required']);
}

$data = tp_request_json();
$department = isset($data['department']) ? strtoupper((string)$data['department']) : '';
if (!in_array($department, TP_ALLOWED_DEPARTMENTS, true)) {
    tp_respond_json(404, ['ok' => false, 'error' => 'Unknown department']);
}
tp_require_department_editor($department, $passwords);
$margin = validate_margin($data['annotationMargin'] ?? null);

$rawDoc = tp_read_json_locked($settingsFile);
$doc = normalize_settings_doc($rawDoc);
$existing = department_entry($doc, $department);
$entry = [
    'revision' => $existing['revision'] + 1,
    'annotationMargin' => $margin,
];
$doc['departments'][$department] = $entry;
$doc['revision']++;

if (!tp_write_json_locked($settingsFile, $doc, true)) {
    tp_respond_json(500, ['ok' => false, 'error' => 'Could not write settings']);
}

tp_respond_json(200, ['ok' => true, 'department' => $department] + $entry);
