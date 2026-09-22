<?php
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/api_common.php';

$catalog = require __DIR__ . '/script_catalog.php';
$passwords = tp_load_passwords()['departments'];
$annotationDir = dirname(__DIR__) . '/show-annotations';
$stateDir = __DIR__ . '/teleprompter_state';
$signalFile = $stateDir . '/annotation_revisions.json';

function annotation_file(string $dir, string $script, string $dept): string {
    return $dir . '/' . $script . '_' . $dept . '.json';
}

function empty_doc(string $script, string $dept): array {
    return [
        'script' => $script,
        'department' => $dept,
        'revision' => 0,
        'annotations' => [],
    ];
}

function normalize_doc($doc, string $script, string $dept): array {
    if (!is_array($doc)) return empty_doc($script, $dept);
    return [
        'script' => $script,
        'department' => $dept,
        'revision' => isset($doc['revision']) ? max(0, (int)$doc['revision']) : 0,
        'annotations' => isset($doc['annotations']) && is_array($doc['annotations'])
            ? array_values($doc['annotations']) : [],
    ];
}

function validate_point($point, string $name): array {
    if (!is_array($point) || count($point) !== 2 || !is_numeric($point[0]) || !is_numeric($point[1])) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid ' . $name]);
    }
    $x = (float)$point[0];
    $y = (float)$point[1];
    // X is normalized to the area remaining after an optional annotation
    // margin. Values outside 0..1 allow drawing into that margin.
    // Y may spill above/below the prompt so annotations can span multiple lines.
    if (!is_finite($x) || !is_finite($y) ||
        $x < -2 || $x > 3 ||
        $y < -10 || $y > 50) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid ' . $name]);
    }
    return [$x, $y];
}

function validate_annotation(array $ann): array {
    $id = isset($ann['id']) && is_string($ann['id']) ? trim($ann['id']) : '';
    if ($id !== '' && !preg_match('/^[A-Za-z0-9_-]{1,100}$/', $id)) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid annotation id']);
    }

    $type = isset($ann['type']) && is_string($ann['type']) ? strtolower(trim($ann['type'])) : '';
    if (!in_array($type, ['stroke', 'arrow', 'ellipse', 'text'], true)) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid annotation type']);
    }

    $prompt = isset($ann['prompt']) && is_string($ann['prompt']) ? trim($ann['prompt']) : '';
    if (!preg_match('/^p[0-9]{6}$/', $prompt)) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid prompt anchor']);
    }

    $color = isset($ann['color']) && is_string($ann['color']) ? trim($ann['color']) : '#ffeb3b';
    if (!preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid colour']);
    }

    $width = isset($ann['width']) && is_numeric($ann['width']) ? (float)$ann['width'] : 3.0;
    if (!is_finite($width) || $width < 0.5 || $width > 24) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid line width']);
    }

    $fontPx = isset($ann['fontPx']) && is_numeric($ann['fontPx']) ? (float)$ann['fontPx'] : 42.0;
    if (!is_finite($fontPx) || $fontPx < 12 || $fontPx > 300) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid reference font size']);
    }

    $coordMode = isset($ann['coordMode']) && is_string($ann['coordMode'])
        ? strtolower(trim($ann['coordMode'])) : 'line';
    if (!in_array($coordMode, ['line', 'block'], true)) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid annotation coordinate mode']);
    }

    $lineHeightPx = isset($ann['lineHeightPx']) && is_numeric($ann['lineHeightPx'])
        ? (float)$ann['lineHeightPx'] : max(1.0, $fontPx * 1.4);
    if (!is_finite($lineHeightPx) || $lineHeightPx < 8 || $lineHeightPx > 500) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid reference line height']);
    }

    $out = [
        'id' => $id,
        'type' => $type,
        'prompt' => $prompt,
        'color' => strtolower($color),
        'width' => $width,
        'fontPx' => $fontPx,
        'lineHeightPx' => $lineHeightPx,
        'coordMode' => $coordMode,
    ];

    if ($type === 'stroke') {
        $points = isset($ann['points']) && is_array($ann['points']) ? $ann['points'] : [];
        if (count($points) < 2 || count($points) > 1500) {
            tp_respond_json(400, ['ok' => false, 'error' => 'Invalid stroke']);
        }
        $out['points'] = array_map(fn($p) => validate_point($p, 'stroke point'), $points);
        if (isset($ann['pressures']) && is_array($ann['pressures'])) {
            if (count($ann['pressures']) !== count($out['points'])) {
                tp_respond_json(400, ['ok' => false, 'error' => 'Invalid stroke pressure data']);
            }
            $pressures = [];
            foreach ($ann['pressures'] as $pressure) {
                if (!is_numeric($pressure)) tp_respond_json(400, ['ok' => false, 'error' => 'Invalid stroke pressure']);
                $pressure = (float)$pressure;
                if (!is_finite($pressure) || $pressure < 0 || $pressure > 1) {
                    tp_respond_json(400, ['ok' => false, 'error' => 'Invalid stroke pressure']);
                }
                $pressures[] = $pressure;
            }
            $out['pressures'] = $pressures;
        }
    } elseif ($type === 'arrow' || $type === 'ellipse') {
        $out['from'] = validate_point($ann['from'] ?? null, 'start point');
        $out['to'] = validate_point($ann['to'] ?? null, 'end point');
    } elseif ($type === 'text') {
        $out['at'] = validate_point($ann['at'] ?? null, 'text point');
        $text = isset($ann['text']) && is_string($ann['text']) ? trim($ann['text']) : '';
        if ($text === '' || strlen($text) > 640) {
            tp_respond_json(400, ['ok' => false, 'error' => 'Annotation text is required']);
        }
        $out['text'] = $text;
    }

    $out['updatedAt'] = microtime(true);
    return $out;
}

$action = $_GET['action'] ?? 'get';

if ($action === 'get') {
    $script = isset($_GET['script']) ? (string)$_GET['script'] : '';
    $dept = isset($_GET['dept']) ? strtoupper((string)$_GET['dept']) : '';
    if (!tp_valid_id($script) || !isset($catalog[$script]) || !in_array($dept, TP_ALLOWED_DEPARTMENTS, true)) {
        tp_respond_json(404, ['ok' => false, 'error' => 'Unknown script or department']);
    }
    $rawDoc = tp_read_json_locked(annotation_file($annotationDir, $script, $dept));
    $doc = normalize_doc($rawDoc, $script, $dept);
    tp_respond_json(200, ['ok' => true] + $doc);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    tp_respond_json(405, ['ok' => false, 'error' => 'POST required']);
}

$data = tp_request_json();
$dept = isset($data['department']) ? strtoupper((string)$data['department']) : '';
if (!in_array($dept, TP_ALLOWED_DEPARTMENTS, true)) {
    tp_respond_json(404, ['ok' => false, 'error' => 'Unknown department']);
}
if ($action === 'logout') {
    tp_clear_auth_cookie('dept_' . strtolower($dept));
    tp_respond_json(200, ['ok' => true, 'department' => $dept]);
}
tp_require_department_editor($dept, $passwords);

$script = isset($data['script']) ? (string)$data['script'] : '';
if (!tp_valid_id($script) || !isset($catalog[$script])) {
    tp_respond_json(404, ['ok' => false, 'error' => 'Unknown script']);
}

$file = annotation_file($annotationDir, $script, $dept);
$rawDoc = tp_read_json_locked($file);
$doc = normalize_doc($rawDoc, $script, $dept);

if ($action === 'save') {
    $ann = validate_annotation(isset($data['annotation']) && is_array($data['annotation']) ? $data['annotation'] : []);
    if ($ann['id'] === '') $ann['id'] = strtolower($dept) . '-ann-' . bin2hex(random_bytes(8));

    $found = false;
    foreach ($doc['annotations'] as $i => $existing) {
        if (is_array($existing) && ($existing['id'] ?? null) === $ann['id']) {
            $doc['annotations'][$i] = $ann;
            $found = true;
            break;
        }
    }
    if (!$found) $doc['annotations'][] = $ann;
} elseif ($action === 'delete') {
    $id = isset($data['id']) ? (string)$data['id'] : '';
    if (!preg_match('/^[A-Za-z0-9_-]{1,100}$/', $id)) {
        tp_respond_json(400, ['ok' => false, 'error' => 'Invalid annotation id']);
    }
    $doc['annotations'] = array_values(array_filter(
        $doc['annotations'],
        fn($a) => !is_array($a) || ($a['id'] ?? null) !== $id
    ));
} else {
    tp_respond_json(404, ['ok' => false, 'error' => 'Unknown action']);
}

$doc['revision']++;
if (!tp_write_json_locked($file, $doc, true)) {
    tp_respond_json(500, ['ok' => false, 'error' => 'Could not write annotation file']);
}

tp_update_revision_signal($signalFile, $stateDir, $script, $dept, $doc['revision']);

tp_respond_json(200, [
    'ok' => true,
    'revision' => $doc['revision'],
    'annotations' => $doc['annotations'],
]);
