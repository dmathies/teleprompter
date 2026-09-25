import { resolve, relative } from 'node:path';
import { existsSync, mkdirSync, copyFileSync, cpSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import Icons from 'unplugin-icons/vite';

function copyDeploymentAssetsPlugin() {
  return {
    name: 'copy-deployment-assets',
    closeBundle() {
      const rootDir = import.meta.dirname;
      const distDir = resolve(rootDir, 'dist');

      if (!existsSync(distDir)) {
        mkdirSync(distDir, { recursive: true });
      }

      // Root files to copy to dist
      const rootFiles = ['.htaccess', 'login.php', 'gatekeeper.php', 'favicon.ico'];
      for (const file of rootFiles) {
        const src = resolve(rootDir, file);
        if (existsSync(src)) {
          copyFileSync(src, resolve(distDir, file));
        }
      }

      // Directory trees to copy recursively: scripts (excluding active session JSON state), show-scripts
      const dirCopies = [
        {
          src: resolve(rootDir, 'scripts'),
          dest: resolve(distDir, 'scripts'),
          filter: (sourcePath) => {
            const rel = relative(rootDir, sourcePath).replace(/\\/g, '/');
            // Do not copy active session JSON state files
            if (rel.startsWith('scripts/teleprompter_state/') && rel.endsWith('.json')) {
              return false;
            }
            return true;
          },
        },
        {
          src: resolve(rootDir, 'show-scripts'),
          dest: resolve(distDir, 'show-scripts'),
        },
      ];

      for (const { src, dest, filter } of dirCopies) {
        if (existsSync(src)) {
          cpSync(src, dest, { recursive: true, filter });
        }
      }

      // Ensure writable deployment runtime directories exist with .gitkeep
      const deploymentDirs = [
        resolve(distDir, 'scripts/teleprompter_state'),
        resolve(distDir, 'show-cues'),
        resolve(distDir, 'show-annotations'),
      ];

      for (const dir of deploymentDirs) {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        const gitkeep = resolve(dir, '.gitkeep');
        if (!existsSync(gitkeep)) {
          writeFileSync(gitkeep, '');
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    Icons({
      compiler: 'raw',
    }),
    copyDeploymentAssetsPlugin(),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        teleprompter: resolve(import.meta.dirname, 'teleprompter_v2.html'),
        pen_pointer_diagnostics: resolve(import.meta.dirname, 'pen_pointer_diagnostics.html'),
        sse_test: resolve(import.meta.dirname, 'sse_test.html'),
      },
    },
  },
  server: {
    proxy: {
      '/scripts': {
        target: 'http://localhost:4805',
        changeOrigin: true,
      },
      '/login.php': {
        target: 'http://localhost:4805',
        changeOrigin: true,
      },
    },
    host: '0.0.0.0'
  }
});
