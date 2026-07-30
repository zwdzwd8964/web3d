#!/usr/bin/env node
/**
 * Constitution C7 · all storage goes through StorageProvider.
 *
 * Business code in @w3/core, @w3/editor and @w3/player must not name a concrete
 * storage mechanism. Only @w3/storage is allowed to know what IndexedDB is —
 * that is the whole point of the seam, and it is what makes v1's HttpApiProvider
 * a zero-diff change to everything above it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectFiles, extractImports, makeReport, matchLines, packageOf, printReport, stripCommentsAndStrings } from './lib/scan.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Packages that must stay ignorant of concrete storage. */
const GUARDED = ['core', 'editor', 'player']

const FORBIDDEN_IMPORTS = ['idb', 'idb-keyval', 'dexie', 'aws-sdk', '@aws-sdk', 'localforage', 'node:fs', 'fs', 'fs/promises', 'node:fs/promises']

const FORBIDDEN_IDENTIFIERS = [
  [/\bindexedDB\b/, 'indexedDB — go through StorageProvider'],
  [/\bwindow\s*\.\s*indexedDB\b/, 'window.indexedDB — go through StorageProvider'],
  [/\blocalStorage\b/, 'localStorage — persistent state belongs in the document (C1) behind StorageProvider (C7)'],
  [/\bsessionStorage\b/, 'sessionStorage — see localStorage'],
  [/\bcaches\s*\.\s*open\s*\(/, 'CacheStorage — go through StorageProvider'],
  [/\bnavigator\s*\.\s*storage\b/, 'navigator.storage — go through StorageProvider'],
]

const report = makeReport('storage abstraction', 'C7')

for (const pkgDir of GUARDED) {
  const files = collectFiles(join(ROOT, 'packages', pkgDir, 'src'), ['.ts', '.tsx', '.js'])
  report.filesScanned += files.length
  for (const file of files) {
    const stripped = stripCommentsAndStrings(readFileSync(file, 'utf8'))
    for (const { spec, line } of extractImports(stripped)) {
      const name = packageOf(spec)
      if (name && FORBIDDEN_IMPORTS.includes(name)) {
        report.add(file, line, `@w3/${pkgDir} imports "${spec}" — only @w3/storage may name a concrete store`)
      }
    }
    for (const [re, why] of FORBIDDEN_IDENTIFIERS) {
      for (const hit of matchLines(stripped, re)) {
        report.add(file, hit.line, `@w3/${pkgDir} uses ${why}`)
      }
    }
  }
}

process.exit(printReport(report, ROOT))
