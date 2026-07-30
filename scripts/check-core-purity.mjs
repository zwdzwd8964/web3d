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
for (const file of ecaFiles) {
  const source = readFileSync(file, 'utf8')
  const stripped = stripCommentsAndStrings(source)
  for (const { spec, line } of extractImports(stripComments(source))) {
    if (packageOf(spec) === 'three') {
      report.add(file, line, 'the ECA engine imports three (C8: it must run in plain Node with no WebGL)')
    }
  }
  for (const [re, why] of NON_DETERMINISTIC) {
    for (const hit of matchLines(stripped, re)) {
      report.add(file, hit.line, `non-deterministic: ${why}`)
    }
  }
}
report.filesScanned += ecaFiles.length

// --- 4. the executor must not grow ------------------------------------------
// Constitution C5 / anti-pattern A3: adding a capability means adding a registry
// entry, never a branch in the executor. The moment the executor starts asking
// "which kind of step is this?", extension-by-configuration is dead and every new
// customer requirement reopens the engine.
const EXECUTOR_SMELLS = [
  [/\bswitch\s*\(\s*[\w.]*\.\s*(action|type|kind)\s*\)/, 'switch on a step discriminant — dispatch through the action registry instead'],
  [/\.\s*(action|type|kind)\s*===\s*['"]/, 'literal comparison against a step discriminant — dispatch through the action registry instead'],
]
for (const file of ecaFiles.filter((f) => /executor|dispatch/i.test(f))) {
  const stripped = stripCommentsAndStrings(readFileSync(file, 'utf8'))
  for (const [re, why] of EXECUTOR_SMELLS) {
    for (const hit of matchLines(stripped, re)) {
      report.add(file, hit.line, `C5/A3: ${why}`)
    }
  }
}

process.exit(printReport(report, ROOT))
