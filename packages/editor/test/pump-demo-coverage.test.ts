import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ActionRegistry, registerBuiltinActions } from '@w3/core'
import type { Action, SceneDocument } from '@w3/schema'
import { EVENT_TYPES, createPumpDemoDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { CAPABILITY_ENTRIES } from './capability-entries.js'

/**
 * T-285 · 样板工程能力覆盖体检。
 *
 * ## 它答的是一个已经发生过两次的失败
 *
 * v0.5 的 T-137：整套灯光栈建好、测好、全绿——五个灯工厂、阴影管线、IBL、`setLight`、
 * 辅助物、拾取——而**没有一张卡认领「用户怎么建一盏灯」**。`createLightNode` 躺在
 * `@w3/schema` 里零调用者。
 *
 * T-205 的能力入口体检答了「每个能力有没有入口」。这一份答的是**另一半**：
 * 「我们拿去演示与验收的那份工程，把这些能力用上了吗」。一个从没被样板用过的能力，
 * 在验收现场就是一个没人演示得出来的承诺。
 *
 * ## 三条测试，两张豁免表
 *
 * 豁免不是「先放着」——每一条要写清**谁会用到它、什么时候**，并带一个到期版本号，
 * 由 T-205 的 `readExemptions` 机械校验（少于 10 个汉字的理由直接判失败）。
 *
 * ## ⚠ 卡面变异 ① 在 v1.0 不成立
 *
 * 卡面要求「`actionsUsedIn` 改成只看 `rules[].then` → 至少一个只在 sequence 嵌套里出现的
 * 动作必须红」。**v1.0 没有嵌套**：`ActionSchema` 是一个扁平信封 `{ action, params }`，
 * `sequence` / `parallel` 是 `rule.mode` 而不是一种动作。全文档里动作只出现在
 * `rules[].then` 一处。
 *
 * 所以 `actionsUsedIn` 写成**通用遍历**（走整份文档找形如 `{action, params}` 的对象），
 * 不是因为今天需要，而是因为 v1.2 的 flows / pages 会新增动作出现的位置——那时这个
 * 函数不改也仍然是对的，而写死 `rules[].then` 的那一版会静静地漏掉它们。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/* ── 豁免表 ─────────────────────────────────────────────────────────────── */

/**
 * 读一张豁免表。
 *
 * 复用 T-205 的 `readExemptions`（`scripts/lib/exemptions.mjs`）——它是一个纯 ESM 模块，
 * 测试可以直接 import。**不另写一份解析**：另写的那份会与它在「几列」「理由多长」
 * 「到期怎么算」上慢慢分家，而分家的症状是某张表的校验悄悄变松。
 */
async function exemptionsIn(file: string): Promise<{ symbol: string; reason: string; owner: string; expires: string }[]> {
  const { readExemptions } = (await import(
    /* @vite-ignore */ new URL('../../../scripts/lib/exemptions.mjs', import.meta.url).href
  )) as {
    readExemptions: (
      f: string,
      o?: { current?: string; cardExists?: (c: string) => boolean },
    ) => { rows: { symbol: string; reason: string; owner: string; expires: string }[]; problems: { line: number; message: string }[] }
  }
  const backlog = readFileSync(join(ROOT, 'docs', 'TASK_BACKLOG_V1.md'), 'utf8')
  const { rows, problems } = readExemptions(join(ROOT, file), {
    current: 'v1.0',
    cardExists: (card) => backlog.includes(card),
  })
  // 表本身坏掉时先报表的问题，而不是报「覆盖不全」——后者会把人送去看错的地方。
  expect(problems.map((p) => `L${p.line} ${p.message}`), `${file} 的豁免表自身有问题`).toEqual([])
  return rows
}

const EXEMPTIONS_FILE = 'docs/PUMP_DEMO_COVERAGE_ALLOWLIST.md'

/* ── 遍历 ───────────────────────────────────────────────────────────────── */

/** 一个值看起来是不是一条动作。 */
const isAction = (v: unknown): v is Action =>
  typeof v === 'object' && v !== null && typeof (v as { action?: unknown }).action === 'string' && 'params' in v

/**
 * 样板工程里用到的全部动作类型。
 *
 * **通用遍历，不是 `rules.flatMap(r => r.then)`。** v1.0 里两者等价（动作只出现在
 * `rules[].then`），而 v1.2 的 flows / pages 会新增动作出现的位置——写死路径的那一版
 * 那天会静静地漏掉它们，而这份体检的全部价值就是「不漏」。
 */
function actionsUsedIn(doc: SceneDocument): Set<string> {
  const found = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value !== 'object' || value === null) return
    if (isAction(value)) found.add(value.action)
    for (const item of Object.values(value)) walk(item)
  }
  walk(doc)
  return found
}

/** 样板工程里用到的全部事件类型（规则的触发器）。 */
const eventsUsedIn = (doc: SceneDocument): Set<string> => new Set(doc.rules.map((r) => r.when.event))

/** 样板工程里**偏离了默认值**的 `meta.**` 叶子路径。 */
function fieldsUsedIn(doc: SceneDocument, reference: SceneDocument): Set<string> {
  const found = new Set<string>()
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (typeof a === 'object' && a !== null && !Array.isArray(a)) {
      for (const key of Object.keys(a)) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown> | undefined)?.[key], `${path}.${key}`)
      return
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) found.add(path)
  }
  walk(doc.meta, reference.meta, 'meta')
  return found
}

/* ── 三条测试 ───────────────────────────────────────────────────────────── */

const demo = createPumpDemoDocument()
const registered = registerBuiltinActions(new ActionRegistry())
  .all()
  .map((d) => d.type)

describe('T-285 · 样板工程演示了每一个动作', () => {
  it('遍历不是空跑的 —— 注册表与样板都真的读到了东西', () => {
    // D36 M6：一个匹配不到东西的遍历会报告零违规，而零违规看起来像成功。
    expect(registered.length).toBeGreaterThanOrEqual(18)
    expect(actionsUsedIn(demo).size).toBeGreaterThanOrEqual(8)
  })

  it('**样板里用到的每个动作都在注册表里**', async () => {
    // 反向的这一条是 T-284 查出来的：T-283 的样板用了一个叫 `setViewpoint` 的动作，
    // 而**那个动作根本不存在**（注册表里是 `moveCamera`）。而 `checkIntegrity` 对它
    // 零 error —— 完整性检查不查动作类型存不存在。这里补上。
    const used = [...actionsUsedIn(demo)]
    const bogus = used.filter((a) => !registered.includes(a))
    expect(bogus, `样板里这些动作不存在：${bogus.join(', ')}`).toEqual([])
  })

  it('注册表里的每个动作都被样板演示过（或写进豁免表）', async () => {
    const used = actionsUsedIn(demo)
    const exempt = new Set((await exemptionsIn(EXEMPTIONS_FILE)).map((r) => r.symbol))
    const missing = registered.filter((type) => !used.has(type) && !exempt.has(`action:${type}`))
    expect(missing, `这些动作没有被样板工程演示过：${missing.map((m) => `action:${m}`).join(', ')}`).toEqual([])
  })
})

describe('T-285 · 样板工程演示了每一种事件', () => {
  it('注册的每种事件都被样板用过（或写进豁免表）', async () => {
    const used = eventsUsedIn(demo)
    const exempt = new Set((await exemptionsIn(EXEMPTIONS_FILE)).map((r) => r.symbol))
    const missing = EVENT_TYPES.filter((type) => !used.has(type) && !exempt.has(`event:${type}`))
    expect(missing, `这些事件没有被样板工程用过：${missing.map((m) => `event:${m}`).join(', ')}`).toEqual([])
  })
})

describe('T-285 · 样板工程不是一堆几何', () => {
  /**
   * T-242 把覆盖面从「动作 / 事件」推到了「可编辑字段」，理由是 `meta.background.color`
   * 这类字段**既不是动作也不是事件**——只看前两者的表对它完全失明，而它在文档里、
   * 运行时读它、导出用它、体检提它，13 份设计零认领。
   *
   * 这一条防的是另一个方向：样板退化成一堆几何。一份只有节点、什么场景设置都没动过的
   * 样板，前两条照样全绿。
   */
  it('样板动过的 `meta.**` 字段占清单的比例够高', () => {
    // 只数**用户真的能在面板上动**的那些：`selector: null` 的行是清单自己标注的
    // 「刻意不可创建」（createdAt / updatedAt / unit / upAxis / hdriAssetId），
    // 把它们算进分母等于要求样板去演示几个没有控件的字段。
    const listed = CAPABILITY_ENTRIES.filter((e) => e.capability.startsWith('field:') && e.selector !== null).map((e) =>
      e.capability.slice('field:'.length),
    )
    expect(listed.length, '可编辑字段清单不该是空的').toBeGreaterThanOrEqual(12)

    // 与「刚建出来的空文档」比：偏离默认值的字段，才算这份样板真的用上了它。
    const touched = fieldsUsedIn(demo, { ...demo, meta: EMPTY_META })
    const covered = listed.filter((path) => touched.has(path))
    expect(
      covered.length,
      `样板只动过 ${covered.length}/${listed.length} 个可编辑字段：${listed.filter((p) => !touched.has(p)).join(', ')}`,
    ).toBeGreaterThanOrEqual(8)
  })
})

/**
 * 一份「什么都没设过」的 meta，用来判断样板到底动过哪些字段。
 *
 * 手写而不是 `createEmptyDocument().meta`：后者带着两个时间戳，而时间戳每次都不同，
 * 会让「动过的字段」永远包含 `meta.createdAt` / `meta.updatedAt`——两个谁也没在面板上
 * 动过的字段。
 */
const EMPTY_META = {
  unit: 'm',
  upAxis: 'Y',
  createdAt: demo.meta.createdAt,
  updatedAt: demo.meta.updatedAt,
  background: { type: 'color', color: '#1a1a1a' },
  environment: { hdriAssetId: null, intensity: 1, exposure: 1 },
  fog: { enabled: false, type: 'linear', color: '#1a1a1a', near: 10, far: 100, density: 0.02 },
  effects: { outline: { enabled: false, color: '#ffb020', widthPx: 3, strength: 3, hiddenEdge: 'dim' } },
} as unknown as SceneDocument['meta']
