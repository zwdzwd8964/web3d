import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'es2022',
  // Declarations come from tsc, not from tsup's rollup-plugin-dts: that plugin does
  // not support the TypeScript 7 compiler API (see ADR-0004). tsup still owns the JS.
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
})
