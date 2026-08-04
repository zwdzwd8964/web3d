#!/usr/bin/env node
/**
 * Constitution C6 · zero external runtime dependencies.
 *
 * Draco and KTX2/Basis decoders are WASM blobs that three.js does NOT bundle into
 * its module graph — the loaders fetch them at runtime. The three.js examples fetch
 * them from a CDN. On a customer intranet that is a white screen, and it is always
 * discovered on go-live day (anti-pattern A7).
 *
 * So we copy them out of the locked `three` dependency into vendor/, commit them,
 * and serve them from our own origin. Source is a pinned dependency, never the network,
 * which keeps `--offline` builds honest.
 *
 * Run: node scripts/sync-vendor.mjs [--check]
 *   --check  verify vendor/ is in sync with the installed three, exit 1 if not
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK_ONLY = process.argv.includes('--check')
const REQUIRE_BUILD = process.argv.includes('--require-build')

/**
 * T-220 · below this the walk is broken rather than `vendor/` empty.
 *
 * The verdict above used to be `srcFiles.length === dstFiles.length && every(...)`, which is
 * `0 === 0` plus a vacuous `every` when both walks come back empty — **恒真**. D36's M6 shape,
 * and it was living on the very command T-220's self-test leans on
 * (「`sync-vendor --check` 必须仍绿」). 10 files today.
 */
const MIN_VENDOR_FILES = 8

/**
 * T-220 · what a built `dist/assets` must still contain.
 *
 * **This is ADR-0012's undo condition #2 becoming a machine.** That ADR says, in prose:
 * 「升级 three 时必须复验：构建后确认 `dist/assets/` 里仍有 draco/basis 产物」. Nothing read it.
 *
 * The failure it guards is silent and total: three stops resolving its decoders through
 * `import.meta.url`, the bundler stops emitting them, `dist` quietly loses the files —
 * and `--check` stays green the whole time, because `vendor/` still matches three. The first
 * symptom is a white page on an air-gapped intranet (anti-pattern A7), months later.
 */
const BUILT_DECODERS = [
  ['packages/editor/dist/assets', /draco.*\.wasm$/i, 'editor 的 Draco 解码器'],
  ['packages/editor/dist/assets', /basis_transcoder.*\.wasm$/i, 'editor 的 KTX2 transcoder'],
  ['packages/player/dist/assets', /draco.*\.wasm$/i, 'player 的 Draco 解码器'],
  ['packages/player/dist/assets', /basis_transcoder.*\.wasm$/i, 'player 的 KTX2 transcoder'],
]

/** @type {{ from: string, to: string, label: string }[]} */
const COPIES = [
  { from: 'examples/jsm/libs/draco', to: 'vendor/draco', label: 'Draco decoder' },
  { from: 'examples/jsm/libs/basis', to: 'vendor/basis', label: 'KTX2 / Basis transcoder' },
]

function findThreeRoot() {
  // Resolve through the workspace, not through hoisting: @w3/core is the declared owner.
  const candidates = [
    join(ROOT, 'packages/core/node_modules/three'),
    join(ROOT, 'node_modules/three'),
  ]
  for (const c of candidates) if (existsSync(join(c, 'package.json'))) return c
  const pnpmDir = join(ROOT, 'node_modules/.pnpm')
  if (existsSync(pnpmDir)) {
    const hit = readdirSync(pnpmDir).find((d) => /^three@/.test(d))
    if (hit) {
      const p = join(pnpmDir, hit, 'node_modules/three')
      if (existsSync(join(p, 'package.json'))) return p
    }
  }
  return null
}

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, base, out)
    else out.push(relative(base, full).split('\\').join('/'))
  }
  return out
}

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex')

const threeRoot = findThreeRoot()
if (!threeRoot) {
  console.error('[sync-vendor] three.js not found. Run `pnpm install` first.')
  process.exit(1)
}
const threeVersion = JSON.parse(readFileSync(join(threeRoot, 'package.json'), 'utf8')).version

let drift = 0
let copied = 0
let checked = 0

for (const { from, to, label } of COPIES) {
  const src = join(threeRoot, from)
  const dst = join(ROOT, to)
  if (!existsSync(src)) {
    console.error(`[sync-vendor] missing in three@${threeVersion}: ${from}`)
    process.exit(1)
  }

  if (CHECK_ONLY) {
    if (!existsSync(dst)) {
      console.error(`[sync-vendor] MISSING  ${to}  (${label})`)
      drift++
      continue
    }
    const srcFiles = walk(src).sort()
    // `VENDOR.md` names a file that does not exist anywhere in this repository — the notes
    // beside the decoders are `README.md`, and three ships one under the same name, so the
    // two sides happen to line up and this filter is a no-op. Left as-is deliberately:
    // "fixing" it to `README.md` filters one side only and turns a matching pair into a
    // count mismatch — measured, T-220 did exactly that and got two spurious DRIFTs.
    const dstFiles = walk(dst).filter((f) => f !== 'VENDOR.md').sort()
    const same =
      srcFiles.length === dstFiles.length &&
      srcFiles.every(
        (f, i) => f === dstFiles[i] && sha1(readFileSync(join(src, f))) === sha1(readFileSync(join(dst, f))),
      )
    checked += dstFiles.length
    if (!same) {
      console.error(`[sync-vendor] DRIFT    ${to}  (differs from three@${threeVersion})`)
      drift++
    } else {
      console.log(`[sync-vendor] ok       ${to}  (${dstFiles.length} file(s))`)
    }
    continue
  }

  rmSync(dst, { recursive: true, force: true })
  mkdirSync(dst, { recursive: true })
  cpSync(src, dst, { recursive: true })
  const n = walk(dst).length
  copied += n
  console.log(`[sync-vendor] copied ${String(n).padStart(3)} file(s)  ${from} -> ${to}   (${label})`)
}

if (CHECK_ONLY) {
  console.log(`[sync-vendor] 比对 ${checked} 个文件 / 不一致 ${drift} 处`)

  // 下限断在文件数上，不是断在 drift 上：drift 今天合法地是 0，拿它当下限这条守卫
  // 当天就无法通过；而 glob 或 three 的目录结构一变，文件数会掉到 0，这条正为它准备。
  if (checked < MIN_VENDOR_FILES) {
    console.error(
      `[sync-vendor] 扫描面塌了：只比对了 ${checked} 个文件，下限 ${MIN_VENDOR_FILES}。` +
        `多半是 three 的目录结构变了或 COPIES 写错了，不是 vendor/ 变空了 —— ` +
        `两侧同时为空时「逐文件 sha1 全部相等」是恒真的`,
    )
    drift++
  }

  // ADR-0012 的撤销条件 #2，第一次变成机器。见 BUILT_DECODERS 的注释。
  if (REQUIRE_BUILD) {
    for (const [dir, pattern, label] of BUILT_DECODERS) {
      const full = join(ROOT, dir)
      if (!existsSync(full)) {
        console.error(`[sync-vendor] ${dir} 不存在 —— 先跑 pnpm build，或去掉 --require-build`)
        drift++
        continue
      }
      const hit = readdirSync(full).filter((f) => pattern.test(f))
      if (hit.length === 0) {
        console.error(
          `[sync-vendor] ${dir} 里找不到${label} —— **打包器不再同源产出解码器了**。` +
            `three 若改掉 import.meta.url 的解析方式，dist 会悄悄少掉它们，而本脚本的 --check 照样绿，` +
            `第一个症状是内网白屏（ADR-0012 撤销条件 #2）`,
        )
        drift++
      } else {
        console.log(`[sync-vendor] ok       ${dir}  ${label} → ${hit[0]}`)
      }
    }
  }

  if (drift > 0) {
    console.error(`\n[sync-vendor] vendor/ is out of sync with three@${threeVersion}.`)
    console.error('              Run: node scripts/sync-vendor.mjs')
    process.exit(1)
  }
  console.log(`\n[sync-vendor] vendor/ matches three@${threeVersion}.`)
  process.exit(0)
}

console.log(`\n[sync-vendor] ${copied} file(s) vendored from three@${threeVersion}.`)
