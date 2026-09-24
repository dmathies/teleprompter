<?php
// scripts/util/auth_cookie.php
const TP_AUTH_TTL = 86400; // 24 hours for master / department edits
const TP_SHOW_AUTH_TTL = 86400 * 60; // 60 days for show access to avoid repeated prompts

function cookieName(string $role): string {
    return 'tp_auth_' . preg_replace('/[^A-Za-z0-9_-]/', '_', strtolower($role));
}

function b64urlEncode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function issueAuthCookie(string $role, string $password, ?int $ttl = null): void {
    if ($password === '') return;
    $effectiveTtl = $ttl ?? ($role === 'show' ? TP_SHOW_AUTH_TTL : TP_AUTH_TTL);
    $exp = time() + $effectiveTtl;
    $message = $role . '|' . $exp;
    $sig = b64urlEncode(hash_hmac('sha256', $message, $password, true));
    setcookie(cookieName($role), $exp . '.' . $sig, [
        'expires' => $exp,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax', // Lax allows top-level page navigations (e.g. from bookmark/link) to carry cookie
    ]);
}

function clearAuthCookie(string $role): void {
    setcookie(cookieName($role), '', [
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function isAuthCookieValid(string $role, string $password, ?int $ttl = null): bool {
    if ($password === '') return false;
    $value = $_COOKIE[cookieName($role)] ?? '';
    if (!is_string($value) ||
        !preg_match('/^([0-9]{10,12})\.([A-Za-z0-9_-]{20,})$/', $value, $m)) {
        return false;
    }

    $effectiveTtl = $ttl ?? ($role === 'show' ? TP_SHOW_AUTH_TTL : TP_AUTH_TTL);
    $exp = (int)$m[1];
    if ($exp < time() || $exp > time() + $effectiveTtl + 300) return false;

    $message = $role . '|' . $exp;
    $expected = b64urlEncode(hash_hmac('sha256', $message, $password, true));
    return hash_equals($expected, $m[2]);
}
