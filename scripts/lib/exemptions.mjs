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
 * @returns {{ rows: {symbol: string, reason: string, owner: string, expires: string, line: number}[], problems: {line: number, message: string}[] }}
 */
export function readExemptions(file, { current = 'v1.0', cardExists = () => true } = {}) {
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
      if (cells[0] === 'symbol' && cells[1] === 'reason' && cells[2] === 'owner' && cells[3] === 'expires') {
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
    if (cells.length !== 4) {
      problems.push({ line, message: `豁免表要求恰好四列，这一行有 ${cells.length} 列：${raw.trim()}` })
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
    if (!/^T-\d{3}$/.test(owner)) {
      problems.push({ line, message: `${symbol}：owner 必须是一个卡号（形如 T-317），实际是「${owner}」` })
    } else if (!cardExists(owner)) {
      problems.push({ line, message: `${symbol}：owner「${owner}」在任务台账里不存在` })
    }
    if (!VERSION_LADDER.includes(expires)) {
      problems.push({
        line,
        message: `${symbol}：expires 必须是版本阶梯上的一级（${VERSION_LADDER.join(' / ')}），实际是「${expires}」`,
      })
    } else if (isExpired(expires, current)) {
      problems.push({ line, message: `${symbol}：豁免已于 ${expires} 到期（当前 ${current}），请接上它或删掉它` })
    }
    rows.push({ symbol, reason, owner, expires, line })
  }

  return { rows, problems }
}

/** How many CJK ideographs `text` contains. Latin words are not a Chinese reason. */
function countCjk(text) {
  return [...text].filter((ch) => /[一-鿿]/.test(ch)).length
}
