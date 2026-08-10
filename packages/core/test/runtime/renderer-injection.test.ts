import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { NullHotspotRenderer } from '../../src/runtime/hotspot-layer.js'
import { createMemoryResolver } from '../../src/runtime/loader.js'
import { webGLRendererParams } from '../../src/runtime/renderer-like.js'
import type { RendererLike } from '../../src/runtime/renderer-like.js'
import { SEAM_NOT_WIRED, SceneRuntime } from '../../src/runtime/scene-runtime.js'

/**
 * T-200 · the renderer injection seam.
 *
 * Read the type annotation on `makeStub` below: it is `RendererLike`, with **no cast**. That
 * is the entire deliverable. Before this card, the only renderer stand-in in this repository
 * ended in `as never` (`scene-runtime.test.ts:73`), which means the compiler was checking
 * nothing at all about it — a stub could omit any member and the mistake would surface as an
 * `undefined is not a function` at run time, in whichever test happened to reach that member
 * first.
 *
 * Five domains' "no GPU needed" unit-test plans (section planes, capture surface, composer
 * passes, KTX2 wiring, loader before/after) rest on this file existing. Without it they
 * degrade into E2E tests: slower, and able to prove only that the parts are connected, never
 * that they are correct.
 */

/** A canvas that is only ever measured. Node has no DOM, so this is the one honest cast. */
const fakeCanvas = () => ({ clientWidth: 800, clientHeight: 600 }) as HTMLCanvasElement

/**
 * A renderer with zero GL calls, written by hand and annotated `RendererLike`.
 *
 * If a member is missing or mistyped, this file does not compile. That is the point: the
 * seam is only worth having if the compiler can tell you what a stand-in still owes.
 */
function makeStub(): {
  renderer: RendererLike
  calls: { render: number; setSize: number; dispose: number; extensionProbes: number }
} {
  // T-219 · `extensionProbes` is what proves `KTX2Loader.detectSupport` ran: it asks the
  // registry about seven compressed-texture formats by name, and a stub that never gets
  // asked is a stub whose renderer was never handed to the transcoder.
  const calls = { render: 0, setSize: 0, dispose: 0, extensionProbes: 0 }
  const renderer: RendererLike = {
    render: () => {
      calls.render++
    },
    setSize: () => {
      calls.setSize++
    },
    setPixelRatio: () => {},
    getPixelRatio: () => 1,
    setClearColor: () => {},
    setClearAlpha: () => {},
    clippingPlanes: [],
    localClippingEnabled: false,
    getContext: () => {
      throw new Error('桩渲染器没有 GL 上下文')
    },
    capabilities: { maxTextureSize: 4096 },
    extensions: {
      has: () => {
        calls.extensionProbes++
        // `false` for everything: no GPU here, and refusing every compressed format is the
        // honest answer. `detectSupport` handles it — it falls back to an uncompressed target.
        return false
      },
      get: () => null,
    },
    info: { memory: { geometries: 0, textures: 0 }, render: { triangles: 0, calls: 0 }, programs: null },
    shadowMap: { enabled: false, type: 0 },
    toneMapping: 0,
    toneMappingExposure: 1,
    // T-236 · OutputPass.js:97 是唯一读者
    outputColorSpace: 'srgb',
    setRenderTarget: () => {},
    domElement: fakeCanvas(),
    dispose: () => {
      calls.dispose++
    },
  }
  return { renderer, calls }
}

function makeRuntime() {
  const { renderer, calls } = makeStub()
  const runtime = new SceneRuntime(createGoldenPathDocument(), {
    resolver: createMemoryResolver(new Map()),
    mode: 'play',
    hotspotRenderer: new NullHotspotRenderer(),
    now: () => 0,
  })
  return { runtime, renderer, calls }
}

describe('注入一个纯 JS 桩', () => {
  it('runs ten frames through an injected stub without touching GL', () => {
    const { runtime, renderer, calls } = makeRuntime()
    runtime.attachRenderer(renderer)

    expect(() => {
      for (let i = 0; i < 10; i++) runtime.tick()
    }).not.toThrow()

    // Not just "did not throw": the stub has to have been the thing that drew. A seam that
    // silently swallows the injected renderer would pass a no-throw assertion perfectly.
    expect(calls.render).toBe(10)
    expect(runtime.activeRenderer).toBe(renderer)
    runtime.dispose()
  })

  it('prefers the injected factory over the default one', () => {
    const { renderer, calls } = makeStub()
    const runtime = new SceneRuntime(createGoldenPathDocument(), {
      canvas: fakeCanvas(),
      resolver: createMemoryResolver(new Map()),
      mode: 'play',
      hotspotRenderer: new NullHotspotRenderer(),
      // Falling back to the default here would call `new WebGLRenderer` on a canvas that is
      // a plain object in Node — this assertion turns red loudly rather than subtly.
      createRenderer: () => renderer,
    })
    runtime.tick()
    expect(calls.render).toBe(1)
    runtime.dispose()
  })

  it('releases the renderer on detach without ending the runtime', () => {
    const { runtime, renderer, calls } = makeRuntime()
    runtime.attachRenderer(renderer)
    runtime.detach()

    expect(calls.dispose).toBe(1)
    expect(runtime.activeRenderer).toBeNull()
    // Still alive: ticking head-less is legal and is what the parity harness does.
    expect(() => runtime.tick()).not.toThrow()
    expect(calls.render).toBe(0)
  })
})

describe('不注入时的构造参数', () => {
  /**
   * A real `WebGLRenderer` cannot be built in Node, so the assertion lands on the parameter
   * object instead — which is where the guarantee actually lives.
   *
   * `preserveDrawingBuffer` is the reason this test exists. Nothing in this repository has
   * ever verified it: the E2E suite reads pixels via `drawImage + getImageData`, which works
   * either way. So the flag that image export (T-266) depends on has been unprotected since
   * v0, and it would have been discovered by a blank PNG on a customer's machine.
   */
  it('keeps the pre-T-200 constructor flags verbatim', () => {
    const canvas = fakeCanvas()
    expect(webGLRendererParams({ canvas })).toEqual({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    })
  })

  it('lets a caller ask for an opaque buffer without touching the other two flags', () => {
    // The thumbnail renderer's one difference from the viewport's (T-053).
    expect(webGLRendererParams({ canvas: fakeCanvas(), alpha: false })).toMatchObject({
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
    })
  })
})

/**
 * The seam list (T-200 ④ / appendix A.3 ②).
 *
 * Twelve signatures opened up front so the thirteen cards that claim `scene-runtime.ts`
 * exclusively do not have to queue behind each other. Each entry names its owner card.
 *
 * **A card that implements one of these deletes its row from this table.** The table is
 * therefore both the assertion and the ledger: if it is empty, the seam list is fully wired.
 */
const SEAMS: readonly [member: string, owner: string, invoke: (runtime: SceneRuntime) => unknown][] = [
  ['flyToView', 'T-337', (r) => r.flyToView([])],
  ['showPage', 'T-307', (r) => r.showPage('pg_00000001')],
  ['hidePage', 'T-307', (r) => r.hidePage('pg_00000001')],
  ['isPageVisible', 'T-307', (r) => r.isPageVisible('pg_00000001')],
  ['swapDocument', 'T-429', (r) => r.swapDocument(createGoldenPathDocument())],
]

describe('接缝清单', () => {
  it('opens exactly five seams', () => {
    // 12 → 8 → 7 → 6 → 5：T-235 接线了 registerChrome / setChromeVisible / pipelineMode /
    // setPostFxEnabled 四条，T-241 接线了 setSelectionOutline，T-244 接线了 setExplode，
    // T-266 接线了 captureImage。
    // 按 T-200 定的规矩，
    // 接线一条就从这张表里删掉一行。
    // **这张表是进度台账**：一条接缝被实现，它就从这里消失，而不是改成「已实现」。
    expect(SEAMS).toHaveLength(5)
  })

  it.each(SEAMS)('%s (%s) exists and throws until it is wired', (member, owner, invoke) => {
    const { runtime } = makeRuntime()

    // Existence first, and asserted as a shape rather than as "not null" — `not.toBeNull()`
    // is also true of `undefined`, which is how three of v0.5's E18 mutations survived.
    const descriptor = describeMember(member)
    expect(descriptor).toBe(member === 'pipelineMode' ? 'get' : 'function')

    // The assertion that matters: an un-wired seam must be LOUD. An empty body would satisfy
    // every caller and every test, which is precisely how this project accumulated fourteen
    // "finished, tested, zero production callers" modules.
    expect(() => invoke(runtime)).toThrow(SEAM_NOT_WIRED(member, owner))
  })
})

/** Whether `SceneRuntime.prototype` carries `member` as a method or as a getter. */
function describeMember(member: string): 'function' | 'get' | 'missing' {
  const descriptor = Object.getOwnPropertyDescriptor(SceneRuntime.prototype, member)
  if (!descriptor) return 'missing'
  if (typeof descriptor.get === 'function') return 'get'
  return typeof descriptor.value === 'function' ? 'function' : 'missing'
}

describe('唯一的渲染器构造点', () => {
  /**
   * There were two `new WebGLRenderer(...)` sites with independently chosen flags. Two sites
   * means the `preserveDrawingBuffer` guarantee can hold in one and be lost in the other,
   * and nobody would reproduce the difference.
   */
  it('constructs a WebGLRenderer in exactly one place in packages/core/src', () => {
    const root = fileURLToPath(new URL('../../src', import.meta.url))
    const hits: string[] = []
    for (const file of walk(root)) {
      // Comments are stripped first, so the assertion is about construction and not about
      // prose. Counting raw text would forbid future cards from even naming the constructor
      // when explaining why they must not call it — a guard that punishes documentation.
      const text = stripComments(readFileSync(file, 'utf8'))
      const count = text.split('new WebGLRenderer(').length - 1
      for (let i = 0; i < count; i++) hits.push(file.slice(root.length + 1).replaceAll('\\', '/'))
    }
    expect(hits).toEqual(['runtime/renderer-like.ts'])
  })
})

/** Removes `/* *\/` and `//` comments. Good enough to tell code from prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.endsWith('.ts')) yield full
  }
}
