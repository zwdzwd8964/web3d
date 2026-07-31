import type { SnapshotSummary } from '@w3/storage'
import { useCallback, useEffect, useState } from 'react'
import { useProject } from '../project/ProjectContext.jsx'
import { formatPublishedAt, listSnapshots, rollbackTo } from '../publish/snapshots.js'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'

/**
 * Overwrites `target` with `source`, one element at a time.
 *
 * `target.splice(0, target.length, ...source)` in one call would be shorter and would
 * make immer emit a single whole-array replace — which is exactly what this exists to
 * avoid. Trimming then assigning by index keeps the patches per-element.
 */
function replaceInPlace<T>(target: T[], source: readonly T[]): void {
  if (target.length > source.length) target.splice(source.length, target.length - source.length)
  for (let i = 0; i < source.length; i++) target[i] = source[i]!
}

/**
 * T-104 · the snapshot list.
 *
 * Rolling back goes through `replaceDocument`, which lands as a normal history entry —
 * so a rollback is itself undoable. That matters: "roll back to last week" and then
 * realising this week's work was worth keeping is a completely ordinary sequence, and a
 * rollback that could not be undone would make the feature too frightening to use.
 */
export function SnapshotPanel() {
  const session = useProject()
  const projectId = useDocumentSelector((s) => s.doc.projectId)
  const revision = useDocumentSelector((s) => s.revision)
  const { commit } = useDocumentActions()

  const [rows, setRows] = useState<SnapshotSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setRows(await listSnapshots(session.storage, projectId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [session, projectId])

  // `revision` in the deps so publishing (which bumps nothing in the document) still
  // refreshes when the user returns to this tab after a publish.
  useEffect(() => {
    void refresh()
  }, [refresh, revision])

  const rollback = async (summary: SnapshotSummary) => {
    setError(null)
    try {
      const { document } = await rollbackTo(session.storage, summary.snapshotId)
      // Through `commit`, NOT `replaceDocument({keepHistory:true})`.
      //
      // SCHEMA_SPEC §11 is unconditional: every write goes through the commit channel.
      // The shortcut was worse than a style violation — `keepHistory` keeps the PREVIOUS
      // document's undo stack, so pressing Ctrl+Z after a rollback replayed inverse
      // patches belonging to a document that no longer existed, silently corrupting the
      // one that did. Meanwhile this panel was promising the user they could undo it.
      commit(`回滚到 ${formatPublishedAt(summary.publishedAt)}${summary.label ? ` · ${summary.label}` : ''}`, (draft) => {
        // Field-by-field, but element-by-element inside each array.
        //
        // Assigning whole arrays looked incremental and is not: immer describes it as one
        // `replace /nodes`, `replace /materials`, … per collection, and the patch applier
        // recognises none of those except `/nodes` — so a rollback tripped the D1
        // full-rebuild fallback and put 铁律 11's alarm counter at 1 on a perfectly
        // ordinary operation. Splicing in place produces per-element patches the renderer
        // reconciles like any other edit.
        replaceInPlace(draft.nodes, document.nodes)
        replaceInPlace(draft.materials, document.materials)
        replaceInPlace(draft.animations, document.animations)
        replaceInPlace(draft.hotspots, document.hotspots)
        replaceInPlace(draft.viewpoints, document.viewpoints)
        replaceInPlace(draft.variables, document.variables)
        replaceInPlace(draft.rules, document.rules)
        replaceInPlace(draft.assets, document.assets)
        replaceInPlace(draft.media, document.media)
        replaceInPlace(draft.pages, document.pages)
        replaceInPlace(draft.flows, document.flows)
        draft.name = document.name
        Object.assign(draft.meta, document.meta)
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="subpanel">
      <div className="subpanel__head">
        快照<span className="num">{rows?.length ?? 0}</span>
        <button type="button" className="tbtn" onClick={() => void refresh()}>
          刷新
        </button>
        <span className="panel__hint">每次发布自动留一份。回滚会落一条撤销记录，可以再撤回来。</span>
      </div>

      {error && <p className="panel__note panel__note--warn">{error}</p>}

      {rows === null ? (
        <p className="panel__note">读取中…</p>
      ) : rows.length === 0 ? (
        <p className="panel__empty">还没有快照。点顶栏「发布」会生成一份。</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>发布时间</th>
              <th>标签</th>
              <th>资产</th>
              <th>schema</th>
              <th>core</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.snapshotId}>
                <td>{formatPublishedAt(row.publishedAt)}</td>
                <td>{row.label ?? '—'}</td>
                <td className="num">{row.assetCount}</td>
                <td className="num">{row.schemaVersion}</td>
                <td className="num">{row.coreVersion}</td>
                <td>
                  <button type="button" className="tbtn" onClick={() => void rollback(row)} title="用这份快照替换当前文档">
                    回滚
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
