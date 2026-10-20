import { register } from 'node:module';

// Node 25 exposes an enumerable localStorage getter which throws without a
// backing file. Lit's server DOM shim copies globals while loading components.
// These unit tests do not need persistent browser storage.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: undefined,
});

register(new URL('./test-loader.mjs', import.meta.url).href, import.meta.url);
