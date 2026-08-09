import type { AssetAudit, AssetOrigin } from '@w3/schema'
import { useState } from 'react'
import { auditMarkdown, auditRows } from '../lib/audit-markdown.js'

/**
 * T-260 · 资产体检报告，一份组件两种用法。
 *
 * ## 这张卡改的三件事，每一件都是「渲染出来了」与「渲染的是对的东西」之间的差
 *
 * 1. **首列是中文项目名，不是 `finding.metric` 那个裸标识符。** 原来那张表第一列写的是
 *    `textureMemoryBytes`，而 `METRICS` 里早就有 `label: '贴图显存占用'`。用户看不懂的表
 *    和没有表的区别，只在于前者让人以为自己看过了。
 * 2. **数值走 `formatMetric`，不是 `toLocaleString`。** `62914560` 与 `60 MB` 是同一个数，
 *    但只有后者能让人判断「这算大吗」。
 * 3. **`AuditResult.summary` 真的渲染出来。** 它是零调用者清单上的一条——一句话总结算得
 *    好好的，从来没人显示过。
 *
 * 三条在旧实现下都是「表格渲染出来了」为真而「渲染的是对的东西」为假，所以卡面点名它们
 * 是最容易写成假绿的地方。
 *
 * ## 两种用法
 *
 * - `mode: 'confirm'` —— 导入前确认，带「取消 / 确认导入」。
 * - `mode: 'view'` —— 只读查看（T-261 的重新体检），没有会改文档的按钮。
 */

export type AuditReportMode = 'confirm' | 'view'

export interface AuditReportProps {
  readonly name: string
  readonly summary: string
  readonly audit: AssetAudit
  /** 送检时的原始记录。**给了它，表格变「送检 / 处理后」两列**（v1.5 转码用，此处先建）。 */
  readonly origin?: AssetOrigin
  readonly mode: AuditReportMode
  /** 只读模式下顶部的两句话（T-261 的「收检时结论 / 当前阈值重算结论」）。 */
  readonly notes?: readonly string[]
  readonly failed?: boolean
  readonly onConfirm?: () => void
  readonly onCancel?: () => void
  readonly children?: React.ReactNode
  /** 注入的剪贴板写入口，便于在 Node 里测。生产传 `navigator.clipboard.writeText`。 */
  readonly writeClipboard?: (text: string) => Promise<void>
}

export function AuditReport(props: AuditReportProps) {
  const { name, summary, audit, origin, mode } = props
  const rows = auditRows(audit, origin)
  const hasOrigin = rows.some((row) => row.origin !== null)
  const [copied, setCopied] = useState(false)

  const copy = () => {
    const text = auditMarkdown({ name, summary, audit, ...(origin ? { origin } : {}) })
    const write = props.writeClipboard ?? ((t: string) => navigator.clipboard.writeText(t))
    void write(text).then(
      () => setCopied(true),
      // 复制失败要说出来。默默什么都不发生，用户会以为复制成功了然后贴出一片空白。
      () => setCopied(false),
    )
  }

  return (
    <div className="report" data-testid="audit-report">
      <h3>{name}</h3>
      {/* 全仓第一次渲染 `summary`。它一直算得好好的，从来没人显示过。 */}
      <p className="report__summary" data-testid="audit-summary">
        {summary}
      </p>

      {props.notes?.map((note) => (
        <p key={note} className="hint" data-testid="audit-note">
          {note}
        </p>
      ))}

      <table className="report__table">
        <thead>
          <tr>
            <th>项目</th>
            {/* origin 缺席时**只有一列「实测」**——空着一列「送检」比没有这一列更难读。 */}
            {hasOrigin ? <th>送检</th> : null}
            <th>{hasOrigin ? '处理后' : '实测'}</th>
            <th>上限</th>
            <th>结论</th>
            <th>建议</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.metric} data-level={audit.findings.find((f) => f.metric === row.metric)?.level}>
              <td data-testid="audit-label">{row.label}</td>
              {hasOrigin ? <td className="num">{row.origin ?? '—'}</td> : null}
              <td className="num" data-testid="audit-value">
                {row.value}
              </td>
              <td className="num">{row.limit}</td>
              <td>{row.verdict}</td>
              <td>{row.advice}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {props.children}

      <div className="report__actions">
        <button type="button" className="tbtn" data-testid="audit-copy" onClick={copy}>
          {copied ? '已复制' : '复制为 Markdown'}
        </button>
        {mode === 'confirm' && (
          <>
            <button type="button" className="tbtn" onClick={props.onCancel}>
              取消
            </button>
            <button type="button" className="tbtn tbtn--primary" onClick={props.onConfirm}>
              {props.failed ? '仍然导入' : '确认导入'}
            </button>
          </>
        )}
        {mode === 'view' && (
          <button type="button" className="tbtn" onClick={props.onCancel}>
            关闭
          </button>
        )}
      </div>

      {mode === 'confirm' && props.failed && (
        <p className="panel__note panel__note--warn">
          该资产未通过体检。仍可导入，但性能验收以《附件A》规格为前提，超标资产的表现不作为验收依据。
        </p>
      )}
    </div>
  )
}
