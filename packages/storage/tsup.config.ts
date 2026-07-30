import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'es2022',
  // Declarations come from tsc — see ADR-0004.
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['@w3/schema'],
})
