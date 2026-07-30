import type { SceneDocument } from '@w3/schema'
import { createMaterial, defaultFactoryContext } from '@w3/schema'
import { useMemo } from 'react'
import { commonValue } from '../lib/selection-values.js'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { NumberField, TextField } from '../widgets/NumberField.js'

/**
 * T-067 · the material panel.
 *
 * Every edit goes through the document, never through a three.js material. The runtime's
 * MaterialRegistry does the clone-on-write, which is why changing one node's roughness
 * cannot move its siblings (R08) — proven by `material-registry.test.ts`, not by hoping.
 */
export function MaterialPanel() {
  const doc = useDocumentSelector((s) => s.doc)
  const selection = useDocumentSelector((s) => s.selection)
  const { commit, preview, previewStart, previewCommit } = useDocumentActions()

  const selected = useMemo(() => doc.nodes.filter((n) => selection.includes(n.id)), [doc.nodes, selection])
  const materialId = useMemo(() => commonValue(selected, (n) => n.overrides.materialId ?? null), [selected])
  const material = typeof materialId === 'string' ? doc.materials.find((m) => m.id === materialId) : undefined

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
            </>
          )}
        </>
      )}
    </div>
  )
}
