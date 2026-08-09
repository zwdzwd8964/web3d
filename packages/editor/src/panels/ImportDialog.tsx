import type { SceneUnit, UpAxis } from '@w3/core'

/**
 * T-259 · 导入前问一句：这份文件是什么单位、哪个轴朝上。
 *
 * ## 这条断链原本断在哪里
 *
 * `computeNormalization` 从 T-051 就在，`importAsset` 也一直接受 `sourceUnit` /
 * `sourceUpAxis` 两个参数——**而全仓没有一个调用方传过它们**。`suggestUnit` 更彻底，
 * 它是零调用者清单上的一条。结果是每一份导入的模型都按「米 · Y 朝上」处理：一份
 * 毫米单位的泵体进来是 1200 米高，用户看到的是一堵墙，且没有任何地方告诉他为什么。
 *
 * 这个对话框就是那条断链的接头。它不猜、不自动缩放——**预填一个建议值，由用户拍板**。
 * 自动缩放比问一句更糟：一份真的 1,200 米的厂区模型会被悄悄缩成一只鞋那么大。
 */

export interface ImportDeclaration {
  readonly sourceUnit: SceneUnit
  readonly sourceUpAxis: UpAxis
}

export interface ImportDialogProps {
  readonly fileName: string
  readonly value: ImportDeclaration
  /** `suggestUnitFromHeader` 的那句中文；没量出来时是 null，此时不显示建议行。 */
  readonly suggestion: { unit: SceneUnit; confident: boolean; reason: string } | null
  readonly onChange: (next: ImportDeclaration) => void
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

const UNIT_LABELS: Record<SceneUnit, string> = { m: '米', cm: '厘米', mm: '毫米' }
const AXIS_LABELS: Record<UpAxis, string> = { Y: 'Y 轴朝上（glTF 标准）', Z: 'Z 轴朝上（多数 CAD）' }

export function ImportDialog(props: ImportDialogProps) {
  const { fileName, value, suggestion } = props

  return (
    <div className="report" data-testid="import-dialog" role="dialog" aria-label="导入设置">
      <h3>{fileName}</h3>

      {suggestion && (
        // 建议的**理由**要露出来。「疑似毫米」不带那句「最长边 1200 单位」的话，用户
        // 没有任何依据判断该不该采纳，而他才是唯一知道这份图纸是什么的人。
        <p className="hint" data-testid="import-unit-suggestion">
          {suggestion.confident ? '推测' : '不太确定，推测'}为{UNIT_LABELS[suggestion.unit]}：{suggestion.reason}
        </p>
      )}

      <label className="field">
        <span className="field__label">源单位</span>
        <select
          className="field__input"
          data-testid="import-unit"
          value={value.sourceUnit}
          onChange={(event) => props.onChange({ ...value, sourceUnit: event.target.value as SceneUnit })}
        >
          {(Object.keys(UNIT_LABELS) as SceneUnit[]).map((unit) => (
            <option key={unit} value={unit}>
              {UNIT_LABELS[unit]}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">上方向</span>
        <select
          className="field__input"
          data-testid="import-up-axis"
          value={value.sourceUpAxis}
          onChange={(event) => props.onChange({ ...value, sourceUpAxis: event.target.value as UpAxis })}
        >
          {(Object.keys(AXIS_LABELS) as UpAxis[]).map((axis) => (
            <option key={axis} value={axis}>
              {AXIS_LABELS[axis]}
            </option>
          ))}
        </select>
      </label>

      <div className="report__actions">
        <button type="button" className="tbtn" data-testid="import-declare-confirm" onClick={props.onConfirm}>
          继续导入
        </button>
        <button type="button" className="tbtn" onClick={props.onCancel}>
          取消
        </button>
      </div>
    </div>
  )
}

/** 建议值 → 初始声明。上方向没有可靠的推断依据，一律从 glTF 标准的 Y 起步。 */
export function declarationFrom(suggestion: { unit: SceneUnit } | null): ImportDeclaration {
  return { sourceUnit: suggestion?.unit ?? 'm', sourceUpAxis: 'Y' }
}
