<?php
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/util/api_common.php';

$allPasswords = loadPasswords();
$showPassword = $allPasswords['show'] ?? '';
requireShowAccess($showPassword);

$passwords = $allPasswords['departments'] ?? [];
$stateDir = __DIR__ . '/teleprompter_state';
$settingsFile = $stateDir . '/department_settings.json';

function defaultMargin(): array {
    return ['side' => 'none', 'width' => 20];
}

function normalizeMargin($margin): array {
    if (!is_array($margin)) return defaultMargin();
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

function validateMargin($margin): array {
    if (!is_array($margin)) {
        respondJson(400, ['ok' => false, 'error' => 'Invalid annotation margin']);
    }
    $side = $margin['side'] ?? null;
    $width = $margin['width'] ?? null;
    if (!is_string($side) || !in_array($side, ['none', 'left', 'right'], true) ||
        !is_numeric($width)) {
        respondJson(400, ['ok' => false, 'error' => 'Invalid annotation margin']);
    }
    $numericWidth = (float)$width;
    if (!is_finite($numericWidth) || $numericWidth < 0 || $numericWidth > 40) {
        respondJson(400, ['ok' => false, 'error' => 'Invalid annotation margin']);
    }
    return ['side' => $side, 'width' => (int)round($numericWidth)];
}

function emptySettingsDoc(): array {
    return ['revision' => 0, 'departments' => []];
}

function normalizeSettingsDoc($doc): array {
    if (!is_array($doc)) return emptySettingsDoc();
    $departments = [];
    if (isset($doc['departments']) && is_array($doc['departments'])) {
        foreach ($doc['departments'] as $department => $entry) {
            if (!is_string($department) || !is_array($entry)) continue;
            $departments[$department] = [
                'revision' => max(0, (int)($entry['revision'] ?? 0)),
                'annotationMargin' => normalizeMargin($entry['annotationMargin'] ?? null),
            ];
        }
    }
    return [
        'revision' => max(0, (int)($doc['revision'] ?? 0)),
        'departments' => $departments,
    ];
}

function departmentEntry(array $doc, string $department): array {
    $entry = $doc['departments'][$department] ?? null;
    if (!is_array($entry)) {
        return ['revision' => 0, 'annotationMargin' => defaultMargin()];
    }
    return [
        'revision' => max(0, (int)($entry['revision'] ?? 0)),
        'annotationMargin' => normalizeMargin($entry['annotationMargin'] ?? null),
    ];
}

$action = $_GET['action'] ?? 'get';

if ($action === 'departments') {
    respondJson(200, [
        'ok' => true,
        'departments' => TP_ALLOWED_DEPARTMENTS,
        'metadata' => TP_DEPARTMENT_METADATA,
    ]);
}

if ($action === 'get') {
    $department = isset($_GET['dept']) ? strtoupper((string)$_GET['dept']) : '';
    if (!in_array($department, TP_ALLOWED_DEPARTMENTS, true)) {
        respondJson(404, ['ok' => false, 'error' => 'Unknown department']);
    }
    $rawDoc = readJsonLocked($settingsFile);
    $entry = departmentEntry(normalizeSettingsDoc($rawDoc), $department);
    respondJson(200, ['ok' => true, 'department' => $department] + $entry);
}

if ($action !== 'save') {
    respondJson(404, ['ok' => false, 'error' => 'Unknown action']);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respondJson(405, ['ok' => false, 'error' => 'POST required']);
}

$data = getRequestJson();
$department = isset($data['department']) ? strtoupper((string)$data['department']) : '';
if (!in_array($department, TP_ALLOWED_DEPARTMENTS, true)) {
    respondJson(404, ['ok' => false, 'error' => 'Unknown department']);
}
requireDepartmentEditor($department, $passwords);
$margin = validateMargin($data['annotationMargin'] ?? null);

$rawDoc = readJsonLocked($settingsFile);
$doc = normalizeSettingsDoc($rawDoc);
$existing = departmentEntry($doc, $department);
$entry = [
    'revision' => $existing['revision'] + 1,
    'annotationMargin' => $margin,
];
$doc['departments'][$department] = $entry;
$doc['revision']++;

if (!writeJsonLocked($settingsFile, $doc, true)) {
    respondJson(500, ['ok' => false, 'error' => 'Could not write settings']);
}

respondJson(200, ['ok' => true, 'department' => $department] + $entry);
