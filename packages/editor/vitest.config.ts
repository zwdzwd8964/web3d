import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // T-229 · `main.tsx` 读一个构建期注入的常量（vite.config.ts 的 `define`）。
  // 测试要调它导出的 `restoreLastDocument`，就得把同一个注入补上——否则模块一加载
  // 就是 ReferenceError，而 vitest 报的是「no tests」，看起来像文件没被收集。
  define: { __W3_CORE_VERSION__: JSON.stringify('test') },
  resolve: {
    alias: {
      '@w3/schema': fileURLToPath(new URL('../schema/src/index.ts', import.meta.url)),
      '@w3/storage': fileURLToPath(new URL('../storage/src/index.ts', import.meta.url)),
      '@w3/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
})
