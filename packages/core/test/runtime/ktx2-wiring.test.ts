import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { NullHotspotRenderer } from '../../src/runtime/hotspot-layer.js'
import { createMemoryResolver } from '../../src/runtime/loader.js'
import type { RendererLike } from '../../src/runtime/renderer-like.js'
import { SceneRuntime } from '../../src/runtime/scene-runtime.js'

/**
 * T-219 · 债 U-16 · 断言**生产装配路径**，不是断言零件本身。
 *
 * The KTX2 decoder had never been constructed — not 「装了没跑过」 but 「代码路径根本没进过」.
 * `AssetLoader` created it inside `if (options.renderer)`, and **neither production
 * construction site passed a renderer**: `SceneRuntime` and the editor's `ProjectSession`
 * both build the loader before any canvas exists. The condition was permanently false, and
 * every KTX2 claim in this repository — including 附件A's promise to customers — rested on it.
 *
 * That defect survived two releases with a fully-tested `KTX2Loader` sitting one call away.
 * **Coverage cannot see this shape**: every part worked; the seam between them was never
 * joined. So these assertions are deliberately about ASSEMBLY — 「真实实现被装上了」 — rather
 * than about the transcoder being correct, which is the browser's job (`compressed-assets.spec.ts`).
 *
 * ⚠ **The card's self-test is `pnpm -F @w3/core test texture-cache ktx2`, and before this file
 * existed that command was already GREEN** — vitest does not complain about a filter word
 * that matches nothing, so 「实现写完、忘了建测试」 passed the self-test and the DoD alike.
 * This file's name is what gives the word `ktx2` somewhere to land.
 */

/** Records what the transcoder asked the renderer about. Zero GL. */
function stubRenderer(): { renderer: RendererLike; probes: string[] } {
  const probes: string[] = []
  const renderer: RendererLike = {
    render: () => {},
    setSize: () => {},
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
      has: (name) => {
        probes.push(name)
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
    domElement: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
    dispose: () => {},
  }
  return { renderer, probes }
}

const makeRuntime = () =>
  new SceneRuntime(createGoldenPathDocument(), {
    resolver: createMemoryResolver(new Map()),
    mode: 'play',
    hotspotRenderer: new NullHotspotRenderer(),
    now: () => 0,
  })

describe('T-219 · 生产装配路径', () => {
  it('has no transcoder before a renderer is attached — the two-release defect, stated', () => {
    const runtime = makeRuntime()
    expect(runtime.loader.ktx2Loader).toBeNull()
    runtime.dispose()
  })

  it('attaching a renderer really installs one', () => {
    const runtime = makeRuntime()
    const { renderer } = stubRenderer()
    runtime.attachRenderer(renderer)
    // The assertion the card asks for: the REAL implementation is mounted. Not that it is
    // correct — that it is there at all, which is what nothing checked.
    expect(runtime.loader.ktx2Loader).not.toBeNull()
    runtime.dispose()
  })

  it('and detectSupport really ran — it probed the compressed-texture extensions by name', () => {
    const runtime = makeRuntime()
    const { renderer, probes } = stubRenderer()
    runtime.attachRenderer(renderer)
    // Without this counter the previous test passes for a transcoder that was constructed
    // and never told what the GPU can do — it would then transcode to a format the machine
    // cannot sample. `detectSupport` is the whole reason the renderer is needed at all.
    expect(probes.length, 'detectSupport 没有问过渲染器任何一种压缩格式').toBeGreaterThan(0)
    expect(probes.some((p) => /compressed_texture/i.test(p))).toBe(true)
    runtime.dispose()
  })

  it('is idempotent, and detaching disposes it', () => {
    const runtime = makeRuntime()
    const { renderer } = stubRenderer()
    runtime.attachRenderer(renderer)
    const first = runtime.loader.ktx2Loader
    runtime.attachRenderer(renderer)
    expect(runtime.loader.ktx2Loader, '重复 attach 不该换一个新的').toBe(first)

    runtime.detach()
    expect(runtime.loader.ktx2Loader, 'detach 之后 transcoder 必须被释放').toBeNull()
    runtime.dispose()
  })

  it('refuses a renderer with no extension registry instead of throwing', () => {
    const runtime = makeRuntime()
    const { renderer } = stubRenderer()
    // WebGPURenderer, and every hand-rolled stub, reaches `detectSupport` without this.
    const crippled = { ...renderer, extensions: undefined } as unknown as RendererLike
    expect(() => runtime.attachRenderer(crippled)).not.toThrow()
    expect(runtime.loader.ktx2Loader).toBeNull()
    runtime.dispose()
  })
})

/* -------------------------------------------------------------------------- */
/* fixture 的字节，作为一份可被机器核对的来源声明                                */
/* -------------------------------------------------------------------------- */

describe('T-219 · checker-etc1s.ktx2 的头部', () => {
  /**
   * The fixture is generated **out of band** by a tool that is deliberately not in this
   * repository, so its bytes cannot be re-derived here. These assertions are what stops it
   * being swapped for something that merely opens: an uncompressed KTX2 and a UASTC/Zstd one
   * both load fine through `KTX2Loader` and **never call the Basis transcoder at all** —
   * which is the one code path 附件A's 「允许 KTX2」 promise actually rests on.
   */
  const bytes = () => readFileSync(fileURLToPath(new URL('../../../../e2e/fixtures/ktx2/checker-etc1s.ktx2', import.meta.url)))

  it('is a KTX 2.0 file', () => {
    const id = [...bytes().subarray(0, 12)]
    expect(id).toEqual([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  it('is ETC1S (BasisLZ), 128×128, with a full mip chain', () => {
    const b = bytes()
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    expect(dv.getUint32(12, true), 'vkFormat 必须是 0 —— 非 0 就是未压缩，transcoder 不会被调用').toBe(0)
    expect(dv.getUint32(20, true)).toBe(128)
    expect(dv.getUint32(24, true)).toBe(128)
    expect(dv.getUint32(36, true), 'faceCount 1 = 2D 贴图，不是 cubemap').toBe(1)
    expect(dv.getUint32(40, true), 'levelCount —— 完整 mip 链').toBe(8)
    expect(dv.getUint32(44, true), 'supercompressionScheme 必须是 1（BasisLZ/ETC1S）；2 是 UASTC/Zstd，走的是另一条分支').toBe(1)
  })
})
