import { useEffect, useMemo, useState } from 'react'
import { useProject } from '../project/ProjectContext.jsx'
import { useDocumentActions, useDocumentSelector, useDocumentStore } from '../store/StoreContext.js'
import { applyImport, summarizeImport } from '../lib/import-flow.js'
import {
  EMPTY_LIBRARY,
  PRIMITIVE_TEMPLATES,
  addPrimitive,
  importLibraryItem,
  itemsOf,
  libraryUrl,
  loadLibrary,
} from '../lib/library.js'
import type { Library, LibraryCategory, LibraryItem, PrimitiveTemplate } from '../lib/library.js'
import { LIBRARY_MIME, PRIMITIVE_MIME, beginDrag, endDrag } from '../viewport/drag.js'
import { boundsOfPrimitive, restOnPoint, viewCentre } from '../viewport/place.js'
import { getActiveRuntime } from '../viewport/runtime-registry.js'

/**
 * T-141 · the resource library.
 *
 * The panel an empty project needs. Before it, a new scene could only be filled by
 * importing a GLB from disk — which is fine for the one customer who has GLBs and useless
 * for the twenty minutes before that.
 *
 * Three tabs because there are three things a scene is assembled from. 对象 is complete
 * here; 纹理 and 环境 are filled in by T-155, and they say so rather than rendering empty
 * — a tab that looks broken is worse than a tab that explains itself.
 *
 * **Every path out of this panel goes through `commit`.** Double-clicking a primitive is
 * one undo entry covering the node AND the material record it needed; using a library model
 * is one entry covering the asset record and its nodes. Nothing here touches three.
 */

const TABS: readonly { id: LibraryCategory; label: string }[] = [
  { id: 'model', label: '对象' },
  { id: 'texture', label: '纹理' },
  { id: 'hdri', label: '环境' },
]

/** Where a double-clicked item lands. The centre of the ground plane, not the origin of
 *  whatever the camera happens to be looking at — predictable beats clever. */
/** The landing point for a double-click: the middle of what the user is looking at (T-146). */
const viewCentreOnGround = () => viewCentre(getActiveRuntime())

export function LibraryPanel() {
  const session = useProject()
  const store = useDocumentStore()
  const doc = useDocumentSelector((s) => s.doc)
  const { commit, select } = useDocumentActions()

  const [tab, setTab] = useState<LibraryCategory>('model')
  const [library, setLibrary] = useState<Library>(EMPTY_LIBRARY)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // Loaded once. The manifest is a static asset; re-reading it per tab switch would be a
  // request per click for a file that cannot have changed.
  useEffect(() => {
    let cancelled = false
    void loadLibrary({ base: document.baseURI }).then((loaded) => {
      if (!cancelled) setLibrary(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // The app's own origin, from the document itself — never a constant (C6).
  const base = document.baseURI
  const models = useMemo(() => itemsOf(library, 'model'), [library])

  const createPrimitive = (template: PrimitiveTemplate) => {
    let created: string | null = null
    const position = restOnPoint(viewCentreOnGround(), boundsOfPrimitive(template.primitive))
    commit(`新建 ${template.label}`, (draft) => {
      created = addPrimitive(draft, template, { position }).id
    })
    if (created) select([created])
  }

  const bringInItem = async (item: LibraryItem) => {
    if (busy) return
    setBusy(item.id)
    setNote(null)
    try {
      // The live document, not the one this render closed over: an import is async and the
      // user can edit while it runs. Committing against a stale document would resurrect
      // whatever they changed in between.
      const target = viewCentreOnGround()
      const result = await importLibraryItem({
        item,
        doc: store.getState().doc,
        storage: session.storage,
        loader: session.loader,
        base,
      })
      commit(`引入 ${item.name}`, (draft) => {
        applyImport(draft, result)
        // Same landing rule as a drop, minus the cursor: the middle of what the user is
        // looking at. A constant origin would put the object off screen the moment they
        // orbited away from it, and «双击没反应» is how that reads.
        for (const node of result.nodes) {
          if (node.parent !== null) continue
          const live = draft.nodes.find((n) => n.id === node.id)
          if (live) live.transform.p = target
        }
      })
      setNote(summarizeImport(result))
    } catch (error) {
      setNote(`引入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="subpanel">
      <div className="subpanel__head">
        资源库
        <div className="seg">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {library.error && <span className="panel__hint">{library.error}</span>}
        {note && <span className="panel__hint">{note}</span>}
      </div>

      {tab === 'model' && (
        <>
          <p className="panel__note">双击放到场景中心，或拖到视口里放置</p>
          <ul className="library-grid">
            {PRIMITIVE_TEMPLATES.map((template) => (
              <li
                key={template.kind}
                className="library-grid__item"
                draggable
                onDragStart={(event) => {
                  // A custom MIME rather than `text/plain`: dropping a primitive onto a text
                  // field should do nothing. The type is all `dragover` can see, so the
                  // payload itself goes into the drag session — see `drag.ts`.
                  event.dataTransfer.setData(PRIMITIVE_MIME, template.kind)
                  event.dataTransfer.effectAllowed = 'copy'
                  beginDrag({ kind: 'primitive', template })
                }}
                onDragEnd={() => endDrag()}
                onDoubleClick={() => createPrimitive(template)}
                title={`双击新建${template.label}`}
              >
                <span className="library-grid__shape" aria-hidden="true" data-kind={template.kind} />
                <span className="library-grid__name">{template.label}</span>
              </li>
            ))}

            {models.map((item) => (
              <li
                key={item.id}
                className="library-grid__item"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(LIBRARY_MIME, item.id)
                  event.dataTransfer.effectAllowed = 'copy'
                  beginDrag({ kind: 'library', item })
                }}
                onDragEnd={() => endDrag()}
                onDoubleClick={() => void bringInItem(item)}
                title={`${item.name}｜${item.license}｜${item.note ?? ''}`}
              >
                <img className="library-grid__preview" src={libraryUrl(item.preview, base)} alt="" />
                <span className="library-grid__name">{busy === item.id ? '引入中…' : item.name}</span>
              </li>
            ))}
          </ul>
          {doc.assets.length === 0 && models.length === 0 && (
            <p className="panel__empty">内置库不可用。仍可从「资产」页签导入自己的文件。</p>
          )}
        </>
      )}

      {tab !== 'model' && (
        <p className="panel__empty">
          {tab === 'texture' ? '纹理' : '环境'}页签在 T-155 接通。内置库已包含
          {itemsOf(library, tab).length} 项，届时在这里陈列。
        </p>
      )}
    </div>
  )
}
