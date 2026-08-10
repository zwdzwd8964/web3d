import { detectCapability, lightFactory, renderCapabilityNotice } from '@w3/core'
import { unpackScene } from '@w3/storage'
import { createPlayerSession } from '../session.js'
import {
  BENCH_LIMITS,
  LIGHT_COUNTS,
  SHADOW_MODES,
  STRESS_COPIES,
  estimateTextureMemory,
  gradeFrames,
  gradeScene,
  gradeLighting,
  gradeLoad,
  gradeStress,
  summariseFrames,
  toJsonReport,
  toMarkdown,
} from './metrics.js'
import type { BenchRow, LightLevel, LoadTiming, SceneStats, StressLevel } from './metrics.js'
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

/**
 * T-278 · `?fast=1` —— 把每一档的采样时长按同一个比例缩短。
 *
 * 全跑一遍要 30 秒以上（6 秒主采样 + 4 档 ×1.2 秒压力 + 12 档 ×0.9 秒灯光 + 后处理对比），
 * 而浏览器级 e2e 要证明的是**这一页从选文件到出报告这条链是通的**，不是这台 CI 机器的
 * 帧率。缩短之后的读数没有验收价值——所以它只由 URL 参数打开，页面上没有这个开关，
 * 客户不会误按。
 *
 * 报告里那张表的**行数与结构完全不变**，这正是 e2e 要断言的东西。
 */
const FAST = new URLSearchParams(location.search).get('fast') === '1'

/**
 * 四处采样时长，一处一个名字。散在调用点上时没人看得出它们是同一组旋钮。
 *
 * 显式标 `number` 而不是 `as const`：后者会把 `measure` 的默认参数窄成 `600 | 6000`，
 * 于是另外三处传 200 的调用点全部编译不过。
 */
const SAMPLE_MS: Record<'main' | 'lighting' | 'stress' | 'postFx', number> = {
  main: FAST ? 600 : 6000,
  lighting: FAST ? 200 : 900,
  stress: FAST ? 200 : 1200,
  postFx: FAST ? 200 : 600,
}

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
    // T-279 · 首屏三段计时。**三次读表都夹在真正的边界上**，不是事后估的：
    // 解包完 / start 返回 / 第一帧画完。
    const t0 = performance.now()
    const pkg = unpackScene(bytes)
    const t1 = performance.now()

    const canvas = document.createElement('canvas')
    canvas.className = 'player__canvas'
    stage.append(canvas)

    const { runtime, session } = createPlayerSession({ pkg, canvas })
    runtime.resize(stage.clientWidth, stage.clientHeight)
    await session.start()
    const t2 = performance.now()

    // 第一帧单独画一次再读表。跟着 `measure` 一起测的话，首帧的着色器编译会被算进
    // 稳态帧率里——那正是 `measure` 丢掉前 30 帧要避开的东西。
    session.tick()
    runtime.renderFrame()
    const timing: LoadTiming = {
      unpackMs: t1 - t0,
      buildMs: t2 - t1,
      firstFrameMs: performance.now() - t2,
    }

    show(`<p class="bench__note">正在测量…（约 ${SAMPLE_MS.main / 1000} 秒，期间相机会自动环绕）</p>`)
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

    show('<p class="bench__note">正在做灯光 / 阴影压力测试…（最多约 20 秒）</p>')
    const lighting = await lightingRamp(runtime, session)

    const scene: SceneStats = {
      triangles: info?.triangles ?? 0,
      drawCalls: info?.calls ?? 0,
      geometries: info?.geometries ?? 0,
      textures: info?.textures ?? 0,
      programs: info?.programs ?? 0,
      textureMemoryBytes: estimateTextureMemory(textures),
    }

    const rows: BenchRow[] = [
      ...gradeLoad(timing),
      ...gradeFrames(summariseFrames(frameTimes)),
      ...gradeScene(scene),
      ...gradeStress(stress),
      ...gradeLighting(lighting),
    ]

    renderReport(rows, scene, sourceName)
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
  durationMs = SAMPLE_MS.main,
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
/**
 * T-174 · the lighting ladder.
 *
 * 0 / 1 / 4 / 8 dynamic lights × shadows off / medium / high. Two costs are being separated,
 * and conflating them is how people conclude "lights are slow" and stop using them: more
 * lights costs per-pixel shading and grows smoothly, while shadows cost an extra depth pass
 * per casting light and grow in steps.
 *
 * The lights are real `SpotLight`s added straight to the scene, NOT document nodes: these
 * are measuring weights, not scene content (C1). Nothing here is committed, and the finally
 * block removes every one of them.
 *
 * Rungs are skipped once a configuration drops below the fail line — past it there is
 * nothing left to learn from a bigger one, and the page would hold the machine at
 * single-digit frame rates to prove it.
 */
async function lightingRamp(
  runtime: ReturnType<typeof createPlayerSession>['runtime'],
  session: ReturnType<typeof createPlayerSession>['session'],
): Promise<LightLevel[]> {
  const spread = Math.max(1, boundingSpan(runtime.graph.root))
  const added: { removeFromParent: () => void; dispose?: () => void }[] = []
  const levels: LightLevel[] = []
  let postFx: { composedFps: number; directFps: number; mode: string } | null = null

  try {
    for (const shadows of SHADOW_MODES) {
      // Shadow maps are a renderer-wide switch; the per-light flag decides who casts.
      runtime.setShadowsEnabled(shadows !== 'off')

      for (const count of LIGHT_COUNTS) {
        while (added.length < count) {
          // Built through core's own `lightFactory`, not by importing three: @w3/player
          // must never reach for three directly (C2), and going through the factory also
          // means the benchmark measures the SAME objects the product builds.
          const light = lightFactory.create({
            kind: 'spot',
            color: '#ffffff',
            intensity: 2,
            range: 0,
            decay: 2,
            angleDeg: 30,
            penumbra: 0.2,
            // T-279 · 档位**原样传下去**。这里原本写的是 `shadows === 'high' ? 'high' : 'medium'`——
            // 在只有 off/medium/high 三种输入时它恰好等价，而 `low` 一加进来，low 那一档
            // 会静静地用 medium 的贴图去测，报告上仍写着 low。
            shadow: { enabled: shadows !== 'off', quality: shadows === 'off' ? 'medium' : shadows, bias: -0.0005 },
          }) as unknown as { position: { set(x: number, y: number, z: number): void }; removeFromParent(): void }
          // Ringed around the scene so each one lights a different side: stacking them in
          // one place measures overdraw on one face rather than N lights on a model.
          const angle = (added.length / Math.max(1, count)) * Math.PI * 2
          light.position.set(Math.cos(angle) * spread, spread * 1.5, Math.sin(angle) * spread)
          runtime.scene.add(light as unknown as Parameters<typeof runtime.scene.add>[0])
          added.push(light)
        }
        while (added.length > count) added.pop()?.removeFromParent()

        const stats = summariseFrames(await measure(runtime, session, SAMPLE_MS.lighting, 4))
        levels.push({ lights: count, shadows, fps: stats.fps, drawCalls: runtime.info?.calls ?? 0 })

        if (stats.fps < BENCH_LIMITS.fpsFail) break
      }

      while (added.length > 0) added.pop()?.removeFromParent()

      // T-235 · 顺带量一次「开 / 关后处理链」的差。
      //
      // 走 `setPostFxEnabled` 而不是改文档：改文档会连带触发一次补丁与一次
      // `applyBackground`，测出来的是两件事混在一起的数。量完交还给文档（`null`）。
      if (shadows === 'off') {
        runtime.setPostFxEnabled(true)
        const composed = summariseFrames(await measure(runtime, session, SAMPLE_MS.postFx, 4))
        runtime.setPostFxEnabled(false)
        const direct = summariseFrames(await measure(runtime, session, SAMPLE_MS.postFx, 4))
        runtime.setPostFxEnabled(null)
        postFx = { composedFps: composed.fps, directFps: direct.fps, mode: runtime.pipelineMode }
      }
    }
  } finally {
    for (const light of added) light.removeFromParent()
    runtime.setShadowsEnabled(false)
  }
  // T-235 · 后处理链的开 / 关对比跟着灯光扫描一起回报。它不是一档「灯光级别」，
  // 所以挂在返回值旁边而不是塞进 levels —— 混进去会让「第几档掉到 30fps 以下」这个
  // 读数变成两件事的混合。
  if (postFx) {
    console.info(
      `[bench] 后处理链：composed ${postFx.composedFps.toFixed(1)} fps / direct ${postFx.directFps.toFixed(1)} fps（当前 mode=${postFx.mode}）`,
    )
  }
  return levels
}

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

      const stats = summariseFrames(await measure(runtime, session, SAMPLE_MS.stress, 5))
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

function renderReport(rows: readonly BenchRow[], scene: SceneStats, sourceName: string) {
  const takenAt = new Date().toISOString()
  const screen = `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`
  const input = { capability, rows, scene, userAgent: navigator.userAgent, screen, takenAt, source: sourceName }
  const markdown = toMarkdown(input)
  const json = JSON.stringify(toJsonReport(input), null, 2)

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
    <button type="button" id="download" class="bench__copy">下载 JSON</button>
    <pre class="bench__md">${escapeHtml(markdown)}</pre>
  `)

  // T-279 · 机器可读的那一份。回填脚本（T-280）读它，而不是去解析上面那张 Markdown
  // 表格——那等于让一份给人看的排版成为机器契约，改一个空格就断。
  //
  // 文件名带上时间戳与档位：这些报告会一份份躺进 `docs/bench-reports/`，同名覆盖
  // 意味着第二台机器的结果把第一台的抹掉，而抹掉的那一刻没有任何提示。
  document.getElementById('download')?.addEventListener('click', () => {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `bench-${takenAt.replace(/[:.]/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(url)
  })

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

show(`<p class="bench__note">把 .w3p 拖到页面上，或点上方按钮选择文件。测量约需 ${SAMPLE_MS.main / 1000} 秒。</p>`)
