import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * T-213 · the one place that reads an ADR's status line.
 *
 * Two consumers, and they must keep sharing it: `check-docs.mjs` rule 8 (fails the build on
 * a non-Accepted ADR) and T-458's `scripts/milestone-close.mjs` step 7 (prints the list).
 * Two parsers would disagree the first time somebody writes the status a fourth way — and
 * there were **four** ways in the tree on the day this was written.
 *
 * **Why `Accepted` is matched by exact equality, with no synonym table.**
 * 「已接受」 / 「已采纳」 are the obvious synonyms to accept, and accepting them is exactly the
 * bug: the string this whole card exists to catch was 「已接受（**但需人工确认**，见下）」,
 * which *starts with* 「已接受」. A prefix or synonym match would have called it Accepted and
 * let 遗留决议清零 pass with the decision still open. The four wordings were normalised once,
 * by hand, in T-213; from here the parser is deliberately unforgiving.
 *
 * A parenthetical after the word is kept as `note` and does not affect the verdict —
 * `Accepted（人工确认，2026-08-04，zwdzwd8964）` is who confirmed it, not a different status.
 */

/** `- 状态: X` or `- **状态**：X`, ASCII or fullwidth colon, with or without the bold. */
const STATUS_RE = /^-\s*(?:\*\*)?状态(?:\*\*)?\s*[:：]\s*(.+?)\s*$/

/** The only status an ADR in this repository may carry once it is merged. */
export const ACCEPTED = 'Accepted'

/**
 * Reads every `docs/adr/NNNN-*.md` and reports its status line.
 *
 * @returns {{ rows: {file: string, line: number, status: string, note: string, raw: string}[], problems: {file: string, line: number, message: string}[] }}
 */
export function readAdrStatuses(dir) {
  const rows = []
  const problems = []

  let files
  try {
    files = readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort()
  } catch {
    problems.push({ file: dir, line: 0, message: `ADR 目录读不到：${dir}。**这不是「零条所以放行」，是拿不到结论**` })
    return { rows, problems }
  }

  for (const file of files) {
    const full = join(dir, file)
    const lines = readFileSync(full, 'utf8').split(/\r?\n/)
    let found = false
    // Only the front matter — a 「状态」 word inside the body prose is not the status line.
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      const m = STATUS_RE.exec(lines[i])
      if (!m) continue
      found = true
      const raw = m[1]
      // `Accepted（人工确认，…）` → status `Accepted`, note `人工确认，…`
      const paren = /^([^（(]+)[（(](.*)[）)]\s*$/.exec(raw)
      const status = (paren ? paren[1] : raw).replace(/\*/g, '').trim()
      rows.push({ file, line: i + 1, status, note: paren ? paren[2].trim() : '', raw })
      break
    }
    if (!found) {
      // Never silently skipped. An ADR whose status cannot be parsed and an ADR with no
      // status are the same thing to a reader, and both must stop the build.
      problems.push({
        file,
        line: 0,
        message: `前 12 行里找不到状态行。格式应为 \`- 状态: Accepted\` 或 \`- **状态**：Accepted\``,
      })
    }
  }

  return { rows, problems }
}
