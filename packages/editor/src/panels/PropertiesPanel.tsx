import type { Explode, Node, Vec3 } from '@w3/schema'
import { EASINGS, EXPLODE_MODES, EXPLODE_MODE_LABELS } from '@w3/schema'
import { fromEulerDegrees, toEulerDegrees } from '@w3/core'
import { useEffect, useMemo, useState } from 'react'
import { clearExplodeGroup, makeExplodeGroup, setExplodeAxis, setExplodeParams } from '../lib/explode-edit.js'
import { getExplodeTool, onExplodeToolChange } from '../viewport/explode-tool.js'
import { MIXED, commonValue, commonVectorComponents, isMixed } from '../lib/selection-values.js'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { CheckField, NumberField, TextField } from '../widgets/NumberField.js'

/**
 * T-064 · the property panel.
 *
 * Two things it must get right:
 *
 * **Euler in, quaternion out.** The document stores a quaternion (SCHEMA_SPEC §4.1-3);
 * nobody types one. Conversion happens at this edge and nowhere else.
 *
 * **Mixed means mixed.** With several objects selected, a field that shows the first
 * one's value and writes it to all of them silently overwrites the others the moment an
 * unrelated field is touched. A mixed field reads as `—` and only writes when edited.
 */

const AXES = ['X', 'Y', 'Z'] as const

export function PropertiesPanel() {
  const nodes = useDocumentSelector((s) => s.doc.nodes)
  const selection = useDocumentSelector((s) => s.selection)
  const { commit, preview, previewStart, previewCommit } = useDocumentActions()

  const selected = useMemo(() => nodes.filter((n) => selection.includes(n.id)), [nodes, selection])

  /**
   * T-248 · 爆炸预览开着时 transform 只读。
   *
   * 防的是「用户在爆炸态下误改真实 transform」：画面上那个零件在离原位一米远的地方，
   * 面板里的数字却是文档值——此时点进去改一个数，改的是**原位**而不是他看着的那个位置。
   * 拖动零件是允许的（那写的是 `explodeOffset`，T-249），两者不是同一件事。
   */
  const [explodeTool, setExplodeToolLocal] = useState(getExplodeTool)
  useEffect(() => onExplodeToolChange(setExplodeToolLocal), [])
  const transformLocked = explodeTool.groupNodeId !== null

  const position = useMemo(() => commonVectorComponents(selected, (n) => n.transform.p), [selected])
  const scale = useMemo(() => commonVectorComponents(selected, (n) => n.transform.s), [selected])
  const rotation = useMemo(
    () => commonVectorComponents(selected, (n) => toEulerDegrees(n.transform.r)),
    [selected],
  )
  const visible = useMemo(() => commonValue(selected, (n) => n.visible), [selected])
  const locked = useMemo(() => commonValue(selected, (n) => n.locked), [selected])

  if (selected.length === 0) {
    return (
      <aside className="panel panel--right">
        <div className="panel__head">属性</div>
        <div className="panel__body">
          <p className="panel__empty">未选中对象</p>
        </div>
      </aside>
    )
  }

  const editEach = (label: string, mutate: (node: Node) => void) => {
    commit(label, (draft) => {
      for (const node of draft.nodes) if (selection.includes(node.id)) mutate(node)
    })
  }

  const previewEach = (mutate: (node: Node) => void) => {
    preview((draft) => {
      for (const node of draft.nodes) if (selection.includes(node.id)) mutate(node)
    })
  }

  /** Writes one axis, leaving the other two at each object's own value. */
  const setAxis = (key: 'p' | 's', axis: number, value: number, live: boolean) => {
    const write = (node: Node) => {
      const vector = [...node.transform[key]] as Vec3
      vector[axis] = value
      node.transform[key] = vector
    }
    if (live) previewEach(write)
    else editEach(axis === 0 ? `调整 ${key === 'p' ? '位置' : '缩放'} X` : `调整 ${key === 'p' ? '位置' : '缩放'} ${AXES[axis]}`, write)
  }

  const setRotationAxis = (axis: number, degrees: number, live: boolean) => {
    const write = (node: Node) => {
      const euler = [...toEulerDegrees(node.transform.r)] as Vec3
      euler[axis] = degrees
      node.transform.r = fromEulerDegrees(euler)
    }
    if (live) previewEach(write)
    else editEach(`调整 旋转 ${AXES[axis]}`, write)
  }

  const single = selected.length === 1 ? selected[0]! : null

  return (
    <aside className="panel panel--right">
      <div className="panel__head">
        属性
        {selected.length > 1 && <span className="num">{selected.length} 个对象</span>}
      </div>
      <div className="panel__body">
        <TextField
          label="名称"
          value={single ? single.name : '—'}
          disabled={!single}
          onCommit={(name) => single && editEach(`重命名 ${name}`, (node) => void (node.name = name))}
        />

        {/* T-248 · 爆炸预览开着时说清楚为什么改不动，否则用户以为面板卡死了 */}
        {transformLocked && (
          <p className="panel__note" data-testid="transform-locked-hint">
            爆炸预览开启中，变换只读。画面上的位置是预览姿态，此处的数字是文档里的原位——
            要调整某个零件的爆炸位置，请拖动它并点「记录当前偏移」
          </p>
        )}

        <fieldset className="group">
          <legend>位置</legend>
          {AXES.map((axis, i) => (
            <NumberField
              key={axis}
              label={axis}
              value={position[i]}
              disabled={transformLocked}
              step={0.01}
              onCommit={(v) => setAxis('p', i, v, false)}
              onPreviewStart={previewStart}
              onPreview={(v) => setAxis('p', i, v, true)}
              onPreviewEnd={() => previewCommit(`调整 位置 ${axis}`)}
            />
          ))}
        </fieldset>

        <fieldset className="group">
          <legend>旋转（度）</legend>
          {AXES.map((axis, i) => (
            <NumberField
              key={axis}
              label={axis}
              value={rotation[i]}
              disabled={transformLocked}
              step={0.5}
              digits={2}
              onCommit={(v) => setRotationAxis(i, v, false)}
              onPreviewStart={previewStart}
              onPreview={(v) => setRotationAxis(i, v, true)}
              onPreviewEnd={() => previewCommit(`调整 旋转 ${axis}`)}
            />
          ))}
        </fieldset>

        <fieldset className="group">
          <legend>缩放</legend>
          {AXES.map((axis, i) => (
            <NumberField
              key={axis}
              label={axis}
              value={scale[i]}
              disabled={transformLocked}
              step={0.01}
              min={0.0001}
              onCommit={(v) => setAxis('s', i, v, false)}
              onPreviewStart={previewStart}
              onPreview={(v) => setAxis('s', i, v, true)}
              onPreviewEnd={() => previewCommit(`调整 缩放 ${axis}`)}
            />
          ))}
        </fieldset>

        <CheckField
          label="可见"
          value={visible ?? MIXED}
          onCommit={(v) => editEach(v ? '显示对象' : '隐藏对象', (node) => void (node.visible = v))}
        />
        <CheckField
          label="锁定"
          value={locked ?? MIXED}
          onCommit={(v) => editEach(v ? '锁定对象' : '解锁对象', (node) => void (node.locked = v))}
        />

        {single?.assetRef && (
          <dl className="meta">
            <dt>资产路径</dt>
            <dd className="meta__path" title={single.assetRef.objectPath}>
              {single.assetRef.objectPath}
            </dd>
            {single.assetRef.missing && <dd className="meta__warn">映射已失效，需在资产面板重新指定</dd>}
          </dl>
        )}
        {isMixed(visible) && <p className="panel__note">部分对象可见性不同</p>}

        {/* T-247 · 爆炸分区。**只在单选时出现**：爆炸参数是分组自己的，多选下
            「改一个参数写给所有选中的分组」在语义上说不通（每组的成员完全不同）。 */}
        {single && (
          <section className="subpanel" data-testid="explode-section">
            <div className="subpanel__head">爆炸视图</div>
            {single.explode === null ? (
              <button
                type="button"
                className="tbtn"
                data-testid="explode-make"
                onClick={() => commit('设为爆炸分组', (d) => makeExplodeGroup(d, single.id))}
              >
                设为爆炸分组
              </button>
            ) : (
              <ExplodeFields
                nodeId={single.id}
                explode={single.explode}
                onCommit={(label, patch) => commit(label, (d) => setExplodeParams(d, single.id, patch))}
                onAxis={(axis, value) => commit('调整排布轴', (d) => setExplodeAxis(d, single.id, axis, value))}
                onPreviewStart={previewStart}
                onPreview={(patch) => preview((d) => setExplodeParams(d, single.id, patch))}
                onPreviewEnd={previewCommit}
                onClear={() => commit('取消爆炸分组', (d) => clearExplodeGroup(d, single.id))}
              />
            )}
          </section>
        )}
      </div>
    </aside>
  )
}

/**
 * 爆炸参数的那几个控件。
 *
 * **每个数值控件都带 min/max**——v0.5 的 T-176 抓到过 `rotationDeg` 与灯光 intensity 的
 * 「存得下、打不开」：面板让用户写进一个 schema 拒绝的值，文档保存成功，下次打开
 * `validate()` 判红，而错误信息指向一个用户根本不知道自己动过的字段。
 */
function ExplodeFields(props: {
  nodeId: string
  explode: Explode
  onCommit: (label: string, patch: Partial<Explode>) => void
  onAxis: (axis: 0 | 1 | 2, value: number) => void
  onPreviewStart: () => void
  onPreview: (patch: Partial<Explode>) => void
  onPreviewEnd: (label: string) => void
  onClear: () => void
}) {
  const { explode } = props
  return (
    <>
      <label className="row">
        <span>模式</span>
        <select
          className="field"
          data-testid="explode-mode"
          value={explode.mode}
          onChange={(e) => props.onCommit('切换爆炸模式', { mode: e.target.value as Explode['mode'] })}
        >
          {EXPLODE_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {EXPLODE_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>

      {explode.mode === 'radial' ? (
        <NumberField
          label="散开倍率"
          value={explode.gain}
          min={0}
          max={20}
          step={0.1}
          onPreviewStart={props.onPreviewStart}
          onPreview={(v) => props.onPreview({ gain: v })}
          onCommit={(v) => props.onCommit('调整散开倍率', { gain: v })}
          onPreviewEnd={() => props.onPreviewEnd('调整散开倍率')}
        />
      ) : (
        <>
          {AXES.map((axis, i) => (
            <NumberField
              key={axis}
              label={`排布轴 ${axis}`}
              value={explode.axis[i] ?? 0}
              min={-1}
              max={1}
              step={0.1}
              onCommit={(v) => props.onAxis(i as 0 | 1 | 2, v)}
            />
          ))}
          <NumberField
            label="间距"
            value={explode.spacing}
            min={0}
            max={1000}
            step={0.05}
            onPreviewStart={props.onPreviewStart}
            onPreview={(v) => props.onPreview({ spacing: v })}
            onCommit={(v) => props.onCommit('调整爆炸间距', { spacing: v })}
            onPreviewEnd={() => props.onPreviewEnd('调整爆炸间距')}
          />
        </>
      )}

      <label className="row">
        <span>缓动</span>
        <select
          className="field"
          data-testid="explode-easing"
          value={explode.easing}
          onChange={(e) => props.onCommit('调整爆炸缓动', { easing: e.target.value as Explode['easing'] })}
        >
          {EASINGS.map((easing) => (
            <option key={easing} value={easing}>
              {easing}
            </option>
          ))}
        </select>
      </label>

      <button type="button" className="tbtn" data-testid="explode-clear" onClick={props.onClear}>
        取消爆炸分组
      </button>
      {/* 说清楚它不会顺手删数据——否则用户不敢点 */}
      <div className="hint">取消分组不会删除各零件已记录的爆炸偏移</div>
    </>
  )
}
