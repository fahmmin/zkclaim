// Adapted from midnight-examples/examples/leaderboard/ui (Midnight Foundation, Apache-2.0).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // The contract's compiler output is the site root: FetchZkConfigProvider fetches /keys, /zkir and /compiler from it.
  publicDir: path.resolve(here, '../contract/src/managed/zkclaim'),
  build: {
    target: 'esnext',
    commonjsOptions: { transformMixedEsModules: true },
  },
  plugins: [react(), wasm(), topLevelAwait()],
  optimizeDeps: {
    esbuildOptions: { target: 'esnext' },
    // WASM packages must not be pre-bundled by esbuild.
    exclude: ['@midnightntwrk/ledger-v9', '@midnightntwrk/onchain-runtime-v4', '@midnight-ntwrk/midnight-js-protocol'],
  },
  server: {
    port: 5173,
    strictPort: true,
    // The contract package and the hoisted node_modules live one level up.
    fs: { allow: [path.resolve(here, '..')] },
  },
});
