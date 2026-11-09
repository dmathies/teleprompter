<?php
require_once __DIR__ . '/util/api_common.php';
require_once __DIR__ . '/util/script_revisions.php';
require_once __DIR__ . '/util/script_editor.php';
header('Cache-Control: no-store');
$passwords = loadPasswords();
requireShowAccess($passwords['show']);
$provided = getHeader('X-Teleprompter-Key');
$headerOk = $passwords['master'] !== '' && $provided !== '' && hash_equals($passwords['master'], $provided);
if (!$headerOk && !isAuthCookieValid('master', $passwords['master'])) respondJson(403, ['error' => 'PRM login required']);
if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'], true)) respondJson(405, ['error' => 'Method not allowed']);
if ($_SERVER['REQUEST_METHOD'] === 'POST' && stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) respondJson(415, ['error' => 'JSON required']);
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 2000000) respondJson(413, ['error' => 'Save a smaller set of changes']);
$data = $_SERVER['REQUEST_METHOD'] === 'POST' ? getRequestJson() : $_GET;
$script = $data['script'] ?? '';
$catalog = require __DIR__ . '/script_catalog.php';
if (!is_string($script) || !isValidId($script) || !isset($catalog[$script])) respondJson(404, ['error' => 'Unknown script']);
$file = $catalog[$script]['file'];
$dir = __DIR__ . '/teleprompter_state/script_revisions/' . $script;
if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) respondJson(500, ['error' => 'Could not create backup directory']);
$lock = @fopen($dir . '/editor.lock', 'c');
if (!$lock || !flockWithTimeout($lock, LOCK_EX)) respondJson(503, ['error' => 'Script editor busy; try again']);
try {
    $original = currentScriptHtml($catalog, $script);
    $revision = scriptRevision($original);
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        snapshotScript($script, $original);
        respondJson(200, ['script' => $script, 'revision' => $revision, 'blocks' => editorModel($original)]);
    }
    if (($data['expectedRevision'] ?? '') !== $revision) respondJson(409, ['error' => 'The script changed since you opened the editor. Your draft is still here; reopen the editor after copying your changes.']);
    if (!is_array($data['operations'] ?? null)) throw new InvalidArgumentException('Changes are required');
    $result = editorApply($original, $data['operations']);
    $next = scriptRevision($result['html']);
    snapshotScript($script, $original);
    snapshotScript($script, $result['html']);
    // External deployments do not take this lock; refuse a detected overwrite.
    if (currentScriptHtml($catalog, $script) !== $original) respondJson(409, ['error' => 'Script changed while saving; retry after reopening']);
    if ($next !== $revision) editorWrite($file, $result['html']);
    $signal = mutateJsonLocked(__DIR__ . '/teleprompter_state/script_updates.json', function($map) use ($script, $next) {
        $map = $map ?? []; $map[$script] = ['revision' => $next]; return $map;
    });
    respondJson(200, ['ok' => true, 'revision' => $next, 'ids' => $result['ids'], 'backupRevision' => $revision,
        'notice' => $signal ? '' : 'Saved, but update notifications failed. Other devices should reload.']);
} catch (InvalidArgumentException $error) { respondJson(400, ['error' => $error->getMessage()]); }
catch (Throwable $error) { respondJson(500, ['error' => $error->getMessage()]); }
finally { if (is_resource($lock)) fclose($lock); }
