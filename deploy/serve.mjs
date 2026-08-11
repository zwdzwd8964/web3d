#!/usr/bin/env node
/**
 * T-293 · 零依赖静态服务器。**给「机器上只有 Node，没有 Docker、没有 nginx」的那一档部署用。**
 *
 * ## 为什么不是「随便找个 http-server」
 *
 * 这份部署的目标环境是**断网的内网机器**。装一个 npm 包意味着那台机器要么能出网、要么要
 * 有人把 node_modules 拷进去——两件事在验收现场都不成立。所以这个文件只 import `node:` 内置。
 *
 * ## 与 nginx 模板的关系：**MIME 表只许有一份真源**
 *
 * `deploy/nginx.conf.template` 的 `types` 块是那一份。这里的 `MIME` 必须与它的扩展名集合
 * **逐个相等**，由 `tools/deploy-test/serve.test.mjs` 断言。两份表各自演化的结果是：同一个
 * `.glb` 在容器部署下是 `model/gltf-binary`、在纯进程部署下是 `application/octet-stream`，
 * 而浏览器对后者的处理**取决于版本**——这种缺陷只在其中一种部署形态上出现，最难归因。
 *
 * ⚠ `.w3p` / `.hdr` / `.ktx2` / `.bin` / `.drc` **故意不在表里**，与 nginx 模板 :10-12 的注释
 * 一致：它们走 `application/octet-stream`，因为浏览器不需要认识它们，是我们自己 fetch 的。
 *
 * 用法：
 *   node deploy/serve.mjs                      # 服务 ./dist，端口 8080
 *   node deploy/serve.mjs --root=/srv/w3 --port=80
 *   PORT=3000 W3_ROOT=/srv/w3 node deploy/serve.mjs
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 扩展名 → Content-Type。**键集合与 `deploy/nginx.conf.template` 的 `types` 块相等。**
 *
 * 改这里要同时改那里，反之亦然；`serve.test.mjs` 会当场判红并把差集打出来。
 */
export const MIME = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/json; charset=utf-8',
  wasm: 'application/wasm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  txt: 'text/plain; charset=utf-8',
}

/** 表里没有的一律这个。与 nginx 的 `default_type` 逐字相同。 */
export const DEFAULT_TYPE = 'application/octet-stream'

/**
 * 一次请求该走哪条路。**纯函数**，所以四条穿越路径能在纯 Node 里穷举，不必起服务器。
 *
 * 判据是**解析之后比前缀**，不是「字符串里有没有 `..`」。后者拦得住 `/../etc/passwd`，
 * 拦不住 `/%2e%2e/`（百分号编码）、拦不住 `/a/../../etc`（先进后出），而且会误伤
 * `/assets/index..hash.js` 这种合法文件名。**先解码、再解析、再比前缀**是唯一站得住的顺序。
 *
 * @param rawUrl 请求行里的原样路径（可能带查询串）。
 * @param root 站点根目录的**绝对**路径。
 * @returns `kind: 'file'` 带绝对路径；`kind: 'spa'` 表示回退到某个 index.html；
 *   `kind: 'health'`；`kind: 'deny'` 带中文原因。
 */
export function routeOf(rawUrl, root) {
  const withoutQuery = rawUrl.split('?')[0].split('#')[0]

  // NUL 截断：`/x.html\0.png` 在某些 API 上会被当成 `/x.html`。直接拒，不猜意图。
  if (withoutQuery.includes('\0') || withoutQuery.includes('%00')) {
    return { kind: 'deny', reason: '路径里含 NUL 字节' }
  }

  let decoded
  try {
    decoded = decodeURIComponent(withoutQuery)
  } catch {
    // `%` 后面跟的不是合法十六进制。拒绝而不是原样使用——原样使用等于把解码交给下游。
    return { kind: 'deny', reason: '路径不是合法的百分号编码' }
  }
  if (decoded.includes('\0')) return { kind: 'deny', reason: '解码之后含 NUL 字节' }

  if (decoded === '/healthz') return { kind: 'health' }

  // Windows 上 `\` 也是分隔符，而 URL 里它是一个普通字符——不归一的话
  // `/..\..\etc` 在 Windows 上能穿出去，在 Linux 上不能。归一成 `/` 之后一视同仁。
  const normalised = decoded.split('\\').join('/')

  const target = resolve(root, `.${normalised}`)
  const fence = root.endsWith(sep) ? root : root + sep
  if (target !== root && !target.startsWith(fence)) {
    return { kind: 'deny', reason: '路径解析之后跑到了站点根目录外面' }
  }

  if (existsSync(target) && statSync(target).isFile()) {
    return { kind: 'file', path: target }
  }

  // 目录请求 → 它自己的 index.html
  const indexInDir = join(target, 'index.html')
  if (existsSync(indexInDir) && statSync(indexInDir).isFile()) {
    return { kind: 'file', path: indexInDir }
  }

  // SPA 回退。**两个应用各回各的 index.html**：播放器在 /player/ 下，编辑器在根下。
  // 都回根的那一份，播放器的深链接会打开编辑器——而两个页面都会正常渲染，
  // 所以这个错误在冒烟测试里看起来完全正常。
  const spa = normalised.startsWith('/player/') ? join(root, 'player', 'index.html') : join(root, 'index.html')
  if (existsSync(spa)) return { kind: 'spa', path: spa }

  return { kind: 'deny', reason: '找不到这个文件，站点根目录里也没有 index.html' }
}

/** 一个文件该带什么缓存头。 */
export function cacheHeaderFor(pathname) {
  // 内容哈希在文件名里的那些，可以永久缓存。`/assets/` 与 `/player/assets/` 都算。
  if (/(^|\/)assets\//.test(pathname)) return 'public, max-age=31536000, immutable'
  // **html 永远不许长缓存。** 它是那张「指向当前一批 assets」的名片；缓存住它，
  // 用户会一直加载旧版本，而且刷新也没用——这是升级之后最常见的「怎么还是老的」。
  if (pathname.endsWith('.html')) return 'no-cache'
  return 'public, max-age=3600'
}

/** 扩展名 → Content-Type，表里没有就是 `application/octet-stream`。 */
export function contentTypeFor(pathname) {
  const ext = extname(pathname).slice(1).toLowerCase()
  return MIME[ext] ?? DEFAULT_TYPE
}

/** 起一台服务器。返回它，调用方负责 `listen`。 */
export function createStaticServer(root) {
  const absoluteRoot = resolve(root)
  return createServer((request, response) => {
    const route = routeOf(request.url ?? '/', absoluteRoot)

    // **每一条响应都带 Content-Length。** 不带的话 Node 用分块传输编码，而分块编码有两个
    // 现实代价：浏览器的下载进度条没有总量（一个 80 MB 的模型看起来像卡住了），以及
    // 一部分内网代理会把分块响应整个缓冲下来再转发，把首字节时间拖成整包时间。
    // 静态服务器知道每个文件多大，没有理由不告诉对方。
    if (route.kind === 'health') {
      const body = Buffer.from('ok\n')
      response.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': body.byteLength,
        'Cache-Control': 'no-store',
      })
      response.end(body)
      return
    }

    if (route.kind === 'deny') {
      // 403 而不是 404：**穿越尝试与「文件不存在」是两回事**，日志里要分得开。
      const body = Buffer.from(`403 ${route.reason}\n`)
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.byteLength })
      response.end(body)
      return
    }

    const served = route.path
    response.writeHead(200, {
      'Content-Type': contentTypeFor(served),
      'Content-Length': statSync(served).size,
      'Cache-Control': cacheHeaderFor(served.split(sep).join('/')),
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    createReadStream(served).pipe(response)
  })
}

/* ── 命令行入口 ──────────────────────────────────────────────────────────── */

function argOf(name, fallback) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

/**
 * 直接跑的，还是被 import 的？
 *
 * ⚠ **必须用 `fileURLToPath`，不能用 `new URL(import.meta.url).pathname`。**
 * 后者返回的是**百分号编码**的路径：这个仓库的目录名里有空格，于是它给出
 * `/C:/Users/.../0729%203d%20engine/deploy/serve.mjs`，与 `process.argv[1]` 永远不相等
 * ——判定恒为 false，`node deploy/serve.mjs` 会**静默地什么都不做然后退出**。
 *
 * 这个 bug 是 `pack-offline.mjs --verify` 的第 3 步抓到的（「serve.mjs 8 秒内没起来」）。
 * 单测抓不到它：单测 import 这个模块，走的正是判定为 false 的那一支。
 */
const isEntry = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isEntry) {
  const root = resolve(argOf('root', process.env['W3_ROOT'] ?? 'dist'))
  const port = Number(argOf('port', process.env['PORT'] ?? '8080'))

  if (!existsSync(join(root, 'index.html'))) {
    console.error(`站点根目录 ${root} 里没有 index.html。用 --root=<目录> 指一个构建产物目录。`)
    process.exit(1)
  }

  const server = createStaticServer(root)

  // **keep-alive 连接会让端口在 close() 之后继续被占着。** systemd 的 restart 与
  // 容器的滚动更新都会因此在「地址已被占用」上失败几秒，而那几秒里服务是断的。
  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  const shutdown = (signal) => {
    console.log(`收到 ${signal}，正在停止…`)
    server.close(() => process.exit(0))
    for (const socket of sockets) socket.destroy()
    // 兜底：5 秒还没退就硬退。一个停不下来的进程比一次不优雅的退出糟糕得多。
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  server.listen(port, () => {
    console.log(`Web3D 静态服务器已启动：http://127.0.0.1:${port}  （根目录 ${root}）`)
    console.log('健康检查：/healthz')
  })
}
