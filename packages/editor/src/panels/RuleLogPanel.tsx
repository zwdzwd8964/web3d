import type { ExecResult, ExecStatus } from '@w3/core'
import { usePreview } from '../preview/PreviewContext.jsx'
import { useDocumentSelector } from '../store/StoreContext.js'

/**
 * T-093 · the rule execution log.
 *
 * `ExecResult` is specified (ECA_SPEC §5.4) as complete and deterministic precisely so
 * that three consumers can share it: this panel, the parity comparison (T-103) and the
 * generated acceptance cases (§8). This is the first of the three, and it is what turns
 * "the rule didn't fire" from a guess into a reading.
 *
 * The skip reasons matter most. A rule that was skipped by its condition and a rule that
 * was skipped by its re-entry policy look identical from the outside — nothing happened —
 * and they need completely different fixes.
 */

const STATUS_LABELS: Record<ExecStatus, string> = {
  completed: '完成',
  aborted: '被中断',
  failed: '失败',
  'skipped-condition': '条件不满足，跳过',
  'skipped-reentry': '上一次未结束，按重入策略跳过',
}

export function RuleLogPanel() {
  const active = usePreview((s) => s.active)
  const log = usePreview((s) => s.log)
  const clearLog = usePreview((s) => s.clearLog)
  const rules = useDocumentSelector((s) => s.doc.rules)

  const nameOf = (ruleId: string) => rules.find((r) => r.id === ruleId)?.name ?? ruleId

  return (
    <div className="subpanel">
      <div className="subpanel__head">
        规则日志<span className="num">{log.length}</span>
        <button type="button" className="tbtn" onClick={clearLog} disabled={log.length === 0}>
          清空
        </button>
        {!active && <span className="panel__hint">进入预览模式后，规则执行会记录在这里</span>}
      </div>

      {log.length === 0 ? (
        <p className="panel__empty">{active ? '还没有规则被触发。试着点一下场景里的对象。' : '未在预览中。'}</p>
      ) : (
        <ul className="log-list">
          {/* Newest first: during a debugging session the last thing that happened is the
              thing being looked for, and scrolling to the bottom every time is friction. */}
          {[...log].reverse().map((result, index) => (
            <li key={`${result.ruleId}-${result.startedAt}-${index}`} data-status={result.status}>
              <div className="log-list__head">
                <b>{nameOf(result.ruleId)}</b>
                <span className="log-list__status">{STATUS_LABELS[result.status]}</span>
                <span className="num">{duration(result)} ms</span>
              </div>
              {result.steps.length > 0 && (
                <ol className="log-list__steps">
                  {result.steps.map((step) => (
                    <li key={step.index} data-status={step.status}>
                      <code>{step.action}</code>
                      <span>{step.status === 'ok' ? '✓' : step.status === 'skipped' ? '跳过' : '✕'}</span>
                      {step.error && <span className="log-list__error">{step.error}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const duration = (result: ExecResult) => Math.max(0, Math.round(result.endedAt - result.startedAt))
