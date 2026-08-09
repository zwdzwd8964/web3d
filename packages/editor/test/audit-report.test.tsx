// @vitest-environment jsdom
import type { AssetAudit, AssetOrigin } from '@w3/schema'
import { METRICS } from '@w3/core'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditReport } from '../src/panels/AuditReport.jsx'
import { auditMarkdown, auditRows } from '../src/lib/audit-markdown.js'

/**
 * T-260 · 体检报告呈现。
 *
 * ## 卡面为什么点名这三条「最容易写成假绿」
 *
 * 旧实现里，**「表格渲染出来了」为真，而「表格渲染的是对的东西」为假**——首列写的是
 * `textureBytes` 这种裸标识符（`METRICS` 里明明有 `label: '贴图显存占用'`），
 * 数值写的是 `62914560`（而不是 `60 MB`），一句话结论 `summary` 算得好好的、从来没人
 * 显示过。一条「报告出现在 DOM 里」的断言对这三件事全部无感。
 *
 * 所以下面的断言都不是「有没有」，而是**「是不是那个东西」**：正则扫首列不许有裸标识符、
 * 数值列不许有四位以上的裸数字、`summary` 的原文必须出现。
 */

const REPORT_METRICS = ['bytes', 'tris', 'textureBytes', 'materials'] as const

function auditOf(overrides: Partial<Record<(typeof REPORT_METRICS)[number], number>> = {}): AssetAudit {
  return {
    checkedAt: '2026-08-05T00:00:00.000Z',
    policyId: 'default',
    findings: REPORT_METRICS.map((metric) => {
      const spec = METRICS.find((m) => m.metric === metric)
      if (!spec) throw new Error(`METRICS 里没有 ${metric}，这份 fixture 的前提垮了`)
      const value = overrides[metric] ?? 1024
      return { metric, value, limit: 62_914_560, level: 'pass' as const, advice: '无需处理' }
    }),
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(node: React.ReactNode): void {
  act(() => root.render(node))
}

const textsOf = (selector: string) => [...host.querySelectorAll(selector)].map((el) => el.textContent ?? '')

describe('T-260 · 首列是中文，不是裸标识符', () => {
  it('每一行的项目名都能在 METRICS 里找到对应的 label', () => {
    render(<AuditReport name="pump.glb" summary="体检通过。" audit={auditOf()} mode="view" />)

    const labels = textsOf('[data-testid="audit-label"]')
    expect(labels).toHaveLength(REPORT_METRICS.length)
    for (const label of labels) {
      // 卡面点名的那条正则：`textureBytes` / `bytes` 这种驼峰裸标识符一个都不许有。
      expect(/^[a-z][A-Za-z]+$/.test(label), `首列出现了裸标识符：${label}`).toBe(false)
      expect(METRICS.some((m) => m.label === label), `「${label}」不在 METRICS 的中文名里`).toBe(true)
    }
  })

  it('METRICS 里查不到时退回标识符 —— 而那是一眼可见的失败，不是兜底', () => {
    const rogue: AssetAudit = {
      checkedAt: '2026-08-05T00:00:00.000Z',
      policyId: 'default',
      findings: [{ metric: 'somethingNobodyRegistered', value: 1, limit: 2, level: 'pass', advice: '' }],
    }
    // 一行英文混在中文表里一眼就能看见，而它意味着 METRICS 与体检结论对不上了。
    expect(auditRows(rogue)[0]?.label).toBe('somethingNobodyRegistered')
  })
})

describe('T-260 · 数值列带单位，不是裸数字', () => {
  it('60 MB 而不是 62914560', () => {
    render(<AuditReport name="pump.glb" summary="体检通过。" audit={auditOf({ bytes: 62_914_560 })} mode="view" />)

    const values = textsOf('[data-testid="audit-value"]')
    expect(values.some((v) => v.includes('MB')), '文件大小应当带单位').toBe(true)
    for (const value of values) {
      // 卡面点名的那条正则。`62914560` 与 `60 MB` 是同一个数，但只有后者能让人
      // 判断「这算大吗」。
      expect(/^\d{4,}$/.test(value.trim()), `数值列出现了裸数字：${value}`).toBe(false)
    }
  })

  it('像素类的数值带 px', () => {
    const audit: AssetAudit = {
      checkedAt: '2026-08-05T00:00:00.000Z',
      policyId: 'default',
      findings: [{ metric: 'maxTextureSize', value: 4096, limit: 4096, level: 'pass', advice: '' }],
    }
    expect(auditRows(audit)[0]?.value).toContain('px')
  })
})

describe('T-260 · summary 真的渲染出来', () => {
  it('原文出现在 DOM 里', () => {
    // 它是零调用者清单上的一条：算得好好的，从来没人显示过。
    const summary = '体检通过，但 2 项接近上限：三角面数、贴图数量。'
    render(<AuditReport name="pump.glb" summary={summary} audit={auditOf()} mode="view" />)
    expect(host.querySelector('[data-testid="audit-summary"]')?.textContent).toBe(summary)
  })
})

describe('T-260 · origin 决定表格是几列', () => {
  const origin = (value: number): AssetOrigin => ({
    hash: 'sha256:' + 'a'.repeat(64),
    bytes: value,
    stats: { bytes: value, tris: 0, materials: 0, textures: 0, textureBytes: 0, nodes: 0, animations: [], clipDurations: {} },
    audit: {
      checkedAt: '2026-08-04T00:00:00.000Z',
      policyId: 'default',
      findings: [{ metric: 'bytes', value, limit: 62_914_560, level: 'pass', advice: '' }],
    },
  })

  it('缺席时只有一列「实测」，没有空着的「送检」', () => {
    render(<AuditReport name="pump.glb" summary="通过。" audit={auditOf()} mode="view" />)
    const heads = textsOf('.report__table th')
    expect(heads).toEqual(['项目', '实测', '上限', '结论', '建议'])
    expect(heads).not.toContain('送检')
  })

  it('存在时变成「送检 / 处理后」两列', () => {
    render(
      <AuditReport
        name="pump.glb"
        summary="通过。"
        audit={auditOf({ bytes: 10_485_760 })}
        origin={origin(62_914_560)}
        mode="view"
      />,
    )
    const heads = textsOf('.report__table th')
    expect(heads).toEqual(['项目', '送检', '处理后', '上限', '结论', '建议'])
    // 送检 60 MB → 处理后 10 MB，两个数都在，且都带单位。
    expect(host.textContent).toContain('60.0 MB')
    expect(host.textContent).toContain('10.0 MB')
  })
})

describe('T-260 · 两种用法', () => {
  it('只读模式没有会改文档的按钮', () => {
    render(<AuditReport name="pump.glb" summary="通过。" audit={auditOf()} mode="view" />)
    const buttons = textsOf('button')
    expect(buttons).not.toContain('确认导入')
    expect(buttons).not.toContain('仍然导入')
    expect(buttons).toContain('关闭')
  })

  it('确认模式下超标时按钮改成「仍然导入」', () => {
    render(<AuditReport name="pump.glb" summary="超标。" audit={auditOf()} mode="confirm" failed />)
    expect(textsOf('button')).toContain('仍然导入')
    expect(host.textContent).toContain('不作为验收依据')
  })

  it('只读模式的两句话（T-261 的收检 / 重算结论）渲染成两行', () => {
    render(
      <AuditReport
        name="pump.glb"
        summary="通过。"
        audit={auditOf()}
        mode="view"
        notes={['收检时（2026-08-04）：体检通过。', '按当前阈值重算：1 项超标。']}
      />,
    )
    expect(textsOf('[data-testid="audit-note"]')).toHaveLength(2)
  })
})

describe('T-260 · 复制为 Markdown', () => {
  it('解析回来的行数与结论和表格一致', async () => {
    const audit = auditOf({ bytes: 62_914_560 })
    const markdown = auditMarkdown({ name: 'pump.glb', summary: '体检通过。', audit })

    const bodyRows = markdown
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .slice(2) // 表头 + 分隔行
    expect(bodyRows).toHaveLength(audit.findings.length)

    // 逐行比对，而不是只数行数：行数对得上但内容错位是这类导出最常见的缺陷。
    const rows = auditRows(audit)
    bodyRows.forEach((line, i) => {
      const cells = line.split('|').map((c) => c.trim())
      expect(cells[1]).toBe(rows[i]!.label)
      expect(cells[2]).toBe(rows[i]!.value)
      // 五列表：cells[0] 是行首竖线前的空串，结论落在 [4]。
      expect(cells[4]).toBe(rows[i]!.verdict)
    })
  })

  it('origin 存在时 Markdown 也变六列，与屏幕同步', () => {
    const markdown = auditMarkdown({
      name: 'pump.glb',
      summary: '通过。',
      audit: auditOf({ bytes: 10_485_760 }),
      origin: {
        hash: 'sha256:' + 'a'.repeat(64),
        bytes: 62_914_560,
        stats: { bytes: 62_914_560, tris: 0, materials: 0, textures: 0, textureBytes: 0, nodes: 0, animations: [], clipDurations: {} },
        audit: {
          checkedAt: '2026-08-04T00:00:00.000Z',
          policyId: 'default',
          findings: [{ metric: 'bytes', value: 62_914_560, limit: 62_914_560, level: 'pass', advice: '' }],
        },
      },
    })
    expect(markdown).toContain('| 项目 | 送检 | 处理后 | 上限 | 结论 | 建议 |')
  })

  it('建议里的管道符被转义，表格不会被切开', () => {
    const audit: AssetAudit = {
      checkedAt: '2026-08-05T00:00:00.000Z',
      policyId: 'default',
      findings: [{ metric: 'bytes', value: 1, limit: 2, level: 'pass', advice: '用 A | B 任一方式处理' }],
    }
    const line = auditMarkdown({ name: 'x', summary: 's', audit }).split('\n').find((l) => l.includes('用 A'))!
    // 转义是给 **Markdown 渲染器** 看的：`\|` 在表格单元格里是一个字面竖线，不再是列分隔符。
    // `String.split('|')` 不认转义，所以这里断的是转义序列本身，而不是切出来几段。
    expect(line).toContain('用 A \\| B')
    expect(line.match(/(?<!\\)\|/g), '未转义的竖线只该是六个列分隔符').toHaveLength(6)
  })

  it('按钮把 Markdown 交给注入的写入口', async () => {
    const written: string[] = []
    render(
      <AuditReport
        name="pump.glb"
        summary="通过。"
        audit={auditOf()}
        mode="view"
        writeClipboard={async (text) => void written.push(text)}
      />,
    )
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="audit-copy"]')!.click()
    })
    expect(written).toHaveLength(1)
    expect(written[0]).toContain('资产体检')
    expect(host.querySelector('[data-testid="audit-copy"]')?.textContent).toBe('已复制')
  })
})
