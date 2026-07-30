import type { SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionRegistry, registerBuiltinActions } from '../../src/eca/actions/index.js'
import { EcaEngine } from '../../src/eca/engine.js'
import { createMemoryResolver } from '../../src/runtime/loader.js'
import { NullHotspotRenderer } from '../../src/runtime/hotspot-layer.js'
import { SceneRuntime } from '../../src/runtime/scene-runtime.js'
import type { LogLevel } from '../../src/eca/types.js'
import { describeRuntimeContract } from '../runtime-contract.js'
import { IDS } from '../helpers.js'
import { buildPumpGlb } from '../assets/glb.js'

/**
 * T-031.
 *
 * `createRenderer` is injected, so everything except the WebGL calls themselves is
 * exercised here in Node. The suite that matters most is the shared RuntimeContract at
 * the bottom: SceneRuntime and HeadlessRuntime run the SAME assertions, which is what
 * stops the head-less runtime from quietly drifting away from the real one — the failure
 * mode where every test is green and the product is broken (ECA_SPEC §6).
 */

/** A stand-in for WebGLRenderer. Records calls; allocates no GL context. */
function fakeRenderer() {
  const calls = { render: 0, setSize: 0, dispose: 0 }
  return {
    calls,
    renderer: {
      calls,
      info: { memory: { geometries: 0, textures: 0 } },
      render: () => {
        calls.render++
      },
      setSize: () => {
        calls.setSize++
      },
      dispose: () => {
        calls.dispose++
      },
      domElement: {} as HTMLCanvasElement,
    } as never,
  }
}

const canvas = () => ({ clientWidth: 800, clientHeight: 600 }) as HTMLCanvasElement

/** Lets an async executor chain settle. Cheap, and far clearer than a magic number. */
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

let clock: number
const advanceClock = (ms: number) => {
  clock += ms
}

function makeRuntime(
  doc: SceneDocument = createGoldenPathDocument(),
  logs?: [LogLevel, string][],
  files: Map<string, ArrayBuffer> = new Map(),
) {
  clock = 0
  const { renderer, calls } = fakeRenderer()
  const runtime = new SceneRuntime(doc, {
    canvas: canvas(),
    resolver: createMemoryResolver(files),
    mode: 'play',
    createRenderer: () => renderer,
    hotspotRenderer: new NullHotspotRenderer(),
    now: () => clock,
    onLog: (level, message) => logs?.push([level, message]),
  })
  return { runtime, calls }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('composition and lifecycle', () => {
  it('assembles the whole runtime and mirrors the document', async () => {
    const { runtime } = makeRuntime()
    await runtime.load(createGoldenPathDocument())

    expect(runtime.graph.size).toBe(3)
    expect(runtime.isVisible(IDS.cover)).toBe(true)
    expect(runtime.getVar('step')).toBe(1)
    runtime.dispose()
  })

  it('renders one frame per tick and drives the animation clock', async () => {
    const { runtime, calls } = makeRuntime()
    await runtime.load(createGoldenPathDocument())

    runtime.tick()
    runtime.tick()
    expect(calls.render).toBe(2)
    runtime.dispose()
  })

  it('resize reaches the camera and the renderer', async () => {
    const { runtime, calls } = makeRuntime()
    const before = calls.setSize
    runtime.resize(1600, 400)
    expect(calls.setSize).toBe(before + 1)
    expect(runtime.camera.camera.aspect).toBe(4)
    runtime.dispose()
  })

  it('applies the document background', async () => {
    const { runtime } = makeRuntime()
    expect(runtime.scene.background).not.toBeNull()

    const doc = createGoldenPathDocument()
    const transparent: SceneDocument = {
      ...doc,
      meta: { ...doc.meta, background: { type: 'transparent', color: '#000000' } },
    }
    const other = makeRuntime(transparent)
    expect(other.runtime.scene.background).toBeNull()
    runtime.dispose()
    other.runtime.dispose()
  })

  it('T-031 · dispose releases everything and is idempotent', async () => {
    const { runtime, calls } = makeRuntime()
    await runtime.load(createGoldenPathDocument())
    runtime.highlight(IDS.cover, 'outline_amber')
    void runtime.wait(10_000).catch(() => undefined)

    runtime.dispose()

    expect(calls.dispose).toBe(1)
    expect(runtime.graph.size).toBe(0)
    expect(runtime.materials.cloneCount).toBe(0)
    expect(runtime.highlights.activeNodeIds).toEqual([])
    expect(() => runtime.dispose()).not.toThrow()
    expect(calls.dispose).toBe(1)
  })

  it('mounting and unmounting a hundred times leaves nothing behind', async () => {
    // T-031's acceptance bar. The GL side needs a browser, but the CPU-side graph,
    // materials and clones are exactly where a leak would start.
    for (let i = 0; i < 100; i++) {
      const { runtime } = makeRuntime()
      await runtime.load(createGoldenPathDocument())
      runtime.highlight(IDS.cover, 'outline_red')
      runtime.dispose()
      expect(runtime.graph.size).toBe(0)
      expect(runtime.materials.cloneCount).toBe(0)
    }
  })

  it('reports an asset it cannot load instead of failing the whole load', async () => {
    const logs: [LogLevel, string][] = []
    const { runtime } = makeRuntime(createGoldenPathDocument(), logs)
    await runtime.load(createGoldenPathDocument())
    // The golden path's asset url is not in the empty resolver.
    expect(logs.some(([level, message]) => level === 'error' && message.includes('资产加载失败'))).toBe(true)
    // The document still built, with placeholders where the geometry would be (D5).
    expect(runtime.graph.size).toBe(3)
    runtime.dispose()
  })

  it('loads real GLB bytes and materialises the geometry', async () => {
    const bytes = await buildPumpGlb()
    const doc = createGoldenPathDocument()
    const files = new Map([[doc.assets[0]!.url, bytes]])
    clock = 0
    const runtime = new SceneRuntime(doc, {
      canvas: canvas(),
      resolver: createMemoryResolver(files),
      mode: 'play',
      createRenderer: () => fakeRenderer().renderer,
      now: () => clock,
    })
    await runtime.load(doc)

    expect(runtime.loader.size).toBe(1)
    // 泵体 maps to Root/Pump/Body, which the fixture GLB really contains.
    expect(runtime.graph.isPlaceholder(IDS.body)).toBe(false)
    runtime.dispose()
  })
})

describe('C3 · the ECA engine drives the real runtime', () => {
  it('runs the golden path against SceneRuntime, not a test double', async () => {
    const doc = createGoldenPathDocument()
    // Real GLB bytes: the fixture's object paths are exactly the golden path's
    // Root/Pump/Body and Root/Pump/ValveCover, so 阀盖 is a genuine Mesh here.
    const { runtime } = makeRuntime(doc, undefined, new Map([[doc.assets[0]!.url, await buildPumpGlb()]]))
    await runtime.load(doc)

    const registry = registerBuiltinActions(new ActionRegistry())
    const engine = new EcaEngine(runtime, { registry })
    engine.attach(doc)
    runtime.onEvent((event) => engine.dispatch(event))
    engine.setEnabled(true)

    engine.dispatch({ event: 'click', nodeId: IDS.cover })

    // The executor reaches the first handler over several microtasks, so let the chain
    // settle before asserting anything about where it got to.
    await flush()
    runtime.tick()
    expect(runtime.tweens.isPlaying(doc.animations[0]!.id), '第一步应已开始播放').toBe(true)
    // The tween is awaited, so the panel must not open until the clock advances.
    expect(runtime.isPanelOpen(IDS.hotspot)).toBe(false)

    advanceClock(1200)
    runtime.tick()
    await flush()

    expect(runtime.isPanelOpen(IDS.hotspot)).toBe(true)
    expect(runtime.getVar('step')).toBe(2)
    expect(runtime.highlights.isHighlighted(IDS.cover)).toBe(true)
    expect(engine.history.at(-1)?.status).toBe('completed')

    engine.detach()
    runtime.dispose()
  })

  it('a second click is refused by the condition, exactly as head-less', async () => {
    const doc = createGoldenPathDocument()
    const { runtime } = makeRuntime(doc, undefined, new Map([[doc.assets[0]!.url, await buildPumpGlb()]]))
    await runtime.load(doc)

    const registry = registerBuiltinActions(new ActionRegistry())
    const engine = new EcaEngine(runtime, { registry })
    engine.attach(doc)
    engine.setEnabled(true)

    engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await flush()
    advanceClock(1200)
    runtime.tick()
    await flush()

    runtime.closePanel('all')
    engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await flush()

    expect(runtime.isPanelOpen(IDS.hotspot)).toBe(false)
    expect(engine.history.at(-1)?.status).toBe('skipped-condition')

    engine.detach()
    runtime.dispose()
  })
})

describe('RuntimeContext behaviours', () => {
  it('refuses to read or write an undeclared variable', async () => {
    const logs: [LogLevel, string][] = []
    const { runtime } = makeRuntime(createGoldenPathDocument(), logs)
    await runtime.load(createGoldenPathDocument())

    expect(runtime.getVar('ghost')).toBe(0)
    runtime.setVar('ghost', 1)
    expect(logs.some(([, m]) => m.includes('未声明'))).toBe(true)
    runtime.dispose()
  })

  it('wait resolves on the timer and rejects on abort', async () => {
    const { runtime } = makeRuntime()
    let done = false
    void runtime.wait(500).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(499)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)

    const controller = new AbortController()
    const settled = runtime.wait(1000, controller.signal).then(
      () => 'resolved',
      () => 'rejected',
    )
    controller.abort()
    expect(await settled).toBe('rejected')
    runtime.dispose()
  })

  it('dispose cancels every outstanding wait rather than leaking a timer', async () => {
    const { runtime } = makeRuntime()
    const settled = runtime.wait(10_000).then(
      () => 'resolved',
      () => 'rejected',
    )
    runtime.dispose()
    expect(await settled).toBe('rejected')
  })

  it('resetScene returns variables, visibility, highlights and panels to the document', async () => {
    const doc = createGoldenPathDocument()
    const { runtime } = makeRuntime(doc)
    await runtime.load(doc)

    runtime.setVar('step', 9)
    runtime.setVisible(IDS.cover, false)
    runtime.highlight(IDS.cover, 'outline_red')
    runtime.openPanel(IDS.hotspot)

    runtime.resetScene()

    expect(runtime.getVar('step')).toBe(1)
    expect(runtime.isVisible(IDS.cover)).toBe(true)
    expect(runtime.highlights.activeNodeIds).toEqual([])
    expect(runtime.isPanelOpen(IDS.hotspot)).toBe(false)
    runtime.dispose()
  })

  it('setVisible with includeDescendants reaches the subtree', async () => {
    const doc = createGoldenPathDocument()
    const { runtime } = makeRuntime(doc)
    await runtime.load(doc)
    runtime.setVisible(IDS.pump, false, { includeDescendants: true })
    expect(runtime.isVisible(IDS.body)).toBe(false)
    expect(runtime.isVisible(IDS.cover)).toBe(false)
    runtime.dispose()
  })

  it('warns when a highlight lands on a node with no geometry, rather than reporting success', async () => {
    const logs: [LogLevel, string][] = []
    const doc = createGoldenPathDocument()
    const { runtime } = makeRuntime(doc, logs)
    await runtime.load(doc)

    // The asset never loaded, so 阀盖 is a placeholder group with nothing to shade.
    runtime.highlight(IDS.cover, 'outline_amber')
    expect(runtime.highlights.isHighlighted(IDS.cover)).toBe(false)
    expect(logs.some(([level, m]) => level === 'warn' && m.includes('占位节点'))).toBe(true)

    // A grouping node reports the other reason.
    runtime.highlight(IDS.pump, 'outline_amber')
    expect(logs.some(([, m]) => m.includes('没有可着色的几何体'))).toBe(true)
    runtime.dispose()
  })

  it('says so plainly that imported clips are not wired yet, rather than silently doing nothing', async () => {
    const doc = createGoldenPathDocument()
    const withImported: SceneDocument = {
      ...doc,
      animations: [
        ...doc.animations,
        {
          kind: 'imported',
          id: 'anm_11111111',
          name: '拆解',
          assetId: doc.assets[0]!.id,
          clipName: 'Disassemble',
          speed: 1,
          loop: false,
          clampWhenFinished: true,
        },
      ],
    }
    const logs: [LogLevel, string][] = []
    const { runtime } = makeRuntime(withImported, logs)
    await runtime.load(withImported)
    await runtime.playAnimation('anm_11111111', {})
    expect(logs.some(([, m]) => m.includes('T-037'))).toBe(true)
    runtime.dispose()
  })
})

describe('the shared RuntimeContext contract', () => {
  describeRuntimeContract('scene-runtime', (doc) => {
    clock = 0
    const runtime = new SceneRuntime(doc, {
      canvas: canvas(),
      resolver: createMemoryResolver(new Map()),
      mode: 'play',
      createRenderer: () => fakeRenderer().renderer,
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => clock,
    })
    runtime.graph.build(doc)
    runtime.resetScene()
    return {
      ctx: runtime,
      async advance(ms: number) {
        advanceClock(ms)
        runtime.tick()
        await vi.advanceTimersByTimeAsync(ms)
        for (let i = 0; i < 6; i++) await Promise.resolve()
      },
    }
  })
})
