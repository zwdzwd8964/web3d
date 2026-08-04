import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import { defineConfig } from 'vite'

// Stamped into every published manifest (D8): the only thread available later for
// diagnosing "old package, new player".
const coreVersion = createRequire(import.meta.url)('../core/package.json').version

// C6 · zero external runtime dependencies:
//  - no CDN, no Google Fonts, no remote decoder;
//  - vendor/ (Draco + KTX2) is NOT copied into the build output. `sync-vendor.mjs` copies
// three's decoders into the repository's `vendor/`, which is a different thing entirely —
// the bundler emits its own copies into `dist/assets/` via `import.meta.url`. Corrected by
// T-220 / ADR-0037; the original sentence had been false since ADR-0012
//    and served from the app's own origin.
export default defineConfig({
  define: { __W3_CORE_VERSION__: JSON.stringify(coreVersion) },
  plugins: [react()],
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
  },
  server: {
    port: 5180,
    host: '127.0.0.1',
    // Dev-only. A Cloudflare quick tunnel serves the dev server from a random
    // *.trycloudflare.com hostname, and Vite rejects Host headers it was not told
    // about. This does NOT widen the bind address — the listener stays on loopback,
    // so nothing is reachable unless a tunnel is deliberately running.
    allowedHosts: ['.trycloudflare.com'],
  },
})
