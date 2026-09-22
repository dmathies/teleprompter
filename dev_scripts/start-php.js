import http from 'node:http';
import { spawn } from 'node:child_process';
import process from 'node:process';

const HOST = process.env.PHP_HOST || '127.0.0.1';
const PORT = parseInt(process.env.PHP_PORT || '4805', 10);
const isWin = process.platform === 'win32';
const workerCount = parseInt(process.env.PHP_CLI_SERVER_WORKERS || '5', 10);

const phpBin = process.env.PHP_BIN || 'php';

if (!isWin) {
  // On Linux/macOS, PHP built-in server natively supports PHP_CLI_SERVER_WORKERS via fork()
  console.log(`[php-dev-server] Starting native PHP built-in server on http://${HOST}:${PORT} (PHP_CLI_SERVER_WORKERS=${workerCount})...`);
  const php = spawn(phpBin, ['-S', `${HOST}:${PORT}`], {
    stdio: 'inherit',
    env: { ...process.env, PHP_CLI_SERVER_WORKERS: String(workerCount) },
  });

  php.on('error', (err) => {
    console.error('[php-dev-server] Failed to spawn PHP:', err.message);
    process.exit(1);
  });
  php.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => { php.kill('SIGINT'); process.exit(0); });
  process.on('SIGTERM', () => { php.kill('SIGTERM'); process.exit(0); });
} else {
  // On Windows, php -S does not support fork().
  // Run a pool of lightweight php -S worker instances and round-robin incoming HTTP requests.
  const baseWorkerPort = PORT + 10;
  const workers = [];

  for (let i = 0; i < workerCount; i++) {
    const workerPort = baseWorkerPort + i;
    const worker = spawn(phpBin, ['-S', `127.0.0.1:${workerPort}`], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: process.env,
    });
    workers.push({ port: workerPort, process: worker, activeRequests: 0 });
  }

  console.log(`[php-dev-server] Spawned ${workerCount} PHP worker instances on Windows (ports ${baseWorkerPort}..${baseWorkerPort + workerCount - 1})`);

  function getAvailableWorker() {
    // Pick worker with lowest active connection count (least-connections load balancing)
    let minWorker = workers[0];
    for (let i = 1; i < workers.length; i++) {
      if (workers[i].activeRequests < minWorker.activeRequests) {
        minWorker = workers[i];
      }
    }
    return minWorker;
  }

  const proxy = http.createServer((req, res) => {
    const target = getAvailableWorker();
    target.activeRequests++;

    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: target.port,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: req.headers.host || `${HOST}:${PORT}`,
      },
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    const finish = () => {
      target.activeRequests = Math.max(0, target.activeRequests - 1);
    };

    res.on('finish', finish);
    res.on('close', () => {
      finish();
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
    });

    proxyReq.on('error', (err) => {
      finish();
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'PHP worker unavailable: ' + err.message }));
      }
    });

    req.pipe(proxyReq);
  });

  proxy.listen(PORT, HOST, () => {
    console.log(`[php-dev-server] Load-balancer listening on http://${HOST}:${PORT}`);
  });

  let cleaningUp = false;
  const cleanup = () => {
    if (cleaningUp) return;
    cleaningUp = true;
    try {
      proxy.close();
    } catch (_) {}
    for (const w of workers) {
      if (w.process && !w.process.killed && w.process.pid) {
        try {
          spawn('taskkill', ['/pid', w.process.pid.toString(), '/f', '/t']);
        } catch (_) {}
      }
    }
  };

  process.on('SIGINT', () => { cleanup(); setTimeout(() => process.exit(0), 200); });
  process.on('SIGTERM', () => { cleanup(); setTimeout(() => process.exit(0), 200); });
  process.on('exit', cleanup);
}
