import { createGoldenPathDocument } from '@w3/schema'
import type { Asset, SceneDocument } from '@w3/schema'
import { describe, expect, it, vi } from 'vitest'
import type { LogLevel } from '../../src/eca/types.js'
import { TextureCache, referencedTextureIds } from '../../src/runtime/texture-cache.js'

/**
 * T-151 · the texture cache.
 *
 * Decoding is injected, so everything with a bug in it — keying, dedup of concurrent loads,
 * ref counting, disposal — runs in plain Node (C8). The stub stands in for
 * `createImageBitmap`, which is the only part that genuinely needs a browser.
 */

const asset = (id: string, name = 'concrete.png'): Asset => ({
  id,
  type: 'texture',
  name,
  hash: `blob_${id}`,
  url: `blob:${id}`,
  version: 1,
  lineageId: id,
  stats: { tris: 0, materials: 0, textures: 1, bytes: 1024, textureBytes: 1024, nodes: 0, animations: [] },
})

/** A document whose materials reference the given texture assets, one slot each. */
function docWith(maps: Record<string, string>): SceneDocument {
  const base = createGoldenPathDocument()
  return {
    ...base,
    assets: [...base.assets, ...Object.values(maps).map((id) => asset(id))],
    materials: [
      {
        ...base.materials[0]!,
        params: { ...base.materials[0]!.params, maps },
      },
    ],
  } as SceneDocument
}

const stubDecode = () =>
  vi.fn(async (_bytes: ArrayBuffer, _mime: string) => ({ width: 4, height: 4 }) as unknown as TexImageSource)

const cacheWith = (decode = stubDecode(), files: Record<string, ArrayBuffer> = {}) => {
  const cache = new TextureCache({
    resolver: { resolve: async (url) => files[url] ?? new ArrayBuffer(8) },
    decode,
  })
  return { cache, decode }
}

describe('one Texture per asset', () => {
  it('decodes an asset once no matter how many materials want it', async () => {
    // The failure this prevents is invisible until it is expensive: a Texture per material
    // slot uploads the same 4 MB image once per material, and nothing in the UI explains
    // why the scene got heavy.
    const { cache, decode } = cacheWith()
    await cache.load(asset('ast_00000001'))
    await cache.load(asset('ast_00000001'))

    expect(decode).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(1)
  })

  it('marks the texture for upload, or it renders as a black square', async () => {
    // three only reads a Texture's source on the frame after `needsUpdate` is set; without
    // it the GPU gets an empty image and every textured surface goes black. `needsUpdate`
    // is a write-only setter — reading it back gives undefined — so the observable effect
    // is the version bump, which is also the only thing a test can hold on to.
    const { cache } = cacheWith()
    const texture = await cache.load(asset('ast_00000001'))
    expect(texture!.version).toBeGreaterThan(0)
  })

  it('does not decode twice when two loads race', async () => {
    const { cache, decode } = cacheWith()
    const [a, b] = await Promise.all([cache.load(asset('ast_00000001')), cache.load(asset('ast_00000001'))])

    expect(decode).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('hands the decoder a MIME type read from the file name, not from the asset type', async () => {
    // `type: 'texture'` says what the image is FOR. It tells a decoder nothing about how
    // the bytes are encoded, and a decoder handed 'texture' as a MIME type fails on every
    // image in the project.
    const { cache, decode } = cacheWith()
    await cache.load(asset('ast_00000001', '砖墙.jpg'))
    expect(decode.mock.calls[0]?.[1]).toBe('image/jpeg')
  })

  it('survives a decode failure without poisoning the cache', async () => {
    const decode = vi.fn(async () => {
      throw new Error('corrupt')
    })
    const cache = new TextureCache({ resolver: { resolve: async () => new ArrayBuffer(8) }, decode })

    expect(await cache.load(asset('ast_00000001'))).toBeNull()
    expect(cache.size).toBe(0)
    // A retry has to be able to succeed: a failed load that stays in flight for ever means
    // one corrupt file makes the slot permanently unusable.
    expect(await cache.load(asset('ast_00000001'))).toBeNull()
    expect(decode).toHaveBeenCalledTimes(2)
  })

  it('reports nothing at all when this build cannot decode', async () => {
    // The parity harness and the ECA tests run with no browser. Loading must be a no-op
    // there rather than a crash — the scene simply renders untextured.
    const cache = new TextureCache({ resolver: { resolve: async () => new ArrayBuffer(8) } })
    expect(await cache.load(asset('ast_00000001'))).toBeNull()
    expect(cache.size).toBe(0)
  })
})

describe('what a document actually references', () => {
  it('collects the ids from every material slot', () => {
    const doc = docWith({ map: 'ast_00000001', normalMap: 'ast_00000002' })
    expect([...referencedTextureIds(doc)].sort()).toEqual(['ast_00000001', 'ast_00000002'])
  })

  it('loads only what is referenced, not every image in the project', async () => {
    // A user who imported twenty textures and used three should pay for three. An unused
    // asset costs storage, not VRAM.
    const doc = docWith({ map: 'ast_00000001' })
    const withSpare: SceneDocument = { ...doc, assets: [...doc.assets, asset('ast_09999999')] }
    const { cache, decode } = cacheWith()

    await cache.ensure(withSpare)

    expect(decode).toHaveBeenCalledTimes(1)
    expect(cache.has('ast_00000001')).toBe(true)
    expect(cache.has('ast_09999999')).toBe(false)
  })

  it('gives the memory back when the last material stops referencing a texture', async () => {
    const { cache } = cacheWith()
    const before = docWith({ map: 'ast_00000001' })
    await cache.ensure(before)
    const texture = cache.get('ast_00000001')!
    const disposed = vi.spyOn(texture, 'dispose')

    await cache.ensure(docWith({}))

    expect(cache.has('ast_00000001')).toBe(false)
    expect(disposed).toHaveBeenCalled()
  })

  it('keeps a texture a SECOND material still uses', async () => {
    // Ref counting is by asset, not by slot: a material dropping its normal map must not
    // dispose a texture the material next to it is still drawing with.
    const { cache } = cacheWith()
    const base = docWith({ map: 'ast_00000001' })
    const shared: SceneDocument = {
      ...base,
      materials: [
        base.materials[0]!,
        { ...base.materials[0]!, id: 'mat_11112222', params: { maps: { normalMap: 'ast_00000001' } } },
      ],
    } as SceneDocument
    await cache.ensure(shared)
    expect(cache.refCount('ast_00000001')).toBe(2)

    // The first material drops it; the second still has it.
    const oneLeft: SceneDocument = { ...shared, materials: [shared.materials[1]!] } as SceneDocument
    await cache.ensure(oneLeft)

    expect(cache.has('ast_00000001'), '另一个材质还在用，不能丢').toBe(true)
    expect(cache.refCount('ast_00000001')).toBe(1)
  })

  it('does not re-decode on every ensure', async () => {
    const { cache, decode } = cacheWith()
    const doc = docWith({ map: 'ast_00000001' })
    await cache.ensure(doc)
    await cache.ensure(doc)
    await cache.ensure(doc)
    expect(decode).toHaveBeenCalledTimes(1)
  })
})

/**
 * T-186 · clearing a texture slot, and whether the bytes actually go.
 *
 * M11 registered this as a leak and the comment on `retainOnly` still said the bytes stay
 * resident until the next import. That stopped being true when the patch forwarder learned
 * to treat `/materials/i/params/maps/*` as needing bytes (M11's own fix): CLEARING a slot
 * emits a patch on that same path, so it takes the slow path too and `ensure` runs.
 *
 * Written as a test rather than a comment edit, because the connection is indirect — it
 * holds only as long as the forwarder keys on `maps` — and 「顺手就好了」 is exactly the
 * kind of claim that quietly stops being true.
 */
describe('clearing a slot frees the texture (T-186)', () => {
  it('drops the bytes once no material references them', async () => {
    const { cache, decode } = cacheWith()
    const used = docWith({ map: 'ast_00000001' })
    await cache.ensure(used)
    expect(cache.size, '前提：贴图真的加载了').toBe(1)
    expect(decode).toHaveBeenCalledTimes(1)

    const cleared = docWith({})
    await cache.ensure(cleared)

    expect(cache.size, '没有材质再引用它，就不该继续占显存').toBe(0)
    expect(cache.refCount('ast_00000001')).toBe(0)
  })

  it('keeps it while ANY material still references it', async () => {
    // The mistake this rules out is freeing on the first clear: two materials sharing one
    // image, one of them clears its slot, and the other renders untextured.
    const { cache } = cacheWith()
    const base = docWith({ map: 'ast_00000001' })
    const shared = {
      ...base,
      materials: [base.materials[0]!, { ...base.materials[0]!, id: 'mat_00000002' }],
    } as SceneDocument
    await cache.ensure(shared)
    expect(cache.refCount('ast_00000001'), '两个材质引用').toBe(2)

    const oneCleared = {
      ...shared,
      materials: [{ ...shared.materials[0]!, params: { ...shared.materials[0]!.params, maps: {} } }, shared.materials[1]!],
    } as SceneDocument
    await cache.ensure(oneCleared)

    expect(cache.size, '还有一个材质在用，不许释放').toBe(1)
    expect(cache.refCount('ast_00000001')).toBe(1)
  })
})

/**
 * T-219 · the KTX2 branch, and **why it sits above `if (!decode) return null`**.
 *
 * A4/X-34 ruled that stand-alone `.ktx2` textures are supported rather than honestly refused
 * — but the honesty still has to land somewhere, and the line it would otherwise sit under
 * returns null without saying a word. Below it, the sentence never prints in any build with
 * no `decode` injected (head-less, parity, every Node test), which is most of the places a
 * reader would want it.
 *
 * Mutation ④ moved the branch down and **the whole suite stayed green** — 855/855 — because
 * nothing asserted the message. That is class (a): the test did not test anything. These do.
 */
describe('T-219 · KTX2 贴图的诚实拒绝', () => {
  const ktx2Asset = (): Asset => ({ ...asset('tex_ktx20001', 'checker.ktx2'), url: 'blob:tex_ktx20001' })

  const cacheWithout = (log: (level: LogLevel, message: string, data?: unknown) => void) =>
    new TextureCache({
      // No `decode`, no `decodeKtx2` — a head-less build, which is where this must still speak.
      resolver: { resolve: async () => new ArrayBuffer(8) },
      log,
    })

  it('names KTX2 specifically instead of returning null in silence', async () => {
    const log = vi.fn<(level: LogLevel, message: string, data?: unknown) => void>()
    const texture = await cacheWithout(log).load(ktx2Asset())

    expect(texture).toBeNull()
    expect(log, '没有 decode 的构建里，这句话一次都没打出来 —— 那正是把分支写在 return null 之下的后果').toHaveBeenCalled()
    const [level, message] = log.mock.calls[0]!
    expect(level).toBe('warn')
    expect(message).toContain('KTX2')
    expect(message).toContain('未启用 GPU 纹理解码')
    expect(message, '要说出是哪张贴图').toContain('checker.ktx2')
  })

  it('and does not hijack an ordinary PNG', async () => {
    const log = vi.fn<(level: LogLevel, message: string, data?: unknown) => void>()
    // The counter-example: without it, a branch that fired for everything would pass above.
    const texture = await cacheWithout(log).load(asset('tex_png000001', 'concrete.png'))
    expect(texture).toBeNull()
    expect(log, 'PNG 走的是原来的静默路径，不该借用 KTX2 的措辞').not.toHaveBeenCalled()
  })
})
