import type { AssetAudit, AssetOrigin, AuditFinding } from '@w3/schema'
import { METRICS, formatMetric } from '@w3/core'

/**
 * T-260 · 体检报告的 Markdown 形态。
 *
 * 「复制为 Markdown」这个按钮的真实用途是**把结论贴进工单或群里**。所以这份输出要能被
 * 对方原样读懂：中文项目名、带单位的数值、明确的结论词——与屏幕上那张表一字不差。
 *
 * 与表格共用同一套取数函数（`labelOf` / `valueOf` / `verdictLabel`），不是各写一遍。
 * 两份实现会分叉，而分叉的那一天，贴出去的数字和屏幕上的不一样，没有人会发现。
 */

/** 一行的四个数据格子，表格与 Markdown 都从这里取。 */
export interface AuditRow {
  readonly metric: string
  /** 中文项目名。**永远不是 `finding.metric` 那个裸标识符。** */
  readonly label: string
  /** 带单位的实测值，如 `12.4 MB` / `1,024 px`。 */
  readonly value: string
  readonly limit: string
  readonly verdict: string
  readonly advice: string
  /** `origin` 存在时的送检原值；没有转码留痕时是 null。 */
  readonly origin: string | null
}

const VERDICTS: Record<AuditFinding['level'], string> = { pass: '通过', warn: '接近上限', fail: '超标' }

/** `METRICS` 里那条 metric 的中文名与单位。查不到时退回标识符本身，但那是 bug 的信号。 */
function specOf(metric: string) {
  return METRICS.find((m) => m.metric === metric)
}

/**
 * 把一份体检结论摊成表格行。
 *
 * @param origin 送检时的原始记录（v1.5 转码用）。给了它，每一行多一个「送检」值；
 *   没给，`origin` 一律是 null，调用方据此决定表头是四列还是五列。
 */
export function auditRows(audit: AssetAudit, origin?: AssetOrigin): AuditRow[] {
  return audit.findings.map((finding) => {
    const spec = specOf(finding.metric)
    const unit = spec?.unit ?? 'count'
    const before = origin?.audit?.findings.find((f) => f.metric === finding.metric)
    return {
      metric: finding.metric,
      // 退回标识符是**可见的失败**，不是兜底：一行英文混在中文表里一眼就能看见，
      // 而它意味着 METRICS 与体检结论对不上了。
      label: spec?.label ?? finding.metric,
      value: formatMetric(finding.value, unit),
      limit: formatMetric(finding.limit, unit),
      verdict: VERDICTS[finding.level],
      advice: finding.advice,
      origin: before ? formatMetric(before.value, unit) : null,
    }
  })
}

/**
 * 整份报告的 Markdown。
 *
 * 表格列数随 `origin` 变，与屏幕上那张表同步——两处分别判断的话，贴出去的表和看到的表
 * 会在转码上线那天开始不一样。
 */
export function auditMarkdown(input: {
  readonly name: string
  readonly summary: string
  readonly audit: AssetAudit
  readonly origin?: AssetOrigin
}): string {
  const rows = auditRows(input.audit, input.origin)
  const hasOrigin = rows.some((r) => r.origin !== null)
  const head = hasOrigin ? ['项目', '送检', '处理后', '上限', '结论', '建议'] : ['项目', '实测', '上限', '结论', '建议']

  const lines = [
    `## ${input.name} · 资产体检`,
    '',
    input.summary,
    '',
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => {
      const cells = hasOrigin
        ? [row.label, row.origin ?? '—', row.value, row.limit, row.verdict, row.advice]
        : [row.label, row.value, row.limit, row.verdict, row.advice]
      // 建议里出现管道符会把表格切开。转义而不是删掉——建议是给人看的，少一个字就少一句话。
      return `| ${cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`
    }),
  ]
  return `${lines.join('\n')}\n`
}
