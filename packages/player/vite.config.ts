import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The player carries no UI framework at all. That is not an optimisation —
// it is the standing proof that @w3/core is framework-agnostic (C2), and it keeps
// the gzip budget (<= 400 KB excluding assets) reachable.
export default defineConfig({
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  resolve: {
    alias: {
      '@w3/schema': fileURLToPath(new URL('../schema/src/index.ts', import.meta.url)),
      '@w3/storage': fileURLToPath(new URL('../storage/src/index.ts', import.meta.url)),
      '@w3/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5181, host: '127.0.0.1' },
})
