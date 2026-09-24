<?php
// gatekeeper.php
// Intercepts protected requests to verify show-level access before granting access
// to teleprompter_v2.html, script content, or synchronisation endpoints.

require_once __DIR__ . '/scripts/util/api_common.php';

$passwords = loadPasswords();
$showPassword = $passwords['show'] ?? '';

// Determine target request
$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$uriPath = parse_url($requestUri, PHP_URL_PATH) ?? '/';

// If show password is set and user is NOT authenticated
if ($showPassword !== '' && !isShowAuthenticated($showPassword)) {
    // Check if this is an API/JSON request or SSE stream
    $isApi = str_starts_with($uriPath, '/scripts/') ||
             str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json') ||
             str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'text/event-stream');

    if ($isApi) {
        if (str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'text/event-stream')) {
            header('Content-Type: text/event-stream; charset=utf-8');
            header('Cache-Control: no-cache, no-store, must-revalidate');
            echo "event: error\n";
            echo "data: {\"error\":\"Show authentication required\",\"code\":401}\n\n";
            exit;
        }
        respondJson(401, ['ok' => false, 'error' => 'Show authentication required']);
    }

    // Otherwise redirect browser to login page
    $targetRedirect = $requestUri;
    header('Location: /login.php?redirect=' . urlencode($targetRedirect));
    exit;
}

// User is authenticated (or no show password configured)
// Map request to physical file
$baseDir = __DIR__;
$filePath = realpath($baseDir . $uriPath);

// Prevent directory traversal
if ($filePath === false || !str_starts_with($filePath, $baseDir)) {
    http_response_code(404);
    echo "404 Not Found";
    exit;
}

if (is_dir($filePath)) {
    if (file_exists($filePath . '/index.html')) {
        $filePath = $filePath . '/index.html';
    } elseif (file_exists($filePath . '/index.php')) {
        $filePath = $filePath . '/index.php';
    } else {
        http_response_code(403);
        echo "403 Forbidden";
        exit;
    }
}

// Execute PHP file or serve static file
if (str_ends_with($filePath, '.php')) {
    // Forward script execution
    $_SERVER['SCRIPT_FILENAME'] = $filePath;
    $_SERVER['SCRIPT_NAME'] = $uriPath;
    $_SERVER['PHP_SELF'] = $uriPath;
    require $filePath;
    exit;
}

// Serve static asset with appropriate Content-Type
$ext = pathinfo($filePath, PATHINFO_EXTENSION);
$contentTypes = [
    'html' => 'text/html; charset=utf-8',
    'css'  => 'text/css; charset=utf-8',
    'js'   => 'application/javascript; charset=utf-8',
    'json' => 'application/json; charset=utf-8',
    'svg'  => 'image/svg+xml',
    'png'  => 'image/png',
    'jpg'  => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'ico'  => 'image/x-icon',
    'woff' => 'font/woff',
    'woff2'=> 'font/woff2',
    'ttf'  => 'font/ttf',
];

$mime = $contentTypes[$ext] ?? mime_content_type($filePath) ?: 'application/octet-stream';
header('Content-Type: ' . $mime);
header('Content-Length: ' . filesize($filePath));
if ($ext === 'html') {
    header('Cache-Control: no-cache, must-revalidate');
}
readfile($filePath);
exit;
