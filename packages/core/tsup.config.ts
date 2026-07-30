import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // Separate entry so the ECA engine can be imported in pure Node with no three.js
    // and no WebGL context (C8). Nothing under src/eca/** may import three.
    eca: 'src/eca.ts',
  },
  format: ['esm'],
  target: 'es2022',
  // Declarations come from tsc — see ADR-0004.
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['three', '@w3/schema'],
})
