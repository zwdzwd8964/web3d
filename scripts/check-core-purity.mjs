#!/usr/bin/env node
/**
 * Constitution C2 · @w3/core is framework-agnostic.
 * Constitution C8 / MVP_V0 D10 · the ECA engine is deterministic and GPU-free.
 *
 * Three sections, all mechanical:
 *   1. @w3/core declares no UI framework and no reverse workspace dependency.
 *   2. No source file under packages/core/src imports one either.
 *   3. Nothing under packages/core/src/eca imports three, and nothing there reads
 *      the ambient clock or randomness — time and entropy arrive through ctx.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collectFiles,
  extractImports,
  makeReport,
  matchLines,
  packageOf,
  printReport,
  stripComments,
  stripCommentsAndStrings,
} from './lib/scan.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CORE = join(ROOT, 'packages/core')

/** Package names @w3/core must never depend on. */
const FORBIDDEN_PACKAGES = [
  'react',
  'react-dom',
  'react-router',
  'react-router-dom',
  'preact',
  'vue',
  'svelte',
  'solid-js',
  'next',
  'nuxt',
  'jquery',
  'zustand',
  'idb',
  // Reverse edges in the dependency graph (MVP_V0 §3): core sits below all of these.
  '@w3/storage',
  '@w3/editor',
  '@w3/player',
]
const FORBIDDEN_SCOPES = ['@react-three', '@vue', '@angular', '@types/react', '@aws-sdk']

const isForbidden = (pkg) =>
  pkg != null &&
  pkg !== 'node:builtin' &&
  (FORBIDDEN_PACKAGES.includes(pkg) || FORBIDDEN_SCOPES.some((s) => pkg === s || pkg.startsWith(`${s}/`)))

/** Ambient time / entropy sources banned inside the ECA engine (D10). */
const NON_DETERMINISTIC = [
  [/\bDate\s*\.\s*now\s*\(/, 'Date.now() — use ctx.now()'],
  [/\bnew\s+Date\s*\(\s*\)/, 'new Date() — use ctx.now()'],
  [/\bperformance\s*\.\s*now\s*\(/, 'performance.now() — use ctx.now()'],
  [/\bsetTimeout\s*\(/, 'setTimeout() — use ctx.wait(ms, signal)'],
  [/\bsetInterval\s*\(/, 'setInterval() — use ctx.wait(ms, signal) in a loop'],
  [/\brequestAnimationFrame\s*\(/, 'requestAnimationFrame() — the ECA engine is frame-agnostic'],
  [/\bMath\s*\.\s*random\s*\(/, 'Math.random() — inject randomness through ctx'],
]

const report = makeReport('core purity', 'C2/C8')

// --- 1. declared dependencies -------------------------------------------------
const pkgPath = join(CORE, 'package.json')
if (!existsSync(pkgPath)) {
  console.error('FAIL  C2 · core purity — packages/core/package.json not found')
  process.exit(1)
}
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
  for (const dep of Object.keys(pkg[field] ?? {})) {
    if (isForbidden(dep)) {
      report.add(pkgPath, 1, `package.json ${field} declares forbidden package "${dep}"`)
    }
  }
}

// --- 2. imports across the whole package --------------------------------------
const srcFiles = collectFiles(join(CORE, 'src'), ['.ts', '.tsx', '.js', '.mjs'])
report.filesScanned = srcFiles.length
for (const file of srcFiles) {
  const source = readFileSync(file, 'utf8')
  for (const { spec, line } of extractImports(stripComments(source))) {
    const pkgName = packageOf(spec)
    if (isForbidden(pkgName)) {
      report.add(file, line, `@w3/core imports "${spec}" (C2: core must not know about UI frameworks or sit above storage)`)
    }
  }
}

// --- 3. ECA determinism -------------------------------------------------------
const ecaDir = join(CORE, 'src/eca')
const ecaFiles = collectFiles(ecaDir, ['.ts', '.js'])
if (ecaFiles.length === 0 && srcFiles.length > 0) {
  report.note('packages/core/src/eca is empty — determinism section had nothing to check')
}

/**
 * T-208 / A6 Q-5 · the determinism scan now covers `src/runtime` as well as `src/eca`.
 *
 * `src/embed` is named in the card and **does not exist yet** (the embed SDK is v1.0's
 * T-271~T-276). Listing a directory that is not there would make the scan look wider than it
 * is, so it is added by the card that creates it — not pre-registered here.
 *
 * The runtime legitimately needs real time: `SceneRuntime.now()` and `SceneRuntime.wait()`
 * **are the implementations of `ctx.now()` / `ctx.wait()`**, and `start()` is the render
 * loop. Widening the scan without an exemption would be asking the implementation to obey a
 * rule that says "do not implement me". Each line is exempted by name, with its reason.
 */
const DETERMINISM_EXEMPTIONS = [
  {
    file: 'runtime/scene-runtime.ts',
    members: ['now', 'wait', 'start'],
    why: 'ctx.now() / ctx.wait() 的实现本体与渲染循环 —— ECA 那条禁令要求大家改道去用的就是它们',
  },
  {
    file: 'assets/audit.ts',
    members: ['grade'],
    why: '体检报告的时间戳；`AuditOptions.now` 已经是可注入的，这里是它的默认实现',
  },
]

/** Whether `line` inside `file` is covered by a written exemption. */
function determinismExempt(file, source, lineNumber) {
  const relative = file.split(/[\\/]/).slice(-2).join('/')
  const exemption = DETERMINISM_EXEMPTIONS.find((e) => e.file.endsWith(relative))
  if (!exemption) return null
  // The member whose body the line falls in, found by walking back to the nearest
  // declaration at class-member indentation.
  const lines = source.split('\n')
  for (let i = lineNumber - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    // A class member at two-space indent, or a top-level function. Both shapes occur:
    // `SceneRuntime.now()` is the former, `grade()` in audit.ts is the latter.
    const member = /^\s{2}(?:private\s+|readonly\s+|async\s+|get\s+|set\s+)*([a-zA-Z_$][\w$]*)\s*[(<]/.exec(line)
    const fn = /^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*[(<]/.exec(line)
    const name = member?.[1] ?? fn?.[1]
    if (name) return exemption.members.includes(name) ? exemption : null
  }
  return null
}

const runtimeDir = join(CORE, 'src/runtime')
const determinismFiles = [...ecaFiles, ...collectFiles(runtimeDir, ['.ts', '.js']), join(CORE, 'src/assets/audit.ts')]
let determinismExempted = 0
for (const file of determinismFiles) {
  const source = readFileSync(file, 'utf8')
  const stripped = stripCommentsAndStrings(source)
  const isEca = /[\\/]eca[\\/]/.test(file)
  if (isEca) {
    for (const { spec, line } of extractImports(stripComments(source))) {
      if (packageOf(spec) === 'three') {
        report.add(file, line, 'the ECA engine imports three (C8: it must run in plain Node with no WebGL)')
      }
    }
  }
  for (const [re, why] of NON_DETERMINISTIC) {
    for (const hit of matchLines(stripped, re)) {
      const exemption = isEca ? null : determinismExempt(file, source, hit.line)
      if (exemption) {
        determinismExempted++
        continue
      }
      report.add(file, hit.line, `non-deterministic: ${why}`)
    }
  }
}
report.filesScanned += determinismFiles.length
report.note(`C8 determinism: ${determinismFiles.length} file(s) in src/eca + src/runtime; ${determinismExempted} line(s) exempted by name`)
for (const e of DETERMINISM_EXEMPTIONS) report.note(`  exempt ${e.file} · ${e.members.join(' / ')} — ${e.why}`)

// --- 4. the executor must not grow ------------------------------------------
// Constitution C5 / anti-pattern A3: adding a capability means adding a registry
// entry, never a branch in the executor. The moment the executor starts asking
// "which kind of step is this?", extension-by-configuration is dead and every new
// customer requirement reopens the engine.
const EXECUTOR_SMELLS = [
  [/\bswitch\s*\(\s*[\w.]*\.\s*(action|type|kind)\s*\)/, 'switch on a step discriminant — dispatch through the action registry instead'],
  [/\.\s*(action|type|kind)\s*===\s*['"]/, 'literal comparison against a step discriminant — dispatch through the action registry instead'],
]

/**
 * T-203 / ADR-0028 · two more, and ONLY for `executor.ts`.
 *
 * Both rules above require a `.` before the discriminant. `executor.ts:24` was a bare
 * `switch (kind)` — so the C5 executor-must-not-branch guard was blind to the one real
 * switch this repository's executor actually had. It was, in other words, passing on the
 * exact shape it exists to catch.
 *
 * Scoped to `executor.ts` rather than the whole ECA directory on purpose: `ref-kinds.ts` and
 * the files under `actions/` branch on kind legitimately, and a rule that shouts at them
 * gets suppressed, at which point it protects nothing. Narrow and accurate beats broad and
 * noisy — that trade-off is written down in ADR-0028's cost 3.
 *
 * The `case` list carries v1.2 / v1.5 kinds (`flow` / `step` / `page` / `dataSource`) that do
 * not exist yet. That is deliberate: T-302's key mutation is "hand-write a `case 'step'` in
 * executor.ts and watch the guard go red", and a guard added after the fact would be a guard
 * nobody ever saw fail.
 */
const EXECUTOR_ONLY_SMELLS = [
  [/\bswitch\s*\(/, 'any switch in executor.ts — the reference registry (ref-kinds.ts) owns per-kind knowledge (ADR-0028)'],
  [
    /\bcase\s+['"](node|material|animation|hotspot|viewpoint|variable|media|flow|step|page|dataSource)['"]/,
    'a per-kind case in executor.ts — add a row to REF_KINDS instead (ADR-0028)',
    // Needs the string CONTENTS. `stripCommentsAndStrings` blanks them (keeping only the
    // quotes), so against that input this pattern can never match a single character of the
    // thing it names — the guard would have been decorative from the day it was added. Found
    // by running the probe the card asks for rather than by reading the regex.
    'keep-strings',
  ],
]

/**
 * T-208 / A6 Q-5 · `engine.ts` joins the scan — **anchored to the basename**.
 *
 * The card says to write `/executor|dispatch|engine/i`. Measured, that matches **all 19**
 * files in `src/eca` on this machine and exactly one on CI, because the checkout directory
 * here is `…:9 3d engine\…` and `collectFiles` returns absolute paths. It would have
 * been a local-red / CI-green split reporting two false violations in `headless.ts`
 * (`animation.kind === 'tween'` and `light.kind === 'hemisphere'`, both legitimate).
 *
 * Anchoring costs one regex and removes the whole class. Line 164 in this same file already
 * used `/executor\.ts$/`; this was the one unanchored filter left.
 */
for (const file of ecaFiles.filter((f) => /(executor|dispatch|engine)\.ts$/.test(f))) {
  const source = readFileSync(file, 'utf8')
  const stripped = stripCommentsAndStrings(source)
  const withStrings = stripComments(source)
  const rules = /executor\.ts$/.test(file) ? [...EXECUTOR_SMELLS, ...EXECUTOR_ONLY_SMELLS] : EXECUTOR_SMELLS
  for (const [re, why, mode] of rules) {
    for (const hit of matchLines(mode === 'keep-strings' ? withStrings : stripped, re)) {
      report.add(file, hit.line, `C5/A3: ${why}`)
    }
  }
}

process.exit(printReport(report, ROOT))
