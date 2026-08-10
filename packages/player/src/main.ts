import type { PlaybackSession, SceneRuntime } from '@w3/core'
import { Player } from './app.js'
import { resolveSource } from './source.js'
import './styles.css'

/**
 * Player entry point.
 *
 * Three ways to get a package in, in priority order:
 *   ?src=<same-origin path>   the deployed case — a .w3p sitting next to index.html
 *   drag & drop / file picker the "someone emailed me a .w3p" case
 *
 * `?src` is fetched, and that is the ONE fetch the player makes. It is same-origin by
 * construction (see `resolveSource`) — C6 forbids reaching anywhere else, and a player
 * that phoned home would break every intranet deployment this product is aimed at.
 */

/**
 * T-273 · 嵌入模式的判据，全文件唯一一处。
 *
 * **只有带 `?embed=1` 时才动态 import 嵌入层。** 不带参数打开播放器时，`boot.ts` /
 * `transport.ts` / `policy.ts` 三个模块一个字节都不下载——嵌入是少数场景，独立打开
 * 是多数场景，让多数场景付少数场景的体积代价没有道理（`pnpm size` 的预算是 gzip 400 KB）。
 */
const EMBEDDED = new URLSearchParams(location.search).get('embed') === '1'

const host = document.getElementById('app')
if (!host) throw new Error('缺少 #app 挂载点')

let player: Player | null = null

function fail(message: string, detail?: unknown): void {
  console.error('[player]', message, detail)
  const box = document.createElement('div')
  box.className = 'player__error'
  box.setAttribute('role', 'alert')
  box.textContent = message
  host!.replaceChildren(box)
  showDropZone()
}

async function open(bytes: Uint8Array): Promise<void> {
  player?.dispose()
  player = null
  host!.replaceChildren()
  try {
    player = new Player({
      host: host!,
      bytes,
      onLog: (level, message) => {
        if (level !== 'debug') console.warn(`[player] ${message}`)
      },
      // T-273 · 嵌入时把会话交给控制器。**只在 `?embed=1` 下 import**，否则这三个模块
      // 一个字节都不下载。
      ...(EMBEDDED ? { onSession: (parts) => void attachEmbed(parts) } : {}),
      // 跑不了也要说出去：页面里那句中文提示在 iframe 里，宿主的 JS 读不到它。
      ...(EMBEDDED ? { onUnsupported: (capability) => void reportUnsupported(capability) } : {}),
    })
    await player.start()
  } catch (error) {
    fail(error instanceof Error ? error.message : '无法打开这个包。', error)
  }
}

/**
 * T-273 · 把会话交给嵌入控制器。**动态 import**，见 `EMBEDDED` 的注释。
 *
 * 失败不阻断播放：嵌入层起不来时播放器仍然是一个能看的播放器，只是宿主指挥不动它。
 */
async function attachEmbed(parts: { session: PlaybackSession; runtime: SceneRuntime }): Promise<void> {
  try {
    const [{ EmbedController, summarizeScene }, { bootEmbed }] = await Promise.all([
      import('@w3/core'),
      import('./embed/boot.js'),
    ])

    // 控制器要往传输层发，而传输层要拿着控制器建——所以先留一个空槽，装好之后填上。
    // 比让传输层反过来持有控制器干净：那样两边就互相引用了。
    let broadcast: ((message: unknown) => void) | null = null

    const controller = new EmbedController({
      deps: {
        document: () => parts.runtime.doc,
        play: () => player?.resume(),
        pause: () => player?.pause(),
        getVariable: (id) => parts.runtime.getVar(id),
        setVariable: (id, value) => parts.runtime.setVar(id, value as never),
        hasVariable: (id) => parts.runtime.doc.variables.some((v) => v.id === id),
        // 真正的实现由 `EmbedController` 的构造函数装上（订阅位图是它自己的状态）。
        subscribe: () => {},
      },
      send: (message) => broadcast?.(message),
      summary: () => summarizeScene(parts.runtime.doc),
    })

    const transport = await bootEmbed({ controller })
    broadcast = (message) => transport?.broadcast(message)
    void parts.session
  } catch (error) {
    console.warn('[player] 嵌入层未能启动，播放器仍可独立使用', error)
  }
}

/** 跑不了时，从嵌入通道说一声。 */
async function reportUnsupported(capability: { message: string; advice: string }): Promise<void> {
  try {
    const { bootEmbed } = await import('./embed/boot.js')
    const controller = {
      handle: async () => null,
    }
    const transport = await bootEmbed({ controller: controller as never })
    transport?.broadcast({ kind: 'evt', protocol: 1, event: 'error', payload: { code: 'unsupported', message: capability.message, advice: capability.advice } })
  } catch {
    // 嵌入层都起不来的话，这条消息本来也送不出去。
  }
}

function showDropZone(): void {
  const zone = document.createElement('div')
  zone.className = 'player__drop'
  zone.innerHTML =
    '<b>把 .w3p 文件拖到这里</b><span>或点击选择文件</span><span class="player__hint">部署时用 ?src=demo.w3p 直接打开</span>'

  const picker = document.createElement('input')
  picker.type = 'file'
  picker.accept = '.w3p,application/zip'
  picker.hidden = true
  picker.addEventListener('change', () => {
    const file = picker.files?.[0]
    if (file) void file.arrayBuffer().then((buffer) => open(new Uint8Array(buffer)))
    picker.value = ''
  })

  zone.addEventListener('click', () => picker.click())
  zone.append(picker)
  host!.append(zone)
}

document.addEventListener('dragover', (event) => event.preventDefault())
document.addEventListener('drop', (event) => {
  event.preventDefault()
  const file = event.dataTransfer?.files[0]
  if (file) void file.arrayBuffer().then((buffer) => open(new Uint8Array(buffer)))
})

const src = resolveSource(new URLSearchParams(location.search).get('src'))
if (src) {
  void fetch(src)
    .then(async (response) => {
      if (!response.ok) throw new Error(`读取 ${src} 失败：HTTP ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    })
    .then(open)
    .catch((error: unknown) => fail(error instanceof Error ? error.message : `无法读取 ${src}`, error))
} else {
  showDropZone()
}
