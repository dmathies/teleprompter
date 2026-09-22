<?php
// teleprompter_sync.php
require_once __DIR__ . '/util/api_common.php';

$MASTER_PASSWORD = loadPasswords()['master'];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$room = $_GET['room'] ?? 'default';
if (!isValidId($room)) {
    respondJson(400, ['error' => 'Invalid room']);
}

$stateDir = __DIR__ . '/teleprompter_state';
$file = $stateDir . '/' . $room . '.json';
$controlFile = $stateDir . '/' . $room . '.master.json';
$MASTER_LEASE_SECONDS = 10.0;

function isValidSessionId($id): bool {
    return is_string($id) && strlen($id) >= 8 && strlen($id) <= 160 && preg_match('/^[A-Za-z0-9._:-]+$/', $id);
}

$authAction = $_GET['auth'] ?? '';
if ($authAction === 'status') {
    respondJson(200, ['ok' => true, 'authenticated' => isAuthCookieValid('master', $MASTER_PASSWORD), 'expiresHours' => 24]);
}
if ($authAction === 'logout') {
    clearAuthCookie('master');
    respondJson(200, ['ok' => true]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $provided = getHeader('X-Teleprompter-Key');
    $headerOk = $MASTER_PASSWORD !== '' && $provided !== '' && hash_equals($MASTER_PASSWORD, $provided);
    $cookieOk = isAuthCookieValid('master', $MASTER_PASSWORD);
    if (!$headerOk && !$cookieOk) {
        respondJson(403, ['error' => 'Forbidden']);
    }
    if ($headerOk) issueAuthCookie('master', $MASTER_PASSWORD);

    $data = getRequestJson();
    if (empty($data) && file_get_contents('php://input') === '') {
        respondJson(400, ['error' => 'Invalid JSON']);
    }

    if (($_GET['control'] ?? '') === 'claim') {
        $sessionId = $data['sessionId'] ?? '';
        $force = !empty($data['force']);
        if (!isValidSessionId($sessionId)) {
            respondJson(400, ['error' => 'Invalid master session']);
        }

        $now = microtime(true);
        $current = readJsonLocked($controlFile);
        $activeOther = $current && isset($current['sessionId'], $current['lastSeen']) &&
            $current['sessionId'] !== $sessionId && ($now - (float)$current['lastSeen']) < $MASTER_LEASE_SECONDS;
        if ($activeOther && !$force) {
            respondJson(409, ['ok' => false, 'error' => 'Another master is active', 'active' => true]);
        }
        $control = ['sessionId' => $sessionId, 'claimedAt' => $now, 'lastSeen' => $now];
        if (!writeJsonLocked($controlFile, $control)) {
            respondJson(500, ['error' => 'Could not save master control']);
        }
        respondJson(200, ['ok' => true, 'takenOver' => $activeOther, 'serverTime' => $now]);
    }

    // Every normal master update must belong to the current server-side owner.
    // This deliberately makes pre-upgrade/zombie masters harmless: they have no session token.
    $sessionId = getHeader('X-Teleprompter-Master-Session');
    $control = readJsonLocked($controlFile);
    if (!isValidSessionId($sessionId) || !$control || !isset($control['sessionId']) || !hash_equals((string)$control['sessionId'], $sessionId)) {
        respondJson(409, ['ok' => false, 'error' => 'Master control lost']);
    }

    $now = microtime(true);
    $control['lastSeen'] = $now;
    writeJsonLocked($controlFile, $control);

    $data['serverTime'] = $now;
    if (!writeJsonLocked($file, $data)) {
        respondJson(500, ['error' => 'Could not write state file']);
    }
    respondJson(200, ['ok' => true, 'serverTime' => $now]);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $state = readJsonLocked($file);
    // Return the current server clock alongside the stored state. Followers
    // use this to age serverTime/interactionAgeMs consistently after reloads.
    respondJson(200, ['ok' => true, 'state' => $state, 'serverTime' => microtime(true)]);
}

respondJson(405, ['error' => 'Method not allowed']);
