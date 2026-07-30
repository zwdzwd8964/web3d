import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // C8: the document model has no GPU and no DOM dependency at all.
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // MVP_V0 §7.1: @w3/schema statement coverage >= 90%.
      thresholds: { statements: 90, branches: 80, functions: 90, lines: 90 },
    },
  },
})
