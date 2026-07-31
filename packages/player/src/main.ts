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
    })
    await player.start()
  } catch (error) {
    fail(error instanceof Error ? error.message : '无法打开这个包。', error)
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
