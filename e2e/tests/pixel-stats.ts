import type { Page } from '@playwright/test'

/**
 * T-236 · 画面像素统计。
 *
 * 从 `golden-path-full.spec.ts` 里抽出来的——那里原来只有一个返回**标量**的
 * `colourBuckets`，而「开描边前后亮部分布有没有整体上移」这种问题需要的是**分布**，
 * 不是一个计数。
 *
 * 全部纯函数 + 一个 `page.evaluate`。纯函数那部分有自己的 Node 单测
 * （`e2e/tests/pixel-stats.test.ts`），因为「两张直方图差多少」这件事写错了不会让任何
 * E2E 变红——它只会让阈值失去意义。
 */

/** 每个颜色桶（每通道 16 级）里的像素数。 */
export async function bucketHistogram(page: Page, selector = 'canvas'): Promise<Record<string, number>> {
  return page.evaluate((sel) => {
    const canvas = document.querySelector(sel) as HTMLCanvasElement | null
    if (!canvas) return {}
    const scratch = document.createElement('canvas')
    scratch.width = canvas.width
    scratch.height = canvas.height
    const ctx = scratch.getContext('2d')!
    ctx.drawImage(canvas, 0, 0)
    const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height)
    const out: Record<string, number> = {}
    // 每 37 个像素取一个：与原 `colourBuckets` 逐字相同的步长，保持两者可比
    for (let i = 0; i < data.length; i += 4 * 37) {
      const key = `${data[i]! >> 4},${data[i + 1]! >> 4},${data[i + 2]! >> 4}`
      out[key] = (out[key] ?? 0) + 1
    }
    return out
  }, selector)
}

/**
 * 不同颜色桶的个数。
 *
 * 原 `colourBuckets` 的行为，保留为薄封装：既有断言（`toBeGreaterThan(3)`）不动。
 * **那两条断言很弱**（「画面上不止 4 种颜色」），但收紧它们不在本卡范围内——
 * 在这里说一句，比默默保留它们诚实。
 */
export async function colourBuckets(page: Page, selector = 'canvas'): Promise<number> {
  return Object.keys(await bucketHistogram(page, selector)).length
}

/** 亮度直方图，`bins` 档。用 Rec.709 亮度权重。 */
export async function luminanceHistogram(page: Page, selector = 'canvas', bins = 16): Promise<number[]> {
  return page.evaluate(
    ({ sel, binCount }) => {
      const canvas = document.querySelector(sel) as HTMLCanvasElement | null
      if (!canvas) return new Array<number>(binCount).fill(0)
      const scratch = document.createElement('canvas')
      scratch.width = canvas.width
      scratch.height = canvas.height
      const ctx = scratch.getContext('2d')!
      ctx.drawImage(canvas, 0, 0)
      const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height)
      const hist = new Array<number>(binCount).fill(0)
      for (let i = 0; i < data.length; i += 4) {
        const y = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
        const bin = Math.min(binCount - 1, Math.floor((y / 256) * binCount))
        hist[bin]! += 1
      }
      return hist
    },
    { sel: selector, binCount: bins },
  )
}

/**
 * 两个纯函数从 core 的测试助手里来 —— 它们在那边有 Node 单测。
 *
 * 抄一份到这里的代价不是重复，是**那一份永远不会被测**：E2E 只会因为「阈值没过」而红，
 * 而一把坏掉的尺子给出的正是「阈值都过了」。
 */
export { brightWeight, histogramDistance } from '../../packages/core/test/helpers/histogram.js'
