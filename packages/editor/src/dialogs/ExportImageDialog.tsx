import { planCapture } from '@w3/core'
import type { CaptureLimits, CaptureOrder, CapturePlan, CaptureRejection, CaptureResult } from '@w3/core'
import { useMemo, useState } from 'react'

/**
 * T-267 · 出图对话框。
 *
 * ## 这个对话框自己不算尺寸
 *
 * 每一个数字都来自 `planCapture`——**包括那句「预计 3840 × 2160」**。让 UI 自己算
 * `vw * scale` 会得到一个与实际导出不同的数：钳位链里有像素比、有管线上限、有显卡上限、
 * 有合同长边上限，四层里任何一层动了，UI 那份算术就落后了，而它显示的仍然是一个像模像样
 * 的数字。卡面把这一点写成了验收（把 `planCapture` 打桩返回 `999×888`，UI 必须显示 999×888）。
 *
 * ## 拒绝与降级是两种东西，各有各的呈现
 *
 * - **拒绝**（JPEG × 透明）：按钮禁用 + 逐字的中文 reason。没有哪张图能回答这个请求。
 * - **降级**（透明 × 描边）：按钮**可用** + 一句「透明背景导出不包含描边效果」。
 *   用户拿到一张图 + 一句解释，好过拿到一个禁用的按钮（T-263 的裁决 / ADR-0021）。
 *
 * 两种行为互相排斥，所以卡面要求各有一条断言——把降级做成禁用，或者把拒绝做成提示，
 * 都会让其中一条红。
 */

/** 倍率档位。**只有三档**：1920 视口上 3× 与 4× 都被 3840 的长边上限咬住，列出来是骗人的。 */
const SCALES = [1, 2, 4] as const
/** 长边档位，与合同措辞逐字一致（拍板项 P-12）。 */
const LONG_EDGES = [1920, 2560, 3840] as const

type SizeMode = 'scale' | 'longEdge'

export interface ExportImageDialogProps {
  /** 当前视口的 CSS 像素尺寸。 */
  readonly viewport: { readonly width: number; readonly height: number }
  readonly limits: CaptureLimits
  /** 当前字体来源，直接显示（v1.0 是系统字体栈，见 `vendor/fonts/README.md`）。 */
  readonly fontSource: string
  /** 打开着的面板数。0 时不显示那一行。 */
  readonly openPanelCount?: number
  readonly onExport: (order: CaptureOrder, filename?: string) => Promise<CaptureResult>
  readonly onClose: () => void
  /** 打桩用。生产走 `planCapture` 本身——UI 不许自己算尺寸。 */
  readonly plan?: typeof planCapture
}

export function ExportImageDialog(props: ExportImageDialogProps) {
  const [mode, setMode] = useState<SizeMode>('scale')
  const [scale, setScale] = useState<number>(2)
  const [longEdge, setLongEdge] = useState<number>(1920)
  const [format, setFormat] = useState<'png' | 'jpeg'>('png')
  const [background, setBackground] = useState<'auto' | 'transparent' | 'opaque'>('auto')
  const [includeHotspots, setIncludeHotspots] = useState(true)
  const [filename, setFilename] = useState('')
  const [result, setResult] = useState<CaptureResult | null>(null)
  const [busy, setBusy] = useState(false)

  const order: CaptureOrder = {
    ...(mode === 'scale' ? { scale } : { longEdge }),
    background,
    format,
    includeHotspots,
  }

  // **唯一的尺寸来源。** 注入的那个只在测试里换掉，生产恒为 `planCapture`。
  const planFn = props.plan ?? planCapture
  const planned: CapturePlan | CaptureRejection = useMemo(
    () => planFn({ ...order, viewport: props.viewport }, props.limits),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `order` 是每次渲染新建的字面量
    [planFn, mode, scale, longEdge, format, background, includeHotspots, props.viewport, props.limits],
  )

  const run = async () => {
    setBusy(true)
    try {
      setResult(await props.onExport(order, filename.trim() || undefined))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" data-testid="export-image-dialog" onClick={props.onClose}>
      <div className="modal__body" onClick={(event) => event.stopPropagation()}>
        <h3>导出图片</h3>

        <label className="fields__row">
          <span className="fields__label">尺寸方式</span>
          <select
            className="field"
            data-testid="export-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as SizeMode)}
          >
            <option value="scale">按倍率</option>
            <option value="longEdge">按长边</option>
          </select>
          {mode === 'scale' ? (
            <select
              className="field"
              data-testid="export-scale"
              value={String(scale)}
              onChange={(e) => setScale(Number(e.target.value))}
            >
              {SCALES.map((s) => (
                <option key={s} value={String(s)}>
                  {s}×
                </option>
              ))}
            </select>
          ) : (
            <select
              className="field"
              data-testid="export-long-edge"
              value={String(longEdge)}
              onChange={(e) => setLongEdge(Number(e.target.value))}
            >
              {LONG_EDGES.map((edge) => (
                <option key={edge} value={String(edge)}>
                  {edge} px
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="fields__row">
          <span className="fields__label">格式</span>
          <select
            className="field"
            data-testid="export-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as 'png' | 'jpeg')}
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
          </select>
          <select
            className="field"
            data-testid="export-background"
            value={background}
            onChange={(e) => setBackground(e.target.value as 'auto' | 'transparent' | 'opaque')}
          >
            <option value="auto">跟随场景</option>
            <option value="transparent">透明</option>
            <option value="opaque">不透明</option>
          </select>
        </label>

        <label className="fields__row">
          <span className="fields__label">文件名</span>
          <input
            className="field"
            type="text"
            data-testid="export-filename"
            placeholder="留空自动生成"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
          />
        </label>

        <label className="fields__row">
          <span className="fields__label">包含热点</span>
          <input
            type="checkbox"
            data-testid="export-hotspots"
            checked={includeHotspots}
            onChange={(e) => setIncludeHotspots(e.target.checked)}
          />
        </label>

        {/* 预计尺寸。**这个数来自 planCapture，不是 UI 自己算的。** */}
        {planned.ok ? (
          <p className="panel__note" data-testid="export-size">
            预计 {planned.width} × {planned.height} 像素
            {props.openPanelCount ? ` · 含 ${props.openPanelCount} 个已打开面板` : ''}
          </p>
        ) : (
          <p className="panel__note panel__note--warn" data-testid="export-reason">
            {planned.reason}
          </p>
        )}

        {/* 钳位与降级说明。非空 ⇔ 计划与请求不一致——这个字段存在的全部理由就是不让钳位悄悄发生。 */}
        {planned.ok && planned.notice !== '' && (
          <p className="panel__note panel__note--warn" data-testid="export-notice">
            {planned.notice}
          </p>
        )}

        <p className="hint" data-testid="export-font">
          文字使用：{props.fontSource}
        </p>

        {result && (
          <p className={result.ok ? 'panel__note' : 'panel__note panel__note--warn'} data-testid="export-result">
            {result.ok ? `已导出 ${result.filename}（${result.width} × ${result.height}）` : result.reason}
          </p>
        )}

        <div className="report__actions">
          <button
            type="button"
            className="tbtn tbtn--primary"
            data-testid="export-run"
            // **只有拒绝才禁用。** 降级（透明 × 描边）按钮可用——用户拿到一张图 + 一句解释，
            // 好过拿到一个禁用的按钮。
            disabled={!planned.ok || busy}
            onClick={() => void run()}
          >
            {busy ? '导出中…' : '导出'}
          </button>
          {/* 导出后**不关闭对话框**：调完参数常常要再导一张，关掉等于让用户从头再填一遍。 */}
          <button type="button" className="tbtn" onClick={props.onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
