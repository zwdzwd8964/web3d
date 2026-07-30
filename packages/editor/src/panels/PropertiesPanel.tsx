import type { Node, Vec3 } from '@w3/schema'
import { fromEulerDegrees, toEulerDegrees } from '@w3/core'
import { useMemo } from 'react'
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

        <fieldset className="group">
          <legend>位置</legend>
          {AXES.map((axis, i) => (
            <NumberField
              key={axis}
              label={axis}
              value={position[i]}
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
      </div>
    </aside>
  )
}
