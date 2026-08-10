import { describe, expect, it, vi } from 'vitest'
import type { CaptureLimits } from '../../src/runtime/capability.js'
import { runCapture } from '../../src/runtime/image-export.js'
import type { CaptureRequest, CaptureSurface } from '../../src/runtime/image-export.js'
import { captureFilename, sanitiseFilename } from '../../src/util/filename.js'

/**
 * T-266 · `captureImage` 的主链路与还原保证。
 *
 * ## 这份测试的形状：故障注入矩阵
 *
 * 八步链路，**逐步让第 k 步抛异常，断言五项状态与进入前逐字段相等**。这不是防御性
 * 测试——出图会临时改掉尺寸、背景、辅助物可见性、帧循环，而这四样里任意一样没还原，
 * 用户看到的是「导出之后编辑器坏了」：画布尺寸不对、网格不见了、或者画面整个冻住。
 * 而这些症状与「导出」这个动作在他眼里没有关系。
 *
 * ## 为什么八条各写一遍，不写成一条参数化
 *
 * 参数化会掩盖一件事：**不同的 k 触发的还原深度不同**。第 1 步抛的时候栈里只有一项，
 * 第 7 步抛的时候有五项——而还原栈的失效方式恰恰是「深了就漏一项」。八条各自断五个
 * 字段，才是真的把每一层深度都走了一遍。
 */

/* -------------------------------------------------------------------------- */
/* 可注入故障的假 surface                                                       */
/* -------------------------------------------------------------------------- */

interface Fake {
  readonly surface: CaptureSurface
  readonly calls: string[]
  state(): Record<string, unknown>
}

const ENTRY = { width: 1280, height: 720, chrome: true, background: 'opaque' as const, running: true }

/** @param failAt 让第 k 步（1..8）抛异常。0 = 不注入故障。 */
function fakeSurface(failAt = 0): Fake {
  const calls: string[] = []
  let width = ENTRY.width
  let height = ENTRY.height
  let chrome = ENTRY.chrome
  let background: 'transparent' | 'opaque' = ENTRY.background
  let running = ENTRY.running
  let capturing = false

  /** 第 k 步的入口。注入点在**动作发生之前**，好让「这一步没做成」是真的。 */
  const step = (k: number, what: string): void => {
    calls.push(`${k}:${what}`)
    if (k === failAt) throw new Error(`第 ${k} 步注入故障`)
  }

  const surface: CaptureSurface = {
    size: () => ({ width, height }),
    setSize: (w, h) => {
      // 还原路径也走这里，所以只有「变大到目标分辨率」那一次算第 ③ 步。
      if (w !== ENTRY.width || h !== ENTRY.height) step(3, 'setSize')
      width = w
      height = h
    },
    chromeVisible: () => chrome,
    setChromeVisible: (v) => {
      if (!v) step(5, 'setChromeVisible')
      chrome = v
    },
    background: () => background,
    setBackground: (b) => {
      if (b !== ENTRY.background) step(4, 'setBackground')
      background = b
    },
    running: () => running,
    setRunning: (v) => {
      if (!v) step(1, 'setRunning')
      running = v
    },
    capturing: () => capturing,
    setCapturing: (v) => {
      if (v) step(2, 'setCapturing')
      capturing = v
    },
    prepareOverlay: async () => {
      step(6, 'prepareOverlay')
    },
    drawScene: () => {
      step(7, 'drawScene')
    },
    composeOverlay: () => {
      calls.push('7b:composeOverlay')
    },
    readPixels: async () => {
      step(8, 'readPixels')
      return { size: 1234, type: 'image/png' } as unknown as Blob
    },
  }

  return {
    surface,
    calls,
    state: () => ({ width, height, chrome, background, running, capturing }),
  }
}

const LIMITS: CaptureLimits = {
  pixelRatio: 1,
  maxTextureSize: 16384,
  maxRenderbufferSize: 16384,
  maxViewportDim: 16384,
  postFxActive: false,
}

const request = (patch: Partial<CaptureRequest> = {}): CaptureRequest => ({
  viewport: { width: 1280, height: 720 },
  // 透明背景：`plan.background` 因此与进入前的 opaque 不同，第 ④ 步才真的改了东西——
  // 用 'auto' 的话它解析成 opaque，那一步是空操作，故障注入点打不到。
  background: 'transparent',
  format: 'png',
  scale: 2,
  ...patch,
})

const run = (fake: Fake, patch: Partial<CaptureRequest> = {}, extra: Record<string, unknown> = {}) =>
  runCapture({ request: request(patch), limits: LIMITS, surface: fake.surface, filename: 'scene.png', ...extra })

const ENTRY_STATE = { ...ENTRY, capturing: false }

/* -------------------------------------------------------------------------- */

describe('T-266 · 故障注入矩阵（八步 × 五项状态）', () => {
  for (let k = 1; k <= 8; k++) {
    it(`第 ${k} 步抛 → 五项状态与进入前逐字段相等，且 resolve 不 reject`, async () => {
      const fake = fakeSurface(k)
      const before = fake.state()
      expect(before, '前提：起点就是 ENTRY').toEqual(ENTRY_STATE)

      // **永不 reject**：`await: false` 的 fire-and-forget 不许产生未处理拒绝。
      const result = await run(fake)

      expect(result.ok, `第 ${k} 步失败时不该报成功`).toBe(false)
      expect(result.reason, '失败必须带一句可显示的中文').not.toBe('')
      expect(result.blob).toBeNull()
      // 五项逐字段相等。少还原任何一项，用户看到的是「导出之后编辑器坏了」。
      expect(fake.state()).toEqual(ENTRY_STATE)
    })
  }

  it('全程顺利时也回到进入前的状态', async () => {
    const fake = fakeSurface()
    const result = await run(fake)
    expect(result.ok).toBe(true)
    expect(fake.state()).toEqual(ENTRY_STATE)
  })
})

describe('T-266 · 链路本身', () => {
  it('`drawScene` 被调的那一刻，画布是**目标分辨率**', async () => {
    let sizeAtDraw: { width: number; height: number } | null = null
    const fake = fakeSurface()
    const wrapped: CaptureSurface = {
      ...fake.surface,
      drawScene: () => {
        sizeAtDraw = fake.surface.size()
        fake.surface.drawScene()
      },
    }
    // 1280×720 视口、2×、pixelRatio 1 → 2560×1440。
    await runCapture({ request: request(), limits: LIMITS, surface: wrapped, filename: 'scene.png' })
    expect(sizeAtDraw).toEqual({ width: 2560, height: 1440 })
  })

  it('overlay 在 `drawScene()` **之后** —— 契约 K3', async () => {
    // 反过来的话热点会被这一帧的场景盖掉，而两种顺序都「画了」。
    const fake = fakeSurface()
    await run(fake)
    const draw = fake.calls.findIndex((c) => c.endsWith('drawScene'))
    const compose = fake.calls.findIndex((c) => c.endsWith('composeOverlay'))
    expect(draw).toBeGreaterThanOrEqual(0)
    expect(compose).toBeGreaterThan(draw)
  })

  it('八步的顺序是固定的', async () => {
    const fake = fakeSurface()
    await run(fake)
    const steps = fake.calls.filter((c) => /^\d/.test(c)).map((c) => c.split(':')[0])
    expect(steps).toEqual(['1', '2', '3', '4', '5', '6', '7', '7b', '8'])
  })

  it('第二次导出被拒，且**不动任何状态**', async () => {
    const fake = fakeSurface()
    // 手工把 capturing 置真，模拟一次仍在进行的导出。
    fake.surface.setCapturing(true)
    const snapshot = fake.state()

    const result = await run(fake)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('上一次导出还没完成。')
    // 两次导出交叠会让还原栈互相覆盖——后一次记的「原尺寸」是前一次改过的那个。
    expect(fake.state()).toEqual(snapshot)
  })

  it('计划被拒时一步都不走', async () => {
    const fake = fakeSurface()
    const result = await run(fake, { format: 'jpeg', background: 'transparent' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('JPEG 格式不支持透明背景。请改用 PNG 格式，或把背景改为不透明。')
    expect(fake.calls, '被拒的请求不该碰渲染器').toHaveLength(0)
  })

  it('读像素返回 null 时报失败，而不是给一个空 blob 的成功', async () => {
    const fake = fakeSurface()
    const wrapped: CaptureSurface = { ...fake.surface, readPixels: async () => null }
    const result = await runCapture({ request: request(), limits: LIMITS, surface: wrapped, filename: 'scene.png' })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('画布读取失败')
  })

  it('钳位说明原样带进结果 —— 对话框要显示它', async () => {
    const fake = fakeSurface()
    // 1280 视口 × 4 = 5120，超过 3840 的合同上限。
    const result = await run(fake, { scale: 4 })
    expect(result.ok).toBe(true)
    expect(result.notice).toContain('导出长边上限为 3840 像素')
    expect(result.width).toBe(3840)
  })

  it('打开着的面板数带进结果 —— 重放的断言点', async () => {
    const fake = fakeSurface()
    const result = await run(fake, {}, { openPanelCount: 2 })
    expect(result.panelCount).toBe(2)
  })

  it('还原过程中某一项自己抛，其余仍然还原', async () => {
    const onWarn = vi.fn()
    const fake = fakeSurface()
    let first = true
    const wrapped: CaptureSurface = {
      ...fake.surface,
      setChromeVisible: (v) => {
        // 还原那一次（v === true）抛。
        if (v && !first) throw new Error('还原辅助物失败')
        first = false
        fake.surface.setChromeVisible(v)
      },
    }
    await runCapture({ request: request(), limits: LIMITS, surface: wrapped, filename: 'scene.png', onWarn })

    // 尺寸、背景、帧循环、出图标志四项照样回去了——一项还原失败不许拖垮其余。
    const state = fake.state()
    expect(state['width']).toBe(ENTRY.width)
    expect(state['background']).toBe(ENTRY.background)
    expect(state['running']).toBe(true)
    expect(state['capturing']).toBe(false)
    expect(onWarn).toHaveBeenCalled()
  })
})

describe('T-266 · 文件名', () => {
  it('非法字符全部替换，全仓一份实现', () => {
    // 取 Windows 与 POSIX 禁字符的并集。**空格不在里面**——它在两个平台上都合法，
    // 替换它只会让用户认不出自己起的名字。
    expect(sanitiseFilename('泵组/拆装: 演示?')).toBe('泵组_拆装_ 演示_')
    expect(sanitiseFilename('  报告  ')).toBe('报告')
    expect(sanitiseFilename('')).toBe('scene')
    expect(sanitiseFilename('   ')).toBe('scene')
  })

  it('Windows 保留设备名加后缀，而不是整个换掉', () => {
    // `CON.png` 在资源管理器里是打不开的。加后缀让用户仍然认得出自己起的名字。
    expect(sanitiseFilename('CON')).toBe('CON_')
    expect(sanitiseFilename('lpt3')).toBe('lpt3_')
    expect(sanitiseFilename('console'), '只有恰好等于保留名才处理').toBe('console')
  })

  it('首尾的点被去掉 —— Windows 会静默吃掉它们', () => {
    expect(sanitiseFilename('..报告..')).toBe('报告')
  })

  it('带时间戳，因为导同一个视角两次是常态', () => {
    // 同名文件在下载目录里变成 `报告 (1).png`，而那个序号与两张图的先后没有关系。
    expect(captureFilename('泵组', 'png', '2026-08-05T12-30-00')).toBe('泵组_2026-08-05T12-30-00.png')
    expect(captureFilename('泵组', 'jpeg', '2026-08-05T12-30-00')).toBe('泵组_2026-08-05T12-30-00.jpg')
  })

  it('用户填了名字就一个字都不加', () => {
    // 他填名字通常正是为了让文件名可预期：要贴进一份文档，或者要覆盖上一张。
    expect(captureFilename('泵组', 'png', '2026-08-05', '插图一')).toBe('插图一.png')
    expect(captureFilename('泵组', 'png', '2026-08-05', '  ')).toContain('泵组')
  })
})
