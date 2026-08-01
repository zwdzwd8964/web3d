import type { MaterialBase, MaterialMaps, SceneDocument } from '@w3/schema'
import { MATERIAL_BASES, createMaterial, defaultFactoryContext } from '@w3/schema'
import { useMemo, useState } from 'react'
import {
  IDENTITY_UV,
  PHYSICAL_FIELDS,
  TEXTURE_SLOTS,
  clearUv,
  setBase,
  setMap,
  setPhysical,
  setUv,
  usersOfMaterial,
} from '../lib/material-edit.js'
import { commonValue } from '../lib/selection-values.js'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { NumberField, TextField } from '../widgets/NumberField.js'
import { TexturePicker } from '../widgets/TexturePicker.js'

/**
 * T-067 + T-152 · the material panel.
 *
 * Every edit goes through the document, never through a three.js material. The runtime's
 * MaterialRegistry does the clone-on-write, which is why changing one node's roughness
 * cannot move its siblings (R08) — proven by `material-registry.test.ts`, not by hoping.
 *
 * The decisions live in `material-edit.ts` so they can be tested: the editor's tests run in
 * plain Node, and M10's review found two features that had been "implemented" entirely
 * inside event handlers no test could reach.
 */

const BASE_LABELS: Record<MaterialBase, string> = {
  standard: '标准',
  physical: '物理（玻璃 / 清漆）',
  basic: '无光照',
  lambert: '兰伯特',
}

export function MaterialPanel() {
  const doc = useDocumentSelector((s) => s.doc)
  const selection = useDocumentSelector((s) => s.selection)
  const { commit, preview, previewStart, previewCommit } = useDocumentActions()
  const [picking, setPicking] = useState<keyof MaterialMaps | null>(null)

  const selected = useMemo(() => doc.nodes.filter((n) => selection.includes(n.id)), [doc.nodes, selection])
  const materialId = useMemo(() => commonValue(selected, (n) => n.overrides.materialId ?? null), [selected])
  const material = typeof materialId === 'string' ? doc.materials.find((m) => m.id === materialId) : undefined
  const users = material ? usersOfMaterial(doc, material.id) : 0

  const assign = (id: string | null) => {
    commit(id ? '指定材质' : '还原材质', (draft) => {
      for (const node of draft.nodes) {
        if (!selection.includes(node.id)) continue
        if (id === null) delete node.overrides.materialId
        else node.overrides.materialId = id
      }
    })
  }

  const editParam = (label: string, key: 'roughness' | 'metalness' | 'opacity', value: number, live: boolean) => {
    const write = (draft: SceneDocument) => {
      const target = draft.materials.find((m) => m.id === material?.id)
      if (target) target.params[key] = value
    }
    if (live) preview(write)
    else commit(label, write)
  }

  const uv = material?.params.uv ?? IDENTITY_UV

  /** One uv control. Dragging previews; releasing commits — D2, one drag one undo entry. */
  const uvField = (label: string, value: number, write: (draft: SceneDocument, v: number) => void, step: number) => (
    <NumberField
      key={label}
      label={label}
      value={value}
      step={step}
      onCommit={(v) => commit(`调整 ${label}`, (draft) => write(draft, v))}
      onPreviewStart={previewStart}
      onPreview={(v) => preview((draft) => write(draft, v))}
      onPreviewEnd={() => previewCommit(`调整 ${label}`)}
    />
  )

  return (
    <div className="subpanel">
      <div className="subpanel__head">
        材质
        <button
          type="button"
          className="tbtn"
          disabled={selected.length === 0}
          onClick={() => {
            const created = createMaterial({ name: `材质 ${doc.materials.length + 1}`, ctx: defaultFactoryContext })
            commit('新建材质', (draft) => {
              draft.materials.push(created)
              for (const node of draft.nodes) if (selection.includes(node.id)) node.overrides.materialId = created.id
            })
          }}
        >
          新建并指定
        </button>
      </div>

      {selected.length === 0 ? (
        <p className="panel__empty">未选中对象</p>
      ) : (
        <>
          <label className="field">
            <span className="field__label">材质</span>
            <select
              className="field__input"
              value={typeof materialId === 'string' ? materialId : ''}
              onChange={(event) => assign(event.target.value || null)}
            >
              <option value="">（继承源材质）</option>
              {doc.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          {material && (
            <>
              {/* 铁律 9 is enforced by the runtime, but the user still has to be able to SEE
                  which case they are in before they drag a slider. */}
              {users > 1 && <p className="panel__note">这份材质被 {users} 个对象共用，改动会同时生效。</p>}

              <TextField
                label="名称"
                value={material.name}
                onCommit={(name) =>
                  commit('重命名材质', (draft) => {
                    const target = draft.materials.find((m) => m.id === material.id)
                    if (target) target.name = name
                  })
                }
              />

              <label className="field">
                <span className="field__label">类型</span>
                <select
                  className="field__input"
                  value={material.base}
                  onChange={(event) =>
                    commit('切换材质类型', (draft) => setBase(draft, material.id, event.target.value as MaterialBase))
                  }
                >
                  {MATERIAL_BASES.map((base) => (
                    <option key={base} value={base}>
                      {BASE_LABELS[base]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field__label">颜色</span>
                <input
                  className="field__input"
                  type="color"
                  value={material.params.color ?? '#b8bec4'}
                  onChange={(event) =>
                    commit('调整 颜色', (draft) => {
                      const target = draft.materials.find((m) => m.id === material.id)
                      if (target) target.params.color = event.target.value
                    })
                  }
                />
              </label>

              {(
                [
                  ['粗糙度', 'roughness'],
                  ['金属度', 'metalness'],
                  ['不透明度', 'opacity'],
                ] as const
              ).map(([label, key]) => (
                <NumberField
                  key={key}
                  label={label}
                  value={material.params[key] ?? 0}
                  step={0.01}
                  min={0}
                  max={1}
                  onCommit={(v) => editParam(`调整 ${label}`, key, v, false)}
                  onPreviewStart={previewStart}
                  onPreview={(v) => editParam(`调整 ${label}`, key, v, true)}
                  onPreviewEnd={() => previewCommit(`调整 ${label}`)}
                />
              ))}

              {material.base === 'physical' && (
                <fieldset className="fieldset">
                  <legend>物理参数</legend>
                  {PHYSICAL_FIELDS.map(({ key, label, min, max, step }) => (
                    <NumberField
                      key={key}
                      label={label}
                      value={material.params[key] ?? min}
                      step={step}
                      min={min}
                      max={max}
                      onCommit={(v) => commit(`调整 ${label}`, (draft) => setPhysical(draft, material.id, key, v))}
                      onPreviewStart={previewStart}
                      onPreview={(v) => preview((draft) => setPhysical(draft, material.id, key, v))}
                      onPreviewEnd={() => previewCommit(`调整 ${label}`)}
                    />
                  ))}
                </fieldset>
              )}

              <fieldset className="fieldset">
                <legend>贴图</legend>
                {TEXTURE_SLOTS.map(({ slot, label }) => {
                  const current = material.params.maps[slot]
                  const asset = current === undefined ? undefined : doc.assets.find((a) => a.id === current)
                  return (
                    <div className="field" key={slot}>
                      <span className="field__label">{label}</span>
                      <button type="button" className="field__input slot" onClick={() => setPicking(slot)}>
                        {asset?.name ?? '（未设置）'}
                      </button>
                      {current !== undefined && (
                        <button
                          type="button"
                          className="tbtn"
                          aria-label={`清除${label}贴图`}
                          onClick={() => commit(`清除 ${label}贴图`, (draft) => setMap(draft, material.id, slot, null))}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  )
                })}

                {picking !== null && (
                  <TexturePicker
                    slot={picking}
                    label={TEXTURE_SLOTS.find((s) => s.slot === picking)?.label ?? ''}
                    assetId={material.params.maps[picking]}
                    onPick={(assetId) => {
                      commit(assetId ? '设置贴图' : '清除贴图', (draft) => setMap(draft, material.id, picking, assetId))
                      setPicking(null)
                    }}
                    onClose={() => setPicking(null)}
                  />
                )}
              </fieldset>

              <fieldset className="fieldset">
                <legend>
                  UV
                  <button
                    type="button"
                    className="tbtn"
                    disabled={material.params.uv === undefined}
                    onClick={() => commit('重置 UV', (draft) => clearUv(draft, material.id))}
                  >
                    重置
                  </button>
                </legend>
                {uvField('平铺 U', uv.repeat[0], (draft, v) => setUv(draft, material.id, { repeat: [v, uv.repeat[1]] }), 0.1)}
                {uvField('平铺 V', uv.repeat[1], (draft, v) => setUv(draft, material.id, { repeat: [uv.repeat[0], v] }), 0.1)}
                {uvField('偏移 U', uv.offset[0], (draft, v) => setUv(draft, material.id, { offset: [v, uv.offset[1]] }), 0.01)}
                {uvField('偏移 V', uv.offset[1], (draft, v) => setUv(draft, material.id, { offset: [uv.offset[0], v] }), 0.01)}
                {uvField('旋转°', uv.rotationDeg, (draft, v) => setUv(draft, material.id, { rotationDeg: v }), 1)}
              </fieldset>
            </>
          )}
        </>
      )}
    </div>
  )
}
