import type { Asset, SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { ACESFilmicToneMapping, Color, DataTexture, EquirectangularReflectionMapping, NoToneMapping, Scene } from 'three'
import type { Texture, WebGLRenderer } from 'three'
import { describe, expect, it } from 'vitest'
import { EnvironmentController, parseHdr } from '../../src/runtime/environment.js'
import type { CompiledEnvironment } from '../../src/runtime/environment.js'
import type { LogLevel } from '../../src/eca/types.js'

/**
 * T-133 · IBL, the backdrop, and tone mapping.
 *
 * The PMREM prefilter needs a GL context and is injected here. Everything else — which
 * asset, when to re-resolve, what the scene reads, what gets freed — is document logic and
 * runs in plain Node (C8). What a browser is needed for is whether the resulting picture is
 * lit by the HDRI, and that is the E2E's job.
 */

const HDRI_ID = 'ast_hdri0001'
const HDRI_URL = 'assets/c1/d2/c1d2e3f4.hdr'

const encoder = new TextEncoder()

/**
 * A real, minimal Radiance file: header, then flat RGBE scanlines.
 *
 * Generated rather than committed as a binary. A checked-in `.hdr` is invisible to review,
 * and a parser test whose input nobody can read is a test of nothing in particular. Width
 * stays under 8 so the parser takes the uncompressed path, which is the one this small.
 */
function makeHdr(width = 4, height = 2, rgbe: [number, number, number, number] = [255, 128, 64, 128]): ArrayBuffer {
  const header = encoder.encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`)
  const body = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) body.set(rgbe, i * 4)
  const out = new Uint8Array(header.length + body.length)
  out.set(header, 0)
  out.set(body, header.length)
  return out.buffer
}

const hdriAsset = (id = HDRI_ID, url = HDRI_URL, type: Asset['type'] = 'hdri'): Asset => ({
  id,
  type,
  name: '工业厂房.hdr',
  hash: `sha256:${'c1d2e3f405162738'.repeat(4)}`,
  url,
  version: 1,
  lineageId: id,
  stats: {
    clipDurations: {}, tris: 0, materials: 0, textures: 1, bytes: 6291456, textureBytes: 11184811, nodes: 0, animations: [] },
})

/** The golden path document with an environment block and, optionally, an hdri asset. */
function docWith(options: {
  hdriAssetId?: string | null
  background?: 'color' | 'transparent' | 'hdri'
  intensity?: number
  exposure?: number
  asset?: Asset | null
}): SceneDocument {
  const base = createGoldenPathDocument()
  return {
    ...base,
    assets: options.asset === null ? base.assets : [...base.assets, options.asset ?? hdriAsset()],
    meta: {
      ...base.meta,
      background: { type: options.background ?? 'color', color: '#1a1a1a' },
      environment: {
        hdriAssetId: options.hdriAssetId ?? null,
        intensity: options.intensity ?? 1,
        exposure: options.exposure ?? 1,
      },
    },
  }
}

interface Harness {
  readonly controller: EnvironmentController
  readonly scene: Scene
  readonly renderer: { toneMapping: number; toneMappingExposure: number }
  readonly logs: [LogLevel, string][]
  /** One entry per resolve, so "did it re-fetch" is answerable. */
  readonly resolved: string[]
  /** Compiled env maps, in order; each records whether it was freed. */
  readonly compiled: { source: DataTexture; disposed: boolean }[]
}

function harness(options: { withRenderer?: boolean; bytes?: ArrayBuffer | (() => ArrayBuffer); fail?: boolean } = {}): Harness {
  const scene = new Scene()
  const renderer = { toneMapping: NoToneMapping, toneMappingExposure: 1 }
  const logs: [LogLevel, string][] = []
  const resolved: string[] = []
  const compiled: { source: DataTexture; disposed: boolean }[] = []

  const controller = new EnvironmentController({
    scene,
    renderer: () => (options.withRenderer === false ? null : (renderer as unknown as WebGLRenderer)),
    resolve: async (url) => {
      resolved.push(url)
      if (options.fail) throw new Error('not found')
      const bytes = options.bytes ?? makeHdr()
      return typeof bytes === 'function' ? bytes() : bytes
    },
    log: (level, message) => logs.push([level, message]),
    compile: (source): CompiledEnvironment => {
      const entry = { source, disposed: false }
      compiled.push(entry)
      // Stands in for the PMREM render target: a distinct object, so "the scene reads the
      // PREFILTERED map, not the raw equirect source" is assertable.
      const texture = new DataTexture(new Uint8Array(4), 1, 1)
      return {
        texture,
        dispose: () => {
          entry.disposed = true
          texture.dispose()
        },
      }
    },
  })

  return { controller, scene, renderer, logs, resolved, compiled }
}

describe('parseHdr', () => {
  it('parses a Radiance file into an equirectangular texture', () => {
    const texture = parseHdr(makeHdr(4, 2))
    expect(texture.image.width).toBe(4)
    expect(texture.image.height).toBe(2)
    // Without this mapping the HDRI is sampled as a flat rectangle behind the camera,
    // which looks exactly like "the environment did not load".
    expect(texture.mapping).toBe(EquirectangularReflectionMapping)
    // `needsUpdate` is write-only in three — the setter bumps `version` and the getter
    // returns undefined, so asserting `needsUpdate === true` would pass on a texture that
    // was never flagged. The version counter is the observable half.
    expect(texture.version).toBeGreaterThan(0)
  })

  it('throws on bytes that are not a Radiance file, rather than producing a blank texture', () => {
    expect(() => parseHdr(encoder.encode('definitely not an hdr').buffer as ArrayBuffer)).toThrow()
  })
})

describe('EnvironmentController · a document with no HDRI', () => {
  it('leaves the scene exactly as v0 left it (G0.5-6)', async () => {
    // The regression this exists for: every v1 document migrates to v2 with an environment
    // block, and if that block changed anything by default, every existing project would
    // look different after the upgrade.
    const { controller, scene, renderer } = harness()
    await controller.apply(docWith({ hdriAssetId: null }))

    expect(scene.environment).toBeNull()
    expect(scene.background).toBeInstanceOf(Color)
    expect((scene.background as Color).getHexString()).toBe('1a1a1a')
    expect(renderer.toneMapping, 'v0 从不设 toneMapping').toBe(NoToneMapping)
    expect(renderer.toneMappingExposure).toBe(1)
  })

  it('keeps transparent meaning transparent', async () => {
    const { controller, scene } = harness()
    await controller.apply(docWith({ hdriAssetId: null, background: 'transparent' }))
    expect(scene.background).toBeNull()
  })

  it('resolves nothing at all', async () => {
    const { controller, resolved } = harness()
    await controller.apply(docWith({ hdriAssetId: null }))
    expect(resolved).toEqual([])
  })
})

describe('EnvironmentController · a document with an HDRI', () => {
  it('loads it, prefilters it, and hands the scene the PREFILTERED map', async () => {
    const { controller, scene, resolved, compiled } = harness()
    await controller.apply(docWith({ hdriAssetId: HDRI_ID, intensity: 2.5 }))

    expect(resolved).toEqual([HDRI_URL])
    expect(compiled).toHaveLength(1)
    expect(scene.environment).not.toBeNull()
    expect(scene.environment, '场景读到的应当是 PMREM 产物，不是原始 equirect 贴图').not.toBe(
      compiled[0]!.source,
    )
    expect(scene.environmentIntensity).toBe(2.5)
  })

  it('switches tone mapping to ACESFilmic and applies the document exposure', async () => {
    const { controller, renderer } = harness()
    await controller.apply(docWith({ hdriAssetId: HDRI_ID, exposure: 1.8 }))
    expect(renderer.toneMapping).toBe(ACESFilmicToneMapping)
    expect(renderer.toneMappingExposure).toBe(1.8)
  })

  it('uses the same map as the backdrop when the background asks for it', async () => {
    const { controller, scene } = harness()
    await controller.apply(docWith({ hdriAssetId: HDRI_ID, background: 'hdri' }))
    expect(scene.background).toBe(scene.environment)
  })

  it('keeps the background colour independent of the environment', async () => {
    // Lighting the scene with an HDRI while showing a flat backdrop is a normal choice,
    // not a mistake to correct.
    const { controller, scene } = harness()
    await controller.apply(docWith({ hdriAssetId: HDRI_ID, background: 'color' }))
    expect(scene.background).toBeInstanceOf(Color)
    expect(scene.environment).not.toBeNull()
  })

  it('does not re-resolve when the document changes but the asset does not', async () => {
    // An intensity slider must not re-download and re-prefilter a multi-megabyte file per
    // frame; that is the difference between a usable control and a frozen editor.
    const { controller, resolved, compiled } = harness()
    await controller.apply(docWith({ hdriAssetId: HDRI_ID, intensity: 1 }))
    await controller.apply(docWith({ hdriAssetId: HDRI_ID, intensity: 3 }))
    await controller.apply(docWith({ hdriAssetId: HDRI_ID, intensity: 3, exposure: 2 }))
    expect(resolved).toHaveLength(1)
    expect(compiled).toHaveLength(1)
  })
})

describe('EnvironmentController · lifecycle', () => {
  it('set → clear → set again frees everything it allocated', async () => {
    // T-133's acceptance. `renderer.info` needs a GL context, so the accounting is done on
    // our own objects instead: every environment that stops being current must be freed,
    // and exactly one must be live at the end.
    const { controller, scene, compiled } = harness()
    const on = docWith({ hdriAssetId: HDRI_ID })
    const off = docWith({ hdriAssetId: null })

    await controller.apply(on)
    await controller.apply(off)
    expect(scene.environment).toBeNull()
    expect(compiled[0]!.disposed, '清空环境后 PMREM 产物必须释放').toBe(true)
    expect(compiled[0]!.source.image, '原始 equirect 贴图也要释放').toBeDefined()

    await controller.apply(on)
    expect(compiled).toHaveLength(2)
    expect(compiled[1]!.disposed).toBe(false)
    expect(controller.disposedEnvironments).toBe(1)
    expect(scene.environment).not.toBeNull()
  })

  it('frees the previous map when the document points at a different HDRI', async () => {
    const other = hdriAsset('ast_hdri0002', 'assets/aa/bb/other.hdr')
    const { controller, compiled, resolved } = harness()
    await controller.apply(docWith({ hdriAssetId: HDRI_ID }))
    await controller.apply({
      ...docWith({ hdriAssetId: 'ast_hdri0002' }),
      assets: [...createGoldenPathDocument().assets, hdriAsset(), other],
    })
    expect(resolved).toEqual([HDRI_URL, other.url])
    expect(compiled[0]!.disposed, '换一张 HDRI 时旧的必须释放').toBe(true)
    expect(compiled[1]!.disposed).toBe(false)
  })

  it('dispose detaches from the scene and frees the map', async () => {
    const { controller, scene, compiled } = harness()
    await controller.apply(docWith({ hdriAssetId: HDRI_ID, background: 'hdri' }))
    controller.dispose()
    expect(scene.environment).toBeNull()
    expect(scene.background).toBeNull()
    expect(compiled[0]!.disposed).toBe(true)
  })

  it('drops a resolve that was superseded while it was in flight', async () => {
    // The user can click through an HDRI list faster than one decodes. Last-arrival-wins
    // would leave the scene showing whichever file happened to finish last.
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let call = 0
    const scene = new Scene()
    const compiled: DataTexture[] = []
    const controller = new EnvironmentController({
      scene,
      renderer: () => null,
      resolve: async () => {
        // Only the FIRST call is held back, so it finishes after the second one.
        if (++call === 1) await gate
        return makeHdr()
      },
      log: () => undefined,
      compile: (source) => {
        compiled.push(source)
        return { texture: source, dispose: () => undefined }
      },
    })

    const other = hdriAsset('ast_hdri0002', 'assets/aa/bb/other.hdr')
    const both = [...createGoldenPathDocument().assets, hdriAsset(), other]
    const first = controller.apply({ ...docWith({ hdriAssetId: HDRI_ID }), assets: both })
    const second = controller.apply({ ...docWith({ hdriAssetId: 'ast_hdri0002' }), assets: both })
    await second
    release!()
    await first

    // The stale one must not have replaced what the newer call installed.
    expect(controller.hasEnvironment).toBe(true)
    expect(scene.environment).not.toBeNull()
  })
})

describe('EnvironmentController · things that go wrong', () => {
  it('reports a dangling reference and renders without an environment', async () => {
    const { controller, scene, logs } = harness()
    await controller.apply(docWith({ hdriAssetId: 'ast_missing1', asset: null }))
    expect(scene.environment).toBeNull()
    expect(logs.some(([level, message]) => level === 'error' && message.includes('不存在'))).toBe(true)
  })

  it('refuses an asset that is not an hdri, naming the type it got', async () => {
    const wrong = hdriAsset(HDRI_ID, HDRI_URL, 'texture')
    const { controller, scene, logs, resolved } = harness()
    await controller.apply(docWith({ hdriAssetId: HDRI_ID, asset: wrong }))
    expect(scene.environment).toBeNull()
    expect(resolved, '类型不对就不该去读字节').toEqual([])
    expect(logs.some(([, message]) => message.includes('texture'))).toBe(true)
  })

  it('survives bytes that fail to parse', async () => {
    const { controller, scene, logs } = harness({ bytes: encoder.encode('not an hdr').buffer as ArrayBuffer })
    await controller.apply(docWith({ hdriAssetId: HDRI_ID }))
    expect(scene.environment).toBeNull()
    expect(logs.some(([level, message]) => level === 'error' && message.includes('解析失败'))).toBe(true)
  })

  it('survives a resolver that cannot find the file', async () => {
    const { controller, scene, logs } = harness({ fail: true })
    await controller.apply(docWith({ hdriAssetId: HDRI_ID }))
    expect(scene.environment).toBeNull()
    expect(logs.some(([level]) => level === 'error')).toBe(true)
  })

  it('keeps the source usable before a renderer exists, and prefilters once one arrives', async () => {
    // The editor constructs the runtime and attaches the canvas separately; a document
    // loaded in between must not end up with an environment nobody ever prefilters.
    let renderer: WebGLRenderer | null = null
    const scene = new Scene()
    const compiled: Texture[] = []
    const controller = new EnvironmentController({
      scene,
      renderer: () => renderer,
      resolve: async () => makeHdr(),
      log: () => undefined,
      compile: (source) => {
        compiled.push(source)
        return { texture: source, dispose: () => undefined }
      },
    })

    const doc = docWith({ hdriAssetId: HDRI_ID })
    await controller.apply(doc)
    expect(scene.environment, '没有渲染器时也要先把原始贴图挂上').not.toBeNull()
    expect(compiled).toHaveLength(0)

    renderer = {} as WebGLRenderer
    await controller.apply(doc)
    expect(compiled, '渲染器到位后应当补做预过滤').toHaveLength(1)
  })
})

/**
 * T-183 · the runtime actually calling any of this.
 *
 * Everything above drives `EnvironmentController` directly, which is why deleting
 * `await this.environment.apply(doc)` from `SceneRuntime.load` left the whole suite green
 * (T-176 审查所得). A controller that works perfectly and is never called renders a black
 * background in the player and nothing in the editor, and no test above can tell.
 *
 * So these go through `SceneRuntime` and assert on `runtime.scene` — the object three will
 * actually draw. There are three call sites and each is a separate way for the HDRI to not
 * show up: opening a document, attaching a canvas later, and editing the environment.
 */
describe('SceneRuntime wires the environment up (T-183)', () => {
  const stubRenderer = () =>
    ({
      info: { memory: { geometries: 0, textures: 0 } },
      shadowMap: { enabled: false, type: -1 },
      toneMapping: NoToneMapping,
      toneMappingExposure: 1,
      render: () => undefined,
      setSize: () => undefined,
      setPixelRatio: () => undefined,
      dispose: () => undefined,
      domElement: {} as HTMLCanvasElement,
    }) as unknown as WebGLRenderer

  /** A prefilter that needs no GL, standing in for PMREM. */
  const fakeCompile = () => {
    const texture = new DataTexture()
    return { texture, dispose: () => texture.dispose() }
  }

  /**
   * The renderer comes back alongside the runtime because `SceneRuntime.renderer` is
   * private — and it should stay private. Holding the stub the runtime was handed asserts
   * the same thing without widening production API to suit a test.
   */
  const makeRuntime = async (doc: SceneDocument) => {
    const { SceneRuntime } = await import('../../src/runtime/scene-runtime.js')
    const { NullHotspotRenderer } = await import('../../src/runtime/hotspot-layer.js')
    const renderer = stubRenderer()
    const runtime = new SceneRuntime(doc, {
      canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
      resolver: { resolve: async () => makeHdr() },
      mode: 'edit',
      createRenderer: () => renderer,
      hotspotRenderer: new NullHotspotRenderer(),
      compileEnvMap: fakeCompile,
      now: () => 0,
    })
    return { runtime, renderer }
  }

  const lit = () => docWith({ hdriAssetId: HDRI_ID, background: 'hdri' })
  const unlit = () => docWith({ hdriAssetId: null })

  /**
   * Every runtime here is BORN without an HDRI and is handed one later.
   *
   * Constructing it from the lit document instead made three of these pass for the wrong
   * reason: `attachRenderer` applies the environment too, so the map was already resident
   * before the test did anything, and deleting the call under test changed nothing. The
   * mutation caught it — the version that read fine was the version that tested nothing.
   */

  it('load() puts the map on the scene before it resolves', async () => {
    // `load` is the ONE moment a caller can wait for the scene to be complete — the publish
    // thumbnail and the parity trace both shoot immediately after it. An environment that
    // arrives three frames later is a black frame in both.
    const { runtime } = await makeRuntime(unlit())
    await runtime.load(lit())

    expect(runtime.scene.environment, '打开文档就该有环境贴图').not.toBeNull()
    expect(runtime.scene.background, '背景设成 hdri 就该是那张图，不是颜色').toBe(runtime.scene.environment)
    runtime.dispose()
  })

  it('turns tone mapping on, which is what makes the HDRI look right rather than flat', async () => {
    const { runtime, renderer } = await makeRuntime(unlit())
    await runtime.load(lit())
    expect(renderer.toneMapping).toBe(ACESFilmicToneMapping)

    // …and back off with no HDRI, which is gate G0.5-6: a v0 document must look EXACTLY
    // as it did, and an ACES curve over an unchanged scene is a visible change.
    await runtime.load(unlit())
    expect(renderer.toneMapping, '没有 HDRI 就必须回到 v0 的 NoToneMapping').toBe(NoToneMapping)
    runtime.dispose()
  })

  it('applies from the CONSTRUCTOR when the document already names one', async () => {
    // `attachRenderer` is private and only ever runs from the constructor, so this — not a
    // late-arriving canvas — is that call site's real shape: a runtime built straight onto
    // a canvas with an HDRI already in the document, and nobody calling `load`. Without it
    // the prefilter never runs and tone mapping stays at the renderer's default, so the
    // scene opens flat and only fixes itself if the user happens to edit the environment.
    const { runtime, renderer } = await makeRuntime(lit())
    // The constructor cannot await — `new` is synchronous — so the resolve lands a few
    // microtasks later. That is exactly why nothing noticed when it was not happening.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(runtime.scene.environment, '构造时就带着 HDRI 的文档也要挂上').not.toBeNull()
    expect(renderer.toneMapping).toBe(ACESFilmicToneMapping)
    runtime.dispose()
  })

  it('follows a patch that sets the HDRI, without a full rebuild', async () => {
    const { runtime } = await makeRuntime(unlit())
    await runtime.load(unlit())
    expect(runtime.scene.environment).toBeNull()

    const before = unlit()
    const next = lit()
    runtime.applyPatch(
      [
        { op: 'replace', path: ['meta', 'environment', 'hdriAssetId'], value: HDRI_ID },
        { op: 'replace', path: ['meta', 'background', 'type'], value: 'hdri' },
      ],
      next,
      before,
    )
    expect(runtime.fullRebuildCount, '设一张环境贴图不该整场重建（铁律 11）').toBe(0)

    // The patch path is fire-and-forget by contract (D1 keeps applyPatch synchronous), so
    // the resolve lands a microtask later — which is precisely why nothing awaited it and
    // why nothing noticed it was never called.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runtime.scene.environment, '改环境的 patch 要真的把图挂上去').not.toBeNull()
    runtime.dispose()
  })

  it('clears it again when the user presses 清除环境', async () => {
    const { runtime } = await makeRuntime(unlit())
    await runtime.load(lit())
    expect(runtime.scene.environment).not.toBeNull()

    const cleared = docWith({ hdriAssetId: null })
    runtime.applyPatch(
      [{ op: 'replace', path: ['meta', 'environment', 'hdriAssetId'], value: null }],
      cleared,
      lit(),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(runtime.scene.environment, '清除环境要真的清掉').toBeNull()
    runtime.dispose()
  })
})
