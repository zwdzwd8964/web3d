import { describe, expect, it } from 'vitest'
import { brightWeight, histogramDistance } from '../helpers/histogram.js'

/**
 * T-236 · `pixel-stats` 里两个纯函数的单测。
 *
 * **它们必须在 Node 里被测。** 这两个函数是 E2E 里那些阈值的量纲来源——写错了不会让
 * 任何 E2E 变红，只会让阈值静默地失去意义（比如距离恒为 0，于是「两条路径画面一致」
 * 这条断言永远通过）。E2E 自己测不了自己的尺子。
 */

describe('T-236 · histogramDistance', () => {
  it('相同的分布距离为 0', () => {
    expect(histogramDistance([1, 2, 3, 4], [1, 2, 3, 4])).toBe(0)
  })

  it('只是总量不同、形状相同 → 仍然是 0（它比的是分布）', () => {
    // 两次截图的采样像素数可能不同（画布尺寸变了），而那不该被算成「画面变了」
    expect(histogramDistance([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(0, 12)
  })

  it('完全不重叠 → 1', () => {
    expect(histogramDistance([1, 0], [0, 1])).toBe(1)
  })

  it('一半像素换了档 → 0.5', () => {
    // 量纲检查：这个数读起来必须是「有百分之几的像素换了亮度档」
    expect(histogramDistance([2, 2], [1, 3])).toBeCloseTo(0.25, 12)
    expect(histogramDistance([4, 0], [2, 2])).toBeCloseTo(0.5, 12)
  })

  it('两边都空 → 0；一边空 → 1', () => {
    expect(histogramDistance([0, 0], [0, 0])).toBe(0)
    expect(histogramDistance([0, 0], [1, 1])).toBe(1)
  })

  it('档数不同直接抛，不补零', () => {
    // 补零会得到一个「看起来很小」的距离，而真实情况是调用方传错了 bins
    expect(() => histogramDistance([1, 2], [1, 2, 3])).toThrow(/档数不同/)
  })
})

describe('T-236 · brightWeight', () => {
  it('全部集中在最暗档 → 0', () => {
    expect(brightWeight([100, 0, 0, 0, 0, 0, 0, 0])).toBe(0)
  })

  it('全部集中在最亮档 → 1', () => {
    expect(brightWeight([0, 0, 0, 0, 0, 0, 0, 100])).toBe(1)
  })

  it('取的是最亮的四分之一档', () => {
    // 8 档时是后 2 档（下标 6、7）
    expect(brightWeight([0, 0, 0, 0, 0, 0, 1, 1])).toBe(1)
    expect(brightWeight([1, 1, 1, 1, 1, 1, 1, 1])).toBeCloseTo(0.25, 12)
    expect(brightWeight([0, 0, 0, 0, 0, 1, 0, 0]), '第 5 档不算亮部').toBe(0)
  })

  it('空直方图 → 0，不是 NaN', () => {
    // NaN 会让「亮部占比没有整体上移」这条断言变成永远通过（NaN 的一切比较都是 false，
    // 而 `expect(NaN).toBeLessThan(x)` 会红——但 `expect(NaN).not.toBeGreaterThan(x)` 会绿）
    expect(brightWeight([0, 0, 0, 0])).toBe(0)
  })
})
