import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { buildScenePackage } from '../fixtures/scene-package.js'

/**
 * T-276 · 真跨源宿主页面套 iframe。
 *
 * ## 为什么要凭空造一个 origin，而不是再起一个 dev server
 *
 * 第三个 dev server 只能给出**另一个 127.0.0.1 端口**，而「跨源」在浏览器眼里是
 * scheme + host + port 三元组不同——同 host 不同端口确实算跨源，但它跨不出
 * `resolveSource` / CORS / sandbox 三条真实的坎（本地地址在测试里到处被放行）。
 * `page.route` + `route.fulfill` 造出的 `https://host.example` 是**真的另一个源**：
 * 它有另一个 scheme、另一个 host，浏览器对它一视同仁。
 *
 * 顺带一个副作用比省一个进程更重要：**策略文件也由路由伪造，于是「策略在不在」本身
 * 成为被测对象**。用例 2 把 `embed-policy.json` 路由成 404，测的正是「取不到白名单时
 * 是谁都不许嵌，还是谁都可以嵌」——这条分支在真服务器上只能靠删文件来触发。
 *
 * ## 四条用例
 *
 * | | 场景 | 期望 |
 * |---|---|---|
 * | 1 | 白名单里有宿主 | 握手成功、命令可用、截图是真图、零外部请求 |
 * | 2 | 策略文件 404 | 握不上手，且明确回了一条 `origin-denied`（**不是全通**） |
 * | 3 | 宿主不在白名单 | 握不上手，且**第二条命令起完全沉默**（防放大器） |
 * | 4 | 地址没带 `?embed=1` | 握不上手（嵌入层根本没下载） |
 */

/**
 * 关掉 Chrome 的「本地网络访问」拦截。
 *
 * 造出来的宿主是 `https://host.example`，浏览器把它归为**公网页面**；而播放器跑在
 * `127.0.0.1`，属于本地网络。Chrome 默认拦下这个方向的请求（Local / Private Network
 * Access），iframe 会停在 `chrome-error://chromewebdata/`，一行日志都没有。
 *
 * **这不是在绕过被测的规则**：真实部署里宿主和播放器要么同在客户内网（私网 → 私网），
 * 要么同在公网，两种都不触发这条拦截。它是「凭空造一个公网 origin」这个手法的副产物，
 * 与被测的 origin 白名单、`?embed=1`、CORS 三条毫无关系。放在 `test.use` 里而不是
 * `playwright.config.ts`：只有这一份 spec 需要它。
 */
test.use({
  launchOptions: {
    args: [
      '--enable-unsafe-swiftshader',
      '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessChecks',
    ],
  },
})

const HOST = 'https://host.example'
const PLAYER = 'http://127.0.0.1:5274'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 宿主页面的尺寸。截图的宽高要和它对得上——这是「与请求一致」的可断言形式。 */
const STAGE = { width: 640, height: 400 }

/* ── 被嵌的那份包与那份 SDK ────────────────────────────────────────────────── */

/**
 * 宿主拿到的那份 SDK —— **构建产物本身**，不是源码。
 *
 * 客户拷进页面的是 `dist/embed.js`，所以被测的就该是它。源码比产物新时重新构建一次：
 * 少了这一步，改完 SDK 忘了构建的那次跑，测的是上一版的 SDK 而它照绿。
 */
function sdkBundle(): string {
  const dist = join(ROOT, 'packages', 'player', 'dist', 'embed.js')
  const source = join(ROOT, 'packages', 'player', 'src', 'embed-sdk', 'index.ts')
  const stale = !existsSync(dist) || statSync(dist).mtimeMs < statSync(source).mtimeMs
  if (stale) {
    execSync('pnpm -F @w3/player build:embed', { cwd: ROOT, stdio: 'inherit' })
  }
  return readFileSync(dist, 'utf8')
}

/* ── 宿主页面 ─────────────────────────────────────────────────────────────── */

/**
 * 一个真外部站点的页面。
 *
 * 它只用 `<script src>` 拿 SDK（**从播放器那个 origin 取，于是脚本本身也是跨源加载的**），
 * 其余全部走全局函数，好让 Playwright 从 Node 侧驱动。页面里没有一个 `import`——
 * 客户的页面通常也没有。
 */
const HOST_HTML = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>宿主页面</title>
<style>html,body{margin:0;padding:0}#stage{width:${STAGE.width}px;height:${STAGE.height}px}</style>
</head><body>
<div id="stage"></div><div id="probe"></div>
<script src="${PLAYER}/player/embed.js"></script>
<script>
window.__log = []
window.__events = []
window.addEventListener('message', function (e) {
  if (e.data && typeof e.data === 'object' && e.data.kind) window.__log.push({ origin: e.origin, data: e.data })
})

window.__mount = function (src, timeoutMs) {
  return W3Player.mount({ src: src, container: document.getElementById('stage'), timeoutMs: timeoutMs })
    .then(function (handle) {
      window.__handle = handle
      return { ok: true, commands: handle.commands, protocol: handle.protocol, scene: handle.scene }
    })
    .catch(function (error) { return { ok: false, code: error.code, message: error.message } })
}

window.__do = function (method, args) {
  var handle = window.__handle
  return Promise.resolve()
    .then(function () { return handle[method].apply(handle, args || []) })
    .then(function (value) { return { ok: true, value: value } })
    .catch(function (error) { return { ok: false, code: error.code, message: error.message } })
}

window.__listen = function (name) {
  window.__handle.on(name, function (payload) { window.__events.push({ name: name, payload: payload }) })
}

/** 截图 —— 解码之后回报，**不只回报「有没有」**。 */
window.__shot = function () {
  return window.__handle.screenshot().then(function (result) {
    var url = result && result.dataUrl
    if (!url) return { error: 'no dataUrl' }
    var binary = atob(url.slice(url.indexOf(',') + 1))
    return new Promise(function (resolve) {
      var image = new Image()
      image.onload = function () {
        var scratch = document.createElement('canvas')
        scratch.width = image.width
        scratch.height = image.height
        var ctx = scratch.getContext('2d')
        ctx.drawImage(image, 0, 0)
        var data = ctx.getImageData(0, 0, scratch.width, scratch.height).data
        var seen = {}
        var opaque = 0
        for (var i = 0; i < data.length; i += 4 * 97) {
          seen[(data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4)] = 1
          if (data[i + 3] === 255) opaque++
        }
        var frame = document.querySelector('#stage iframe')
        resolve({
          bytes: binary.length,
          width: image.width,
          height: image.height,
          colours: Object.keys(seen).length,
          opaque: opaque,
          frameWidth: frame ? frame.clientWidth : 0,
          frameHeight: frame ? frame.clientHeight : 0,
        })
      }
      image.onerror = function () { resolve({ error: 'decode failed' }) }
      image.src = url
    })
  }).catch(function (error) { return { error: (error && error.code) + ': ' + (error && error.message) } })
}

/**
 * 不走 SDK 的裸探针：连发三条命令，把**每一条回执**都收下来。
 *
 * 握不上手时 SDK 只会 reject 一次，看不出「回了几条拒绝」——而「第二条起沉默」正是
 * 防放大器那条纪律的全部内容。
 */
window.__probe = function (src) {
  return new Promise(function (resolve) {
    var replies = []
    var frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    frame.style.width = '320px'
    frame.style.height = '200px'
    var sent = 0
    window.addEventListener('message', function (e) {
      if (e.source !== frame.contentWindow) return
      replies.push(e.data)
      if (e.data && e.data.kind === 'evt' && e.data.event === 'boot') {
        var tick = setInterval(function () {
          sent++
          frame.contentWindow.postMessage({ kind: 'cmd', protocol: 1, id: 'probe-' + sent, name: 'ready' }, '*')
          if (sent >= 3) clearInterval(tick)
        }, 250)
      }
    })
    frame.src = src
    document.getElementById('probe').appendChild(frame)
    setTimeout(function () { resolve({ sent: sent, replies: replies }) }, 4000)
  })
}
</script>
</body></html>`

/* ── 台架 ─────────────────────────────────────────────────────────────────── */

interface Harness {
  /** 本次跑里被拦下的外部地址。用例 1 断言它是空的（C6）。 */
  readonly blocked: string[]
}

/**
 * 装好四条路由，然后把页面开到那个凭空造出来的 origin 上。
 *
 * @param policy 白名单文件的内容；`null` = 让它 404。
 */
async function openHost(
  context: import('@playwright/test').BrowserContext,
  page: import('@playwright/test').Page,
  policy: string | null,
): Promise<Harness> {
  const blocked: string[] = []

  // ① 兜底：外部地址一律拦下并记账。**先注册**，因为 Playwright 后注册的优先。
  await context.route('**/*', (route) => {
    const url = route.request().url()
    if (url.includes('127.0.0.1') || url.includes('localhost') || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue()
    }
    blocked.push(url)
    return route.abort()
  })

  // ② 宿主页面本身。它是台架的一部分，不是产品发出的请求，所以不进 `blocked`。
  await context.route(`${HOST}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HOST_HTML }),
  )

  // ③ SDK。dev server 上没有 `/player/` 这个前缀（那是部署时 `--base` 才有的），
  //    所以这一条既是伪造也是必需。
  await context.route(`${PLAYER}/player/embed.js`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: sdkBundle() }),
  )

  // ④ 白名单。**这一条让「策略在不在」成为被测对象。**
  await context.route(`${PLAYER}/embed-policy.json`, (route) =>
    policy === null
      ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: policy }),
  )

  await page.goto(`${HOST}/`)
  await page.waitForFunction(() => typeof (window as unknown as { W3Player?: unknown }).W3Player === 'object')
  return { blocked }
}

/** 播放器地址。`embed` 传 false 时故意漏掉 `?embed=1`。 */
function playerUrl(options: { embed: boolean }): string {
  return `${PLAYER}/?src=/embed.w3p${options.embed ? '&embed=1' : ''}`
}

test.beforeAll(() => {
  const bytes = buildScenePackage({ name: '嵌入用例场景' })
  const dir = join(ROOT, 'packages', 'player', 'public')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'embed.w3p'), bytes)
  expect(bytes.byteLength, '包要有内容').toBeGreaterThan(500)
})

test.describe('T-276 · 跨源嵌入', () => {
  test.describe.configure({ timeout: 120_000 })

  test('用例 1 · 白名单放行：握手、命令、事件、截图、零外部请求', async ({ context, page }) => {
    const harness = await openHost(context, page, JSON.stringify([HOST]))

    const mounted = await page.evaluate(
      (url) => (window as never as { __mount: (u: string, t: number) => Promise<Record<string, unknown>> }).__mount(url, 45_000),
      playerUrl({ embed: true }),
    )
    expect(mounted['ok'], `握手应当成功，实际：${JSON.stringify(mounted)}`).toBe(true)
    expect(mounted['protocol']).toBe(1)

    const commands = mounted['commands'] as string[]
    expect(commands, '基本命令要齐').toEqual(
      expect.arrayContaining(['ready', 'play', 'pause', 'getVariable', 'setVariable', 'subscribe', 'screenshot']),
    )
    // X-53：v1.0 没有多场景实现，于是这个名字**不出现在清单里**，而不是存在但永远失败。
    expect(commands, 'goToScene 在 v1.0 不该出现').not.toContain('goToScene')

    const scene = mounted['scene'] as Record<string, unknown>
    expect(scene['name'], '摘要里要有场景名').toBe('嵌入用例场景')

    /* 变量：读 → 写 → 再读 --------------------------------------------------- */
    const before = await page.evaluate(() =>
      (window as never as { __do: (m: string, a: unknown[]) => Promise<Record<string, unknown>> }).__do('getVariable', ['step']),
    )
    expect(before['ok'], `getVariable 应当成功：${JSON.stringify(before)}`).toBe(true)

    await page.evaluate(() =>
      (window as never as { __listen: (n: string) => void; __do: (m: string, a: unknown[]) => Promise<unknown> }).__listen('variableChange'),
    )
    await page.evaluate(() =>
      (window as never as { __do: (m: string, a: unknown[]) => Promise<unknown> }).__do('subscribe', [null]),
    )

    const wrote = await page.evaluate(() =>
      (window as never as { __do: (m: string, a: unknown[]) => Promise<Record<string, unknown>> }).__do('setVariable', ['step', 2]),
    )
    expect(wrote['ok'], `setVariable 应当成功：${JSON.stringify(wrote)}`).toBe(true)

    const after = await page.evaluate(() =>
      (window as never as { __do: (m: string, a: unknown[]) => Promise<Record<string, unknown>> }).__do('getVariable', ['step']),
    )
    expect(after['value'], '写进去的值要读得回来').toBe(2)

    /* 截图：**解出来比一比**，不是「有没有返回」 ------------------------------ */
    const shot = await page.evaluate(() =>
      (window as never as { __shot: () => Promise<Record<string, number | string>> }).__shot(),
    )
    expect(shot['error'], `截图不该失败：${JSON.stringify(shot)}`).toBeUndefined()
    expect(shot['bytes'], 'PNG 字节数').toBeGreaterThan(1000)
    expect(shot['width'], '宽要和宿主给的 iframe 一致').toBe(shot['frameWidth'])
    expect(shot['height'], '高要和宿主给的 iframe 一致').toBe(shot['frameHeight'])
    expect(shot['width'], '宿主要的就是这么大').toBe(STAGE.width)
    expect(shot['height']).toBe(STAGE.height)
    // 一张全透明空图也能有正确的宽高、也能压到 1 KB 以上。**画面内容才是被测的东西。**
    expect(shot['colours'], '画面上不该只有一种颜色').toBeGreaterThan(1)
    expect(shot['opaque'], '请求的是不透明背景').toBeGreaterThan(0)

    /* C6：嵌入没有引入任何新的外部请求 ---------------------------------------- */
    expect(harness.blocked, `嵌入不该请求任何外部地址：${harness.blocked.join(', ')}`).toEqual([])
  })

  test('用例 2 · 策略文件 404：谁都不许嵌，而不是谁都可以嵌', async ({ context, page }) => {
    await openHost(context, page, null)

    const mounted = await page.evaluate(
      (url) => (window as never as { __mount: (u: string, t: number) => Promise<Record<string, unknown>> }).__mount(url, 20_000),
      playerUrl({ embed: true }),
    )
    expect(mounted['ok'], '取不到白名单时不该握上手').toBe(false)
    expect(mounted['code']).toBe('timeout')

    // 「握不上手」有两种成因：播放器根本没起来，和播放器起来了但拒绝了我们。
    // 只断言前者的话，把 boot 那行删掉也照绿。所以要看到那条明确的拒绝。
    const log = await page.evaluate(() => (window as never as { __log: { data: Record<string, unknown> }[] }).__log)
    const booted = log.some((m) => m.data['event'] === 'boot')
    const denied = log.filter((m) => (m.data['payload'] as Record<string, unknown> | undefined)?.['code'] === 'origin-denied')
    expect(booted, '播放器要真的起来了').toBe(true)
    expect(denied.length, '要明确回一条 origin-denied').toBe(1)
  })

  test('用例 3 · origin 不在白名单：拒绝一次，之后完全沉默', async ({ context, page }) => {
    await openHost(context, page, JSON.stringify(['https://other.example']))

    const mounted = await page.evaluate(
      (url) => (window as never as { __mount: (u: string, t: number) => Promise<Record<string, unknown>> }).__mount(url, 20_000),
      playerUrl({ embed: true }),
    )
    expect(mounted['ok'], '白名单外的宿主不该握上手').toBe(false)
    expect(mounted['code']).toBe('timeout')

    const probe = await page.evaluate(
      (url) =>
        (
          window as never as { __probe: (u: string) => Promise<{ sent: number; replies: Record<string, unknown>[] }> }
        ).__probe(url),
      playerUrl({ embed: true }),
    )
    expect(probe.sent, '探针要真的发出去过三条').toBe(3)
    const denied = probe.replies.filter((r) => (r['payload'] as Record<string, unknown> | undefined)?.['code'] === 'origin-denied')
    const acks = probe.replies.filter((r) => r['kind'] === 'ack')
    // 回一次是礼貌，回第二次开始就是把自己做成反射放大器。
    expect(denied.length, `三条命令只该收到一条拒绝，实际 ${denied.length} 条`).toBe(1)
    expect(acks.length, '一条都不该被执行').toBe(0)
  })

  test('用例 4 · 地址没带 ?embed=1：嵌入层根本没下载', async ({ context, page }) => {
    await openHost(context, page, JSON.stringify([HOST]))

    const mounted = await page.evaluate(
      (url) => (window as never as { __mount: (u: string, t: number) => Promise<Record<string, unknown>> }).__mount(url, 15_000),
      playerUrl({ embed: false }),
    )
    expect(mounted['ok'], '没带 ?embed=1 时不该握上手').toBe(false)
    expect(mounted['code']).toBe('timeout')

    // 而且**一条消息都没发出来**——不是「发了但被拒」，是那三个模块一个字节都没下载。
    const log = await page.evaluate(() => (window as never as { __log: { data: Record<string, unknown> }[] }).__log)
    expect(log, `不该有任何嵌入消息：${JSON.stringify(log)}`).toEqual([])
  })
})
