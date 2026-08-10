// @vitest-environment jsdom
import type { CaptureLimits, CaptureOrder, CaptureResult } from '@w3/core'
import { planCapture } from '@w3/core'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportImageDialog } from '../../src/dialogs/ExportImageDialog.jsx'

/**
 * T-267 · 出图对话框。
 *
 * ## 卡面点名的那条断言：**对话框不自己算尺寸**
 *
 * 把 `planCapture` 打桩返回 `999×888`，UI 必须显示 999×888。一个自己算 `vw * scale` 的
 * 实现在其余每一条断言下都能绿——它显示的是一个像模像样的数字，只是与实际导出的不一样。
 * 钳位链里有像素比、管线上限、显卡上限、合同长边上限四层，UI 那份算术只要落后一层就错。
 *
 * ## 拒绝与降级必须各有一条断言
 *
 * 两种行为互相排斥：把降级做成禁用、或把拒绝做成提示，都只会让其中一条红。卡面因此
 * 要求两条都写。
 */

const LIMITS: CaptureLimits = {
  pixelRatio: 1,
  maxTextureSize: 16384,
  maxRenderbufferSize: 16384,
  maxViewportDim: 16384,
  postFxActive: false,
}

/** 开着描边的机器：`postFxActive` 为真，透明背景会触发降级。 */
const WITH_OUTLINE: CaptureLimits = { ...LIMITS, postFxActive: true }

const okResult = (patch: Partial<CaptureResult> = {}): CaptureResult => ({
  ok: true,
  width: 2560,
  height: 1440,
  format: 'png',
  background: 'opaque',
  filename: 'scene.png',
  notice: '',
  reason: '',
  blob: null,
  panelCount: 0,
  ...patch,
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(props: Partial<Parameters<typeof ExportImageDialog>[0]> = {}): {
  onExport: ReturnType<typeof vi.fn>
} {
  const onExport = vi.fn(async () => okResult())
  act(() => {
    root.render(
      <ExportImageDialog
        viewport={{ width: 1280, height: 720 }}
        limits={LIMITS}
        fontSource="系统字体"
        onExport={onExport as unknown as (o: CaptureOrder, f?: string) => Promise<CaptureResult>}
        onClose={() => {}}
        {...props}
      />,
    )
  })
  return { onExport }
}

const text = (testId: string) => host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? null
const button = () => host.querySelector<HTMLButtonElement>('[data-testid="export-run"]')!

/** 改一个 select 的值。React 在原生元素上装了自己的 setter。 */
function choose(testId: string, value: string): void {
  const select = host.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`)!
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  setter?.call(select, value)
  act(() => {
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('T-267 · 对话框不自己算尺寸', () => {
  it('把 planCapture 打桩返回 999×888 → UI 显示 999×888', () => {
    // 卡面点名的那条。一个自己算 `1280 * 2 = 2560` 的实现在这里必红。
    const stub = (() => ({
      ok: true,
      width: 999,
      height: 888,
      scale: 1,
      pipelineMode: 'direct',
      background: 'opaque',
      format: 'png',
      includeHotspots: true,
      droppedOutline: false,
      notice: '',
    })) as unknown as typeof planCapture

    render({ plan: stub })
    expect(text('export-size')).toContain('999 × 888')
  })

  it('不打桩时显示 planCapture 真的算出来的数', () => {
    // 1280×720 视口、默认 2×、pixelRatio 1 → 2560×1440。
    render()
    expect(text('export-size')).toContain('2560 × 1440')
  })

  it('改倍率之后尺寸跟着变', () => {
    render()
    choose('export-scale', '1')
    expect(text('export-size')).toContain('1280 × 720')
  })
})

describe('T-267 · 拒绝：按钮禁用 + 逐字 reason', () => {
  it('JPEG + 透明 → 禁用，并显示那句中文', () => {
    render()
    choose('export-format', 'jpeg')
    choose('export-background', 'transparent')

    expect(button().disabled, 'JPEG 没有 alpha 通道，没有哪张图能回答这个请求').toBe(true)
    expect(text('export-reason')).toBe('JPEG 格式不支持透明背景。请改用 PNG 格式，或把背景改为不透明。')
    // 被拒时不显示尺寸——一个「预计 0 × 0」比不显示更让人困惑。
    expect(text('export-size')).toBeNull()
  })
})

describe('T-267 · 降级：按钮可用 + 提示', () => {
  it('透明 + 描边 → **按钮可用**，且显示「透明背景导出不包含描边效果」', () => {
    // T-263 的裁决：用户拿到一张图 + 一句解释，好过拿到一个禁用的按钮。
    render({ limits: WITH_OUTLINE })
    choose('export-background', 'transparent')

    expect(button().disabled, '降级不是拒绝').toBe(false)
    expect(text('export-notice')).toContain('透明背景导出不包含描边效果。')
    // P-11：不许把雾一起列进去。
    expect(text('export-notice')).not.toContain('雾')
  })

  it('钳位也走同一条提示 —— 长边超过 3840 时说清钳到了多少', () => {
    render()
    choose('export-mode', 'longEdge')
    choose('export-long-edge', '3840')
    // 1280×720 的视口按 3840 长边导出是放大，不触发钳位；换成 4× 才会。
    choose('export-mode', 'scale')
    choose('export-scale', '4')
    expect(text('export-notice')).toContain('3840')
  })
})

describe('T-267 · 导出', () => {
  it('点导出 → onExport 被调一次，参数与 UI 选择逐项一致', async () => {
    const { onExport } = render()
    choose('export-format', 'jpeg')
    choose('export-scale', '1')

    await act(async () => {
      button().click()
    })

    expect(onExport).toHaveBeenCalledTimes(1)
    const [order] = onExport.mock.calls[0] as unknown as [CaptureOrder]
    expect(order.format).toBe('jpeg')
    expect(order.scale).toBe(1)
    expect(order.includeHotspots).toBe(true)
    expect(order.background).toBe('auto')
    // 长边模式没选，就不该混进去。
    expect('longEdge' in order).toBe(false)
  })

  it('长边模式下传的是 longEdge，不是 scale', async () => {
    const { onExport } = render()
    choose('export-mode', 'longEdge')
    choose('export-long-edge', '2560')

    await act(async () => {
      button().click()
    })

    const [order] = onExport.mock.calls[0] as unknown as [CaptureOrder]
    expect(order.longEdge).toBe(2560)
    expect('scale' in order).toBe(false)
  })

  it('**导出后不关闭对话框**，且显示结果', async () => {
    // 调完参数常常要再导一张，关掉等于让用户从头再填一遍。
    let closed = 0
    const { onExport } = render({ onClose: () => void closed++ })
    await act(async () => {
      button().click()
    })

    expect(onExport).toHaveBeenCalled()
    expect(closed, '导出不该顺手关掉对话框').toBe(0)
    expect(host.querySelector('[data-testid="export-image-dialog"]')).not.toBeNull()
    expect(text('export-result')).toContain('已导出')
  })

  it('导出失败时显示 reason，对话框仍在', async () => {
    const onExport = vi.fn(async () => okResult({ ok: false, reason: '显卡资源不足，导出已取消。' }))
    act(() => {
      root.render(
        <ExportImageDialog
          viewport={{ width: 1280, height: 720 }}
          limits={LIMITS}
          fontSource="系统字体"
          onExport={onExport as unknown as (o: CaptureOrder, f?: string) => Promise<CaptureResult>}
          onClose={() => {}}
        />,
      )
    })
    await act(async () => {
      button().click()
    })
    expect(text('export-result')).toContain('显卡资源不足')
  })
})

describe('T-267 · 显示当前字体来源', () => {
  it('原样显示注入进来的那一句', () => {
    // v1.0 是系统字体栈，不同机器字形不同——这一行是用户唯一能知道这件事的地方
    // （`vendor/fonts/README.md` 写了为什么）。
    render({ fontSource: '系统字体（自托管字体加载失败）' })
    expect(text('export-font')).toContain('系统字体（自托管字体加载失败）')
  })
})
