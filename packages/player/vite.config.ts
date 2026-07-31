import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { defineConfig } from 'vite'

// Stamped into every published manifest (D8): the only thread available later for
// diagnosing "old package, new player".
const coreVersion = createRequire(import.meta.url)('../core/package.json').version

// The player carries no UI framework at all. That is not an optimisation —
// it is the standing proof that @w3/core is framework-agnostic (C2), and it keeps
// the gzip budget (<= 400 KB excluding assets) reachable.
export default defineConfig({
  define: { __W3_CORE_VERSION__: JSON.stringify(coreVersion) },
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  resolve: {
    alias: {
      '@w3/schema': fileURLToPath(new URL('../schema/src/index.ts', import.meta.url)),
      '@w3/storage': fileURLToPath(new URL('../storage/src/index.ts', import.meta.url)),
      '@w3/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // Two entries: the player, and the standalone benchmark page (T-110). The card's
      // acceptance is "能在客户机器上独立运行（单页，无需编辑器）", so it ships alongside.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        bench: fileURLToPath(new URL('./bench.html', import.meta.url)),
      },
    },
  },
  server: { port: 5181, host: '127.0.0.1' },
})
