#!/usr/bin/env node
/**
 * T-293 · 离线安装包。**一个 tar，拷到断网机器上能起来。**
 *
 * ## 为什么它与「纯进程部署」是同一张卡
 *
 * `--verify` 的第 3 步就是**起 `deploy/serve.mjs` 并 curl 它**。分成两张卡的话，两边会
 * 各写一份 MIME 表——而同一个 `.glb` 在容器部署下是 `model/gltf-binary`、在纯进程部署下
 * 是 `application/octet-stream` 这种缺陷，只在其中一种形态上出现，最难归因。
 *
 * ## 包里有什么
 *
 * | 文件 | 是什么 |
 * |---|---|
 * | `image.tar` | `docker save` 出来的部署镜像。装 Docker 的机器用它 |
 * | `site/` | 静态产物本身。**只装了 Node 的机器用它**，配 `serve.mjs` |
 * | `serve.mjs` · `w3-web.service` · `install-windows-task.ps1` | 纯进程部署的三件套 |
 * | `manifest.json` | 版本、构建时间、镜像标签、每个文件的大小 |
 * | `SHA256SUMS` | 逐文件校验和。**载入脚本第一步就是校验它** |
 * | `载入与启动.md` · `load.sh` · `load.ps1` | 给现场的人 |
 *
 * ⚠ **镜像里不许有 `*.w3p`**。那是用户的作品，不是产品的一部分；打进镜像意味着每一次
 * 部署都在分发别人的场景文件。`--verify` 第 8 步专门查这件事。
 *
 * 用法：
 *   node scripts/pack-offline.mjs              # 打包到 dist-offline/
 *   node scripts/pack-offline.mjs --verify     # 打包并跑完九步自检
 *   node scripts/pack-offline.mjs --out=/tmp/x # 换输出目录
 */

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IMAGE_TAG = 'web3d-deploy:offline'
const VERIFY_PORT = 18294

const args = process.argv.slice(2)
const verify = args.includes('--verify')
const outArg = args.find((a) => a.startsWith('--out='))
const OUT = resolve(ROOT, outArg ? outArg.slice(6) : 'dist-offline')

const steps = []
let failed = 0

/** 跑一步，把结果记进清单。**每一步都有名字**，因为失败时人要知道卡在第几步。 */
function step(n, what, body) {
  process.stdout.write(`  ${n}. ${what} … `)
  try {
    const detail = body()
    steps.push({ n, what, ok: true, detail: detail ?? '' })
    console.log(`ok${detail ? `（${detail}）` : ''}`)
  } catch (error) {
    failed += 1
    steps.push({ n, what, ok: false, detail: error.message })
    console.log('失败')
    console.log(`     ${error.message}`)
  }
}

function run(cmd, cmdArgs, options = {}) {
  return execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
}

/** 一个目录下所有文件的相对路径，排序稳定。 */
function walk(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full, base))
    else out.push(relative(base, full).split('\\').join('/'))
  }
  return out
}

/* ── 打包 ────────────────────────────────────────────────────────────────── */

console.log(`离线安装包 → ${OUT}`)
rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'site'), { recursive: true })

const editorDist = join(ROOT, 'packages/editor/dist')
const playerDist = join(ROOT, 'packages/player/dist')
if (!existsSync(editorDist) || !existsSync(playerDist)) {
  console.error('找不到构建产物。先跑 `pnpm build`，再跑本脚本。')
  process.exit(1)
}

// site/ 的目录结构与 Dockerfile 的三条 COPY 逐字一致。两边不一致的话，
// 「装 Docker 的机器」与「只有 Node 的机器」会看到两个不同的站点。
cpSync(editorDist, join(OUT, 'site'), { recursive: true })
cpSync(playerDist, join(OUT, 'site/player'), { recursive: true })
cpSync(join(ROOT, 'vendor'), join(OUT, 'site/vendor'), { recursive: true })

for (const file of ['deploy/serve.mjs', 'deploy/w3-web.service', 'deploy/install-windows-task.ps1']) {
  copyFileSync(join(ROOT, file), join(OUT, file.split('/').pop()))
}
for (const file of ['载入与启动.md', 'load.sh', 'load.ps1']) {
  const from = join(ROOT, 'deploy/offline', file)
  if (existsSync(from)) copyFileSync(from, join(OUT, file))
}

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version ?? '0.0.0'
const builtAt = new Date().toISOString()

console.log('  构建部署镜像 …')
run('docker', ['build', '-t', IMAGE_TAG, '.'], { stdio: ['ignore', 'inherit', 'inherit'] })
run('docker', ['save', '-o', join(OUT, 'image.tar'), IMAGE_TAG], { stdio: ['ignore', 'inherit', 'inherit'] })

const files = walk(OUT).filter((f) => f !== 'SHA256SUMS' && f !== 'manifest.json')
const sums = files
  .map((f) => `${createHash('sha256').update(readFileSync(join(OUT, f))).digest('hex')}  ${f}`)
  .join('\n')
writeFileSync(join(OUT, 'SHA256SUMS'), sums + '\n')

writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify(
    {
      version,
      builtAt,
      imageTag: IMAGE_TAG,
      files: files.map((f) => ({ path: f, bytes: statSync(join(OUT, f)).size })),
    },
    null,
    2,
  ) + '\n',
)

console.log(`  打好了：${files.length + 2} 个文件`)

if (!verify) {
  console.log('（没跑自检。加 --verify 跑九步。）')
  process.exit(0)
}

/* ── 九步自检 ────────────────────────────────────────────────────────────── */

console.log('')
console.log('九步自检：')

step(1, 'SHA256SUMS 逐文件校验', () => {
  let checked = 0
  for (const line of readFileSync(join(OUT, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
    const [want, path] = line.split(/\s{2,}/)
    const got = createHash('sha256').update(readFileSync(join(OUT, path))).digest('hex')
    if (got !== want) throw new Error(`${path} 校验和对不上：期望 ${want.slice(0, 12)}… 实际 ${got.slice(0, 12)}…`)
    checked += 1
  }
  if (checked < 5) throw new Error(`只校验了 ${checked} 个文件，清单多半是空的`)
  return `${checked} 个文件`
})

step(2, 'manifest.json 的文件清单与实际一致', () => {
  const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'))
  const declared = new Set(manifest.files.map((f) => f.path))
  const actual = new Set(walk(OUT).filter((f) => f !== 'SHA256SUMS' && f !== 'manifest.json'))
  const missing = [...actual].filter((f) => !declared.has(f))
  const extra = [...declared].filter((f) => !actual.has(f))
  if (missing.length || extra.length) throw new Error(`清单与实际不符：多 ${extra.length} 少 ${missing.length}`)
  return `${declared.size} 条`
})

step(3, '起 serve.mjs 并 curl 它（这是与纯进程部署共用的那一份）', () => {
  const child = spawn(process.execPath, [join(OUT, 'serve.mjs'), `--root=${join(OUT, 'site')}`, `--port=${VERIFY_PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    const deadline = Date.now() + 8000
    for (;;) {
      const up = probe(VERIFY_PORT)
      if (up) break
      if (Date.now() > deadline) throw new Error('serve.mjs 8 秒内没起来')
      sleep(100)
    }
    const health = httpGet(VERIFY_PORT, '/healthz')
    if (!health.body.startsWith('ok')) throw new Error(`/healthz 返回的是「${health.body.trim()}」`)

    const player = httpGet(VERIFY_PORT, '/player/deep/link')
    if (player.status !== 200) throw new Error(`/player/deep/link 返回 ${player.status}`)
    if (!/播放器|Player/i.test(player.body)) throw new Error('/player/ 的 SPA 回退没返回播放器那一份')

    const root = httpGet(VERIFY_PORT, '/deep/link')
    if (!/编辑器|Editor/i.test(root.body)) throw new Error('/ 的 SPA 回退没返回编辑器那一份')

    const denied = httpGet(VERIFY_PORT, '/%2e%2e/%2e%2e/etc/passwd')
    if (denied.status !== 403) throw new Error(`穿越路径返回 ${denied.status}，应当是 403`)
    return '健康检查 / 两条 SPA 回退 / 一条穿越'
  } finally {
    child.kill('SIGKILL')
  }
})

step(4, '站点里有 index.html 与 player/index.html', () => {
  for (const f of ['site/index.html', 'site/player/index.html']) {
    if (!existsSync(join(OUT, f))) throw new Error(`缺 ${f}`)
  }
  // 两份必须可区分，否则「player 回退回了根那一份」这种错在冒烟里完全正常。
  const a = readFileSync(join(OUT, 'site/index.html'), 'utf8')
  const b = readFileSync(join(OUT, 'site/player/index.html'), 'utf8')
  if (a === b) throw new Error('两份 index.html 内容一模一样，SPA 回退错了也看不出来')
  return '两份可区分'
})

step(5, 'vendor/ 里的三方运行时资源在包里', () => {
  const dir = join(OUT, 'site/vendor')
  if (!existsSync(dir)) throw new Error('site/vendor 不存在——断网机器上 Draco / KTX2 会白屏')
  const n = walk(dir).length
  if (n < 5) throw new Error(`site/vendor 里只有 ${n} 个文件，多半没拷全`)
  return `${n} 个文件`
})

step(6, 'image.tar 是一个能被 docker load 认的包', () => {
  const bytes = statSync(join(OUT, 'image.tar')).size
  if (bytes < 1_000_000) throw new Error(`image.tar 只有 ${bytes} 字节，多半是空的`)
  // 只列内容不真 load：真 load 会污染跑 CI 那台机器的镜像库，而这一步要证的是
  // 「这个 tar 的结构是对的」。真 load 由 `载入与启动.md` 里那条命令在现场做。
  // GNU tar 在 Windows 上会把 `C:\...` 当成 `host:path` 去解析主机名（实测：
  // 「tar: Cannot connect to C: resolve failed」）。改成在 OUT 目录里用相对文件名。
  const listing = run('tar', ['-tf', 'image.tar'], { cwd: OUT })
  if (!listing.includes('manifest.json')) throw new Error('image.tar 里没有 manifest.json，不是 docker save 出来的')
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
})

step(7, '产物里零外链（C6 在部署产物上的最后一道复检）', () => {
  const offenders = []
  for (const rel of walk(join(OUT, 'site'))) {
    if (!/\.(html|js|mjs|css|json|webmanifest)$/.test(rel)) continue
    const text = readFileSync(join(OUT, 'site', rel), 'utf8')
    // 只认真正会发请求的形态：属性里的绝对 URL。散文与注释里出现 https:// 是允许的。
    const m = text.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi)
    if (m) offenders.push(`${rel} → ${m[0].slice(0, 70)}`)
  }
  if (offenders.length) throw new Error(`产物里有外链：\n       ${offenders.join('\n       ')}`)
  return '零条'
})

step(8, '镜像里不含 *.w3p（那是用户的作品，不是产品的一部分）', () => {
  const out = run('docker', ['run', '--rm', '--entrypoint', 'sh', IMAGE_TAG, '-c', "find /usr/share/nginx/html -name '*.w3p' | head -20"])
  const hits = out.trim().split('\n').filter(Boolean)
  if (hits.length) throw new Error(`镜像里有 ${hits.length} 个 .w3p：${hits.join(' ')}`)
  return '零个'
})

step(9, '三份现场文档都在包里', () => {
  for (const f of ['载入与启动.md', 'load.sh', 'load.ps1']) {
    if (!existsSync(join(OUT, f))) throw new Error(`缺 ${f}——现场的人没有说明书`)
  }
  return '三份'
})

console.log('')
if (failed > 0) {
  console.error(`FAIL  离线安装包自检 — 九步里 ${failed} 步没过`)
  process.exit(1)
}
console.log('PASS  离线安装包自检 · 九步全过')

/* ── 小工具 ──────────────────────────────────────────────────────────────── */

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function probe(port) {
  try {
    execFileSync(process.execPath, ['-e', `require('net').connect(${port},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))`], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/** 裸 socket 的 GET，**路径原样不归一**——`fetch` 会把 `%2e%2e` 提前解掉。 */
function httpGet(port, path) {
  const script = `
const s = require('net').connect(${port}, '127.0.0.1')
let buf = ''
s.on('connect', () => s.write('GET ' + process.argv[1] + ' HTTP/1.1\\r\\nHost: h\\r\\nConnection: close\\r\\n\\r\\n'))
s.on('data', (d) => (buf += d))
s.on('end', () => { process.stdout.write(buf); process.exit(0) })
s.on('error', () => process.exit(1))
`
  const raw = execFileSync(process.execPath, ['-e', script, path], { encoding: 'utf8' })
  const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1] ?? 0)
  const body = raw.slice(raw.indexOf('\r\n\r\n') + 4)
  return { status, body }
}
