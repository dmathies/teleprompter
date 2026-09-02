<?php
// teleprompter_events.php
// Server-Sent Events stream for teleprompter followers.
// The master still POSTs state to teleprompter_sync.php.

header('Content-Type: text/event-stream; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('X-Accel-Buffering: no');
header('Connection: keep-alive');

ini_set('output_buffering', '0');
ini_set('zlib.output_compression', '0');
set_time_limit(0);
ignore_user_abort(false);

while (ob_get_level() > 0) {
    @ob_end_flush();
}

$room = $_GET['room'] ?? 'default';
if (!preg_match('/^[A-Za-z0-9_-]+$/', $room)) {
    http_response_code(400);
    echo "event: error\n";
    echo "data: {\"error\":\"Invalid room\"}\n\n";
    flush();
    exit;
}

$stateDir = __DIR__ . '/teleprompter_state';
$file = $stateDir . '/' . $room . '.json';
$annotationSignalFile = $stateDir . '/annotation_revisions.json';

// A finite stream is friendlier to shared PHP-FPM hosting. EventSource
// reconnects automatically, carrying Last-Event-ID when available.
$maxLifetimeSeconds = 300;
$checkIntervalUs = 100000;   // 100 ms; master normally publishes at <= 4 Hz
$heartbeatSeconds = 5;

$startedAt = microtime(true);
$lastHeartbeatAt = 0.0;
$lastSignature = null;
$lastAnnotationSignature = null;
$lastEventId = $_SERVER['HTTP_LAST_EVENT_ID'] ?? '';

function read_state_locked(string $file): ?array {
    if (!is_file($file)) return null;

    $fp = @fopen($file, 'r');
    if ($fp === false) return null;

    if (!@flock($fp, LOCK_SH)) {
        fclose($fp);
        return null;
    }

    $json = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    if ($json === false || trim($json) === '') return null;
    $state = json_decode($json, true);
    return is_array($state) ? $state : null;
}


function emit_annotation_revisions(array $map): void {
    echo "event: annotation-revision\n";
    echo 'data: ' . json_encode(['revisions' => $map], JSON_UNESCAPED_SLASHES) . "\n\n";
    flush();
}

function emit_state(array $state): void {
    $sequence = isset($state['sequence']) ? (string)$state['sequence'] : '';

    if ($sequence !== '') {
        echo 'id: ' . str_replace(["\r", "\n"], '', $sequence) . "\n";
    }

    // This is deliberately NOT stored in the state file.  It says when this
    // particular copy of the stored master state left the server, allowing a
    // newly connected follower to calculate the true age of serverTime rather
    // than treating a replayed state as brand new.
    $state['deliveryServerTime'] = microtime(true);
    echo 'data: ' . json_encode($state, JSON_UNESCAPED_SLASHES) . "\n\n";
    flush();
}

// Tell EventSource to reconnect reasonably quickly after our planned recycle.
echo "retry: 1000\n\n";
flush();

while ((microtime(true) - $startedAt) < $maxLifetimeSeconds) {
    if (connection_aborted()) break;

    $state = read_state_locked($file);
    $annotationRevisions = read_state_locked($annotationSignalFile);

    if ($annotationRevisions !== null) {
        $annotationSignature = json_encode($annotationRevisions, JSON_UNESCAPED_SLASHES);
        if ($annotationSignature !== false && $annotationSignature !== $lastAnnotationSignature) {
            $lastAnnotationSignature = $annotationSignature;
            emit_annotation_revisions($annotationRevisions);
            $lastHeartbeatAt = microtime(true);
        }
    }

    if ($state !== null) {
        // Compare the whole JSON state, not file mtime: filesystem timestamp
        // resolution can be too coarse for several master updates per second.
        $signature = json_encode($state, JSON_UNESCAPED_SLASHES);
        $sequence = isset($state['sequence']) ? (string)$state['sequence'] : '';

        if ($signature !== false && $signature !== $lastSignature) {
            $lastSignature = $signature;

            // On reconnect, avoid immediately replaying the exact event the
            // browser says it already received. A newer state is sent at once.
            if ($lastEventId === '' || $sequence === '' || $sequence !== $lastEventId) {
                emit_state($state);
                $lastEventId = '';
                $lastHeartbeatAt = microtime(true);
            }
        }
    }

    $now = microtime(true);
    if (($now - $lastHeartbeatAt) >= $heartbeatSeconds) {
        // Named heartbeat is visible to JavaScript, allowing the follower to
        // distinguish a healthy SSE/server path from a silent/disconnected one.
        echo "event: server-heartbeat\n";
        echo 'data: ' . json_encode(['serverTime' => $now], JSON_UNESCAPED_SLASHES) . "\n\n";
        flush();
        $lastHeartbeatAt = $now;
    }

    usleep($checkIntervalUs);
}

// Normal EOF is intentional. EventSource reconnects automatically.
