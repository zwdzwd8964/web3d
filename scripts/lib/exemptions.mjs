import { existsSync, readFileSync } from 'node:fs'

/**
 * T-205 · the one place that reads an exemption table and compares an expiry.
 *
 * NORTH_STAR §8 has said since v0 that "例外必须有到期版本号，到期未清 CI 转红". **The script
 * that reads an expiry version did not exist.** So the rule was a sentence, and v1 was about
 * to add `CONSTITUTION-EXCEPTION` comments (ADR-0025) to a system with no expiry mechanism at
 * all — writing 「到期 v2」 into a repository where nothing can tell that v2 has arrived.
 *
 * Three consumers share this module and must keep sharing it: `check-dead-exports.mjs`,
 * `check-no-external.mjs`, and T-298's `check-expiry.mjs`. Two implementations of version
 * comparison would disagree the first time someone writes `v1.10`.
 */

/** Version ladder, oldest first. NORTH_STAR §3. `expires` must name one of these. */
export const VERSION_LADDER = ['v0', 'v0.5', 'v1.0', 'v1.2', 'v1.5', 'v2', 'v3']

/** 一个卡号。`owner` 一直是这个形状；T-287 起 `expires` 也可以是。 */
const CARD_RE = /^T-\d{3}$/

/**
 * True when `expires` is at or before `current` — i.e. the exemption is due.
 *
 * Ladder position, not `semver`. The ladder is what this project actually versions by
 * (NORTH_STAR §3), and `v1.0 < v1.2 < v1.5 < v2` is a statement about that ladder rather
 * than about numbers: a semver comparison would put `v1.5` after `v2` for anyone who writes
 * `v1.50`, and nobody would find out until an exemption silently stopped expiring.
 */
export function isExpired(expires, current) {
  const at = VERSION_LADDER.indexOf(expires)
  const now = VERSION_LADDER.indexOf(current)
  if (at === -1 || now === -1) return false
  return at <= now
}

/**
 * Parses a four-column exemption table out of a Markdown file.
 *
 * The four columns are `symbol` / `reason` / `owner` / `expires`, and **all four are
 * required** (D36, verbatim). Each one earns its place:
 *
 *  - `reason` shorter than 10 CJK characters is rejected, because 「以后要用」 is not a reason
 *    and an exemption whose justification nobody can evaluate is just a silenced check.
 *  - `owner` is the load-bearing one. D22 freezes a batch of placeholder fields in v1.0 that
 *    only v1.2 and v1.5 consume; when they come due, "who do I ask" has to have an answer
 *    that is not "git blame".
 *  - `expires` is what makes it an exemption rather than a new default. NORTH_STAR §8:
 *    "没有到期日的例外，一年后就是新的默认行为."
 *
 * ## T-287 · 卡号也可以做到期日
 *
 * 版本阶梯的最小刻度是**一整个版本**，所以「这个导出的消费者是下一张卡」在这张表里
 * 表达不出来：写 `v1.0` 当场就算过期（当前就是 v1.0），写 `v1.2` 是**谎报**——把一个
 * 隔一张卡的债说成隔一个版本的债，而下一个读到它的人没有任何线索知道真相。
 *
 * 所以 `expires` 多认一种写法：**一个卡号**。它到期的条件不是「版本到了」，而是
 * **那张卡在台账里被标成 `[x]` 了**——那张卡本该顺手接上它，收工了还留着这一行，
 * 说明它没接。
 *
 * 这是**收紧**，不是开口子：卡号到期的行会在下一张卡收工时立刻转红，而版本到期的行
 * 能一直躺到那个版本。**只有传了 `cardClosed` 的调用方**认这种写法，其余三张表不变。
 *
 * `columns` selects WHICH table in the file to read: the header row has to name exactly these
 * columns, in this order, and every data row has to have exactly this many cells. That is what
 * lets one file hold two tables with different shapes without either reader picking up the
 * other's rows — ADR-0033's four-column 豁免 table and its five-column 冻结接口 table live in
 * `DEAD_EXPORTS_ALLOWLIST.md` side by side. Columns past the fourth are returned verbatim
 * under their own names and are validated by the caller, not here.
 *
 * @returns {{ rows: {symbol: string, reason: string, owner: string, expires: string, line: number}[], problems: {line: number, message: string}[] }}
 */
export function readExemptions(
  file,
  {
    current = 'v1.0',
    cardExists = () => true,
    /**
     * 「这张卡收工了吗」。**传了它，`expires` 才认卡号**；不传就只认版本阶梯（原行为）。
     */
    cardClosed = null,
    columns = ['symbol', 'reason', 'owner', 'expires'],
  } = {},
) {
  const rows = []
  const problems = []
  if (!existsSync(file)) {
    problems.push({ line: 0, message: `豁免表不存在：${file}` })
    return { rows, problems }
  }

  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  let inTable = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    const line = i + 1
    if (!raw.trimStart().startsWith('|')) {
      inTable = false
      continue
    }
    const cells = raw
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())

    // The header row names the columns; the separator row is all dashes.
    if (!inTable) {
      if (cells.length === columns.length && columns.every((name, k) => cells[k] === name)) {
        inTable = 'header'
        continue
      }
      continue
    }
    if (inTable === 'header') {
      inTable = true
      continue
    }

    const [symbol = '', reason = '', owner = '', expires = ''] = cells
    if (cells.length !== columns.length) {
      problems.push({ line, message: `本表要求恰好 ${columns.length} 列，这一行有 ${cells.length} 列：${raw.trim()}` })
      continue
    }
    if (!symbol) {
      problems.push({ line, message: 'symbol 列为空' })
      continue
    }
    if (countCjk(reason) < 10) {
      problems.push({
        line,
        message: `${symbol}：reason 少于 10 个汉字（「${reason}」）。写清楚谁会用到它、什么时候——「以后要用」不是理由`,
      })
    }
    if (!CARD_RE.test(owner)) {
      problems.push({ line, message: `${symbol}：owner 必须是一个卡号（形如 T-317），实际是「${owner}」` })
    } else if (!cardExists(owner)) {
      problems.push({ line, message: `${symbol}：owner「${owner}」在任务台账里不存在` })
    }
    if (cardClosed && CARD_RE.test(expires)) {
      // T-287 · 卡号到期。见下面 `cardClosed` 的注释：这是比版本到期**更紧**的一档，
      // 不是新开的口子。
      if (!cardExists(expires)) {
        problems.push({ line, message: `${symbol}：expires 写的卡号「${expires}」在任务台账里不存在` })
      } else if (cardClosed(expires)) {
        problems.push({
          line,
          message: `${symbol}：${expires} 已经收工了，但这一行还在——那张卡本该接上它。接上它或删掉它`,
        })
      }
    } else if (!VERSION_LADDER.includes(expires)) {
      problems.push({
        line,
        message: `${symbol}：expires 必须是版本阶梯上的一级（${VERSION_LADDER.join(' / ')}）${
          cardClosed ? '，或者一个卡号（形如 T-288）' : ''
        }，实际是「${expires}」`,
      })
    } else if (isExpired(expires, current)) {
      problems.push({ line, message: `${symbol}：豁免已于 ${expires} 到期（当前 ${current}），请接上它或删掉它` })
    }
    const extra = {}
    for (let k = 4; k < columns.length; k++) extra[columns[k]] = cells[k] ?? ''
    rows.push({ symbol, reason, owner, expires, line, ...extra })
  }

  return { rows, problems }
}

/** How many CJK ideographs `text` contains. Latin words are not a Chinese reason. */
function countCjk(text) {
  return [...text].filter((ch) => /[一-鿿]/.test(ch)).length
}
