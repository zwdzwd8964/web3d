import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ConditionSchema, EVENT_PAYLOAD_KEYS, EVENT_TYPES } from '../src/rule.js'
import { ID_COLLECTION_NAMES } from '../src/document.js'
import { OVERLAY_TYPES } from '../src/page.js'
import { PREFIXES } from '../src/id.js'
import type { SceneDocument } from '../src/document.js'
import { SceneDocumentSchema } from '../src/document.js'
import { checkIntegrity, errorsOf } from '../src/integrity.js'
import { walkShape } from './shape-walk.js'
import V2_SHAPE from './fixtures/v2-shape.json'

/**
 * T-225 · **the reverse comparison — `SCHEMA_V3_FREEZE.md` 的唯一机器落点。**
 *
 * T-206 produced a 98-row table that six people signed. Everything else about that table is
 * prose: a signature does not execute, and a table nobody reads back drifts the moment the
 * first field is typed. §2 of the document says so in as many words: 「这一节是本表唯一的
 * 机器落点」.
 *
 * **This test is that landing point, and it is not decoration** — writing it caught two live
 * divergences in the signed zone: `HIDDEN_EDGE_MODES` had been implemented as
 * `['hidden','dashed','solid']`/`'hidden'` against a frozen `['hide','dim','show']`/`'dim'`,
 * and `outline.strength` defaulted to `1.5` against a frozen `3`. Both compiled, both
 * validated, both round-tripped through migration, and every one of the 254 other schema
 * tests was green. Nothing but reading the table back could have found them.
 *
 * ## Why a baseline file
 *
 * 「本次新增字段数」 has no meaning without v2 to subtract. `fixtures/v2-shape.json` is the
 * field-path set of `SceneDocumentSchema` **as it stood on `main` before this card**, walked
 * by the same `walkShape` used here and committed once. v2 is frozen history, so the file is
 * a constant, not a snapshot that needs refreshing — if it ever needs regenerating, the
 * schema has been rewritten and this test should be rewritten with it.
 *
 * ## Why coverage-by-prefix rather than equal counts
 *
 * The card words it as 「表内字段数 === 本次新增字段数」. Taken as two integers that is
 * 98 vs 197 and it can never hold, for a reason that is correct rather than a bug: the walk
 * re-enters `NodeSchema` and `MaterialSchema` through the new `prefabs[]` collection, so
 * `prefabs[].nodes[].transform.p` shows up as "new" while being an old field reached by a
 * new road. The table declares `prefabs` once and is right to.
 *
 * So the equality is between **sets**, with a row covering a path when it names that path or
 * a prefix of it. Both directions are asserted, and both matter:
 *   - 表 → 码：a row naming a field that does not exist = the table describes fiction.
 *   - 码 → 表：a new field no row covers = something was added without being signed for,
 *     which is exactly 铁律 8 的 stop condition.
 */

const FREEZE_MD = fileURLToPath(new URL('../../../docs/SCHEMA_V3_FREEZE.md', import.meta.url))

/* ========================================================================== */
/* the parser                                                                 */
/* ========================================================================== */

/**
 * What the 形状 / 裁决 columns say should be true of a row's paths.
 *
 * `retyped` is the one that is easy to miss and the reason this is five values rather than
 * four: `flows[].variableId` went `z.string()` → `VariableIdSchema` and `pages[].name` went
 * `z.string()` → `z.string().min(1)`. Both rows read like additions and neither is one — the
 * fields have been there since v0. Filing them as `added` would make direction 二 accept a
 * new field hiding behind either name.
 */
type Verdict = 'added' | 'absent' | 'removed' | 'unchanged' | 'retyped'

interface Row {
  readonly section: string
  /** 第一列, backticks stripped, one entry per path the row names. */
  readonly names: readonly string[]
  readonly shape: string
  readonly verdict: Verdict
  /**
   * True when `names` came from parsing the 形状 cell's `z.object({…})` rather than the
   * 第一列 — the `EventDescriptor` / `Condition` rows. Those paths live in a discriminated
   * union, where branches legitimately share key names with branches that already existed
   * (`rules[].if[].value` is in every condition), so they are checked for existence but not
   * for novelty.
   */
  readonly derived: boolean
}

/**
 * Classify a row by its 形状 and 裁决 columns.
 *
 * All five verdicts are load-bearing and machine-checkable, which is what makes the table
 * worth parsing at all — 「不采纳」 rows are the ones that decay silently, because nothing
 * anywhere else in the repo ever mentions a field that was decided against.
 */
function classify(shape: string, ruling: string): Verdict {
  const bare = shape.replace(/\*/g, '').trim()
  if (bare.startsWith('删除')) return 'removed'
  if (/^(不采纳|不加|永不定义|永不新增)/.test(bare)) return 'absent'
  if (/^(不改|一个字节都不改|形状不变)/.test(bare)) return 'unchanged'
  // 「`VariableIdSchema`（原 `z.string()`）」—— 收紧，不是新增
  if (bare.includes('（原')) return 'retyped'
  // 「**字段保留**，永不获得运行时」—— `steps[].onEnter` 自 v0 就在，本行改的是 `.describe()`
  if (ruling.replace(/\*/g, '').includes('字段保留')) return 'unchanged'
  return 'added'
}

/**
 * Pull the object keys out of a 形状 cell like
 * `z.object({event:z.literal('pageEnter'), pageId:PageIdSchema}).strict()`.
 *
 * Depth-counted rather than split on `,`, because `z.literal('x')` and `z.enum([…])` both
 * contain commas and parens inside the very cells this has to read.
 */
function objectKeys(shape: string): string[] {
  const open = shape.indexOf('z.object({')
  if (open === -1) return []
  let depth = 0
  let body = ''
  for (let i = open + 'z.object('.length; i < shape.length; i++) {
    const ch = shape[i]!
    if ('({['.includes(ch)) depth++
    else if (')}]'.includes(ch)) {
      depth--
      if (depth === 0) break
    }
    body += ch
  }
  const keys: string[] = []
  let depth2 = 0
  let cur = ''
  for (const ch of body.slice(1)) {
    if ('({['.includes(ch)) depth2++
    else if (')}]'.includes(ch)) depth2--
    if (ch === ',' && depth2 === 0) {
      keys.push(cur)
      cur = ''
    } else cur += ch
  }
  keys.push(cur)
  return keys.map((k) => k.split(':')[0]!.replace(/[`\s]/g, '')).filter(Boolean)
}

/**
 * Rows whose 第一列 is a **type or constant name**, not a document path.
 *
 * These are real rows carrying real rulings (`OVERLAY_TYPES` **恒为 4** is R13's whole
 * defence), but they are checked by §2's count assertions below rather than by walking the
 * document shape. Listing them explicitly — rather than "skip anything that fails to
 * resolve" — is deliberate: a silent skip is how a typo'd path becomes an exempt row.
 */
const CONSTANT_ROWS = new Set([
  'ID_COLLECTIONS',
  'PREFIXES',
  'SECTION_SCOPES',
  'EXPLODE_MODES',
  'OverlayIdSchema',
  'OverlaySchema',
  'OVERLAY_TYPES',
  'OVERLAY_TOKENS',
  'EVENT_TYPES',
  'EVENT_PAYLOAD_KEYS',
  'DataSourceAuthSchema 的 kind 枚举成员',
  'AssetOriginSchema 的叶子类型与 ops[] / skipped[] 的元素形状',
  'node 字段',
  'meta 字段',
  'animations[].kind 第三种',
  'constraints',
  'schemaVersion',
  'pages / flows 的「出列」',
  'hotspots[].content.type · NODE_PROP_KEYS · node.parent / node.order',
  'meta.fromTemplate · rules[].template',
])

/**
 * Rows written relative to their own schema rather than to the document root.
 *
 * §1.3 says `node.section` and `section.scope`; the document says `nodes[].section` and
 * `nodes[].section.scope`. The table is easier to read that way and there is no reason to
 * make a human-facing document carry `[]` noise — but the mapping has to be written down
 * somewhere, and here is better than in the document, because here it is executed.
 */
const PREFIX_ALIASES: readonly (readonly [RegExp, string])[] = [
  [/^node\./, 'nodes[].'],
  [/^section\./, 'nodes[].section.'],
  [/^explode\./, 'nodes[].explode.'],
  [/^prefabRef\./, 'nodes[].prefabRef.'],
  [/^prefab\./, 'prefabs[].'],
  [/^map\[\]\./, 'dataSources[].map[].'],
  [/^PageSchema\./, 'pages[].'],
  [/^(text|image|button|panel)\.props\./, 'pages[].overlays[].props.'],
]

const normalise = (name: string): string => {
  for (const [re, to] of PREFIX_ALIASES) if (re.test(name)) return name.replace(re, to)
  return name
}

/**
 * Expand the shorthand the table uses for sibling fields.
 *
 * `` `text.props.text` / `size` / `color` `` means three paths under the same parent, not one
 * path plus two bare words. Five rows are written this way; unfolding them here is what lets
 * `pages[].overlays[].props.align` be covered without the table repeating its prefix.
 */
function expandNames(cell: string): string[] {
  const parts = cell
    // 「`animations[].startS`（仅 `imported`）」—— 括号里是给人看的限定语，不是路径的一部分
    .replace(/（[^）]*）/g, '')
    .split('·')
    .flatMap((p) => p.split('/'))
    .map((p) => p.replace(/`/g, '').trim())
    .filter(Boolean)
  const out: string[] = []
  let parent = ''
  for (const p of parts) {
    if (p.includes('.') || p.includes('[')) {
      out.push(p)
      parent = p.slice(0, p.lastIndexOf('.') + 1)
    } else {
      out.push(parent ? parent + p : p)
    }
  }
  return out
}

function parseFreezeTable(): Row[] {
  const md = readFileSync(FREEZE_MD, 'utf8')
  const rows: Row[] = []
  let section = ''
  for (const line of md.split('\n')) {
    if (line.startsWith('### ')) section = line.slice(4).trim()
    if (!section.startsWith('1') || !line.startsWith('| `')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 3) continue
    const raw = cells[0]!.replace(/`/g, '').trim()
    const shape = cells[1]!
    const verdict = classify(shape, cells[5] ?? '')

    // §1.6 的两类行：第一列是分支名（`EventDescriptor` `pageEnter`），路径藏在形状列的
    // `z.object({…})` 里。从形状列解出来，而不是在这里抄一份——抄一份就又多了一个会漂的副本。
    const isEvent = raw.startsWith('EventDescriptor')
    const isCondition = raw.startsWith('Condition') && verdict !== 'absent'
    if (isEvent || isCondition) {
      const keys = objectKeys(shape).filter((k) => k !== (isEvent ? 'event' : 'op'))
      const names = isEvent
        ? keys.map((k) => `rules[].when.${k}`)
        : keys.flatMap((k) => [`rules[].if[].${k}`, `rules[].ifAny[].${k}`])
      rows.push({ section, names, shape, verdict, derived: true })
      continue
    }

    rows.push({
      section,
      names: CONSTANT_ROWS.has(raw) ? [] : expandNames(cells[0]!).map(normalise),
      shape,
      verdict,
      derived: false,
    })
  }
  return rows
}

/* ========================================================================== */

const V3 = walkShape(SceneDocumentSchema)
const V2 = new Set(V2_SHAPE as string[])
const ADDED = new Set([...V3].filter((p) => !V2.has(p)))
const REMOVED = new Set([...V2].filter((p) => !V3.has(p)))
const ROWS = parseFreezeTable()

describe('SCHEMA_V3_FREEZE.md · 反向比对（T-206 的唯一机器落点）', () => {
  /**
   * The scan-surface floor, D36's M6 shape.
   *
   * Every assertion below is a `for` over parsed rows, and every one of them passes
   * vacuously if the parser returns nothing — a renamed heading, a reformatted table, a
   * moved file, and this whole suite reports green while checking literally nothing. 98 rows
   * today; the floor is the number the document must not quietly fall below.
   */
  it('解析面没有塌：表里至少 90 行、v2 基线至少 250 条路径', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(90)
    expect(V2.size).toBeGreaterThanOrEqual(250)
    expect(V3.size).toBeGreaterThan(V2.size)
    // 四种裁决每一种都真的被解析出来了，否则 classify() 可以整个坏掉而不被发现
    for (const v of ['added', 'absent', 'removed', 'unchanged', 'retyped'] as const) {
      expect(ROWS.filter((r) => r.verdict === v).length, `裁决「${v}」一行都没解析到`).toBeGreaterThan(0)
    }
  })

  /* --- 方向一 · 表 → 码 ---------------------------------------------------- */

  it('表里每一条「新增」行，代码里都真的新增了', () => {
    const bad: string[] = []
    for (const row of ROWS) {
      if (row.verdict !== 'added') continue
      for (const name of row.names) {
        if (!V3.has(name)) bad.push(`${name}（${row.section}）—— 表里有，代码里没有`)
        // 判别联合的分支之间共用键名是合法的（每一支条件都有 `value`），所以从形状列解出来的
        // 那几行只查「在」，不查「新」。第一列直接点名的字段两条都查。
        else if (!row.derived && !ADDED.has(name)) bad.push(`${name}（${row.section}）—— v2 就有了，不是本次新增`)
      }
    }
    expect(bad.join('\n')).toBe('')
  })

  it('表里每一条「不采纳 / 永不定义」行，代码里确实一个字节都没有', () => {
    const bad: string[] = []
    for (const row of ROWS) {
      if (row.verdict !== 'absent') continue
      for (const name of row.names) {
        if (V3.has(name)) bad.push(`${name}（${row.section}）—— 表里写着「${row.shape}」，代码里却有`)
      }
    }
    expect(bad.join('\n')).toBe('')
  })

  it('表里唯一一条「删除」行，v2 有、v3 没有', () => {
    const removedRows = ROWS.filter((r) => r.verdict === 'removed').flatMap((r) => r.names)
    expect(removedRows).toEqual(['viewpoints[].thumbnailUrl'])
    for (const name of removedRows) {
      expect(V2.has(name), `${name} 在 v2 基线里就不存在，这行「删除」是空头支票`).toBe(true)
      expect(V3.has(name), `${name} 说好要删，v3 里还在`).toBe(false)
    }
    // 「本次唯一的字段删除」——这是表里的原话，也是它最容易失守的一句
    expect([...REMOVED]).toEqual(['viewpoints[].thumbnailUrl'])
  })

  it('表里每一条「不改」/「收紧」行，v2 和 v3 里都在', () => {
    const bad: string[] = []
    for (const row of ROWS) {
      if (row.verdict !== 'unchanged' && row.verdict !== 'retyped') continue
      for (const name of row.names) {
        if (!V2.has(name)) bad.push(`${name}（${row.verdict}）—— 说是老字段，可 v2 里就没有`)
        else if (!V3.has(name)) bad.push(`${name}（${row.verdict}）—— 说是老字段，v3 里却没了`)
      }
    }
    expect(bad.join('\n')).toBe('')
  })

  /* --- 方向二 · 码 → 表 ---------------------------------------------------- */

  /**
   * **这一条就是那句「表内字段数 === 本次新增字段数」。**
   *
   * 从表里删掉 `hotspots[].style.label` 那一行，本条转红——这正是 §2 点名的那个变异。
   */
  it('代码里每一个新增字段，表里都有一行签了字', () => {
    const declared = ROWS.filter((r) => r.verdict === 'added').flatMap((r) => r.names)
    const covers = (path: string) => declared.some((d) => path === d || path.startsWith(`${d}.`) || path.startsWith(`${d}[`))
    const orphans = [...ADDED].filter((p) => !covers(p)).sort()
    expect(
      orphans.join('\n'),
      `${orphans.length} 个字段进了 schema 却没进冻结表 —— 要么补表并重新签字，要么删字段（铁律 8）`,
    ).toBe('')
  })

  /* --- §2 的计数汇总 ------------------------------------------------------- */

  /**
   * §2 说得很直白：「这两个数错一位，那条反向比对就变成两份错误互相签字」。
   *
   * 所以这些数字从**文档里读出来**再跟代码比，不是在测试里再抄一遍——抄一遍就正是那句话
   * 描述的失败模式。
   */
  it('§2 计数汇总的每个 v3 列都等于代码实测', () => {
    const md = readFileSync(FREEZE_MD, 'utf8')
    const summary = md.slice(md.indexOf('## 2 ·'), md.indexOf('## 3 ·'))
    const num = (label: string): number => {
      // 去掉反引号再找：§2 里写的是 `` `node` 字段 ``，标签写成 'node 字段' 才读得通
      const row = summary.split('\n').find((l) => l.startsWith('|') && l.replace(/`/g, '').includes(label))
      expect(row, `§2 里找不到「${label}」那一行`).toBeTruthy()
      const cell = row!.split('|')[3]!.replace(/\*/g, '').trim()
      const n = Number(cell)
      expect(Number.isFinite(n), `「${label}」的 v3 列不是个数字：${cell}`).toBe(true)
      return n
    }

    expect(num('顶层集合数')).toBe(ID_COLLECTION_NAMES.length)
    expect(num('ID 前缀数')).toBe(Object.keys(PREFIXES).length)
    expect(num('事件枚举')).toBe(EVENT_TYPES.length)
    expect(num('EVENT_PAYLOAD_KEYS')).toBe(EVENT_PAYLOAD_KEYS.length)
    expect(num('OVERLAY_TYPES')).toBe(OVERLAY_TYPES.length)
    // §2 的口径是「`ConditionSchema` 支数」，所以数联合分支，不数一份抄来的常量
    const conditionBranches = (ConditionSchema as unknown as { _zod: { def: { options: unknown[] } } })._zod.def
      .options.length
    expect(num('条件')).toBe(conditionBranches)
    // 「标量」是相对上面那行「顶层集合数」说的：新增的顶层键里剔掉两个新集合，剩 `sceneId` 一个
    const collections = new Set<string>(ID_COLLECTION_NAMES)
    expect(
      num('顶层标量'),
      '顶层新增键 = 标量 + 集合，两行分别记；把集合算进标量会让这两行互相掩护',
    ).toBe([...ADDED].filter((p) => !p.includes('.') && !p.includes('[') && !collections.has(p)).length)
    expect(num('node 字段')).toBe([...ADDED].filter((p) => /^nodes\[\]\.[^.[]+$/.test(p)).length)
    expect(num('meta 字段')).toBe([...ADDED].filter((p) => /^meta\.[^.[]+$/.test(p)).length)
    expect(num('字段删除')).toBe(REMOVED.size)
  })
})

/* ========================================================================== */
/* T-225 · 卡面点名的几条硬断言                                                */
/* ========================================================================== */

describe('T-225 · 卡面点名的硬断言', () => {
  /**
   * 与上面 §2 的比对**不是重复**。
   *
   * §2 那条比的是「文档写的数 === 代码实测的数」，两边一起改就一起绿——它守的是漂移，
   * 不是取值。这里写死的是取值本身，守的是**裁决**：`OVERLAY_TYPES` 恒为 4 是 R13
   * （需求膨胀成页面搭建器）的整条防线，加第 5 支 type 就是拆掉它。
   *
   * 想加第五种 overlay 时，改 §2 的表就够绿了；改到这里才会看见这段话。
   */
  it('OVERLAY_TYPES 恒为 4 —— 这是 R13 的防线，不是一个巧合的数字', () => {
    expect(OVERLAY_TYPES.length).toBe(4)
    expect([...OVERLAY_TYPES]).toEqual(['text', 'image', 'button', 'panel'])
  })

  it('EVENT_TYPES 是 11，且三个新事件都在', () => {
    expect(EVENT_TYPES.length).toBe(11)
    for (const e of ['pageEnter', 'flowStepEnter', 'overlayClick']) expect([...EVENT_TYPES]).toContain(e)
  })

  /**
   * `deferred.ts` 必须真的不在磁盘上。
   *
   * 它被删掉是 T-225 的交付内容之一（`pages` / `flows` 从「未实现的抽屉」里出列）。留着
   * 一份没人 import 的旧定义，下一个人 grep 到的会是它——而它和 `page.ts` / `flow.ts`
   * 里的新定义只差几个字段，差得刚好足以让人读错。
   */
  it('deferred.ts 已从磁盘上消失', () => {
    const p = fileURLToPath(new URL('../src/deferred.ts', import.meta.url))
    expect(existsSync(p), `${p} 还在 —— pages/flows 的定义现在有两份`).toBe(false)
    // 下限：路径拼错时上面那条恒真
    expect(existsSync(fileURLToPath(new URL('../src/flow.ts', import.meta.url))), '路径拼错了').toBe(true)
  })

  /** I49 必须在一份磁盘上的真文档上真的报出来（ADR-0035）。 */
  it('I49 在 orchestration.json 上真的报了 warn，且文案给出替代路径', () => {
    const doc = JSON.parse(
      readFileSync(fileURLToPath(new URL('./fixtures/v3/orchestration.json', import.meta.url)), 'utf8'),
    ) as SceneDocument
    const issues = checkIntegrity(doc).filter((i) => i.code === 'I49')
    expect(issues.length, 'I49 一条都没报 —— fixture 里没有配 onEnter 的步骤，这条规则从没被走过').toBe(1)
    expect(issues[0]!.level).toBe('warn')
    expect(issues[0]!.message, '只说「不执行」而不说该用什么，这条 warn 的价值就没了').toContain('flowStepEnter')
    // 而它不能是 error：C4 说一份能打开的文档永远要能打开
    expect(errorsOf(checkIntegrity(doc))).toEqual([])
  })
})
