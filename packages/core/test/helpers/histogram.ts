/**
 * T-236 · 直方图上的两个纯函数。
 *
 * **住在 core 的测试助手里，而不是 `e2e/`。** 它们是 E2E 那些阈值的量纲来源——写错了
 * 不会让任何 E2E 变红，只会让阈值静默失去意义（距离恒为 0，于是「两条路径画面一致」
 * 永远通过）。E2E 测不了自己的尺子，所以尺子要放在能被 Node 单测覆盖的地方。
 *
 * `e2e/tests/pixel-stats.ts` 从这里 import，不再抄一份。
 */

/**
 * 两张直方图的距离，0（相同）到 1（完全不重叠）。
 *
 * 用**归一化后的 L1 距离的一半**（即 total variation distance）。除以 2 让它落在 [0,1]，
 * 这样阈值读起来是「有百分之几的像素换了亮度档」，而不是一个没有量纲的数。
 *
 * 长度不同时抛而不是补零：那是调用方传错了 bins，静默补零会得到一个「看起来很小」
 * 的距离。
 */
export function histogramDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error(`直方图档数不同：${a.length} vs ${b.length}`)
  const sumA = a.reduce((x, y) => x + y, 0)
  const sumB = b.reduce((x, y) => x + y, 0)
  if (sumA === 0 || sumB === 0) return sumA === sumB ? 0 : 1
  let total = 0
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i]! / sumA - b[i]! / sumB)
  return total / 2
}

/**
 * 亮部占比：最亮的四分之一档里的像素比例。
 *
 * 「开描边之后画面整体变亮了」这件事在直方图上的表现就是它变大。单看平均亮度看不出来
 * ——一次色调映射错误会同时压暗暗部、提亮亮部，平均值几乎不动。
 */
export function brightWeight(hist: readonly number[]): number {
  const total = hist.reduce((a, b) => a + b, 0)
  if (total === 0) return 0
  const from = Math.floor(hist.length * 0.75)
  let bright = 0
  for (let i = from; i < hist.length; i++) bright += hist[i]!
  return bright / total
}
