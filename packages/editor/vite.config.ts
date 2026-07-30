import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// C6 · zero external runtime dependencies:
//  - no CDN, no Google Fonts, no remote decoder;
//  - vendor/ (Draco + KTX2) is copied into the build output by scripts/sync-vendor.mjs
//    and served from the app's own origin.
export default defineConfig({
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
    // No remote chunks: everything ships in the bundle.
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  server: { port: 5180, host: '127.0.0.1' },
})
