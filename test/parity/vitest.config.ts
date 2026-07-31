import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Both sides run head-less: no WebGL, no DOM (C3 + C8). Everything the parity comparison
 * looks at — which rules fired, in what order, with what step results — is reachable
 * without a GPU, which is exactly what C8 was for.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@w3/schema': fileURLToPath(new URL('../../packages/schema/src/index.ts', import.meta.url)),
      '@w3/storage': fileURLToPath(new URL('../../packages/storage/src/index.ts', import.meta.url)),
      '@w3/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@w3/player': fileURLToPath(new URL('../../packages/player/src/index.ts', import.meta.url)),
      '@w3/editor': fileURLToPath(new URL('../../packages/editor/src/preview/index.ts', import.meta.url)),
    },
  },
  test: { environment: 'node', include: ['*.test.ts'] },
})
