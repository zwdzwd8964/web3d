#!/usr/bin/env node
/**
 * MVP_V0 §3 · the dependency graph is a DAG with no reverse arrows.
 *
 *        @w3/schema  <---------------+
 *             ^                      |
 *        @w3/storage                 |
 *             ^                      |
 *        @w3/core  ------------------+     (core depends on schema, NOT on storage)
 *          ^    ^
 *   @w3/editor  @w3/player
 *
 * core not depending on storage is deliberate: core only knows "hand me an
 * ArrayBuffer". That is what lets it run under a fake AssetResolver in Node (C8).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectFiles, extractImports, makeReport, packageOf, printReport, stripComments } from './lib/scan.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Exactly which workspace packages each package may reach. */
const ALLOWED_EDGES = {
  '@w3/schema': [],
  '@w3/storage': ['@w3/schema'],
  '@w3/core': ['@w3/schema'],
  '@w3/editor': ['@w3/schema', '@w3/storage', '@w3/core'],
  '@w3/player': ['@w3/schema', '@w3/storage', '@w3/core'],
}

const DIRS = {
  '@w3/schema': 'packages/schema',
  '@w3/storage': 'packages/storage',
  '@w3/core': 'packages/core',
  '@w3/editor': 'packages/editor',
  '@w3/player': 'packages/player',
}

const WORKSPACE = Object.keys(ALLOWED_EDGES)
const report = makeReport('dependency direction', 'MVP §3')

for (const [name, dir] of Object.entries(DIRS)) {
  const allowed = ALLOWED_EDGES[name]
  const pkgPath = join(ROOT, dir, 'package.json')
  if (!existsSync(pkgPath)) {
    report.add(pkgPath, 1, `${name}: package.json missing`)
    continue
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (WORKSPACE.includes(dep) && !allowed.includes(dep)) {
        report.add(pkgPath, 1, `${name} declares ${field} on ${dep} — not an allowed edge`)
      }
    }
  }

  const files = collectFiles(join(ROOT, dir, 'src'), ['.ts', '.tsx', '.js'])
  report.filesScanned += files.length
  for (const file of files) {
    for (const { spec, line } of extractImports(stripComments(readFileSync(file, 'utf8')))) {
      const target = packageOf(spec)
      if (target && WORKSPACE.includes(target) && target !== name && !allowed.includes(target)) {
        report.add(file, line, `${name} imports ${target} — reverse or forbidden edge (allowed: ${allowed.join(', ') || 'none'})`)
      }
    }
  }
}

process.exit(printReport(report, ROOT))
