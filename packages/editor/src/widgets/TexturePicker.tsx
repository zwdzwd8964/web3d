import type { MaterialMaps } from '@w3/schema'
import { useEffect, useState } from 'react'
import { applyImport } from '../lib/import-flow.js'
import { EMPTY_LIBRARY, importLibraryItem, itemsOf, libraryUrl, loadLibrary } from '../lib/library.js'
import type { Library, LibraryItem } from '../lib/library.js'
import { useProject } from '../project/ProjectContext.jsx'
import { useDocumentActions, useDocumentSelector, useDocumentStore } from '../store/StoreContext.js'
import { textureAssets } from '../lib/material-edit.js'

/**
 * T-152 · picking a texture for one material slot.
 *
 * Two tabs, because there are two places a texture can come from and they behave
 * differently: the project's own assets are already here, and a built-in library texture
 * is a FILE that has to be imported first. Choosing one from the library therefore runs the
 * normal import pipeline (hash dedup, health check, asset record) — D17's third discipline,
 * the same rule the model library follows. There is no second way for bytes to enter a
 * project.
 *
 * 「清除」 is a first-class choice rather than a separate button, because unsetting a slot is
 * as common as setting one and hiding it in a corner is how people end up with a normal map
 * they cannot get rid of.
 */

export interface TexturePickerProps {
  readonly slot: keyof MaterialMaps
  readonly label: string
  /** The asset currently in the slot, if any. */
  readonly assetId: string | undefined
  readonly onPick: (assetId: string | null) => void
  readonly onClose: () => void
}

export function TexturePicker({ label, assetId, onPick, onClose }: TexturePickerProps) {
  const doc = useDocumentSelector((s) => s.doc)
  const store = useDocumentStore()
  const session = useProject()
  const { commit } = useDocumentActions()

  const [tab, setTab] = useState<'project' | 'library'>('project')
  const [library, setLibrary] = useState<Library>(EMPTY_LIBRARY)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // The app's own origin, from the document itself — never a constant (C6).
  const base = document.baseURI

  useEffect(() => {
    let cancelled = false
    void loadLibrary({ base }).then((loaded) => {
      if (!cancelled) setLibrary(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [base])

  const own = textureAssets(doc)
  const fromLibrary = itemsOf(library, 'texture')

  /**
   * Brings a library texture into the project, then selects it.
   *
   * The live document, not this render's: an import is async and the user can edit while it
   * runs. Committing against a stale one would resurrect whatever they changed.
   */
  const bringIn = async (item: LibraryItem) => {
    if (busy) return
    setBusy(item.id)
    setNote(null)
    try {
      const result = await importLibraryItem({
        item,
        doc: store.getState().doc,
        storage: session.storage,
        loader: session.loader,
        base,
      })
      commit(`引入 ${item.name}`, (draft) => applyImport(draft, result))
      onPick(result.asset.id)
    } catch (error) {
      setNote(`引入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="picker" role="dialog" aria-label={`选择${label}贴图`}>
      <div className="picker__head">
        <div className="seg">
          <button type="button" aria-pressed={tab === 'project'} onClick={() => setTab('project')}>
            项目资产
          </button>
          <button type="button" aria-pressed={tab === 'library'} onClick={() => setTab('library')}>
            内置纹理
          </button>
        </div>
        <button type="button" className="tbtn" onClick={onClose}>
          关闭
        </button>
      </div>

      {note !== null && <p className="panel__note">{note}</p>}

      {tab === 'project' && (
        <ul className="picker__grid">
          <li>
            <button type="button" className="picker__clear" disabled={assetId === undefined} onClick={() => onPick(null)}>
              清除
            </button>
          </li>
          {own.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                aria-pressed={asset.id === assetId}
                className="picker__item"
                onClick={() => onPick(asset.id)}
                title={asset.name}
              >
                {asset.thumbnailUrl !== undefined && <img src={asset.thumbnailUrl} alt="" />}
                <span className="picker__name">{asset.name}</span>
              </button>
            </li>
          ))}
          {own.length === 0 && <p className="panel__empty">项目里还没有纹理。从「内置纹理」选一张，或在资产面板导入。</p>}
        </ul>
      )}

      {tab === 'library' && (
        <ul className="picker__grid">
          {fromLibrary.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="picker__item"
                onClick={() => void bringIn(item)}
                title={`${item.name}｜${item.license}`}
              >
                <img src={libraryUrl(item.preview, base)} alt="" />
                <span className="picker__name">{busy === item.id ? '引入中…' : item.name}</span>
              </button>
            </li>
          ))}
          {fromLibrary.length === 0 && <p className="panel__empty">内置纹理库为空。</p>}
        </ul>
      )}
    </div>
  )
}
