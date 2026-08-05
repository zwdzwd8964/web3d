import { FOG_TYPES } from '@w3/schema'
import type { Fog, SceneDocument } from '@w3/schema'
import { suggestFogRange } from '@w3/core'
import { applySuggestedFogRange, setFogEnabled, setFogParams, setFogType } from '../lib/effects-edit.js'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { NumberField } from '../widgets/NumberField.js'

/**
 * T-239 · 场景效果面板 · 雾段。
 *
 * 描边段由 T-241 补进同一个面板（X-44 定的：雾与描边共一个面板，而**不是**共一个
 * `meta.effects` 块——D30 把 `meta.fog` 独立出来，因为雾不是后处理，它的消费者、代价
 * 与出图裁决三项都与描边不同）。
 *
 * 拖滑块走 `preview`（不落撤销），松手 `previewCommit` 落一条。这不是体验优化：
 * 每一帧一条撤销会让「撤销上一步」变成撤销一像素。形状与 `LightPanel` 逐字同形——
 * 四个回调缺任何一个，拖拽的中间态要么全进撤销栈，要么根本提交不了。
 */

const TYPE_LABELS: Record<Fog['type'], string> = {
  linear: '线性（按远近线性变浓）',
  exp2: '指数（更像真实大气）',
}

export function SceneEffectsPanel() {
  const fog = useDocumentSelector((s) => s.doc.meta.fog)
  const nodes = useDocumentSelector((s) => s.doc.nodes)
  const { commit, preview, previewStart, previewCommit } = useDocumentActions()

  /**
   * 场景包围盒，用节点位置估。
   *
   * **不用 `graph.root` 的真实包围盒**：那要向运行时要，而这个面板不该知道运行时存在
   * （铁律 1 的同一条理由——面板读文档）。节点锚点围出来的盒子对「雾该从多远开始」
   * 这个量级问题足够，而它在无渲染器时也算得出来。
   */
  const suggest = () => {
    if (nodes.length === 0) return
    const min: [number, number, number] = [Infinity, Infinity, Infinity]
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (const node of nodes) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, node.transform.p[i]!)
        max[i] = Math.max(max[i]!, node.transform.p[i]!)
      }
    }
    const range = suggestFogRange({ min, max })
    commit('按场景大小估算雾距', (d) => applySuggestedFogRange(d, range))
  }

  return (
    <div className="subpanel" data-testid="scene-effects-panel">
      <div className="subpanel__head">场景效果</div>

      <label className="row">
        <span>雾</span>
        <input
          type="checkbox"
          data-testid="fog-enabled"
          checked={fog.enabled}
          onChange={(e) => commit(e.target.checked ? '开启雾' : '关闭雾', (d) => setFogEnabled(d, e.target.checked))}
        />
      </label>

      {fog.enabled && (
        <>
          <label className="row">
            <span>类型</span>
            <select
              className="field"
              data-testid="fog-type"
              value={fog.type}
              onChange={(e) => commit('切换雾类型', (d) => setFogType(d, e.target.value as Fog['type']))}
            >
              {FOG_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>

          <label className="row">
            <span>颜色</span>
            <input
              type="color"
              data-testid="fog-color"
              value={fog.color}
              onChange={(e) => commit('调整雾色', (d) => setFogParams(d, { color: e.target.value }))}
            />
          </label>

          {fog.type === 'linear' ? (
            <>
              <NumberField
                label="起始距离"
                value={fog.near}
                min={0}
                step={0.5}
                onPreviewStart={previewStart}
                onPreview={(v) => preview((d: SceneDocument) => setFogParams(d, { near: v }))}
                onCommit={(v) => commit('调整雾起始距离', (d: SceneDocument) => setFogParams(d, { near: v }))}
                onPreviewEnd={() => previewCommit('调整雾起始距离')}
              />
              <NumberField
                label="完全消失距离"
                value={fog.far}
                min={0}
                step={0.5}
                onPreviewStart={previewStart}
                onPreview={(v) => preview((d: SceneDocument) => setFogParams(d, { far: v }))}
                onCommit={(v) => commit('调整雾消失距离', (d: SceneDocument) => setFogParams(d, { far: v }))}
                onPreviewEnd={() => previewCommit('调整雾消失距离')}
              />
              {/* I16 只在发布时拦，编辑中就说一句 —— 用户此刻正看着一片纯色 */}
              {fog.near >= fog.far && <div className="hint hint--warn">起始距离不小于消失距离，画面会被雾色填满</div>}
            </>
          ) : (
            <NumberField
              label="浓度"
              value={fog.density}
              min={0}
              max={1}
              step={0.005}
              onPreviewStart={previewStart}
              onPreview={(v) => preview((d: SceneDocument) => setFogParams(d, { density: v }))}
              onCommit={(v) => commit('调整雾浓度', (d: SceneDocument) => setFogParams(d, { density: v }))}
              onPreviewEnd={() => previewCommit('调整雾浓度')}
            />
          )}

          <button type="button" className="tbtn" data-testid="fog-suggest" onClick={suggest} disabled={nodes.length === 0}>
            按场景大小估算
          </button>
        </>
      )}
    </div>
  )
}
