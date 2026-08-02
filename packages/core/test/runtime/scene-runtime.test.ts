import type { Light, NodeOverrides, SceneDocument } from '@w3/schema'
import { createGoldenPathDocument, identityTransform } from '@w3/schema'
import { PCFSoftShadowMap } from 'three'
import type { Mesh, MeshStandardMaterial, SpotLight } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionRegistry, registerBuiltinActions } from '../../src/eca/actions/index.js'
import { EcaEngine } from '../../src/eca/engine.js'
import { createMemoryResolver } from '../../src/runtime/loader.js'
import { NullHotspotRenderer } from '../../src/runtime/hotspot-layer.js'
import { SceneRuntime } from '../../src/runtime/scene-runtime.js'
import type { LogLevel } from '../../src/eca/types.js'
import { describeRuntimeContract } from '../runtime-contract.js'
import { IDS, makeRule } from '../helpers.js'
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
  const calls = { render: 0, setSize: 0, dispose: 0 }
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
      dispose: () => {
        calls.dispose++
      },
      domElement: {} as HTMLCanvasElement,
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

describe('a carrier KIND change keeps the node’s surface (T-186 · T-185 审查所得)', () => {
  it('box → sphere: the replacement mesh keeps castShadow and the material override', async () => {
    // `replaceObject` builds a fresh mesh, and a fresh mesh carries three's defaults —
    // castShadow false, the factory's neutral grey. Before the fix, switching a
    // primitive's kind silently dropped its shadow and its material until the next full
    // load, while every panel showed the right values.
    const doc = createGoldenPathDocument()
    const template = doc.nodes[0]!
    const withCarriers: SceneDocument = {
      ...doc,
      materials: [
        ...doc.materials,
        { id: 'mat_deftest1', name: '默认材质', base: 'standard', preset: 'custom', params: { color: '#b8bec4', roughness: 0.8, metalness: 0, maps: {} } },
      ],
      nodes: [
        ...doc.nodes,
        { ...template, id: 'nd_pr000000', name: '展台', parent: null, order: 9000, assetRef: null, primitive: { kind: 'box', size: [1, 1, 1] }, light: null, overrides: { materialId: 'mat_deftest1' } },
        { ...template, id: 'nd_li000000', name: '聚光灯', parent: null, order: 10000, assetRef: null, primitive: null, light: { kind: 'spot', color: '#ffffff', intensity: 2, range: 0, decay: 2, angleDeg: 30, penumbra: 0.2, shadow: { enabled: true, quality: 'medium', bias: -0.0005 } } },
      ],
    } as SceneDocument
    const { runtime } = makeRuntime(withCarriers)
    await runtime.load(withCarriers)

    const mesh = () => runtime.graph.objectFor('nd_pr000000') as Mesh
    expect(mesh().castShadow, '前提：阴影管线开着').toBe(true)
    expect((mesh().material as MeshStandardMaterial).color.getHexString(), '前提：材质覆盖生效').toBe('b8bec4')

    const next: SceneDocument = {
      ...withCarriers,
      nodes: withCarriers.nodes.map((n) =>
        n.id === 'nd_pr000000' ? { ...n, primitive: { kind: 'sphere' as const, radius: 0.5 } } : n,
      ),
    }
    runtime.applyPatch(
      [{ op: 'replace', path: ['nodes', 3, 'primitive'], value: { kind: 'sphere', radius: 0.5 } }],
      next,
      withCarriers,
    )

    expect(runtime.fullRebuildCount).toBe(0)
    expect(mesh().geometry.type).toBe('SphereGeometry')
    expect(mesh().castShadow, '换类型后投影标志必须还在').toBe(true)
    expect((mesh().material as MeshStandardMaterial).color.getHexString(), '换类型后材质覆盖必须还在').toBe('b8bec4')
    runtime.dispose()
  })
})

describe('D19 · playMedia races the real end against durationS (T-186)', () => {
  const mediaRuntime = (durationS: number) => {
    clock = 0
    const doc = createGoldenPathDocument()
    const withMedia: SceneDocument = {
      ...doc,
      assets: [...doc.assets, { ...doc.assets[0]!, id: 'ast_med00001', type: 'audio', name: '讲解.mp3' }],
      media: [{ id: 'med_00000001', type: 'audio', assetId: 'ast_med00001', name: '讲解', durationS }],
      hotspots: doc.hotspots,
      rules: [
        makeRule({
          when: { event: 'sceneReady' },
          then: [
            { action: 'playMedia', params: { mediaId: 'med_00000001', await: true } },
            { action: 'openPanel', params: { hotspotId: doc.hotspots[0]!.id } },
          ],
        }),
      ],
    } as SceneDocument
    const elements: ReturnType<typeof fakeMediaElement>[] = []
    const runtime = new SceneRuntime(withMedia, {
      canvas: canvas(),
      resolver: { resolve: async () => new ArrayBuffer(8) },
      mode: 'play',
      createRenderer: () => fakeRenderer().renderer,
      hotspotRenderer: new NullHotspotRenderer(),
      createMediaElement: () => {
        const element = fakeMediaElement()
        elements.push(element)
        return element
      },
      now: () => clock,
    })
    const registry = registerBuiltinActions(new ActionRegistry())
    const engine = new EcaEngine(runtime, { registry })
    engine.attach(withMedia)
    engine.setEnabled(true)
    return { runtime, engine, elements, hotspotId: doc.hotspots[0]!.id }
  }

  it('the real ended event releases the chain without waiting out the recording', async () => {
    const { runtime, engine, elements, hotspotId } = mediaRuntime(2)
    engine.dispatch({ event: 'sceneReady' })
    await flush()

    expect(runtime.isMediaPlaying('med_00000001'), '前提：剪辑真的开播了').toBe(true)
    expect(runtime.isPanelOpen(hotspotId), '等待播完期间面板不能开').toBe(false)

    elements[0]!.finish()
    await flush()

    // The clock never moved: only the real 'ended' event can have released the chain.
    expect(runtime.isPanelOpen(hotspotId), '真实结束先到，链条立刻继续').toBe(true)
    expect(engine.history.at(-1)?.status).toBe('completed')
    engine.detach()
    runtime.dispose()
  })

  it('durationS still bounds a clip that never fires ended', async () => {
    const { runtime, engine, hotspotId } = mediaRuntime(2)
    engine.dispatch({ event: 'sceneReady' })
    await flush()
    expect(runtime.isPanelOpen(hotspotId)).toBe(false)

    advanceClock(2000)
    await vi.advanceTimersByTimeAsync(2000)
    await flush()

    expect(runtime.isPanelOpen(hotspotId), '录制时长到了，链条也要继续').toBe(true)
    engine.detach()
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
    return {
      ctx: runtime,
      async advance(ms: number) {
        advanceClock(ms)
        runtime.tick()
        await vi.advanceTimersByTimeAsync(ms)
        for (let i = 0; i < 6; i++) await Promise.resolve()
      },
      lightOf: (nodeId: string) => runtime.lightOf(nodeId),
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
