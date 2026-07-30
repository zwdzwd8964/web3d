import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'

/**
 * T-071 · the history panel.
 *
 * Its real job is not convenience — it is making the undo stack VISIBLE. MVP_V0 D2's
 * acceptance bar is "one gizmo drag leaves exactly one entry", and nobody can check that
 * against an invisible stack. With the panel open, a drag that produces sixty entries is
 * obvious the moment it happens rather than three milestones later.
 *
 * Jumping to a point is implemented as repeated undo/redo rather than as a direct seek:
 * the stacks are the single source of truth for what has been applied, and a separate
 * seek path would be a second implementation of the same thing, free to disagree.
 */
export function HistoryPanel() {
  const entries = useDocumentSelector((s) => s.history.entries)
  const redoEntries = useDocumentSelector((s) => s.history.redoEntries)
  const canUndo = useDocumentSelector((s) => s.canUndo)
  const canRedo = useDocumentSelector((s) => s.canRedo)
  // Read so the panel re-renders when the stacks move; the arrays above are mutated in
  // place by the History object and would not trip a reference check on their own.
  useDocumentSelector((s) => s.historyDepth)
  useDocumentSelector((s) => s.revision)

  const { undo, redo, clearHistory } = useDocumentActions()

  const undoTo = (index: number) => {
    for (let i = entries.length - 1; i >= index; i--) undo()
  }
  const redoTo = (index: number) => {
    // redoEntries is a stack: its LAST element is the next one to be re-applied.
    for (let i = redoEntries.length - 1; i >= index; i--) redo()
  }

  return (
    <div className="subpanel">
      <div className="subpanel__head">
        历史
        <span className="num">{entries.length}</span>
        <button type="button" className="tbtn" onClick={undo} disabled={!canUndo}>
          撤销
        </button>
        <button type="button" className="tbtn" onClick={redo} disabled={!canRedo}>
          重做
        </button>
        <button type="button" className="tbtn" onClick={clearHistory} disabled={!canUndo && !canRedo}>
          清空
        </button>
      </div>

      {entries.length === 0 && redoEntries.length === 0 ? (
        <p className="panel__empty">还没有可撤销的操作</p>
      ) : (
        <ol className="history-list">
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <button type="button" className="history-list__entry" onClick={() => undoTo(index)} title="撤销到这一步之前">
                <span className="history-list__label">{entry.label}</span>
                {/* The patch count is the D2 tell: a drag that shows 60 here did not
                    collapse, and the property panel or gizmo wiring is at fault. */}
                <span className="num history-list__count">{entry.patches.length}</span>
              </button>
            </li>
          ))}
          {[...redoEntries].reverse().map((entry, i) => {
            const index = redoEntries.length - 1 - i
            return (
              <li key={`redo-${entry.at}-${index}`} className="history-list__redo">
                <button type="button" className="history-list__entry" onClick={() => redoTo(index)} title="重做到这一步">
                  <span className="history-list__label">{entry.label}</span>
                  <span className="num history-list__count">{entry.patches.length}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
