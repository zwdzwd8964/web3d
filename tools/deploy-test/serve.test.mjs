#!/usr/bin/env node
/**
 * T-293 · `deploy/serve.mjs` 的契约。**跑在 `node --test` 上，无浏览器、无 Docker。**
 *
 * 用 node 自带的测试运行器而不是 vitest，理由与被测对象一样：这份东西要能在一台
 * **只装了 Node** 的机器上验证。把它挂进 vitest，验证它就需要先 `pnpm install`。
 *
 * 用法：node --test tools/deploy-test/serve.test.mjs
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, test } from 'node:test'
import { MIME, cacheHeaderFor, contentTypeFor, createStaticServer, routeOf } from '../../deploy/serve.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** 造一个最小站点：根 index.html、player/index.html、一个 assets、一个 glb。 */
function makeSite() {
  const dir = mkdtempSync(join(tmpdir(), 'w3-serve-'))
  mkdirSync(join(dir, 'player'), { recursive: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })
  mkdirSync(join(dir, 'player', 'assets'), { recursive: true })
  // **两份 index.html 的内容必须可区分。** 否则「SPA 回退回错了那一份」这条变异是绿的
  // ——两个都返回 200、都是 html，只有内容不同。
  writeFileSync(join(dir, 'index.html'), '<title>Web3D 工具引擎 · 编辑器</title>')
  writeFileSync(join(dir, 'player', 'index.html'), '<title>Web3D 播放器</title>')
  writeFileSync(join(dir, 'assets', 'app.js'), 'export const x = 1')
  writeFileSync(join(dir, 'pump.glb'), 'glTF fake')
  return dir
}

describe('MIME 表与 nginx 模板同源', () => {
  test('扩展名集合与 nginx types 块**逐个相等**', () => {
    const template = readFileSync(join(ROOT, 'deploy/nginx.conf.template'), 'utf8')
    const block = template.slice(template.indexOf('types {'), template.indexOf('}', template.indexOf('types {')))
    assert.ok(block.length > 50, 'nginx 模板里没抽到 types 块——抽取面坏了，不是模板变简单了')

    const fromNginx = new Set()
    for (const line of block.split(/\r?\n/)) {
      const m = /^\s*[\w./+-]+\s+([^;]+);/.exec(line)
      if (!m) continue
      for (const ext of m[1].trim().split(/\s+/)) fromNginx.add(ext)
    }

    const fromServe = new Set(Object.keys(MIME))
    const missing = [...fromNginx].filter((e) => !fromServe.has(e))
    const extra = [...fromServe].filter((e) => !fromNginx.has(e))

    // 两个方向都报。只查一个方向的话，「nginx 加了一条、serve 没加」与
    // 「serve 加了一条、nginx 没加」里总有一种是隐形的。
    assert.deepEqual(missing, [], `serve.mjs 的 MIME 表缺这些扩展名（nginx 有）：${missing.join(' ')}`)
    assert.deepEqual(extra, [], `serve.mjs 的 MIME 表多这些扩展名（nginx 没有）：${extra.join(' ')}`)
    assert.ok(fromNginx.size >= 15, `只从 nginx 模板抽到 ${fromNginx.size} 个扩展名，抽取面坏了`)
  })

  test('.glb 是 model/gltf-binary，不是八位字节流', () => {
    assert.equal(contentTypeFor('/x/pump.glb'), 'model/gltf-binary')
  })

  test('.w3p 故意不在表里，走默认类型', () => {
    // 与 nginx 模板 :10-12 的注释一致：它是我们自己 fetch 的，浏览器不需要认识它。
    assert.equal(contentTypeFor('/a.w3p'), 'application/octet-stream')
  })
})

describe('路径穿越 · 四种写法全部拒绝', () => {
  const site = makeSite()
  after(() => rmSync(site, { recursive: true, force: true }))

  const CASES = [
    ['/../../etc/passwd', '直白的相对路径'],
    ['/%2e%2e/%2e%2e/etc/passwd', '百分号编码的 ..'],
    ['/x%00.png', 'NUL 截断'],
    ['/..\\..\\windows\\win.ini', 'Windows 的反斜杠'],
  ]

  for (const [url, why] of CASES) {
    test(`${why}：${url} → 拒绝`, () => {
      const route = routeOf(url, site)
      // 断的是 deny 而不是「不等于 file」：回退到 SPA 也是「不等于 file」，
      // 而那意味着穿越请求拿到了 200 和一份 html。
      assert.equal(route.kind, 'deny', `${url} 应当被拒，实际是 ${route.kind}`)
    })
  }

  test('合法的深层路径不被误伤', () => {
    assert.equal(routeOf('/assets/app.js', site).kind, 'file')
    assert.equal(routeOf('/player/index.html', site).kind, 'file')
  })

  test('文件名里带 .. 的合法文件不被误伤', () => {
    writeFileSync(join(site, 'assets', 'index..hash.js'), 'ok')
    // 「路径里有 .. 就拒」的实现会把这一条也拒掉，而它是一个合法文件名。
    assert.equal(routeOf('/assets/index..hash.js', site).kind, 'file')
  })
})

describe('SPA 回退 · 两个应用各回各的', () => {
  const site = makeSite()
  after(() => rmSync(site, { recursive: true, force: true }))

  test('/player/whatever → player/index.html', () => {
    const route = routeOf('/player/whatever', site)
    assert.equal(route.kind, 'spa')
    assert.match(readFileSync(route.path, 'utf8'), /播放器/)
  })

  test('/whatever → 根 index.html', () => {
    const route = routeOf('/whatever', site)
    assert.equal(route.kind, 'spa')
    assert.match(readFileSync(route.path, 'utf8'), /编辑器/)
  })
})

describe('缓存头', () => {
  test('/assets/ 下的东西 immutable', () => {
    assert.match(cacheHeaderFor('/assets/app-abc123.js'), /immutable/)
    assert.match(cacheHeaderFor('/player/assets/app-abc123.js'), /immutable/)
  })

  test('.html 是 no-cache', () => {
    // 缓存住 index.html，用户升级之后会一直加载旧版本，而且刷新也没用。
    assert.equal(cacheHeaderFor('/index.html'), 'no-cache')
    assert.equal(cacheHeaderFor('/player/index.html'), 'no-cache')
  })
})

describe('真的起一台服务器', () => {
  let site
  let server
  let base

  before(async () => {
    site = makeSite()
    server = createStaticServer(site)
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    base = `http://127.0.0.1:${server.address().port}`
  })

  after(async () => {
    await new Promise((done) => server.close(done))
    rmSync(site, { recursive: true, force: true })
  })

  test('/healthz → 200 ok', async () => {
    const response = await fetch(`${base}/healthz`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'ok\n')
  })

  test('/player/deep/link → 200 且内容是播放器那一份', async () => {
    const response = await fetch(`${base}/player/deep/link`)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /播放器/)
  })

  test('/deep/link → 200 且内容是编辑器那一份', async () => {
    const response = await fetch(`${base}/deep/link`)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /编辑器/)
  })

  test('.glb 带正确的 Content-Type', async () => {
    const response = await fetch(`${base}/pump.glb`)
    assert.equal(response.headers.get('content-type'), 'model/gltf-binary')
  })

  /**
   * ⚠ **这一条必须用裸 socket，不能用 `fetch`。**
   *
   * `fetch` 会在**发出去之前**把 `/%2e%2e/%2e%2e/etc/passwd` 归一成 `/etc/passwd`——
   * 于是服务器收到的根本不是穿越路径，它按 SPA 回退返回 200 和一份 index.html，
   * 而断言 403 当场红。第一版就是这么红的，红得对：**那条测试测的是 undici 的归一化，
   * 不是我的服务器**。真正会发原样路径的是攻击者的裸连接与 `curl --path-as-is`。
   */
  test('穿越请求（裸 socket 发原样路径）拿到 403', async () => {
    const status = await rawGet(server.address().port, '/%2e%2e/%2e%2e/etc/passwd')
    assert.equal(status, 403, '原样发过去的穿越路径必须被拒')
  })

  test('裸 socket 发合法路径仍然 200 —— 上一条不是把所有裸请求都拒了', async () => {
    // 少了这一条，把 `rawGet` 的一切都返回 403 的实现也能让上一条绿。
    assert.equal(await rawGet(server.address().port, '/healthz'), 200)
  })
})

describe('停机 · SIGTERM 之后端口要还回来', () => {
  /**
   * 卡面要求「SIGTERM 后端口在 2s 内释放」。
   *
   * 这条测的是 keep-alive 连接：`server.close()` **不会**断开已经建立的连接，它只是不再
   * 接受新的。于是一个还开着标签页的浏览器能让端口一直被占着——systemd 的 restart 与
   * 容器滚动更新都会撞上「地址已被占用」，而那几秒里服务是断的。
   *
   * 所以这条测试**故意先建一条 keep-alive 连接再发信号**。不建的话，任何实现都能过。
   *
   * ⚠ Windows 上没有真正的 SIGTERM。`process.kill(pid, 'SIGTERM')` 在 Windows 会直接
   * 终止进程——那样测的是「进程死了端口自然还回来」，与优雅停机无关。所以这一条
   * **在 Windows 上跳过并说明原因**，而不是假装它通过了。
   */
  test('建了 keep-alive 连接也能在 2 秒内还回端口', { skip: process.platform === 'win32' ? 'Windows 没有真 SIGTERM，这条只在 POSIX 上有意义' : false }, async () => {
    const site = makeSite()
    const port = 18293
    const child = spawn(process.execPath, [join(ROOT, 'deploy/serve.mjs'), `--root=${site}`, `--port=${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    try {
      await waitForPort(port, 5000)

      // 一条不关的 keep-alive 连接 —— 这是这条测试的全部意义。
      const held = connect(port, '127.0.0.1')
      await new Promise((done) => held.once('connect', done))
      held.write('GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n')
      await new Promise((done) => held.once('data', done))

      const startedAt = Date.now()
      child.kill('SIGTERM')
      await waitForPortFree(port, 2000)
      assert.ok(Date.now() - startedAt < 2000, '端口没在 2 秒内还回来')
      held.destroy()
    } finally {
      child.kill('SIGKILL')
      rmSync(site, { recursive: true, force: true })
    }
  })
})

/** 等到端口能连上。 */
async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const ok = await new Promise((done) => {
      const probe = connect(port, '127.0.0.1')
      probe.once('connect', () => (probe.destroy(), done(true)))
      probe.once('error', () => done(false))
    })
    if (ok) return
    if (Date.now() > deadline) throw new Error(`端口 ${port} 在 ${timeoutMs}ms 内没起来`)
    await new Promise((done) => setTimeout(done, 50))
  }
}

/** 等到端口连不上（= 已释放）。 */
async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const busy = await new Promise((done) => {
      const probe = connect(port, '127.0.0.1')
      probe.once('connect', () => (probe.destroy(), done(true)))
      probe.once('error', () => done(false))
    })
    if (!busy) return
    if (Date.now() > deadline) throw new Error(`端口 ${port} 在 ${timeoutMs}ms 内没被释放`)
    await new Promise((done) => setTimeout(done, 50))
  }
}

/** 用裸 TCP 发一个 GET，**路径原样不归一**，返回状态码。 */
async function rawGet(port, path) {
  const socket = connect(port, '127.0.0.1')
  await new Promise((done) => socket.once('connect', done))
  socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`)
  let buffer = ''
  for await (const chunk of socket) buffer += chunk
  return Number(/^HTTP\/1\.1 (\d{3})/.exec(buffer)?.[1] ?? 0)
}
