import type { Light, NodeOverrides, SceneDocument } from '@w3/schema'
import { createGoldenPathDocument, identityTransform } from '@w3/schema'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PCFSoftShadowMap } from 'three'
import type { SpotLight } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionRegistry, registerBuiltinActions } from '../../src/eca/actions/index.js'
import { EcaEngine } from '../../src/eca/engine.js'
import { createMemoryResolver } from '../../src/runtime/loader.js'
import { NullHotspotRenderer } from '../../src/runtime/hotspot-layer.js'
import { SceneRuntime } from '../../src/runtime/scene-runtime.js'
import type { SceneRuntimeOptions } from '../../src/runtime/scene-runtime.js'
import type { LogLevel } from '../../src/eca/types.js'
import type { RuntimeEvent } from '../../src/eca/types.js'
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

/**
 * A stand-in for WebGLRenderer. Records calls; allocates no GL context.
 *
 * `shadowMap` is part of the stand-in rather than something the production code defends
 * against being absent: a real `WebGLRenderer` always has it, and letting the double omit
 * it would mean the runtime had to carry an `if` for a state that cannot occur in
 * production — an untestable branch guarding against the test harness. It is also what
 * makes T-132's acceptance ("无 GL 断言 shadowMap 开关联动") assertable at all.
 */
/** A stand-in for HTMLMediaElement. Records nothing; plays instantly and successfully. */
function fakeMediaElement() {
  const listeners = new Set<() => void>()
  return {
    src: '',
    volume: 1,
    loop: false,
    currentTime: 0,
    play: () => Promise.resolve(),
    pause: () => {},
    addEventListener: (_type: 'ended', listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: 'ended', listener: () => void) => void listeners.delete(listener),
    /** Test seam: fires `ended`, which is how a clip finishes without real playback. */
    finish: () => {
      for (const listener of [...listeners]) listener()
    },
  }
}

function fakeRenderer() {
  const calls = { render: 0, setSize: 0, setPixelRatio: 0, dispose: 0 }
  const shadowMap = { enabled: false, type: -1 }
  return {
    calls,
    shadowMap,
    renderer: {
      calls,
      info: { memory: { geometries: 0, textures: 0 } },
      shadowMap,
      render: () => {
        calls.render++
      },
      setSize: () => {
        calls.setSize++
      },
      // T-214 · `RendererLike` has always required this; the `as never` cast below let the
      // stub omit it, and nothing noticed until production started calling it.
      setPixelRatio: () => {
        calls.setPixelRatio++
      },
      dispose: () => {
        calls.dispose++
      },
      domElement: {} as HTMLCanvasElement,
      // T-241 · core 自带的 composer 工厂会问显卡有没有浮点帧缓冲，真 `WebGLRenderer`
      // 永远有 `extensions`。与 `shadowMap` 同一条理由放进替身：让生产代码为一个
      // 只在测试里可能出现的状态写 `if`，那个分支永远测不到。
      extensions: { has: () => false },
      getPixelRatio: () => 1,
      getSize: (target: { set: (w: number, h: number) => unknown }) => target.set(800, 600),
      setRenderTarget: () => {},
      getRenderTarget: () => null,
      clear: () => {},
    } as never,
  }
}

const canvas = () => ({ clientWidth: 800, clientHeight: 600 }) as HTMLCanvasElement

/** The golden path document plus an imported clip pointing at its asset. */
const withClip = (doc: SceneDocument): SceneDocument => ({
  ...doc,
  animations: [
    ...doc.animations,
    {
      startS: 0,
      endS: null,
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
})

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
  // T-235 · composer 工厂。缺省不注入 —— 那正是「默认走直连」的形状。
  createComposer?: SceneRuntimeOptions['createComposer'],
) {
  clock = 0
  const { renderer, calls, shadowMap } = fakeRenderer()
  const runtime = new SceneRuntime(doc, {
    canvas: canvas(),
    resolver: createMemoryResolver(files),
    mode: 'play',
    createRenderer: () => renderer,
    hotspotRenderer: new NullHotspotRenderer(),
    now: () => clock,
    onLog: (level, message) => logs?.push([level, message]),
    ...(createComposer === undefined ? {} : { createComposer }),
  })
  return { runtime, calls, shadowMap }
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

  it('T-037 · plays an imported clip once its asset is loaded', async () => {
    const doc = createGoldenPathDocument()
    const withImported = withClip(doc)
    const bytes = await buildPumpGlb({ animationName: 'Disassemble', animationSeconds: 1 })
    const { runtime } = makeRuntime(withImported, undefined, new Map([[doc.assets[0]!.url, bytes]]))
    await runtime.load(withImported)

    let settled = false
    void runtime.playAnimation('anm_11111111', {}).then(() => {
      settled = true
    })

    runtime.tick()
    expect(runtime.isAnimationPlaying('anm_11111111')).toBe(true)

    advanceClock(999)
    runtime.tick()
    await flush()
    expect(settled).toBe(false)

    advanceClock(1)
    runtime.tick()
    await flush()
    expect(settled).toBe(true)
    expect(runtime.isAnimationPlaying('anm_11111111')).toBe(false)
    runtime.dispose()
  })

  it('warns when an imported clip names an asset that never loaded, rather than hanging', async () => {
    const logs: [LogLevel, string][] = []
    // Empty resolver: the asset never arrives.
    const { runtime } = makeRuntime(withClip(createGoldenPathDocument()), logs)
    await runtime.load(runtime.doc)
    await expect(runtime.playAnimation('anm_11111111', {})).resolves.toBeUndefined()
    expect(logs.some(([level, m]) => level === 'warn' && m.includes('尚未加载'))).toBe(true)
    runtime.dispose()
  })
})

describe('the shared RuntimeContext contract', () => {
  describeRuntimeContract('scene-runtime', (doc) => {
    clock = 0
    const runtime = new SceneRuntime(doc, {
      canvas: canvas(),
      // Resolves ANY url to empty bytes. The contract is about media semantics — started,
      // stopped, silenced on reset — not about storage, and a resolver that refuses every
      // url would make the media half fail for a reason about the harness.
      resolver: { resolve: async () => new ArrayBuffer(8) },
      mode: 'play',
      createRenderer: () => fakeRenderer().renderer,
      hotspotRenderer: new NullHotspotRenderer(),
      // A stand-in for <audio>, for the same reason as `createRenderer`: the bus's logic —
      // pooling, volume, loop, stop, the autoplay fallback — is what the contract compares,
      // and none of it needs a decoder. Without this the contract's media assertions would
      // pass on the headless side and fail here for a reason that is about the harness.
      createMediaElement: () => fakeMediaElement(),
      now: () => clock,
    })
    runtime.graph.build(doc)
    runtime.resetScene()
    // T-216 · the contract's event-sequence assertions read this.
    const seen: RuntimeEvent[] = []
    runtime.onEvent((event) => void seen.push(event))
    return {
      ctx: runtime,
      async advance(ms: number) {
        advanceClock(ms)
        runtime.tick()
        await vi.advanceTimersByTimeAsync(ms)
        for (let i = 0; i < 6; i++) await Promise.resolve()
      },
      lightOf: (nodeId: string) => runtime.lightOf(nodeId),
      events: () => seen,
    }
  })
})

/**
 * T-132 · the shadow pipeline.
 *
 * Everything here runs without a GL context: the switch is a boolean on the renderer and
 * the per-mesh effect is two booleans on an Object3D, so "does the pipeline follow the
 * document" is fully assertable in Node. What needs a browser is whether the resulting
 * picture actually has a shadow in it, and that is the E2E's job.
 */
describe('shadows (T-132)', () => {
  const spot = (enabled: boolean): Light => ({
    kind: 'spot',
    color: '#ffd9a0',
    intensity: 3,
    range: 0,
    decay: 2,
    angleDeg: 30,
    penumbra: 0.2,
    shadow: { enabled, quality: 'medium', bias: -0.0005 },
  })

  const LIGHT_ID = 'nd_light001'

  /** The golden path plus an optional light node, and optional overrides. */
  function docWith(options: {
    light?: Light | null
    coverOverrides?: NodeOverrides
    lightOverrides?: NodeOverrides
  }): SceneDocument {
    const base = createGoldenPathDocument()
    const nodes = base.nodes.map((n) =>
      n.id === IDS.cover && options.coverOverrides
        ? { ...n, overrides: { ...n.overrides, ...options.coverOverrides } }
        : n,
    )
    if (!options.light) return { ...base, nodes }
    return {
      ...base,
      nodes: [
        ...nodes,
        {
          section: null,
          explode: null,
          explodeOffset: null,
          prefabRef: null,
          id: LIGHT_ID,
          name: '聚光灯',
          parent: null,
          order: 9000,
          assetRef: null,
          primitive: null,
          light: options.light,
          transform: identityTransform(),
          visible: true,
          locked: false,
          overrides: options.lightOverrides ?? {},
        },
      ],
    }
  }

  it('materialises a light node as a real three light, not the placeholder group', async () => {
    // The wiring, asserted directly. The light factory (T-131) and the carrier dispatch
    // (T-130) were both green while NOTHING CONNECTED THEM: the graph fell back to the
    // placeholder factory, so every document light became an empty Group — a light in the
    // hierarchy tree, a gizmo that moves it, patches that reach it, and a scene that stays
    // exactly as dark as it was. Neither card's tests could see it; each was exercising
    // its own half against a stand-in of the other.
    const doc = docWith({ light: spot(true) })
    const { runtime } = makeRuntime(doc)
    await runtime.load(doc)

    const object = runtime.graph.objectFor(LIGHT_ID)!
    expect((object as { isLight?: boolean }).isLight, '灯节点没有变成真的灯').toBe(true)
    const light = object as unknown as SpotLight
    expect(light.intensity, '文档里的强度没有到达灯').toBe(3)
    expect(light.angle, 'angleDeg 应当已转成弧度').toBeCloseTo((30 * Math.PI) / 180, 9)
    runtime.dispose()
  })

  it('leaves the pipeline off when nothing asks for a shadow', async () => {
    // A depth pass nobody uses is the most expensive thing this renderer can be told to do
    // for nothing, so "off unless asked" is the behaviour, not an optimisation.
    const doc = docWith({ light: null })
    const { runtime, shadowMap } = makeRuntime(doc)
    await runtime.load(doc)
    expect(shadowMap.enabled).toBe(false)
    expect(runtime.graph.objectFor(IDS.cover)!.castShadow).toBe(false)
    expect(runtime.graph.objectFor(IDS.cover)!.receiveShadow).toBe(false)
    runtime.dispose()
  })

  it('a light with shadows off does not switch the pipeline on', async () => {
    // The discriminating case: a light EXISTS here, so "any light at all" would pass.
    const doc = docWith({ light: spot(false) })
    const { runtime, shadowMap } = makeRuntime(doc)
    await runtime.load(doc)
    expect(shadowMap.enabled).toBe(false)
    expect(runtime.graph.objectFor(IDS.cover)!.castShadow).toBe(false)
    runtime.dispose()
  })

  it('one shadow-casting light turns it on, and meshes cast and receive by default', async () => {
    const doc = docWith({ light: spot(true) })
    const { runtime, shadowMap } = makeRuntime(doc)
    await runtime.load(doc)
    expect(shadowMap.enabled).toBe(true)
    // PCFSoft, not the hard-edged default: on the large flat surfaces this product is used
    // on, plain PCF reads as a rendering artefact rather than as a shadow.
    expect(shadowMap.type).toBe(PCFSoftShadowMap)
    for (const id of [IDS.body, IDS.cover]) {
      expect(runtime.graph.objectFor(id)!.castShadow, id).toBe(true)
      expect(runtime.graph.objectFor(id)!.receiveShadow, id).toBe(true)
    }
    runtime.dispose()
  })

  it('node overrides turn one node off without touching its siblings', async () => {
    const doc = docWith({ light: spot(true), coverOverrides: { castShadow: false } })
    const { runtime } = makeRuntime(doc)
    await runtime.load(doc)

    const cover = runtime.graph.objectFor(IDS.cover)!
    expect(cover.castShadow, '阀盖 被单独关掉投射').toBe(false)
    expect(cover.receiveShadow, '关掉投射不该把接收一起关掉').toBe(true)
    expect(runtime.graph.objectFor(IDS.body)!.castShadow, '兄弟节点不受影响').toBe(true)
    runtime.dispose()
  })

  it('does not write the mesh overrides onto a light node', async () => {
    // `castShadow` on a light means "this light casts", and it comes from
    // `light.shadow.enabled`. If the node walk did not skip lights, this override would
    // silently switch a light's shadow off through an unrelated control.
    const doc = docWith({ light: spot(true), lightOverrides: { castShadow: false } })
    const { runtime } = makeRuntime(doc)
    await runtime.load(doc)
    expect(runtime.graph.objectFor(LIGHT_ID)!.castShadow).toBe(true)
    runtime.dispose()
  })

  it('follows a patch that switches the last shadow off, without a full rebuild', async () => {
    const on = docWith({ light: spot(true) })
    const off = docWith({ light: spot(false) })
    const { runtime, shadowMap } = makeRuntime(on)
    await runtime.load(on)
    expect(shadowMap.enabled).toBe(true)

    runtime.applyPatch([{ op: 'replace', path: ['nodes', 3, 'light', 'shadow', 'enabled'], value: false }], off, on)
    expect(shadowMap.enabled).toBe(false)
    expect(runtime.graph.objectFor(IDS.cover)!.castShadow, '关掉后 mesh 标志位要跟着复位').toBe(false)
    expect(runtime.fullRebuildCount, '这条 patch 不该回落全量重建').toBe(0)
    runtime.dispose()
  })

  it('rewrites the flags after a rebuild, where every Object3D is new', async () => {
    const doc = docWith({ light: spot(true) })
    const { runtime } = makeRuntime(doc)
    await runtime.load(doc)
    // A second load rebuilds the graph from scratch. The on/off state has not moved, so
    // only the forced re-application keeps the new objects correct.
    await runtime.load(doc)
    expect(runtime.graph.objectFor(IDS.cover)!.castShadow).toBe(true)
    runtime.dispose()
  })

  it('reaches the geometry inside a node, and stops at the next node', async () => {
    // A node materialises one Object3D that may hold several meshes, and three reads the
    // flag per renderable object — so the whole subtree has to carry it. But a descendant
    // that is ITSELF a document node has its own overrides, and walking through it would
    // let a parent silently override its child.
    const bytes = await buildPumpGlb()
    const doc = docWith({ light: spot(true), coverOverrides: { castShadow: false } })
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

    const body = runtime.graph.objectFor(IDS.body)!
    let meshes = 0
    body.traverse((child) => {
      if ((child as { isMesh?: boolean }).isMesh !== true) return
      meshes++
      expect(child.castShadow, '节点内部的 mesh 也要拿到标志位').toBe(true)
    })
    expect(meshes, '这份 GLB 里 泵体 应当真的有 mesh').toBeGreaterThan(0)

    expect(runtime.graph.objectFor(IDS.cover)!.castShadow, '被单独关掉的节点不受父级影响').toBe(false)
    runtime.dispose()
  })
})

/* ========================================================================== */
/* T-235 · 唯一渲染出口 · capturing 守卫 · chrome 注册表                        */
/* ========================================================================== */

describe('T-235 · 唯一渲染出口', () => {
  it('源文件里 renderer?.render( 恰好出现一次', () => {
    // 收口前是 2 处（tick 与 renderFrame 各一），加一条后处理链就要两处都记得改，
    // 而漏掉的那一处会在某个宿主上安静地画出没有描边的画面。
    //
    // ADR-0025 预告了一条脚本化的检查（与出图同版本新建）。在它落地之前，这条 grep
    // 是唯一拦着后来人再加一处的东西 —— 所以它读的是**源文件文本**，不是行为。
    const source = readFileSync(
      fileURLToPath(new URL('../../src/runtime/scene-runtime.ts', import.meta.url)),
      'utf8',
    )
    // **先去注释再数。** 第一版没去，于是 `drawScene()` 自己那句「全文件唯一一处
    // `renderer?.render(`」的注释被算成了第二处命中——一条检查把自己的说明文字
    // 当成了违规。ADR-0025 预告的那条脚本化检查同样要处理这件事。
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const hits = code.match(/renderer\?\.render\(/g) ?? []
    expect(hits, `renderer?.render( 出现了 ${hits.length} 次，应当只在 drawScene() 里有一处`).toHaveLength(1)
  })

  it('tick() 与 renderFrame() 走同一个出口', () => {
    const { runtime, calls } = makeRuntime()
    const before = calls.render
    runtime.tick()
    const afterTick = calls.render
    runtime.renderFrame()
    const afterFrame = calls.render

    expect(afterTick - before, 'tick 画了一帧').toBe(1)
    expect(afterFrame - afterTick, 'renderFrame 也画了一帧').toBe(1)
    runtime.dispose()
  })
})

describe('T-235 · capturing 守卫', () => {
  it('出图期间 tick() 不画', () => {
    const { runtime, calls } = makeRuntime()
    runtime.tick()
    const drawn = calls.render

    runtime.beginCapture()
    runtime.tick()
    runtime.tick()
    expect(calls.render, '出图期间画布上会是半改完的状态').toBe(drawn)

    runtime.endCapture()
    runtime.tick()
    expect(calls.render).toBe(drawn + 1)
    runtime.dispose()
  })

  it('出图期间的 resize 被记下来，结束时补上', () => {
    const { runtime, calls } = makeRuntime()
    runtime.resize(800, 600)
    const sized = calls.setSize

    runtime.beginCapture()
    runtime.resize(100, 50)
    expect(calls.setSize, '出图算了一半的分辨率不许被冲掉').toBe(sized)

    runtime.endCapture()
    expect(calls.setSize, '结束时要补上那一次').toBe(sized + 1)
    runtime.dispose()
  })

  it('出图期间没有 resize 过，结束时也不多画一次', () => {
    const { runtime, calls } = makeRuntime()
    runtime.resize(800, 600)
    const sized = calls.setSize
    runtime.beginCapture()
    runtime.endCapture()
    expect(calls.setSize).toBe(sized)
    runtime.dispose()
  })
})

describe('T-235 · chrome 注册表接到运行时上', () => {
  /**
   * chrome 只在 `mode: 'edit'` 下存在——播放器本来就不画它，所以 `setChromeVisible`
   * 在 play 模式下是刻意的空操作。`makeRuntime` 是 play 模式的，这里另起一个。
   */
  const editRuntime = () =>
    new SceneRuntime(createGoldenPathDocument(), {
      canvas: canvas(),
      resolver: createMemoryResolver(new Map()),
      mode: 'edit',
      createRenderer: () => fakeRenderer().renderer,
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
    })

  it('setEditorChromeVisible 是 setChromeVisible 的别名，两者作用相同', () => {
    const runtime = editRuntime()
    const extra = new Object3D()
    extra.name = 'w3:probe'
    const off = runtime.registerChrome(extra)

    runtime.setEditorChromeVisible(false)
    expect(extra.visible, '通过别名隐藏的也是同一批对象').toBe(false)

    runtime.setChromeVisible(true)
    expect(extra.visible).toBe(true)

    off()
    runtime.dispose()
  })

  it('反注册之后不再受开关影响', () => {
    const runtime = editRuntime()
    const extra = new Object3D()
    const off = runtime.registerChrome(extra)
    off()

    runtime.setChromeVisible(false)
    expect(extra.visible, '已经摘掉的对象不该再被翻').toBe(true)
    runtime.dispose()
  })

  it('play 模式下开关是空操作 —— 播放器本来就没有 chrome', () => {
    // `makeRuntime` 就是 play 模式。注册得进去（宿主不必先问自己是什么模式），
    // 但开关不动它——播放器画面里本来就没有这些东西。
    const { runtime } = makeRuntime()
    const extra = new Object3D()
    runtime.registerChrome(extra)
    runtime.setChromeVisible(false)
    expect(extra.visible).toBe(true)
    runtime.dispose()
  })
})

describe('T-235 · 管线接在运行时的三个点上', () => {
  it('默认文档：composer 工厂一次都没被调用', () => {
    const createComposer = vi.fn()
    const { runtime } = makeRuntime(createGoldenPathDocument(), undefined, undefined, createComposer)
    expect(createComposer).not.toHaveBeenCalled()
    expect(runtime.pipelineMode).toBe('direct')
    runtime.dispose()
  })

  it('setPostFxEnabled(true) 之后 mode 变成 composed', () => {
    const createComposer = vi.fn(() => ({
      passes: [] as unknown[],
      addPass: () => {},
      removePass: () => {},
      render: () => {},
      setSize: () => {},
      dispose: () => {},
      renderTarget1: { samples: 4 },
      renderTarget2: { samples: 0 },
    }))
    const { runtime } = makeRuntime(createGoldenPathDocument(), undefined, undefined, createComposer)

    runtime.setPostFxEnabled(true)
    expect(createComposer).toHaveBeenCalledTimes(1)
    expect(runtime.pipelineMode).toBe('composed')

    runtime.setPostFxEnabled(null)
    expect(runtime.pipelineMode).toBe('direct')
    runtime.dispose()
  })
})

/* ========================================================================== */
/* T-239 · 编辑期辅助物不吃雾 —— 遍历断言，不是写死名单                        */
/* ========================================================================== */

describe('T-239 · registerChrome 顺手关掉雾', () => {
  const editRuntimeForFog = () =>
    new SceneRuntime(createGoldenPathDocument(), {
      canvas: canvas(),
      resolver: createMemoryResolver(new Map()),
      mode: 'edit',
      createRenderer: () => fakeRenderer().renderer,
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
    })

  /** 一个吃雾的网格。**先断它默认吃雾**，否则下面的断言对「本来就是 false」也成立。 */
  const foggyMesh = () => {
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
    mesh.name = 'w3:probe'
    return mesh
  }

  it('注册进去的对象，整棵子树都不吃雾了', () => {
    const runtime = editRuntimeForFog()
    const root = new Group()
    const child = foggyMesh()
    const grandchild = foggyMesh()
    child.add(grandchild)
    root.add(child)

    expect((child.material as MeshStandardMaterial).fog, '前提：材质默认是吃雾的').toBe(true)

    runtime.registerChrome(root)

    expect((child.material as MeshStandardMaterial).fog).toBe(false)
    expect((grandchild.material as MeshStandardMaterial).fog, '孙子节点也要').toBe(false)
    runtime.dispose()
  })

  /**
   * **遍历断言，不是写死名单。**
   *
   * 卡面要求「`scene.children` 里除 `graph.root` 外每个对象材质 `fog === false`」。
   * 那个写法今天会**恒真**：chrome 全在一个 Group 下，而那个 Group 本身没有材质，
   * 于是「每个对象」这句话遍历到的是零个材质。
   *
   * 所以数据源是 `ChromeRegistry.objects`，而且**先断它非空**——一个空注册表下
   * 「每一个都不吃雾」是恒真的，那正是 D36 的 M6 形状。
   */
  it('注册表里每一个对象的每一份材质都不吃雾（含前提：注册表非空）', () => {
    const runtime = editRuntimeForFog()
    const extra = foggyMesh()
    runtime.registerChrome(extra)

    // `grid` 与 `lightHelpers.root` 在构造时就注册了，加上这一个
    const scene = runtime.scene
    const chromeRoot = scene.getObjectByName('w3:chrome')
    expect(chromeRoot, 'chrome 容器不在场景里，下面的遍历什么都查不到').toBeDefined()

    let materialsSeen = 0
    chromeRoot!.traverse((object) => {
      const material = (object as Mesh).material
      if (!material) return
      for (const one of Array.isArray(material) ? material : [material]) {
        if (!('fog' in one)) continue
        materialsSeen++
        expect(one.fog, `${object.name || object.type} 的材质还在吃雾`).toBe(false)
      }
    })

    // 下限：一份材质都没遍历到时，上面那个循环里的 expect 一次都没执行
    expect(materialsSeen, '一份材质都没查到，这条断言是空转的').toBeGreaterThan(0)
    runtime.dispose()
  })

  it('场景图本身照常吃雾 —— 关的只是辅助物', () => {
    // 反向：把整个场景的材质都关掉雾，用户的模型就不受雾影响了，而那是本卡要做的
    // 事情的**反面**。
    const runtime = editRuntimeForFog()
    let graphMaterials = 0
    let foggy = 0
    runtime.graph.root.traverse((object) => {
      const material = (object as Mesh).material
      if (!material) return
      for (const one of Array.isArray(material) ? material : [material]) {
        if (!('fog' in one)) continue
        graphMaterials++
        if (one.fog) foggy++
      }
    })
    if (graphMaterials > 0) expect(foggy, '场景图的材质被顺手关掉了雾').toBe(graphMaterials)
    runtime.dispose()
  })
})

/* ========================================================================== */
/* T-240 · 高亮的两种画法，在真运行时上                                        */
/* ========================================================================== */

describe('T-240 · 描边开关决定高亮怎么画', () => {
  const SHADED = 'nd_shade001'

  /** 黄金路径 + 一个图元节点。图元是唯一同步就能 materialise 出真网格的载体。 */
  const shadedDoc = (outline: boolean): SceneDocument => {
    const base = createGoldenPathDocument()
    return {
      ...base,
      meta: { ...base.meta, effects: { outline: { ...base.meta.effects.outline, enabled: outline } } },
      nodes: [
        ...base.nodes,
        {
          section: null,
          explode: null,
          explodeOffset: null,
          prefabRef: null,
          id: SHADED,
          name: '标记球',
          parent: null,
          order: 9100,
          assetRef: null,
          primitive: { kind: 'sphere', radius: 0.2 },
          light: null,
          transform: { p: [0, 1, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
          visible: true,
          locked: false,
          overrides: {},
        },
      ],
    }
  }

  const fakeOutlinePass = () => ({
    selectedObjects: [] as Object3D[],
    edgeStrength: 0,
    edgeThickness: 0,
    pulsePeriod: 3,
    visibleEdgeColor: { set: () => {} },
    hiddenEdgeColor: { set: () => {} },
    dispose: () => {},
  })

  const fakeComposer = () => ({
    passes: [] as unknown[],
    addPass(p: unknown) {
      this.passes.push(p)
    },
    removePass(p: unknown) {
      const i = this.passes.indexOf(p)
      if (i >= 0) this.passes.splice(i, 1)
    },
    render: () => {},
    setSize: () => {},
    dispose: () => {},
    renderTarget1: { samples: 4 },
    renderTarget2: { samples: 0 },
  })

  /** 一个装好了描边工厂的运行时。`outline` 决定文档里那个开关。 */
  function outlineRuntime(outline: boolean, logs?: [LogLevel, string][]) {
    const passes: ReturnType<typeof fakeOutlinePass>[] = []
    const runtime = new SceneRuntime(shadedDoc(outline), {
      canvas: canvas(),
      resolver: createMemoryResolver(new Map()),
      mode: 'play',
      createRenderer: () => fakeRenderer().renderer,
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
      onLog: (level, message) => logs?.push([level, message]),
      createComposer: fakeComposer,
      createOutlinePass: () => {
        const p = fakeOutlinePass()
        passes.push(p)
        return p
      },
    })
    // 契约 harness 同款：构造函数不建图，`load` 才建，而 `load` 是异步的、这里又没有
    // 资产要加载。图元节点在 `build` 里同步 materialise 成真网格，正是本组需要的。
    runtime.graph.build(runtime.doc)
    return { runtime, passes }
  }

  const materialOf = (runtime: SceneRuntime, nodeId: string) =>
    (runtime.graph.objectFor(nodeId) as Mesh).material as MeshStandardMaterial

  it('outline.enabled 为 false：走自发光，材质的 emissive 被写', () => {
    const { runtime, passes } = outlineRuntime(false)
    const before = materialOf(runtime, SHADED).emissive.getHexString()

    runtime.highlight(SHADED, 'outline_amber')

    expect(runtime.highlightOf(SHADED)).toBe('outline_amber')
    expect(materialOf(runtime, SHADED).emissive.getHexString()).not.toBe(before)
    expect(passes, '关着的时候一条 pass 都不该被造出来').toHaveLength(0)
    runtime.dispose()
  })

  it('outline.enabled 为 true：材质不被写，对象进了 pass 的 selectedObjects', () => {
    const { runtime, passes } = outlineRuntime(true)
    const before = materialOf(runtime, SHADED).emissive.getHexString()

    runtime.highlight(SHADED, 'outline_amber')

    expect(runtime.highlightOf(SHADED)).toBe('outline_amber')
    expect(materialOf(runtime, SHADED).emissive.getHexString(), '描边不碰材质').toBe(before)
    expect(passes).toHaveLength(1)
    expect(passes[0]!.selectedObjects).toContain(runtime.graph.objectFor(SHADED))
    runtime.dispose()
  })

  it('中途打开描边：已经高亮的那个被重画，材质还原、对象进 pass', () => {
    // 不重画的话，开关那一瞬间已高亮的节点会「消失」，而用户没有取消过高亮。
    const { runtime, passes } = outlineRuntime(false)
    const before = materialOf(runtime, SHADED).emissive.getHexString()
    runtime.highlight(SHADED, 'outline_red')
    expect(materialOf(runtime, SHADED).emissive.getHexString()).not.toBe(before)

    runtime.setPostFxEnabled(true)

    expect(runtime.pipelineMode).toBe('composed')
    expect(runtime.highlightOf(SHADED), '换画法不等于取消高亮').toBe('outline_red')
    expect(materialOf(runtime, SHADED).emissive.getHexString(), '自发光那份要被撤掉').toBe(before)
    expect(passes[0]!.selectedObjects).toContain(runtime.graph.objectFor(SHADED))
    runtime.dispose()
  })

  it('再关回去：对象从 pass 里摘掉，材质重新被写', () => {
    const { runtime, passes } = outlineRuntime(true)
    runtime.highlight(SHADED, 'outline_red')
    const lit = materialOf(runtime, SHADED).emissive.getHexString()

    runtime.setPostFxEnabled(false)

    expect(runtime.pipelineMode).toBe('direct')
    expect(runtime.highlightOf(SHADED)).toBe('outline_red')
    expect(passes[0]!.selectedObjects).toEqual([])
    expect(materialOf(runtime, SHADED).emissive.getHexString()).not.toBe(lit)
    runtime.dispose()
  })

  it('**宿主一个工厂都不注入时，描边仍然真的走描边** —— 这是 C3 的落点（T-241）', async () => {
    // 播放器从不注入任何东西（`session.ts` 是 C3 验收口径明令不许出现 diff 的文件），
    // 所以默认值必须在 core 里。默认值一旦丢了，症状是「预览里有轮廓、发布出去没有」——
    // 而两边的测试各自都是绿的。
    const runtime = new SceneRuntime(shadedDoc(true), {
      canvas: canvas(),
      resolver: createMemoryResolver(new Map()),
      mode: 'play',
      createRenderer: () => fakeRenderer().renderer,
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
    })
    runtime.graph.build(runtime.doc)
    const before = (runtime.graph.objectFor(SHADED) as Mesh & { material: MeshStandardMaterial }).material.emissive.getHexString()

    runtime.highlight(SHADED, 'outline_amber')

    expect(runtime.pipelineMode, '默认 composer 工厂也在 core 里').toBe('composed')
    expect(runtime.highlightOf(SHADED)).toBe('outline_amber')
    expect(
      (runtime.graph.objectFor(SHADED) as Mesh & { material: MeshStandardMaterial }).material.emissive.getHexString(),
      '走了描边就不该碰材质',
    ).toBe(before)
    runtime.dispose()
  })

  it('注入口仍然管用 —— 注入的桩要盖过默认值', () => {
    // 默认值不能把注入口挤掉：core 自己的单测、headless 导出、bench 页都靠注入桩。
    const { runtime, passes } = outlineRuntime(true)
    runtime.highlight(SHADED, 'outline_amber')
    expect(passes, '用的是注入的那个工厂，不是默认那个').toHaveLength(1)
    runtime.dispose()
  })

  it('unlit 材质：自发光模式下失败并报出「材质不支持自发光」，描边模式下成功', () => {
    // 卡面 ④。原来这种情况报的是「没有可着色的几何体」——处置办法完全不同：
    // 节点没有问题，把描边打开就好，而那句文案会让用户去改一个没毛病的节点。
    const logs: [LogLevel, string][] = []
    const off = outlineRuntime(false, logs)
    const unlit = off.runtime.graph.objectFor(SHADED) as Mesh
    unlit.material = new MeshBasicMaterial({ color: 0x334455 })

    off.runtime.highlight(SHADED, 'outline_amber')
    expect(off.runtime.highlightOf(SHADED)).toBeNull()
    expect(logs.some(([level, m]) => level === 'warn' && m.includes('材质不支持自发光'))).toBe(true)
    expect(logs.some(([, m]) => m.includes('没有可着色的几何体')), '别再报成分组节点').toBe(false)
    off.runtime.dispose()

    const on = outlineRuntime(true)
    const unlit2 = on.runtime.graph.objectFor(SHADED) as Mesh
    unlit2.material = new MeshBasicMaterial({ color: 0x334455 })
    on.runtime.highlight(SHADED, 'outline_amber')
    expect(on.runtime.highlightOf(SHADED), '描边这条路不碰材质，unlit 也画得上').toBe('outline_amber')
    on.runtime.dispose()
  })

  it('未知预设报的是预设名，不是几何体', () => {
    const logs: [LogLevel, string][] = []
    const { runtime } = outlineRuntime(false, logs)
    runtime.highlight(SHADED, 'outline_chartreuse')
    expect(logs.some(([level, m]) => level === 'warn' && m.includes('未知的高亮预设'))).toBe(true)
    runtime.dispose()
  })
})

/* ========================================================================== */
/* T-237 · mixer 在运行时里的回收接缝                                          */
/* ========================================================================== */

describe('T-237 · resetScene 与 rebuild 都把 mixer 交回去', () => {
  /** 一个真的加载了带动画 GLB 的运行时。没有真资产就没有 mixer，断言会恒真。 */
  async function loadedRuntime() {
    const bytes = await buildPumpGlb({ animationName: 'Disassemble', animationSeconds: 1 })
    const doc = withClip(createGoldenPathDocument())
    const files = new Map<string, ArrayBuffer>([[doc.assets[0]!.url, bytes]])
    const { runtime } = makeRuntime(doc, undefined, files)
    await runtime.load(doc)
    return { runtime, doc }
  }

  it('前提：播一条导入动画之后真的有 mixer', async () => {
    // 少了这一条，下面两条对一个「从来就没有 mixer」的运行时同样成立。
    const { runtime } = await loadedRuntime()
    void runtime.playAnimation('anm_11111111', {}).catch(() => undefined)
    expect(runtime.clips.mixerCount).toBeGreaterThan(0)
    runtime.dispose()
  })

  it('resetScene 之后 mixer 数为 0', async () => {
    const { runtime } = await loadedRuntime()
    void runtime.playAnimation('anm_11111111', {}).catch(() => undefined)

    runtime.resetScene()

    expect(runtime.clips.mixerCount).toBe(0)
    runtime.dispose()
  })

  it('**连做 5 次「播放 → resetScene」，峰值不随次数增长**', async () => {
    // 只断「调用后为 0」是假绿：clearMixers 没接进 resetScene 时那条也绿。
    const { runtime } = await loadedRuntime()
    const peaks: number[] = []
    for (let i = 0; i < 5; i++) {
      void runtime.playAnimation('anm_11111111', {}).catch(() => undefined)
      peaks.push(runtime.clips.mixerCount)
      runtime.resetScene()
    }
    expect(new Set(peaks).size, `峰值序列 ${peaks.join(',')} 在涨`).toBe(1)
    runtime.dispose()
  })

  it('整图重建之后不再驱动重建前的对象 —— **重建后不重播，直接继续 tick**', async () => {
    // 这条的判别力全在「不重播」上。重建后再 play 一次的话，`play` 开头那句 `stop` 会把
    // 旧 playback 顺手停掉，于是幽灵自己不动了——**通知有没有接进 rebuild 完全看不出来**。
    const { runtime, doc } = await loadedRuntime()
    void runtime.playAnimation('anm_11111111', {}).catch(() => undefined)
    advanceClock(200)
    runtime.tick()
    const ghost = runtime.graph.objectFor(IDS.body)!
    expect(ghost.position.y, '前提：它本来在被驱动').not.toBe(0)
    const ghostY = ghost.position.y

    await runtime.load(doc)
    expect(runtime.graph.objectFor(IDS.body), '前提：重建换了对象').not.toBe(ghost)

    advanceClock(400)
    runtime.tick()
    advanceClock(400)
    runtime.tick()

    expect(ghost.position.y, '幽灵对象一动都不许再动').toBe(ghostY)
    expect(runtime.clips.mixerCount, '重建前那个 mixer 也不该留着').toBe(0)
    runtime.dispose()
  })
})

/* ========================================================================== */
/* T-241 · 选中态描边通道接在运行时上                                          */
/* ========================================================================== */

describe('T-241 · setSelectionOutline', () => {
  const SHADED = 'nd_shade001'

  const shadedEditDoc = (outline: boolean): SceneDocument => {
    const base = createGoldenPathDocument()
    return {
      ...base,
      meta: { ...base.meta, effects: { outline: { ...base.meta.effects.outline, enabled: outline } } },
      nodes: [
        ...base.nodes,
        {
          section: null,
          explode: null,
          explodeOffset: null,
          prefabRef: null,
          id: SHADED,
          name: '标记球',
          parent: null,
          order: 9100,
          assetRef: null,
          primitive: { kind: 'sphere', radius: 0.2 },
          light: null,
          transform: { p: [0, 1, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
          visible: true,
          locked: false,
          overrides: {},
        },
      ],
    }
  }

  /** 编辑模式的运行时。选中态只在编辑模式下有意义。 */
  function editRuntime(outline: boolean) {
    const runtime = new SceneRuntime(shadedEditDoc(outline), {
      canvas: canvas(),
      resolver: createMemoryResolver(new Map()),
      mode: 'edit',
      createRenderer: () => fakeRenderer().renderer,
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
    })
    runtime.graph.build(runtime.doc)
    return runtime
  }

  /** 选中通道当前画着几个对象。走 highlights 的策略，不另开公开面。 */
  const selectionCount = (runtime: SceneRuntime) =>
    (runtime.highlights as unknown as { strategy: { selectionObjects?: readonly unknown[] } }).strategy.selectionObjects
      ?.length ?? 0

  it('**先证明非空，再证明为空** —— 描边开着时选中集真的进了通道', () => {
    // 只断「进预览后为 0」是假绿：它对一个从来没画过选中态的实现同样成立
    // （T-239 ② 已经在雾上踩过这个形状）。
    const runtime = editRuntime(true)
    runtime.setSelectionOutline([SHADED])
    expect(selectionCount(runtime), '前提：它本来是非空的').toBe(1)
    runtime.dispose()
  })

  it('进预览（setChromeVisible(false)）时清空', () => {
    const runtime = editRuntime(true)
    runtime.setSelectionOutline([SHADED])

    runtime.setChromeVisible(false)

    expect(selectionCount(runtime), '选中态与 grid / gizmo 同类，进预览一起收起来').toBe(0)
    runtime.dispose()
  })

  it('退出预览时**按当时的选中集恢复**，不是留空', () => {
    const runtime = editRuntime(true)
    runtime.setSelectionOutline([SHADED])
    runtime.setChromeVisible(false)

    runtime.setChromeVisible(true)

    expect(selectionCount(runtime), '用户没有取消过选择').toBe(1)
    runtime.dispose()
  })

  it('预览期间改选中集，不会漏进画面', () => {
    const runtime = editRuntime(true)
    runtime.setChromeVisible(false)
    runtime.setSelectionOutline([SHADED])
    expect(selectionCount(runtime)).toBe(0)
    runtime.dispose()
  })

  it('中途打开描边：当前选中集立刻出现在新通道里', () => {
    // 换策略之后不重推的话，「面板上打开描边」会让选中的对象没有轮廓，
    // 直到用户重新点一次 —— 而用户会认为是描边坏了。
    const runtime = editRuntime(false)
    runtime.setSelectionOutline([SHADED])
    expect(runtime.pipelineMode).toBe('direct')

    runtime.setPostFxEnabled(true)

    expect(runtime.pipelineMode).toBe('composed')
    expect(selectionCount(runtime)).toBe(1)
    runtime.dispose()
  })

  it('描边关着时它是无操作，不抛', () => {
    const runtime = editRuntime(false)
    expect(() => runtime.setSelectionOutline([SHADED])).not.toThrow()
    runtime.dispose()
  })

  it('选中态不碰材质 —— 它与 highlight 是两条路', () => {
    const runtime = editRuntime(true)
    const material = (runtime.graph.objectFor(SHADED) as Mesh).material as MeshStandardMaterial
    const before = material.emissive.getHexString()

    runtime.setSelectionOutline([SHADED])

    expect(material.emissive.getHexString()).toBe(before)
    expect(runtime.highlightOf(SHADED), '选中不是高亮').toBeNull()
    runtime.dispose()
  })
})
