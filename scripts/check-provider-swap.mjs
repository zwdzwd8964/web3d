#!/usr/bin/env node
/**
 * Constitution C7 · the provider seam is swappable in one edit.
 *
 * `check-storage-abstraction.mjs` already forbids the *names* of concrete stores
 * (`indexedDB`, `localStorage`, `idb`) outside `@w3/storage`. That is necessary and not
 * sufficient: code can honour every one of those rules and still be impossible to swap,
 * because the decision of WHICH provider to build is scattered, or because it reaches the
 * network through a primitive that has nothing to do with storage.
 *
 * **债 A, named on T-209's card and true when this file was written:** the C7 guards did
 * not scan for `fetch` at all, although the constitution and 铁律 8 both name
 * 「fetch 到固定端点」 in so many words. v1.5 introduces `HttpApiProvider`; at that moment a
 * stray `fetch` in a panel is indistinguishable from the provider doing its job, and C7
 * becomes a sentence again.
 *
 * **Ownership of the network primitives is here, not in `check-storage-abstraction.mjs`.**
 * (X-29.) Two scripts maintaining one allowlist disagree the first time somebody adds a
 * row to only one of them.
 *
 * Four rules:
 *   R1  provider construction sites — SET EQUALITY against `PROVIDER_SITES`
 *   R2  network primitives          — SET EQUALITY against `NETWORK_SITES`
 *   R3  the assembly point is one file
 *   R4  E2E specs never name a provider
 *
 * **R1 and R2 compare sets, not counts.** "At most one file constructs a provider" is the
 * weaker rule that looks identical on a green day: it passes when a site MOVES, and it
 * passes when the only site is deleted. Set equality fails on both, and failing when a
 * declared site disappears is the half that catches a refactor quietly routing around the
 * seam.
 *
 * Usage: node scripts/check-provider-swap.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectFiles, makeReport, matchLines, printReport, stripCommentsAndStrings } from './lib/scan.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Packages whose code has to survive the v1.5 provider swap untouched. */
const GUARDED = ['core', 'editor', 'player']

/**
 * Every file allowed to say `new …Provider(`, and why it is the only one.
 *
 * One entry today. `defaultStorage()` picks IndexedDB or memory by feature detection and
 * hands back a `StorageProvider`; everything above it takes the interface. Swapping in
 * `HttpApiProvider` is a change to this function and to nothing else, which is the property
 * the whole seam exists to have — and the property this rule measures.
 */
const PROVIDER_SITES = new Map([
  ['packages/editor/src/project/session.ts', 'defaultStorage() — the single feature-detection point (C7)'],
])

/**
 * Every file allowed to touch a network primitive, and why it cannot break an intranet.
 *
 * Deliberately NOT a `readExemptions` table. Those rows carry an expiry because they are
 * debts; this one is a permanent architectural allowance, and giving it a fake expiry would
 * either be cleaned up wrongly or renewed forever. What keeps it honest instead is set
 * equality plus `PROOF`: the guard reads the file and refuses unless the named proof token
 * is present, so the allowance survives only as long as the reason does.
 */
const NETWORK_SITES = new Map([
  [
    'packages/player/src/main.ts',
    {
      why: '`?src=` 取同源 .w3p，是播放器唯一一次取数（C6 §「断网能跑」的例外由 resolveSource 兜住）',
      // resolveSource() rejects anything that is not a same-origin relative path. If that
      // call disappears, the fetch stops being same-origin by construction and this
      // allowance stops being true — so the guard checks for it rather than trusting it.
      proof: 'resolveSource(',
    },
  ],
  [
    'packages/player/src/embed/boot.ts',
    {
      why: 'T-272 · 取嵌入白名单。**相对 URL、同源、随 --base 走**，所以内网部署下它取的是同一台机器上的那份文件；取不到时按「谁都不许嵌」处理，不是全通',
      // 这条豁免成立的全部前提是那个常量**是相对路径**。把它写死成一个绝对地址的那天，
      // 它就变成了一次外部请求，而内网部署会白屏——所以守卫检查它，不靠信任。
      proof: 'const POLICY_URL =',
    },
  ],
])

const NETWORK_PRIMITIVES = [
  [/\bfetch\s*\(/, 'fetch('],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bnew\s+WebSocket\s*\(/, 'new WebSocket('],
  [/\bnew\s+EventSource\s*\(/, 'new EventSource('],
  [/\bnew\s+BroadcastChannel\s*\(/, 'new BroadcastChannel('],
  [/\bnavigator\s*\.\s*locks\b/, 'navigator.locks'],
]

const PROVIDER_CTOR = /\bnew\s+([A-Z]\w*Provider)\s*\(/
/** Concrete provider classes exported by `@w3/storage`. The interface itself is fine. */
const CONCRETE_PROVIDERS = /\b(IndexedDbProvider|MemoryProvider|HttpApiProvider)\b/

/**
 * Below this, the glob is broken rather than the repo clean.
 *
 * D36's M6 shape, third recurrence in v1: a guard that scans zero files reports PASS. The
 * floor sits on the FILE count because the violation count is legitimately near zero today
 * — 125 files at the time of writing, rounded down.
 */
const MIN_FILES = 110
const MIN_E2E_SPECS = 5

const report = makeReport('provider seam is swappable', 'C7')
const rel = (file) => relative(ROOT, file).split('\\').join('/')

/* -------------------------------------------------------------------------- */

const foundProviderSites = new Map()
const foundNetworkSites = new Map()
const importsConcrete = new Set()

for (const pkg of GUARDED) {
  for (const file of collectFiles(join(ROOT, 'packages', pkg, 'src'), ['.ts', '.tsx', '.js'])) {
    const source = readFileSync(file, 'utf8')
    // Strings are blanked so a URL inside a message, or the word "fetch" in a comment,
    // is not a violation. `matchLines` gets the blanked text for the same reason.
    const stripped = stripCommentsAndStrings(source)
    const path = rel(file)
    report.filesScanned++

    for (const hit of matchLines(stripped, PROVIDER_CTOR)) {
      const name = PROVIDER_CTOR.exec(hit.text)?.[1] ?? 'Provider'
      if (!foundProviderSites.has(path)) foundProviderSites.set(path, [])
      foundProviderSites.get(path).push({ line: hit.line, what: name })
    }

    for (const [re, label] of NETWORK_PRIMITIVES) {
      for (const hit of matchLines(stripped, re)) {
        if (!foundNetworkSites.has(path)) foundNetworkSites.set(path, [])
        foundNetworkSites.get(path).push({ line: hit.line, what: label, source })
      }
    }

    // R3 works off imports rather than constructor calls: a file that imports a concrete
    // class without calling `new` yet is still a second place that has to change.
    for (const hit of matchLines(stripped, CONCRETE_PROVIDERS)) {
      if (/\bimport\b|\bfrom\b/.test(hit.text)) importsConcrete.add(path)
    }
  }
}

/* R1 · provider construction sites ----------------------------------------- */

for (const [path, hits] of foundProviderSites) {
  if (PROVIDER_SITES.has(path)) continue
  for (const h of hits) {
    report.add(join(ROOT, path), h.line, `R1 · 未申报的 provider 构造点：${h.what}。C7 要求换 provider 只改一处，申报表在 check-provider-swap.mjs 的 PROVIDER_SITES`)
  }
}
for (const [path, why] of PROVIDER_SITES) {
  if (foundProviderSites.has(path)) continue
  report.add(join(ROOT, path), 0, `R1 · 申报的 provider 构造点消失了：${why}。它要么被搬走了（搬到哪去了？），要么这条申报该删——两种都要人来看一眼`)
}

/* R2 · network primitives --------------------------------------------------- */

for (const [path, hits] of foundNetworkSites) {
  const allowed = NETWORK_SITES.get(path)
  if (allowed) continue
  for (const h of hits) {
    report.add(join(ROOT, path), h.line, `R2 · 业务代码里的网络原语 ${h.what}。铁律 8 与 C6 都点名它；确实需要就进 NETWORK_SITES 并写清为什么它打不破内网部署`)
  }
}
for (const [path, spec] of NETWORK_SITES) {
  const hits = foundNetworkSites.get(path)
  if (!hits) {
    report.add(join(ROOT, path), 0, `R2 · 申报的取数点消失了：${spec.why}。删掉这条申报，或者查清楚谁把它搬走了`)
    continue
  }
  if (!hits[0].source.includes(spec.proof)) {
    report.add(join(ROOT, path), hits[0].line, `R2 · 豁免的理由不再成立：找不到 \`${spec.proof}\`。这条豁免成立的前提就是它，前提没了豁免也没了`)
  }
}

/* R3 · one assembly point --------------------------------------------------- */

if (importsConcrete.size > 1) {
  for (const path of importsConcrete) {
    if (PROVIDER_SITES.has(path)) continue
    report.add(join(ROOT, path), 0, `R3 · 第 ${importsConcrete.size} 个文件 import 了具体 provider 类。装配点必须唯一，否则 v1.5 换 HttpApiProvider 时要改 ${importsConcrete.size} 处`)
  }
}

/* R4 · E2E specs never name a provider -------------------------------------- */

const specs = collectFiles(join(ROOT, 'e2e'), ['.ts']).filter((f) => f.endsWith('.spec.ts'))
for (const file of specs) {
  const stripped = stripCommentsAndStrings(readFileSync(file, 'utf8'))
  for (const hit of matchLines(stripped, /\b\w*Provider\b/)) {
    report.add(file, hit.line, 'R4 · E2E spec 里出现了 provider 字样。E2E 应该只认界面行为；认了 provider，换存储实现时 E2E 会跟着一起改，那就不是回归测试了')
  }
}

/* Floors -------------------------------------------------------------------- */

if (report.filesScanned < MIN_FILES) {
  report.add(join(ROOT, 'scripts/check-provider-swap.mjs'), 0, `扫描面塌了：只看到 ${report.filesScanned} 个文件，下限 ${MIN_FILES}。多半是 collectFiles 的路径写错了，不是仓库变干净了`)
}
if (specs.length < MIN_E2E_SPECS) {
  report.add(join(ROOT, 'scripts/check-provider-swap.mjs'), 0, `R4 扫描面塌了：只看到 ${specs.length} 份 E2E spec，下限 ${MIN_E2E_SPECS}`)
}

report.note(`R1 · provider 构造点 ${foundProviderSites.size} 处，申报 ${PROVIDER_SITES.size} 处`)
for (const [path, why] of PROVIDER_SITES) report.note(`     申报：${path} — ${why}`)
report.note(`R2 · 网络原语命中 ${[...foundNetworkSites.values()].reduce((n, h) => n + h.length, 0)} 处，分布在 ${foundNetworkSites.size} 个文件，申报 ${NETWORK_SITES.size} 个`)
for (const [path, spec] of NETWORK_SITES) report.note(`     申报：${path} — ${spec.why}（凭据 \`${spec.proof}\`）`)
report.note(`R3 · import 具体 provider 类的文件 ${importsConcrete.size} 个`)
report.note(`R4 · 扫了 ${specs.length} 份 E2E spec`)

process.exit(printReport(report, ROOT))
