/**
 * Shared scanning helpers for the constitution guards.
 *
 * Deliberately dependency-free plain Node: the guards must run before `pnpm install`
 * has finished doing anything interesting, and in an offline CI (C6).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.pnpm', 'vendor'])

/** Recursively collect files under `dir` whose extension is in `exts`. */
export function collectFiles(dir, exts, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectFiles(full, exts, out)
    else if (exts.includes(extname(full))) out.push(full)
  }
  return out
}

/**
 * Blank out comments and string/template literals, preserving offsets so that
 * line numbers stay correct. Used before identifier scans so that a rule's own
 * documentation ("do not call Date.now()") never trips the rule.
 */
export function stripCommentsAndStrings(src) {
  let out = ''
  let i = 0
  const n = src.length
  const keepNewlines = (s) => s.replace(/[^\n]/g, ' ')

  while (i < n) {
    const two = src.slice(i, i + 2)
    if (two === '//') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? n : end
      out += keepNewlines(src.slice(i, stop))
      i = stop
      continue
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += keepNewlines(src.slice(i, stop))
      i = stop
      continue
    }
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === ch) break
        j++
      }
      const stop = Math.min(j + 1, n)
      out += ch + keepNewlines(src.slice(i + 1, stop - 1)) + (src[stop - 1] === ch ? ch : '')
      i = stop
      continue
    }
    out += ch
    i++
  }
  return out
}

const IMPORT_PATTERNS = [
  /(?:^|[\s;}])import\s+(?:[\w*{}\n\r\t, $]+\s+from\s+)?['"]([^'"]+)['"]/g,
  /(?:^|[\s;}])export\s+(?:[\w*{}\n\r\t, $]+\s+)?from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

/** Every module specifier imported by `src`, with 1-based line numbers. */
export function extractImports(src) {
  /** @type {{ spec: string, line: number }[]} */
  const found = []
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src)) !== null) {
      found.push({ spec: m[1], line: src.slice(0, m.index).split('\n').length })
    }
  }
  return found
}

/** Package name of a bare specifier: 'three/addons/x.js' -> 'three', '@w3/core/x' -> '@w3/core'. */
export function packageOf(spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) return null
  if (spec.startsWith('node:')) return 'node:builtin'
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** Find every line where `re` matches, as {line, text} records. */
export function matchLines(src, re) {
  /** @type {{ line: number, text: string, match: string }[]} */
  const hits = []
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0
    const m = re.exec(lines[i])
    if (m) hits.push({ line: i + 1, text: lines[i].trim(), match: m[0] })
  }
  return hits
}

/** A guard result the aggregator can render uniformly. */
export function makeReport(name, article) {
  return {
    name,
    article,
    /** @type {{ file: string, line: number, message: string }[]} */
    violations: [],
    /** @type {string[]} */
    notes: [],
    filesScanned: 0,
    add(file, line, message) {
      this.violations.push({ file, line, message })
    },
    note(message) {
      this.notes.push(message)
    },
  }
}

export function printReport(report, root) {
  const tag = `${report.article} · ${report.name}`
  for (const n of report.notes) console.log(`  note: ${n}`)
  if (report.violations.length === 0) {
    console.log(`PASS  ${tag}  (${report.filesScanned} file(s) scanned)`)
    return 0
  }
  console.error(`FAIL  ${tag}  — ${report.violations.length} violation(s)`)
  for (const v of report.violations) {
    const rel = relative(root, v.file).split('\\').join('/')
    console.error(`      ${rel}:${v.line}  ${v.message}`)
  }
  return 1
}
