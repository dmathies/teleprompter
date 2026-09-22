<?php
// scripts/api_common.php
// Shared utility helpers for teleprompter PHP endpoints.

require_once __DIR__ . '/auth_cookie.php';

const TP_ALLOWED_DEPARTMENTS = ['FS', 'LX', 'SND', 'STG'];

function tp_respond_json(int $status, array $body): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

function tp_valid_id(string $value): bool {
    return (bool)preg_match('/^[A-Za-z0-9_-]+$/', $value);
}

function tp_request_json(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function tp_get_header(string $name): string {
    $serverName = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return $_SERVER[$serverName] ?? '';
}

function tp_flock_with_timeout($fp, int $operation, float $timeoutSeconds = 2.0): bool {
    $start = microtime(true);
    do {
        if (@flock($fp, $operation | LOCK_NB)) {
            return true;
        }
        usleep(10000); // 10ms backoff
    } while ((microtime(true) - $start) < $timeoutSeconds);
    return false;
}

function tp_read_json_locked(string $file): ?array {
    if (!is_file($file)) return null;
    $fp = @fopen($file, 'r');
    if (!$fp) return null;
    if (!tp_flock_with_timeout($fp, LOCK_SH)) {
        fclose($fp);
        return null;
    }
    $raw = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    if ($raw === false || trim($raw) === '') return null;
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}

function tp_write_json_locked(string $file, array $data, bool $pretty = false): bool {
    $dir = dirname($file);
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        return false;
    }
    $fp = @fopen($file, 'c+');
    if (!$fp) return false;
    if (!tp_flock_with_timeout($fp, LOCK_EX)) {
        fclose($fp);
        return false;
    }
    ftruncate($fp, 0);
    rewind($fp);
    $flags = JSON_UNESCAPED_SLASHES;
    if ($pretty) $flags |= JSON_PRETTY_PRINT;
    $encoded = json_encode($data, $flags);
    $ok = ($encoded !== false) && (fwrite($fp, $encoded . ($pretty ? "\n" : "")) !== false);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return $ok;
}

function tp_load_passwords(): array {
    $passwordConfig = require __DIR__ . '/passwords.php';
    if (!is_array($passwordConfig)) {
        return ['master' => '', 'departments' => []];
    }
    return [
        'master' => is_string($passwordConfig['master'] ?? null) ? $passwordConfig['master'] : '',
        'departments' => is_array($passwordConfig['departments'] ?? null) ? $passwordConfig['departments'] : [],
    ];
}

function tp_require_department_editor(string $dept, array $passwords): void {
    $provided = tp_get_header('X-Cue-Key');
    $expected = $passwords[$dept] ?? null;
    $role = 'dept_' . strtolower($dept);

    $headerOk = is_string($expected) && $expected !== '' &&
        $provided !== '' && hash_equals($expected, $provided);
    $cookieOk = is_string($expected) && tp_auth_cookie_valid($role, $expected);

    if (!$headerOk && !$cookieOk) {
        tp_respond_json(403, ['ok' => false, 'error' => 'Authentication failed']);
    }

    if ($headerOk) {
        tp_issue_auth_cookie($role, $expected);
    }
}

function tp_update_revision_signal(string $signalFile, string $stateDir, string $script, string $dept, int $revision): void {
    if (!is_dir($stateDir) && !mkdir($stateDir, 0775, true) && !is_dir($stateDir)) return;

    $fp = @fopen($signalFile, 'c+');
    if ($fp === false) return;
    if (!tp_flock_with_timeout($fp, LOCK_EX)) { fclose($fp); return; }

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
