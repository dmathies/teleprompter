import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import Icons from 'unplugin-icons/vite';

export default defineConfig({
  plugins: [
    Icons({
      compiler: 'raw',
    }),
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
});
