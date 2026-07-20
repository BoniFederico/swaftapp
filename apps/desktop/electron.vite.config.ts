import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const here = dirname(fileURLToPath(import.meta.url));

// Resolve @swaft/shared to its TypeScript source so Vite/Rollup transpile it as project source
// (avoids the "TS in node_modules is not transpiled" pitfall in a workspace).
const sharedAlias = {
  '@swaft/shared': resolve(here, '../../packages/shared/src/index.ts'),
};

// Keep real node dependencies (sql.js, hash-wasm) EXTERNAL so they are `require`d from node_modules
// at runtime — bundling sql.js breaks its UMD wrapper + WASM loading. `@swaft/shared` is excluded so
// it stays bundled from its TS source (it is not a built package).
const externalize = externalizeDepsPlugin({ exclude: ['@swaft/shared'] });

export default defineConfig({
  main: {
    plugins: [externalize],
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        // Extra entries emitted next to the main bundle and spawned by it:
        // - `dbWorker` (worker thread) keeps sql.js off the main thread;
        // - `scriptHost` (utilityProcess) runs user-authored capabilities in their own process.
        input: {
          index: resolve(here, 'src/main/index.ts'),
          dbWorker: resolve(here, 'src/main/workers/db.worker.ts'),
          scriptHost: resolve(here, 'src/main/workers/script-host.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalize],
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: { index: resolve(here, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(here, 'src/renderer'),
    resolve: { alias: sharedAlias },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(here, 'src/renderer/index.html') },
      },
    },
  },
});
