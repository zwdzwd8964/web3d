import { detectCapability, renderCapabilityNotice } from '@w3/core'
import { unpackScene } from '@w3/storage'
import { createPlayerSession } from '../session.js'
import {
  BENCH_LIMITS,
  STRESS_COPIES,
  estimateTextureMemory,
  gradeFrames,
  gradeScene,
  gradeStress,
  summariseFrames,
  toMarkdown,
} from './metrics.js'
import type { BenchRow, StressLevel } from './metrics.js'
import '../styles.css'
import './bench.css'

/**
 * T-110 · the benchmark page.
 *
 * The acceptance line is "能在客户机器上独立运行（单页，无需编辑器）", and that is the whole
 * design constraint. It ships as a second HTML entry in the player bundle, takes a `.w3p`
 * by drag-and-drop, and produces a Markdown block the customer's engineer can paste into
 * a ticket without installing anything.
 *
 * It runs the REAL player session — same loader, same runtime, same rules — because a
 * benchmark of a synthetic scene measures the benchmark.
 */

const host = document.getElementById('bench')!
const stage = document.getElementById('stage') as HTMLDivElement
const out = document.getElementById('out') as HTMLDivElement

const capability = detectCapability()
if (capability.level !== 'ok') renderCapabilityNotice(host, capability)

const state = { running: false }

function show(html: string) {
  out.innerHTML = html
}

async function run(bytes: Uint8Array, sourceName: string) {
  if (state.running) return
  state.running = true
  show('<p class="bench__note">正在解包与加载…</p>')
  stage.replaceChildren()

  try {
    const pkg = unpackScene(bytes)
    const canvas = document.createElement('canvas')
    canvas.className = 'player__canvas'
    stage.append(canvas)

    const { runtime, session } = createPlayerSession({ pkg, canvas })
    runtime.resize(stage.clientWidth, stage.clientHeight)
    await session.start()

    show('<p class="bench__note">正在测量…（约 6 秒，期间相机会自动环绕）</p>')
    const frameTimes = await measure(runtime, session)

    // Counters are read AFTER a render, because three resets `info.render` each frame —
    // and BEFORE the stress ramp, whose copies would otherwise be counted as if the
    // customer's model contained them.
    const info = runtime.info
    const textures: { width: number; height: number }[] = []
    runtime.scene.traverse((object) => {
      const material = (object as { material?: unknown }).material
      for (const map of texturesOf(material)) {
        if (map.image?.width) textures.push({ width: map.image.width, height: map.image.height })
      }
    })

    show('<p class="bench__note">正在做逐级加载压力测试…（最多约 5 秒）</p>')
    const stress = await stressRamp(runtime, session)

    const rows: BenchRow[] = [
      ...gradeFrames(summariseFrames(frameTimes)),
      ...gradeScene({
        triangles: info?.triangles ?? 0,
        drawCalls: info?.calls ?? 0,
        geometries: info?.geometries ?? 0,
        textures: info?.textures ?? 0,
        programs: info?.programs ?? 0,
        textureMemoryBytes: estimateTextureMemory(textures),
      }),
      ...gradeStress(stress),
    ]

    renderReport(rows, sourceName)
    session.dispose()
    runtime.dispose()
    canvas.remove()
  } catch (error) {
    show(`<p class="bench__note bench__note--bad">测量失败：${error instanceof Error ? error.message : String(error)}</p>`)
  } finally {
    state.running = false
  }
}

/**
 * Continuous rendering while orbiting, for `durationMs`.
 *
 * Orbiting rather than a static view on purpose: a still camera lets the driver skip work
 * and reports a frame rate the user will never see. The first frames are discarded —
 * shader compilation and texture upload happen there, and they say nothing about
 * steady-state performance. The ramp discards fewer of them because each rung is short and
 * only the first rung pays the compilation cost.
 */
function measure(
  runtime: ReturnType<typeof createPlayerSession>['runtime'],
  session: ReturnType<typeof createPlayerSession>['session'],
  durationMs = 6000,
  warmupFrames = 30,
): Promise<number[]> {
  return new Promise((resolve) => {
    const times: number[] = []
    let warmup = warmupFrames
    let previous = performance.now()
    const started = previous

    const frame = () => {
      const now = performance.now()
      runtime.camera.rotate(0.012, 0)
      session.tick()
      runtime.renderFrame()

      if (warmup > 0) warmup--
      else times.push(now - previous)
      previous = now

      if (now - started < durationMs) requestAnimationFrame(frame)
      else resolve(times)
    }
    requestAnimationFrame(frame)
  })
}

/**
 * T-116 · ADR-0016 · the staged load ramp, the sixth metric T-110 listed and never shipped.
 *
 * One rung at a time: duplicate the loaded scene until there are ×1, ×2, ×4, ×8 copies of
 * it on screen, measuring each. It answers the question the customer's engineer actually
 * asks at acceptance — "our model is three times this one, will it run" — which no
 * single-point frame rate can.
 *
 * The copies are `clone(true)`, which SHARES geometry and material with the original. That
 * is what makes this cheap and also what bounds what it proves: draw calls and vertex
 * throughput scale, VRAM does not (ADR-0016). It is also why the cleanup below removes but
 * never disposes — disposing a clone's geometry would destroy the original's.
 *
 * Nothing here touches the document. These are measuring weights, not scene content (C1).
 */
async function stressRamp(
  runtime: ReturnType<typeof createPlayerSession>['runtime'],
  session: ReturnType<typeof createPlayerSession>['session'],
): Promise<StressLevel[]> {
  const source = runtime.graph.root
  const spread = Math.max(1, boundingSpan(source))
  const copies: { removeFromParent: () => void }[] = []
  const levels: StressLevel[] = []

  try {
    for (const target of STRESS_COPIES) {
      // Lay the extra copies out in a row rather than on top of each other: overlapping
      // geometry is a depth-test benchmark, not a scene-size one.
      while (copies.length < target - 1) {
        const clone = source.clone(true)
        clone.position.x += spread * (copies.length + 1)
        runtime.scene.add(clone)
        copies.push(clone)
      }

      const stats = summariseFrames(await measure(runtime, session, 1200, 5))
      const info = runtime.info
      levels.push({
        copies: target,
        fps: stats.fps,
        drawCalls: info?.calls ?? 0,
        triangles: info?.triangles ?? 0,
      })

      // Past the fail line there is nothing left to learn from a bigger rung, and the
      // page would keep the machine at single-digit frame rates to prove it.
      if (stats.fps < BENCH_LIMITS.fpsFail) break
    }
  } finally {
    for (const clone of copies) clone.removeFromParent()
  }
  return levels
}

/** Roughly how wide the scene is, so copies can be placed side by side without overlapping. */
function boundingSpan(root: { traverse: (cb: (o: unknown) => void) => void }): number {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  root.traverse((object) => {
    const position = (object as { position?: { x: number } }).position
    if (!position) return
    min = Math.min(min, position.x)
    max = Math.max(max, position.x)
  })
  return Number.isFinite(min) && Number.isFinite(max) ? max - min + 1 : 1
}

function texturesOf(material: unknown): { image?: { width: number; height: number } }[] {
  if (!material || typeof material !== 'object') return []
  const list = Array.isArray(material) ? material : [material]
  const out: { image?: { width: number; height: number } }[] = []
  for (const m of list) {
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
      const value = (m as Record<string, unknown>)[key]
      if (value && typeof value === 'object' && 'image' in value) out.push(value as { image: { width: number; height: number } })
    }
  }
  return out
}

function renderReport(rows: readonly BenchRow[], sourceName: string) {
  const takenAt = new Date().toISOString()
  const screen = `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`
  const markdown = toMarkdown({
    capability,
    rows,
    userAgent: navigator.userAgent,
    screen,
    takenAt,
    source: sourceName,
  })

  const table = rows
    .map(
      (r) => `<tr data-verdict="${r.verdict}">
        <td>${r.metric}</td><td class="num">${r.value}</td><td class="num">${r.limit}</td>
        <td>${r.verdict === 'pass' ? '通过' : r.verdict === 'warn' ? '接近上限' : '超标'}</td>
        <td class="bench__note-cell">${r.note}</td></tr>`,
    )
    .join('')

  show(`
    <div class="bench__env">
      <b>${capability.vendor ?? '未知'} · ${capability.renderer ?? '未知'}</b>
      ${capability.level === 'software' ? '<span class="bench__warn">软件渲染 · 帧率数据不可作为验收依据</span>' : ''}
      <span>${screen}</span>
    </div>
    <table class="bench__table">
      <thead><tr><th>指标</th><th>实测</th><th>上限</th><th>结论</th><th>说明</th></tr></thead>
      <tbody>${table}</tbody>
    </table>
    <button type="button" id="copy" class="bench__copy">复制为 Markdown</button>
    <pre class="bench__md">${escapeHtml(markdown)}</pre>
  `)

  document.getElementById('copy')?.addEventListener('click', () => {
    void navigator.clipboard.writeText(markdown).then(
      () => {
        const button = document.getElementById('copy')!
        button.textContent = '已复制'
        setTimeout(() => (button.textContent = '复制为 Markdown'), 1500)
      },
      // Clipboard access can be denied; the <pre> below is always selectable, so this is
      // a nicety failing rather than the feature failing.
      () => undefined,
    )
  })
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

document.addEventListener('dragover', (event) => event.preventDefault())
document.addEventListener('drop', (event) => {
  event.preventDefault()
  const file = event.dataTransfer?.files[0]
  if (file) void file.arrayBuffer().then((buffer) => run(new Uint8Array(buffer), file.name))
})

const picker = document.getElementById('pick') as HTMLInputElement
picker.addEventListener('change', () => {
  const file = picker.files?.[0]
  if (file) void file.arrayBuffer().then((buffer) => run(new Uint8Array(buffer), file.name))
})

show('<p class="bench__note">把 .w3p 拖到页面上，或点上方按钮选择文件。测量约需 6 秒。</p>')
