<?php
// teleprompter_sync.php
$passwordConfig = require __DIR__ . '/passwords.php';
$MASTER_PASSWORD = is_array($passwordConfig) && is_string($passwordConfig['master'] ?? null)
    ? $passwordConfig['master']
    : '';
unset($passwordConfig);
require_once __DIR__ . '/auth_cookie.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$room = $_GET['room'] ?? 'default';
if (!preg_match('/^[A-Za-z0-9_-]+$/', $room)) {
    http_response_code(400); echo json_encode(['error'=>'Invalid room']); exit;
}

$stateDir = __DIR__ . '/teleprompter_state';
if (!is_dir($stateDir) && !mkdir($stateDir, 0775, true) && !is_dir($stateDir)) {
    http_response_code(500); echo json_encode(['error'=>'Could not create state directory']); exit;
}

$file = $stateDir . '/' . $room . '.json';
$controlFile = $stateDir . '/' . $room . '.master.json';
$MASTER_LEASE_SECONDS = 10.0;

function getHeaderValue(string $name): string {
    $serverName = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return $_SERVER[$serverName] ?? '';
}
function valid_session_id($id): bool {
    return is_string($id) && strlen($id) >= 8 && strlen($id) <= 160 && preg_match('/^[A-Za-z0-9._:-]+$/', $id);
}
function read_json_locked(string $file): ?array {
    if (!is_file($file)) return null;
    $fp = @fopen($file, 'r'); if (!$fp) return null;
    if (!@flock($fp, LOCK_SH)) { fclose($fp); return null; }
    $json = stream_get_contents($fp); flock($fp, LOCK_UN); fclose($fp);
    $v = json_decode((string)$json, true); return is_array($v) ? $v : null;
}
function write_json_locked(string $file, array $data): bool {
    $fp = @fopen($file, 'c+'); if (!$fp) return false;
    if (!@flock($fp, LOCK_EX)) { fclose($fp); return false; }
    ftruncate($fp,0); rewind($fp);
    $ok = fwrite($fp, json_encode($data, JSON_UNESCAPED_SLASHES)) !== false;
    fflush($fp); flock($fp, LOCK_UN); fclose($fp); return $ok;
}
function authenticated(string $password): bool {
    $provided = getHeaderValue('X-Teleprompter-Key');
    $headerOk = $password !== '' && $provided !== '' && hash_equals($password, $provided);
    return $headerOk || tp_auth_cookie_valid('master', $password);
}

$authAction = $_GET['auth'] ?? '';
if ($authAction === 'status') {
    echo json_encode(['ok'=>true,'authenticated'=>tp_auth_cookie_valid('master',$MASTER_PASSWORD),'expiresHours'=>24]); exit;
}
if ($authAction === 'logout') {
    tp_clear_auth_cookie('master'); echo json_encode(['ok'=>true]); exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $provided = getHeaderValue('X-Teleprompter-Key');
    $headerOk = $MASTER_PASSWORD !== '' && $provided !== '' && hash_equals($MASTER_PASSWORD, $provided);
    $cookieOk = tp_auth_cookie_valid('master', $MASTER_PASSWORD);
    if (!$headerOk && !$cookieOk) { http_response_code(403); echo json_encode(['error'=>'Forbidden']); exit; }
    if ($headerOk) tp_issue_auth_cookie('master', $MASTER_PASSWORD);

    $body = file_get_contents('php://input');
    $data = json_decode($body, true);
    if (!is_array($data)) { http_response_code(400); echo json_encode(['error'=>'Invalid JSON']); exit; }

    if (($_GET['control'] ?? '') === 'claim') {
        $sessionId = $data['sessionId'] ?? '';
        $force = !empty($data['force']);
        if (!valid_session_id($sessionId)) { http_response_code(400); echo json_encode(['error'=>'Invalid master session']); exit; }

        $now = microtime(true);
        $current = read_json_locked($controlFile);
        $activeOther = $current && isset($current['sessionId'],$current['lastSeen']) &&
            $current['sessionId'] !== $sessionId && ($now - (float)$current['lastSeen']) < $MASTER_LEASE_SECONDS;
        if ($activeOther && !$force) {
            http_response_code(409);
            echo json_encode(['ok'=>false,'error'=>'Another master is active','active'=>true]); exit;
        }
        $control = ['sessionId'=>$sessionId,'claimedAt'=>$now,'lastSeen'=>$now];
        if (!write_json_locked($controlFile,$control)) { http_response_code(500); echo json_encode(['error'=>'Could not save master control']); exit; }
        echo json_encode(['ok'=>true,'takenOver'=>$activeOther,'serverTime'=>$now]); exit;
    }

    // Every normal master update must belong to the current server-side owner.
    // This deliberately makes pre-upgrade/zombie masters harmless: they have no session token.
    $sessionId = getHeaderValue('X-Teleprompter-Master-Session');
    $control = read_json_locked($controlFile);
    if (!valid_session_id($sessionId) || !$control || !isset($control['sessionId']) || !hash_equals((string)$control['sessionId'], $sessionId)) {
        http_response_code(409);
        echo json_encode(['ok'=>false,'error'=>'Master control lost']); exit;
    }

    $now = microtime(true);
    $control['lastSeen'] = $now;
    write_json_locked($controlFile, $control);

    $data['serverTime'] = $now;
    if (!write_json_locked($file, $data)) { http_response_code(500); echo json_encode(['error'=>'Could not write state file']); exit; }
    echo json_encode(['ok'=>true,'serverTime'=>$now]); exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $state = read_json_locked($file);
    // Return the current server clock alongside the stored state.  Followers
    // use this to age serverTime/interactionAgeMs consistently after reloads.
    echo json_encode(['ok'=>true,'state'=>$state,'serverTime'=>microtime(true)]); exit;
}
http_response_code(405); echo json_encode(['error'=>'Method not allowed']);
