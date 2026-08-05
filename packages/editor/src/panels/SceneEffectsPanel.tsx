import { FOG_TYPES, HIDDEN_EDGE_MODES } from '@w3/schema'
import type { Background, Fog, HiddenEdgeMode, SceneDocument } from '@w3/schema'
import { suggestFogRange } from '@w3/core'
import {
  applySuggestedFogRange,
  setFogEnabled,
  setFogParams,
  setFogType,
  setOutlineEnabled,
  setOutlineParams,
} from '../lib/effects-edit.js'
import { setBackgroundColor, setBackgroundType, setEnvIntensity, setExposure } from '../lib/environment-edit.js'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { NumberField } from '../widgets/NumberField.js'

/**
 * T-239 / T-241 · 场景效果面板 · 雾段与描边段。
 *
 * 两段在同一个面板里（X-44 定的），但**不在同一个 `meta` 块里**——D30 把 `meta.fog`
 * 独立于 `meta.effects`，因为雾不是后处理，它的消费者、代价与出图裁决三项都与描边不同。
 * 面板把它们放一起是给人看的分组，写文档时仍然是两条路径。
 *
 * 拖滑块走 `preview`（不落撤销），松手 `previewCommit` 落一条。这不是体验优化：
 * 每一帧一条撤销会让「撤销上一步」变成撤销一像素。形状与 `LightPanel` 逐字同形——
 * 四个回调缺任何一个，拖拽的中间态要么全进撤销栈，要么根本提交不了。
 */

const TYPE_LABELS: Record<Fog['type'], string> = {
  linear: '线性（按远近线性变浓）',
  exp2: '指数（更像真实大气）',
}

/**
 * T-242 · 面板给的背景类型只有两档。
 *
 * `hdri` 是第三档，**刻意不出现在这里**：把背景设成 hdri 而 `environment.hdriAssetId`
 * 是 null，画面是一片纯黑且没有任何提示。它的入口在资源库的「设为环境」，那条路径会
 * 同时把 assetId 写进去。
 */
const BACKGROUND_LABELS: Record<Exclude<Background['type'], 'hdri'>, string> = {
  color: '纯色',
  transparent: '透明（导出 PNG 时留空）',
}

/** T-241 · 被遮挡的那一段轮廓怎么画。 */
const HIDDEN_EDGE_LABELS: Record<HiddenEdgeMode, string> = {
  hide: '不画（只画看得见的那一段）',
  dim: '画一条暗的',
  show: '与可见部分同色',
}

export function SceneEffectsPanel() {
  const fog = useDocumentSelector((s) => s.doc.meta.fog)
  const outline = useDocumentSelector((s) => s.doc.meta.effects.outline)
  const background = useDocumentSelector((s) => s.doc.meta.background)
  const environment = useDocumentSelector((s) => s.doc.meta.environment)
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

      <div className="subpanel__head">描边</div>

      <label className="row">
        <span>描边</span>
        <input
          type="checkbox"
          data-testid="outline-enabled"
          checked={outline.enabled}
          onChange={(e) =>
            commit(e.target.checked ? '开启描边' : '关闭描边', (d) => setOutlineEnabled(d, e.target.checked))
          }
        />
      </label>

      {outline.enabled && (
        <>
          <label className="row">
            <span>选中色</span>
            <input
              type="color"
              data-testid="outline-color"
              value={outline.color}
              onChange={(e) => commit('调整描边色', (d) => setOutlineParams(d, { color: e.target.value }))}
            />
          </label>
          {/* 这一句省不掉：面板上唯一的颜色控件却管不到规则高亮，不说清楚，
              用户会改完发现「没变」并认为描边坏了 */}
          <div className="hint">此颜色用于编辑器选中态；规则里的高亮用各自预设的颜色</div>

          <NumberField
            label="宽度（近似像素）"
            value={outline.widthPx}
            min={1}
            max={8}
            step={0.5}
            onPreviewStart={previewStart}
            onPreview={(v) => preview((d: SceneDocument) => setOutlineParams(d, { widthPx: v }))}
            onCommit={(v) => commit('调整描边宽度', (d: SceneDocument) => setOutlineParams(d, { widthPx: v }))}
            onPreviewEnd={() => previewCommit('调整描边宽度')}
          />
          <NumberField
            label="强度"
            value={outline.strength}
            min={0}
            max={5}
            step={0.1}
            onPreviewStart={previewStart}
            onPreview={(v) => preview((d: SceneDocument) => setOutlineParams(d, { strength: v }))}
            onCommit={(v) => commit('调整描边强度', (d: SceneDocument) => setOutlineParams(d, { strength: v }))}
            onPreviewEnd={() => previewCommit('调整描边强度')}
          />

          <label className="row">
            <span>被遮挡部分</span>
            <select
              className="field"
              data-testid="outline-hidden-edge"
              value={outline.hiddenEdge}
              onChange={(e) => commit('调整遮挡轮廓', (d) => setOutlineParams(d, { hiddenEdge: e.target.value as HiddenEdgeMode }))}
            >
              {HIDDEN_EDGE_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {HIDDEN_EDGE_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>

          <div className="hint hint--warn">开启描边会用后处理管线，透明背景导出与 4× 导出不含描边</div>
        </>
      )}

      <div className="subpanel__head">背景与曝光</div>

      <label className="row">
        <span>背景</span>
        <select
          className="field"
          data-testid="background-type"
          value={background.type}
          onChange={(e) => commit('切换背景类型', (d) => setBackgroundType(d, e.target.value as Background['type']))}
        >
          {background.type === 'hdri' && (
            // 已经是 hdri 就把它显示出来，否则下拉框会显示成「纯色」而文档里不是——
            // 一个说谎的控件比没有控件更糟。**但它不出现在可选项里**（见 BACKGROUND_LABELS）。
            <option value="hdri">环境贴图（在资源库里更换）</option>
          )}
          {Object.entries(BACKGROUND_LABELS).map(([type, label]) => (
            <option key={type} value={type}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {background.type === 'color' && (
        <label className="row">
          <span>背景色</span>
          <input
            type="color"
            data-testid="background-color"
            value={background.color}
            onChange={(e) => commit('调整背景色', (d) => setBackgroundColor(d, e.target.value))}
          />
        </label>
      )}

      <NumberField
        label="曝光"
        value={environment.exposure}
        min={0.1}
        max={4}
        step={0.05}
        onPreviewStart={previewStart}
        onPreview={(v) => preview((d: SceneDocument) => setExposure(d, v))}
        onCommit={(v) => commit('调整曝光', (d: SceneDocument) => setExposure(d, v))}
        onPreviewEnd={() => previewCommit('调整曝光')}
      />

      <NumberField
        label="环境光强度"
        value={environment.intensity}
        min={0}
        max={4}
        step={0.05}
        disabled={environment.hdriAssetId === null}
        onPreviewStart={previewStart}
        onPreview={(v) => preview((d: SceneDocument) => setEnvIntensity(d, v))}
        onCommit={(v) => commit('调整环境光强度', (d: SceneDocument) => setEnvIntensity(d, v))}
        onPreviewEnd={() => previewCommit('调整环境光强度')}
      />
      {environment.hdriAssetId === null && <div className="hint">环境光强度要先在资源库里挂一张环境贴图才有效果</div>}
    </div>
  )
}
