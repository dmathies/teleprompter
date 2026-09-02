<?php

header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('X-Accel-Buffering: no');

ini_set('output_buffering', '0');
ini_set('zlib.output_compression', '0');

while (ob_get_level() > 0) {
    ob_end_flush();
}

for ($i = 1; $i <= 60; $i++) {
    $data = [
        'tick' => $i,
        'time' => date('H:i:s'),
        'microtime' => microtime(true),
    ];

    echo "data: " . json_encode($data) . "\n\n";

    flush();

    sleep(1);
}