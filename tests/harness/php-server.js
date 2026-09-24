import http from 'node:http';
import { spawn } from 'node:child_process';
import process from 'node:process';
import fs from 'node:fs';

function findPhpBinary() {
  if (process.env.PHP_BIN) return process.env.PHP_BIN;

  const commonWinPaths = [
    'C:\\xampp\\php\\php.exe',
    'C:\\tools\\php\\php.exe',
    'C:\\laragon\\bin\\php\\php-current\\php.exe',
    'C:\\Program Files\\PHP\\php.exe',
  ];

  if (process.platform === 'win32') {
    for (const p of commonWinPaths) {
      try {
        if (fs.existsSync(p)) return p;
      } catch (_) {}
    }
  }

  return 'php';
}

export class PhpTestServer {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 4899;
    this.workerCount = options.workerCount || 4;
    this.phpBin = options.phpBin || findPhpBinary();
    this.rootDir = options.rootDir || process.cwd();
    this.workers = [];
    this.proxy = null;
    this.baseUrl = `http://${this.host}:${this.port}`;
  }

  static async isAvailable(bin = findPhpBinary()) {
    return new Promise((resolve) => {
      try {
        const probe = spawn(bin, ['-v']);
        probe.on('error', () => resolve(false));
        probe.on('exit', (code) => resolve(code === 0));
      } catch (_) {
        resolve(false);
      }
    });
  }

  async start() {
    const isWin = process.platform === 'win32';
    const baseWorkerPort = this.port + 10;

    // Verify PHP is launchable
    await new Promise((resolve, reject) => {
      const probe = spawn(this.phpBin, ['-v']);
      probe.on('error', (err) => reject(new Error(`Could not spawn PHP (${this.phpBin}): ${err.message}`)));
      probe.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`PHP probe exited with code ${code}`));
      });
    });

    if (!isWin) {
      const php = spawn(this.phpBin, ['-S', `${this.host}:${this.port}`, '-t', this.rootDir], {
        stdio: ['ignore', 'ignore', 'ignore'],
        env: { ...process.env, PHP_CLI_SERVER_WORKERS: String(this.workerCount) },
      });
      this.workers.push({ process: php });
    } else {
      for (let i = 0; i < this.workerCount; i++) {
        const workerPort = baseWorkerPort + i;
        const worker = spawn(this.phpBin, ['-S', `127.0.0.1:${workerPort}`, '-t', this.rootDir], {
          stdio: ['ignore', 'ignore', 'ignore'],
          env: process.env,
        });
        this.workers.push({ port: workerPort, process: worker, activeRequests: 0 });
      }

      const getWorker = () => {
        let min = this.workers[0];
        for (let i = 1; i < this.workers.length; i++) {
          if (this.workers[i].activeRequests < min.activeRequests) min = this.workers[i];
        }
        return min;
      };

      this.proxy = http.createServer((req, res) => {
        const target = getWorker();
        target.activeRequests++;

        const reqHeaders = { ...req.headers };
        if (!reqHeaders['x-show-key'] && !reqHeaders['cookie']) {
          reqHeaders['x-show-key'] = 'CHANGE-ME-SHOW';
        }

        const proxyReq = http.request({
          hostname: '127.0.0.1',
          port: target.port,
          path: req.url,
          method: req.method,
          headers: {
            ...reqHeaders,
            host: req.headers.host || `${this.host}:${this.port}`,
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
          if (!proxyReq.destroyed) proxyReq.destroy();
        });
        proxyReq.on('error', (err) => {
          finish();
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });

        req.pipe(proxyReq);
      });

      await new Promise((resolve) => {
        this.proxy.listen(this.port, this.host, resolve);
      });
    }

    // Wait for all worker instances to accept connections
    if (isWin) {
      for (const w of this.workers) {
        const start = Date.now();
        let ready = false;
        while (Date.now() - start < 5000) {
          try {
            const res = await fetch(`http://127.0.0.1:${w.port}/scripts/list_scripts.php`);
            if (res.status === 200 || res.status === 401) {
              ready = true;
              break;
            }
          } catch (_) {
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        if (!ready) {
          throw new Error(`Worker on port ${w.port} failed to start within 5s`);
        }
      }
    } else {
      const start = Date.now();
      while (Date.now() - start < 5000) {
        try {
          const res = await fetch(`${this.baseUrl}/scripts/list_scripts.php`);
          if (res.status === 200 || res.status === 401) break;
        } catch (_) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    }
  }

  async stop() {
    if (this.proxy) {
      await new Promise((r) => this.proxy.close(r));
    }
    for (const w of this.workers) {
      if (w.process && !w.process.killed && w.process.pid) {
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', w.process.pid.toString(), '/f', '/t']);
          } else {
            w.process.kill('SIGKILL');
          }
        } catch (_) {}
      }
    }
    this.workers = [];
  }
}
