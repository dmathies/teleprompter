import { spawn } from 'node:child_process';
import process from 'node:process';

const WORKERS = process.env.PHP_CLI_SERVER_WORKERS || '10';

console.log(`[dev] Spawning PHP server via dev_scripts/start-php.js (PHP_CLI_SERVER_WORKERS=${WORKERS})...`);

const phpProcess = spawn(process.execPath, ['dev_scripts/start-php.js'], {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

const isWin = process.platform === 'win32';
const viteBin = isWin ? 'npx.cmd' : 'npx';
const viteArgs = ['vite'];

console.log('[dev] Spawning Vite...');

const viteProcess = spawn(viteBin, viteArgs, {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

function killProcess(child) {
  if (!child || child.killed) return;
  try {
    if (isWin && child.pid) {
      spawn('taskkill', ['/pid', child.pid.toString(), '/f', '/t']);
    } else {
      child.kill('SIGINT');
    }
  } catch {
    // ignore
  }
}

let shuttingDown = false;
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  killProcess(phpProcess);
  killProcess(viteProcess);
  setTimeout(() => process.exit(exitCode), 300);
}

phpProcess.on('error', (err) => {
  console.error('[dev] Failed to start PHP:', err.message);
  shutdown(1);
});

viteProcess.on('error', (err) => {
  console.error('[dev] Failed to start Vite:', err.message);
  shutdown(1);
});

phpProcess.on('exit', (code) => {
  if (!shuttingDown) {
    console.log(`[dev] PHP process exited with code ${code}`);
    shutdown(code ?? 0);
  }
});

viteProcess.on('exit', (code) => {
  if (!shuttingDown) {
    console.log(`[dev] Vite process exited with code ${code}`);
    shutdown(code ?? 0);
  }
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
