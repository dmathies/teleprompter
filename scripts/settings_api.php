<?php
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

$passwordConfig = require __DIR__ . '/passwords.php';
$passwords = is_array($passwordConfig) && is_array($passwordConfig['departments'] ?? null)
    ? $passwordConfig['departments']
    : [];
unset($passwordConfig);
require_once __DIR__ . '/auth_cookie.php';

$allowedDepartments = ['FS', 'LX', 'SND', 'STG'];
$stateDir = __DIR__ . '/teleprompter_state';
$settingsFile = $stateDir . '/department_settings.json';

function respond_json(int $status, array $body): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

function request_json(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

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
        respond_json(400, ['ok' => false, 'error' => 'Invalid annotation margin']);
    }
    $side = $margin['side'] ?? null;
    $width = $margin['width'] ?? null;
    if (!is_string($side) || !in_array($side, ['none', 'left', 'right'], true) ||
        !is_numeric($width)) {
        respond_json(400, ['ok' => false, 'error' => 'Invalid annotation margin']);
    }
    $numericWidth = (float)$width;
    if (!is_finite($numericWidth) || $numericWidth < 0 || $numericWidth > 40) {
        respond_json(400, ['ok' => false, 'error' => 'Invalid annotation margin']);
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

function read_settings_doc(string $file): array {
    if (!is_file($file)) return empty_settings_doc();
    $fp = @fopen($file, 'r');
    if ($fp === false) return empty_settings_doc();
    if (!@flock($fp, LOCK_SH)) {
        fclose($fp);
        return empty_settings_doc();
    }
    $raw = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    if ($raw === false || trim($raw) === '') return empty_settings_doc();
    return normalize_settings_doc(json_decode($raw, true));
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

function require_department_editor(string $department, array $passwords): void {
    $provided = $_SERVER['HTTP_X_CUE_KEY'] ?? '';
    $expected = $passwords[$department] ?? null;
    $role = 'dept_' . strtolower($department);
    $headerOk = is_string($expected) && $expected !== '' &&
        is_string($provided) && $provided !== '' && hash_equals($expected, $provided);
    $cookieOk = is_string($expected) && tp_auth_cookie_valid($role, $expected);

    if (!$headerOk && !$cookieOk) {
        respond_json(403, ['ok' => false, 'error' => 'Authentication failed']);
    }
    if ($headerOk) tp_issue_auth_cookie($role, $expected);
}

$action = $_GET['action'] ?? 'get';

if ($action === 'get') {
    $department = isset($_GET['dept']) ? strtoupper((string)$_GET['dept']) : '';
    if (!in_array($department, $allowedDepartments, true)) {
        respond_json(404, ['ok' => false, 'error' => 'Unknown department']);
    }
    $entry = department_entry(read_settings_doc($settingsFile), $department);
    respond_json(200, ['ok' => true, 'department' => $department] + $entry);
}

if ($action !== 'save') {
    respond_json(404, ['ok' => false, 'error' => 'Unknown action']);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond_json(405, ['ok' => false, 'error' => 'POST required']);
}

$data = request_json();
$department = isset($data['department']) ? strtoupper((string)$data['department']) : '';
if (!in_array($department, $allowedDepartments, true)) {
    respond_json(404, ['ok' => false, 'error' => 'Unknown department']);
}
require_department_editor($department, $passwords);
$margin = validate_margin($data['annotationMargin'] ?? null);

if (!is_dir($stateDir) && !mkdir($stateDir, 0775, true) && !is_dir($stateDir)) {
    respond_json(500, ['ok' => false, 'error' => 'Settings directory is not writable']);
}

$fp = @fopen($settingsFile, 'c+');
if ($fp === false) respond_json(500, ['ok' => false, 'error' => 'Settings file is not writable']);
if (!@flock($fp, LOCK_EX)) {
    fclose($fp);
    respond_json(500, ['ok' => false, 'error' => 'Could not lock settings file']);
}

try {
    rewind($fp);
    $raw = stream_get_contents($fp);
    $doc = ($raw === false || trim($raw) === '')
        ? empty_settings_doc()
        : normalize_settings_doc(json_decode($raw, true));
    $existing = department_entry($doc, $department);
    $entry = [
        'revision' => $existing['revision'] + 1,
        'annotationMargin' => $margin,
    ];
    $doc['departments'][$department] = $entry;
    $doc['revision']++;

    $encoded = json_encode($doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($encoded === false) throw new RuntimeException('Could not encode settings');
    rewind($fp);
    if (!ftruncate($fp, 0) || fwrite($fp, $encoded . "\n") === false || !fflush($fp)) {
        throw new RuntimeException('Could not write settings');
    }
    flock($fp, LOCK_UN);
    fclose($fp);
    respond_json(200, ['ok' => true, 'department' => $department] + $entry);
} catch (Throwable $e) {
    flock($fp, LOCK_UN);
    fclose($fp);
    respond_json(500, ['ok' => false, 'error' => 'Settings update failed']);
}
