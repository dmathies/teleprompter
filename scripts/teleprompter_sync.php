<?php
// teleprompter_sync.php
require_once __DIR__ . '/api_common.php';

$MASTER_PASSWORD = tp_load_passwords()['master'];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$room = $_GET['room'] ?? 'default';
if (!tp_valid_id($room)) {
    tp_respond_json(400, ['error' => 'Invalid room']);
}

$stateDir = __DIR__ . '/teleprompter_state';
$file = $stateDir . '/' . $room . '.json';
$controlFile = $stateDir . '/' . $room . '.master.json';
$MASTER_LEASE_SECONDS = 10.0;

function valid_session_id($id): bool {
    return is_string($id) && strlen($id) >= 8 && strlen($id) <= 160 && preg_match('/^[A-Za-z0-9._:-]+$/', $id);
}

$authAction = $_GET['auth'] ?? '';
if ($authAction === 'status') {
    tp_respond_json(200, ['ok' => true, 'authenticated' => tp_auth_cookie_valid('master', $MASTER_PASSWORD), 'expiresHours' => 24]);
}
if ($authAction === 'logout') {
    tp_clear_auth_cookie('master');
    tp_respond_json(200, ['ok' => true]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $provided = tp_get_header('X-Teleprompter-Key');
    $headerOk = $MASTER_PASSWORD !== '' && $provided !== '' && hash_equals($MASTER_PASSWORD, $provided);
    $cookieOk = tp_auth_cookie_valid('master', $MASTER_PASSWORD);
    if (!$headerOk && !$cookieOk) {
        tp_respond_json(403, ['error' => 'Forbidden']);
    }
    if ($headerOk) tp_issue_auth_cookie('master', $MASTER_PASSWORD);

    $data = tp_request_json();
    if (empty($data) && file_get_contents('php://input') === '') {
        tp_respond_json(400, ['error' => 'Invalid JSON']);
    }

    if (($_GET['control'] ?? '') === 'claim') {
        $sessionId = $data['sessionId'] ?? '';
        $force = !empty($data['force']);
        if (!valid_session_id($sessionId)) {
            tp_respond_json(400, ['error' => 'Invalid master session']);
        }

        $now = microtime(true);
        $current = tp_read_json_locked($controlFile);
        $activeOther = $current && isset($current['sessionId'], $current['lastSeen']) &&
            $current['sessionId'] !== $sessionId && ($now - (float)$current['lastSeen']) < $MASTER_LEASE_SECONDS;
        if ($activeOther && !$force) {
            tp_respond_json(409, ['ok' => false, 'error' => 'Another master is active', 'active' => true]);
        }
        $control = ['sessionId' => $sessionId, 'claimedAt' => $now, 'lastSeen' => $now];
        if (!tp_write_json_locked($controlFile, $control)) {
            tp_respond_json(500, ['error' => 'Could not save master control']);
        }
        tp_respond_json(200, ['ok' => true, 'takenOver' => $activeOther, 'serverTime' => $now]);
    }

    // Every normal master update must belong to the current server-side owner.
    // This deliberately makes pre-upgrade/zombie masters harmless: they have no session token.
    $sessionId = tp_get_header('X-Teleprompter-Master-Session');
    $control = tp_read_json_locked($controlFile);
    if (!valid_session_id($sessionId) || !$control || !isset($control['sessionId']) || !hash_equals((string)$control['sessionId'], $sessionId)) {
        tp_respond_json(409, ['ok' => false, 'error' => 'Master control lost']);
    }

    $now = microtime(true);
    $control['lastSeen'] = $now;
    tp_write_json_locked($controlFile, $control);

    $data['serverTime'] = $now;
    if (!tp_write_json_locked($file, $data)) {
        tp_respond_json(500, ['error' => 'Could not write state file']);
    }
    tp_respond_json(200, ['ok' => true, 'serverTime' => $now]);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $state = tp_read_json_locked($file);
    // Return the current server clock alongside the stored state. Followers
    // use this to age serverTime/interactionAgeMs consistently after reloads.
    tp_respond_json(200, ['ok' => true, 'state' => $state, 'serverTime' => microtime(true)]);
}

tp_respond_json(405, ['error' => 'Method not allowed']);
