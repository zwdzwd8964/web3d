import { checkIntegrity } from '@w3/schema'
import type { IntegrityIssue, SceneDocument } from '@w3/schema'
import { createActionRefResolver } from '@w3/core'
import { useMemo } from 'react'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'

/**
 * T-092 · the integrity list.
 *
 * The status bar has shown 「完整性 3 阻断」 since the status bar existed, and there was
 * nowhere to find out which three. The evaluation report put it exactly right: the warning
 * BEFORE a destructive delete was grade A, and everything after it disappeared. This is
 * the after.
 *
 * Every row locates: clicking one selects the node it is about, which is the difference
 * between a diagnostic and a to-do list.
 */
export function IssuePanel() {
  const doc = useDocumentSelector((s) => s.doc)
  const { select } = useDocumentActions()

  // The action-ref resolver is what makes rule参数 visible to the checker — without it,
  // a rule pointing at a deleted node reads as valid because `params` is opaque to schema.
  const issues = useMemo(() => checkIntegrity(doc, { actionRefs: createActionRefResolver() }), [doc])

  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warn')

  return (
    <div className="subpanel">
      <div className="subpanel__head">
        完整性
        <span className={errors.length > 0 ? 'badge badge--fail' : 'badge badge--ok'}>{errors.length} 阻断</span>
        <span className={warnings.length > 0 ? 'badge badge--warn' : 'badge badge--ok'}>{warnings.length} 提示</span>
      </div>

      {issues.length === 0 ? (
        <p className="panel__empty">没有发现问题。</p>
      ) : (
        <ul className="issue-list">
          {[...errors, ...warnings].map((issue, index) => {
            const nodeId = locateNode(issue, doc)
            return (
              <li key={`${issue.code}-${index}`} data-level={issue.level}>
                <button
                  type="button"
                  className="issue-list__row"
                  disabled={nodeId === null}
                  onClick={() => nodeId && select([nodeId])}
                  title={nodeId ? '选中相关对象' : '该问题不指向某个具体对象'}
                >
                  <span className="issue-list__code">{issue.code}</span>
                  <span className="issue-list__msg">{issue.message}</span>
                  {issue.path && <code className="issue-list__path">{issue.path}</code>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * The node an issue is about, if any.
 *
 * Two sources, in order of confidence: a broken reference names its target directly, and
 * otherwise the bracketed path — `nodes[3].assetRef` — gives an index into the array.
 * Derived here rather than by widening `IntegrityIssue`, so the check itself stays free
 * of anything the UI needs.
 */
export function locateNode(issue: IntegrityIssue, doc: SceneDocument): string | null {
  if (issue.refKind === 'node' && issue.refId && doc.nodes.some((n) => n.id === issue.refId)) return issue.refId
  const match = /^nodes\[(\d+)\]/.exec(issue.path)
  if (!match) return null
  return doc.nodes[Number(match[1])]?.id ?? null
}
