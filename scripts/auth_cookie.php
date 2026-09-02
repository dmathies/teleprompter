<?php
const TP_AUTH_TTL = 86400; // 24 hours

function tp_cookie_name(string $role): string {
    return 'tp_auth_' . preg_replace('/[^A-Za-z0-9_-]/', '_', strtolower($role));
}

function tp_b64url_encode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function tp_issue_auth_cookie(string $role, string $password): void {
    if ($password === '') return;
    $exp = time() + TP_AUTH_TTL;
    $message = $role . '|' . $exp;
    $sig = tp_b64url_encode(hash_hmac('sha256', $message, $password, true));
    setcookie(tp_cookie_name($role), $exp . '.' . $sig, [
        'expires' => $exp,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function tp_clear_auth_cookie(string $role): void {
    setcookie(tp_cookie_name($role), '', [
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function tp_auth_cookie_valid(string $role, string $password): bool {
    if ($password === '') return false;
    $value = $_COOKIE[tp_cookie_name($role)] ?? '';
    if (!is_string($value) ||
        !preg_match('/^([0-9]{10,12})\.([A-Za-z0-9_-]{20,})$/', $value, $m)) {
        return false;
    }

    $exp = (int)$m[1];
    if ($exp < time() || $exp > time() + TP_AUTH_TTL + 300) return false;

    $message = $role . '|' . $exp;
    $expected = tp_b64url_encode(hash_hmac('sha256', $message, $password, true));
    return hash_equals($expected, $m[2]);
}
