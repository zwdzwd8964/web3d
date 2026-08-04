#!/usr/bin/env node
/**
 * G1.0-22 · the mutation-testing register, and the machine that reads it.
 *
 * **风险 V25 与本台账新纪律 1 都建立在这张表上，而在本卡之前没有任何一张卡造它的锁。**
 * `docs/MUTATIONS.md` 由 T-200 收尾时手工建立并从那时起一直在填；T-297 只是把它锁上，
 * 不是它的起点。没有这把锁，一条漏登记的变异与一条不存在的变异在仓库里长得一模一样。
 *
 * Four rules:
 *   R1  每张标 `[x]` 且「变异检验」栏不含「不适用」的卡，表里至少一行 —— 缺失时点名卡号
 *   R2  「实际」为 `绿` / `绿→红` 的行，后两列非空且分类是 a / b / c
 *   R3  「卡号」列里的每个卡号都在台账里真实存在（防登记表自己腐烂）
 *   R4  七列逐行非空，列头顺序与模板逐字相同
 *
 * Usage: node scripts/check-mutations.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTER = join(ROOT, 'docs/MUTATIONS.md')
const LEDGER = join(ROOT, 'docs/TASK_BACKLOG_V1.md')

/** Column order, verbatim from the template. Changing this changes the contract. */
const COLUMNS = ['卡号', '编号', '操作', '期望', '实际', '若绿属哪一类', '处置']

/**
 * The four closed tokens the 「实际」 column may start with.
 *
 * **这一列此前是散文，于是「未转红条数」有两个答案**（含「绿」字 19 条 / 含绿且不含红 14 条），
 * 而 T-458 的里程碑收尾脚本要按这个数报「本里程碑未转红条数」。一个可以争辩的数字不是指标。
 *
 *  - `红`      变异让测试转红了，也就是它该有的样子
 *  - `绿`      没转红
 *  - `绿→红`   先绿，把测试改强之后才红 —— **本仓最有价值的一类记录**，它证明的是原来的测试没测到东西
 *  - `非变异`  不是变异，是一次观察/测量，为留证而登记
 *
 * `绿→红` 单列而不是并进 `红`：并进去等于把「我们差点漏掉这个缺陷」洗成「一切正常」。
 */
const OUTCOME_TOKENS = ['绿→红', '红', '绿', '非变异']
/** Outcomes that require a classification and a disposition. */
const NEEDS_CLASS = new Set(['绿', '绿→红'])
/** The closed enumeration for 「若绿属哪一类」. No fourth bucket may be invented. */
const CLASSES = new Set(['a', 'b', 'c'])

/**
 * Below this the ledger glob is broken rather than the project finished.
 *
 * **下限断在台账卡数上，不是断在登记条数上。** 验收明确要求「把表清成只剩表头 → 脚本仍正常
 * 读取并打印 `登记条数 0`」，所以登记条数合法地可以是 0；而需登记集合是从台账算出来的，
 * 台账读坏时它变成空集，R1 会静静地全过。这正是 D36 点名的 M6 形状 —— 本版第五次写下它。
 */
const MIN_LEDGER_CARDS = 150

const problems = []
const notes = []
const fail = (message) => problems.push(message)

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Splits a Markdown table row, honouring `\|` inside cell text.
 *
 * The naive `.split('|')` that `check-docs.mjs:366` uses would report four of this table's
 * rows as malformed — and those four are the rows whose bodies quote regexes
 * (`/executor\|dispatch\|engine/i`, `(function\|const\|…)`), i.e. the most informative ones.
 * Fixing that by removing the escapes from the prose would have destroyed the evidence.
 */
function splitRow(row) {
  const cells = []
  let cur = ''
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '|') {
      cur += '\\|'
      i++
      continue
    }
    if (row[i] === '|') {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += row[i]
  }
  cells.push(cur)
  return cells.slice(1, -1).map((c) => c.trim())
}

/** Reads a file, or refuses to give a verdict. A guard that cannot read its input is not green. */
function readOrRefuse(file, what) {
  if (!existsSync(file)) {
    fail(`${what}读不到：${relative(ROOT, file)}。**这不是「零条所以放行」，是拿不到结论** —— 路径写错的守卫会永远绿`)
    return null
  }
  return readFileSync(file, 'utf8')
}

const registerText = readOrRefuse(REGISTER, '登记表')
const ledgerText = readOrRefuse(LEDGER, '任务台账')

/* -------------------------------------------------------------------------- */
/* The ledger side — who is required to have registered                        */
/* -------------------------------------------------------------------------- */

/**
 * Every card in the ledger, with whether it is done and whether it owes a registration.
 *
 * 「不适用」 is matched with `includes`, not equality: the real wordings are
 * 「不适用（合同 / 文档卡）」 and 「不适用（裁决卡）」, and an equality test would start
 * pointing at cards on the day they land.
 */
function readLedger(text) {
  if (text === null) return { cards: new Map(), required: new Set() }
  const cards = new Map()
  const required = new Set()
  const lines = text.split(/\r?\n/)
  let current = null
  for (const line of lines) {
    const head = /^###\s+\[( |x)\]\s+(T-\d{3})\b/.exec(line)
    if (head) {
      current = { id: head[2], done: head[1] === 'x', mutationLine: null }
      cards.set(current.id, current)
      continue
    }
    if (current && /^-\s+\*\*变异检验\*\*/.test(line)) {
      current.mutationLine ??= line
    }
  }
  for (const card of cards.values()) {
    if (!card.done) continue
    // No 变异检验 line at all counts as required: a card that forgot the column entirely
    // must not be quieter than one that wrote 「不适用」.
    if (card.mutationLine !== null && card.mutationLine.includes('不适用')) continue
    required.add(card.id)
  }
  return { cards, required }
}

const { cards, required } = readLedger(ledgerText)

if (ledgerText !== null && cards.size < MIN_LEDGER_CARDS) {
  fail(
    `台账扫描面塌了：只认出 ${cards.size} 张卡，下限 ${MIN_LEDGER_CARDS}。` +
      `多半是卡头正则或路径坏了，不是台账变短了 —— 需登记集合正是从这里算出来的，它一空 R1 就会静静全过`,
  )
}

/* -------------------------------------------------------------------------- */
/* The register side                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Parses the table under `## 登记表`, and only that table.
 *
 * Scanning the whole file would sweep in the template's own example, which is deliberately
 * written as prose rather than as a table row — the card asks for a REAL v0.5 mutation as
 * the example, and every one of those carries a v0.5 card number, which R3 would then
 * (correctly) reject. Prose example + a strictly-scoped scan is the only shape where both
 * requirements hold at once.
 */
function readRegister(text) {
  if (text === null) return { rows: [], headerSeen: false }
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim().startsWith('## 登记表'))
  if (start === -1) {
    fail('登记表里找不到 `## 登记表` 这一节 —— 脚本只扫这一节以下的表，找不到它就等于什么都没扫')
    return { rows: [], headerSeen: false }
  }
  const rows = []
  let headerSeen = false
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw.startsWith('|')) continue
    const cells = splitRow(raw)
    if (!headerSeen) {
      if (cells.join('|') !== COLUMNS.join('|')) {
        fail(
          `R4 · 列头与模板不符（L${i + 1}）。期望逐字为 ${COLUMNS.join(' / ')}，实际是 ${cells.join(' / ')}`,
        )
      }
      headerSeen = true
      continue
    }
    if (cells.every((c) => /^-*$/.test(c))) continue
    rows.push({ cells, line: i + 1 })
  }
  return { rows, headerSeen }
}

const { rows, headerSeen } = readRegister(registerText)
if (registerText !== null && !headerSeen) fail('R4 · `## 登记表` 之下一行表头都没有')

/** The leading token of the 「实际」 cell, with Markdown emphasis stripped first. */
function outcomeOf(cell) {
  const bare = cell.replace(/^[*_\s]+/, '')
  return OUTCOME_TOKENS.find((token) => bare.startsWith(token)) ?? null
}

const covered = new Set()
let notReddened = 0

for (const { cells, line } of rows) {
  const at = `L${line}`
  if (cells.length !== 7) {
    fail(`R4 · ${at} 有 ${cells.length} 列，模板是 7 列：${cells[0] ?? ''} ${cells[1] ?? ''}`)
    continue
  }
  const [card, index, operation, expectation, actual, klass, disposition] = cells
  for (const [name, value] of [
    ['卡号', card],
    ['编号', index],
    ['操作', operation],
    ['期望', expectation],
    ['实际', actual],
    ['若绿属哪一类', klass],
    ['处置', disposition],
  ]) {
    if (value === '') fail(`R4 · ${at} 的「${name}」列为空。七列逐行必填，留空的行等于没登记`)
  }

  if (!/^T-\d{3}$/.test(card)) {
    fail(`R3 · ${at} 的卡号「${card}」不是卡号形状（形如 T-297）`)
  } else if (!cards.has(card)) {
    fail(`R3 · ${at} 的卡号「${card}」在台账里不存在 —— 登记表自己腐烂了，或者卡被删/改号了`)
  } else {
    covered.add(card)
  }

  const outcome = outcomeOf(actual)
  if (outcome === null) {
    fail(
      `R2 · ${at} 的「实际」必须以四个封闭 token 之一开头（${OUTCOME_TOKENS.join(' / ')}），实际是「${actual.slice(0, 40)}」。` +
        `散文没法数 —— 「未转红条数」会有两个答案`,
    )
    continue
  }
  if (outcome !== '红') notReddened++
  if (NEEDS_CLASS.has(outcome)) {
    const bare = klass.replace(/[*_\s]/g, '')
    if (!CLASSES.has(bare)) {
      fail(`R2 · ${at} 的「实际」是 ${outcome}，「若绿属哪一类」必须是 a / b / c 之一，实际是「${klass}」`)
    }
    if (disposition === '' || disposition === '—') {
      fail(`R2 · ${at} 的「实际」是 ${outcome}，「处置」必填且不许是「—」 —— 没转红的变异，怎么处理的才是全部价值`)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* R1 · required ⊆ covered                                                     */
/* -------------------------------------------------------------------------- */

const missing = [...required].filter((id) => !covered.has(id)).sort()
for (const id of missing) {
  fail(`R1 · ${id} 已标 [x] 且「变异检验」栏不是「不适用」，但 \`docs/MUTATIONS.md\` 里一行都没有`)
}

/**
 * Registrations beyond what is required are a note, never a failure.
 *
 * The equation the card writes is 「涉及卡数 === 需登记卡数」, and on the day this was
 * implemented the two sides read 17 and 16. The extra was **T-212**, whose 变异检验 column
 * says 「不适用（合同 / 文档卡）」 and which nevertheless ran a substitute check and wrote it
 * down. Failing on that would push the next person to DELETE a good record to get green —
 * the exact incentive this table exists to avoid. So the equation is implemented as
 * `required ⊆ covered`, and the surplus is printed.
 */
const surplus = [...covered].filter((id) => !required.has(id)).sort()

/* -------------------------------------------------------------------------- */

const rel = (f) => relative(ROOT, f).split('\\').join('/')
console.log(`  登记条数 ${rows.length} / 涉及卡数 ${covered.size} / 未转红条数 ${notReddened}`)
console.log(`  应登记卡数 ${required.size}（台账 ${cards.size} 张卡里已标 [x] 且需登记的）· 已覆盖 ${covered.size - surplus.length}`)
if (surplus.length > 0) {
  notes.push(`额外登记（「变异检验」栏写「不适用」但仍留了证据，不算违规）：${surplus.join('、')}`)
}
for (const note of notes) console.log(`  note: ${note}`)

if (problems.length === 0) {
  console.log(`PASS  G1.0-22 · 变异检验登记表  (${rel(REGISTER)})`)
  process.exit(0)
}
console.error(`FAIL  G1.0-22 · 变异检验登记表  — ${problems.length} 处`)
for (const p of problems) console.error(`      ${p}`)
process.exit(1)
