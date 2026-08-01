import type { LightKind, SceneDocument } from '@w3/schema'
import { LIGHT_KINDS, LIGHT_LABELS, SHADOW_QUALITIES } from '@w3/schema'
import { useMemo } from 'react'
import { castsShadow, setLightKind, setLightParams, setLightShadow, usingDefaultRig } from '../lib/light-edit.js'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { NumberField } from '../widgets/NumberField.js'

/**
 * T-137 · the light panel.
 *
 * Shown when the selection is a single light node. Lights are nodes (D12), so position and
 * rotation are the ordinary transform controls in the property panel and the gizmo — this
 * panel owns only what is light-specific.
 *
 * There is no "aim" control, and that is D13 working: direction is the node's rotation, so
 * aiming a spotlight is dragging the rotate gizmo. A second aiming widget here would be a
 * second thing to keep in sync with the first.
 */

const QUALITY_LABELS: Record<(typeof SHADOW_QUALITIES)[number], string> = {
  low: '低（512）',
  medium: '中（1024）',
  high: '高（2048）',
}

export function LightPanel() {
  const doc = useDocumentSelector((s) => s.doc)
  const selection = useDocumentSelector((s) => s.selection)
  const { commit, preview, previewStart, previewCommit } = useDocumentActions()

  const node = useMemo(() => {
    if (selection.length !== 1) return undefined
    const found = doc.nodes.find((n) => n.id === selection[0])
    return found && found.light !== null ? found : undefined
  }, [doc.nodes, selection])

  if (!node || node.light === null) {
    return (
      <div className="subpanel">
        <div className="subpanel__head">灯光</div>
        <p className="panel__empty">选中一盏灯以调整参数。在「资源库 · 对象」页签里新建。</p>
      </div>
    )
  }

  const light = node.light
  const id = node.id

  /** A live-dragging number control. One drag, one undo entry (D2). */
  const field = (
    label: string,
    value: number,
    key: string,
    range: { min: number; max: number; step: number },
  ) => (
    <NumberField
      key={key}
      label={label}
      value={value}
      min={range.min}
      max={range.max}
      step={range.step}
      onCommit={(v) => commit(`调整 ${label}`, (draft: SceneDocument) => setLightParams(draft, id, { [key]: v }))}
      onPreviewStart={previewStart}
      onPreview={(v) => preview((draft: SceneDocument) => setLightParams(draft, id, { [key]: v }))}
      onPreviewEnd={() => previewCommit(`调整 ${label}`)}
    />
  )

  const colourField = (label: string, value: string, key: string) => (
    <label className="field" key={key}>
      <span className="field__label">{label}</span>
      <input
        className="field__input"
        type="color"
        value={value}
        onChange={(event) =>
          commit(`调整 ${label}`, (draft: SceneDocument) => setLightParams(draft, id, { [key]: event.target.value }))
        }
      />
    </label>
  )

  const shadow = 'shadow' in light ? light.shadow : null

  return (
    <div className="subpanel">
      <div className="subpanel__head">灯光</div>

      {/* D14 · the built-in rig retreats the moment the first light exists. Without this
          line the first light a user creates appears to make the scene DARKER, and the
          explanation is nowhere on screen. */}
      {usingDefaultRig(doc) && <p className="panel__note">场景当前使用内置默认灯架；加入第一盏灯后它会自动退场。</p>}

      <label className="field">
        <span className="field__label">类型</span>
        <select
          className="field__input"
          value={light.kind}
          onChange={(event) =>
            commit('切换灯光类型', (draft: SceneDocument) => setLightKind(draft, id, event.target.value as LightKind))
          }
        >
          {LIGHT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {LIGHT_LABELS[kind]}
            </option>
          ))}
        </select>
      </label>

      {'color' in light && colourField('颜色', light.color, 'color')}
      {light.kind === 'hemisphere' && colourField('天空色', light.skyColor, 'skyColor')}
      {light.kind === 'hemisphere' && colourField('地面色', light.groundColor, 'groundColor')}

      {field('强度', light.intensity, 'intensity', {
        min: 0,
        max: light.kind === 'ambient' || light.kind === 'hemisphere' ? 10 : 20,
        step: 0.1,
      })}

      {'range' in light && field('范围（0 = 无限）', light.range, 'range', { min: 0, max: 100, step: 0.5 })}
      {'decay' in light && field('衰减', light.decay, 'decay', { min: 0, max: 4, step: 0.1 })}
      {light.kind === 'spot' && field('锥角°', light.angleDeg, 'angleDeg', { min: 1, max: 89, step: 1 })}
      {light.kind === 'spot' && field('边缘柔和', light.penumbra, 'penumbra', { min: 0, max: 1, step: 0.05 })}

      {castsShadow(light.kind) && shadow !== null && (
        <fieldset className="fieldset">
          <legend>阴影</legend>
          <label className="field">
            <span className="field__label">投射阴影</span>
            <input
              type="checkbox"
              checked={shadow.enabled}
              onChange={(event) =>
                commit(event.target.checked ? '开启阴影' : '关闭阴影', (draft: SceneDocument) =>
                  setLightShadow(draft, id, { enabled: event.target.checked }),
                )
              }
            />
          </label>
          <label className="field">
            <span className="field__label">质量</span>
            <select
              className="field__input"
              value={shadow.quality}
              disabled={!shadow.enabled}
              onChange={(event) =>
                commit('调整阴影质量', (draft: SceneDocument) =>
                  setLightShadow(draft, id, { quality: event.target.value as (typeof SHADOW_QUALITIES)[number] }),
                )
              }
            >
              {SHADOW_QUALITIES.map((quality) => (
                <option key={quality} value={quality}>
                  {QUALITY_LABELS[quality]}
                </option>
              ))}
            </select>
          </label>
          {/* Bias has to be exposed — shadow acne is scene-dependent and no default fits
              every model — but the range is one where a wrong value degrades the picture
              rather than erasing the shadow entirely. */}
          <NumberField
            label="偏移（消除条纹）"
            value={shadow.bias}
            min={-0.01}
            max={0.01}
            step={0.0001}
            onCommit={(v) => commit('调整阴影偏移', (draft: SceneDocument) => setLightShadow(draft, id, { bias: v }))}
            onPreviewStart={previewStart}
            onPreview={(v) => preview((draft: SceneDocument) => setLightShadow(draft, id, { bias: v }))}
            onPreviewEnd={() => previewCommit('调整阴影偏移')}
          />
        </fieldset>
      )}

      <p className="panel__hint">照射方向 = 节点自身的旋转（局部 -Z）。用旋转 gizmo 对准目标。</p>
    </div>
  )
}
