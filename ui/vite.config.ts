// Adapted from midnight-examples/examples/leaderboard/ui (Midnight Foundation, Apache-2.0).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

const here = path.dirname(fileURLToPath(import.meta.url));

// `vercel deploy ui/dist` runs each file in the deployment's api/ folder as a function: ship the Preprod indexer proxy.
const vercelFunction: Plugin = {
  name: 'zkclaim-vercel-function',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'api/indexer.mjs', source: readFileSync(path.resolve(here, 'api/indexer.mjs'), 'utf8') });
  },
};

export default defineConfig({
  // The contract's compiler output is the site root: FetchZkConfigProvider fetches /keys, /zkir and /compiler from it.
  publicDir: path.resolve(here, '../contract/src/managed/zkclaim'),
  build: {
    target: 'esnext',
    commonjsOptions: { transformMixedEsModules: true },
    // The role app, and the wallet-free receipt verifier (verify.html imports nothing from the role app).
    rollupOptions: { input: { main: path.resolve(here, 'index.html'), verify: path.resolve(here, 'verify.html') } },
  },
  plugins: [react(), wasm(), topLevelAwait(), vercelFunction],
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
