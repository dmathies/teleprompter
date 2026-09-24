<?php
// login.php
// Per-show access authentication.
// Verifies show password and issues long-lived HttpOnly auth cookie.

require_once __DIR__ . '/scripts/util/api_common.php';

$passwords = loadPasswords();
$showPassword = $passwords['show'] ?? '';

// If no show password is configured, redirect straight to the teleprompter app
if ($showPassword === '') {
    header('Location: /teleprompter_v2.html');
    exit;
}

$action = $_GET['action'] ?? '';
$redirect = $_GET['redirect'] ?? '/teleprompter_v2.html';
// Support relative paths, or same-host/localhost dev URLs (e.g. http://localhost:5173/teleprompter_v2.html)
$isAllowedRedirect = preg_match('#^/[A-Za-z0-9_\-\./\?=&%]+$#', $redirect) && !str_starts_with($redirect, '//');
if (!$isAllowedRedirect && preg_match('#^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?(/[A-Za-z0-9_\-\./\?=&%]*)?$#', $redirect)) {
    $isAllowedRedirect = true;
}
if (!$isAllowedRedirect) {
    $redirect = '/teleprompter_v2.html';
}

// Check logout
if ($action === 'logout') {
    clearAuthCookie('show');
    if (($_SERVER['HTTP_ACCEPT'] ?? '') === 'application/json' || $action === 'status') {
        respondJson(200, ['ok' => true, 'authenticated' => false]);
    }
    header('Location: /login.php');
    exit;
}

// Check status (API)
if ($action === 'status') {
    respondJson(200, [
        'ok' => true,
        'authenticated' => isShowAuthenticated($showPassword),
        'enabled' => ($showPassword !== ''),
    ]);
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $isJson = str_contains($_SERVER['CONTENT_TYPE'] ?? '', 'application/json');
    $submittedPassword = '';

    if ($isJson) {
        $body = getRequestJson();
        $submittedPassword = is_string($body['password'] ?? null) ? trim($body['password']) : '';
    } else {
        $submittedPassword = is_string($_POST['password'] ?? null) ? trim($_POST['password']) : '';
    }

    if ($submittedPassword !== '' && hash_equals($showPassword, $submittedPassword)) {
        issueAuthCookie('show', $showPassword);

        if ($isJson) {
            respondJson(200, ['ok' => true, 'redirect' => $redirect]);
        } else {
            header('Location: ' . $redirect);
            exit;
        }
    } else {
        if ($isJson) {
            respondJson(401, ['ok' => false, 'error' => 'Incorrect show password']);
        } else {
            $error = 'Incorrect password. Please try again.';
        }
    }
}

// If already authenticated and visiting GET login.php, redirect straight away
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isShowAuthenticated($showPassword)) {
    header('Location: ' . $redirect);
    exit;
}

?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Teleprompter Login</title>
  <style>
    :root {
      --bg-color: #121417;
      --card-bg: #1c2026;
      --border-color: #2e3642;
      --text-color: #e6edf3;
      --muted-color: #8b949e;
      --primary-color: #2f80ed;
      --primary-hover: #1a6cd4;
      --danger-color: #e5534b;
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: var(--bg-color);
      color: var(--text-color);
      font-family: var(--font-family);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .login-card {
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 2.25rem 2rem;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    }
    .brand-title {
      font-size: 1.4rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 0.5rem;
      text-align: center;
    }
    .brand-subtitle {
      font-size: 0.9rem;
      color: var(--muted-color);
      text-align: center;
      margin-bottom: 1.75rem;
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      margin-bottom: 0.5rem;
      color: var(--muted-color);
    }
    input[type="password"] {
      width: 100%;
      background-color: #121417;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      font-size: 1rem;
      color: var(--text-color);
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    input[type="password"]:focus {
      border-color: var(--primary-color);
      box-shadow: 0 0 0 3px rgba(47, 128, 237, 0.25);
    }
    .submit-btn {
      width: 100%;
      background-color: var(--primary-color);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0.8rem 1rem;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.15s ease;
      margin-top: 0.5rem;
    }
    .submit-btn:hover {
      background-color: var(--primary-hover);
    }
    .error-msg {
      background-color: rgba(229, 83, 75, 0.15);
      border: 1px solid rgba(229, 83, 75, 0.4);
      color: var(--danger-color);
      padding: 0.65rem 0.85rem;
      border-radius: 6px;
      font-size: 0.85rem;
      margin-bottom: 1.25rem;
      text-align: center;
    }
    .persistence-note {
      font-size: 0.78rem;
      color: var(--muted-color);
      margin-top: 1.25rem;
      text-align: center;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <h1 class="brand-title">GAOS Teleprompter</h1>
    <p class="brand-subtitle">Enter the show password to access the teleprompter</p>

    <?php if ($error !== ''): ?>
      <div class="error-msg"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div>
    <?php endif; ?>

    <form method="POST" action="login.php?redirect=<?= urlencode($redirect) ?>">
      <div class="form-group">
        <label for="password">Show Password</label>
        <input type="password" id="password" name="password" required autofocus autocomplete="current-password" placeholder="Password">
      </div>
      <button type="submit" class="submit-btn">Unlock Teleprompter</button>
    </form>
    <div class="persistence-note">
      This device will remain unlocked for 60 days so rehearsals and live performances proceed without interruption.
    </div>
  </div>
</body>
</html>
