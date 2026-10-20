<?php
// Private content-addressed snapshots, written only by authenticated mutations.
function scriptRevision(string $html): string {
    return hash('sha256', $html);
}

function currentScriptHtml(array $catalog, string $script): string {
    $html = @file_get_contents($catalog[$script]['file']);
    if ($html === false) respondJson(404, ['ok' => false, 'error' => 'Script unavailable']);
    return $html;
}

function snapshotScript(string $script, string $html): string {
    $revision = scriptRevision($html);
    $dir = dirname(__DIR__) . '/teleprompter_state/script_revisions/' . $script;
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        respondJson(500, ['ok' => false, 'error' => 'Could not create script snapshot directory']);
    }
    $file = $dir . '/' . $revision . '.html';
    $lock = @fopen($dir . '/snapshot.lock', 'c');
    if (!$lock || !flockWithTimeout($lock, LOCK_EX)) {
        respondJson(503, ['ok' => false, 'error' => 'Script snapshot busy']);
    }
    if (is_file($file)) {
        if (hash_file('sha256', $file) !== $revision) respondJson(500, ['ok' => false, 'error' => 'Corrupt script snapshot']);
        fclose($lock);
        return $revision;
    }
    // Exclusive creation prevents an immutable snapshot from being replaced.
    $fp = @fopen($file, 'x');
    if (!$fp) respondJson(500, ['ok' => false, 'error' => 'Could not create script snapshot']);
    $ok = flock($fp, LOCK_EX) && fwrite($fp, $html) === strlen($html) && fflush($fp);
    fclose($fp);
    if (!$ok) respondJson(500, ['ok' => false, 'error' => 'Could not write script snapshot']);
    fclose($lock);
    return $revision;
}
