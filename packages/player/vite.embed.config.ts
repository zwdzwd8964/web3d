import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/**
 * T-274 · 宿主 SDK 的构建。
 *
 * ## 与主应用**同一个 dist**，所以 `emptyOutDir: false`
 *
 * `build:app` 先跑、`build:embed` 后跑，两者写同一个目录。少了这一行，第二次构建会把
 * 第一次的产物整个删掉——而症状是「部署上去只有 embed.js，index.html 不见了」。
 *
 * ## 两种格式，因为客户的接法两种都有
 *
 * - `embed.js`（IIFE，全局 `W3Player`）——给一个 `<script src>` 就能用的页面
 * - `embed.mjs`（ESM）——给有构建工具的宿主
 *
 * 体积门槛写在测试里（未压缩 < 12 KB）：SDK 会被拷进客户的页面，而它做的事情只有
 * 「建一个 iframe + 收发消息」。超过这个数就说明有东西不该在里面。
 */
export default defineConfig({
  build: {
    // **不清目录。** 主应用先构建，这一次只往里加两个文件。
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/embed-sdk/index.ts'),
      name: 'W3Player',
      formats: ['iife', 'es'],
      fileName: (format) => (format === 'iife' ? 'embed.js' : 'embed.mjs'),
    },
    rollupOptions: {
      // 零依赖是 SDK 的硬约束，所以没有 external —— 有 external 就意味着有依赖。
      output: { inlineDynamicImports: true },
    },
  },
})
