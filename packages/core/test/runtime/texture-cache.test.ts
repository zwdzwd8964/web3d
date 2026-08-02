import { createGoldenPathDocument } from '@w3/schema'
import type { Asset, SceneDocument } from '@w3/schema'
import { describe, expect, it, vi } from 'vitest'
import { TextureCache, referencedTextureIds } from '../../src/runtime/texture-cache.js'
import { samplerVariant } from '../../src/runtime/material-registry.js'

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

  it('sweeps the cleared slot’s VARIANT even while the asset itself stays resident (T-186)', async () => {
    // The residual half of M11: the old sweep only ran when the whole asset dropped, so
    // clearing 「基础色」 while a second material kept the same image as a roughness map
    // stranded the sRGB variant for ever — a real extra GL texture, since colour space is
    // part of three's GL texture key.
    const { cache } = cacheWith()
    const base = docWith({ map: 'ast_00000001' })
    const shared: SceneDocument = {
      ...base,
      materials: [
        base.materials[0]!,
        { ...base.materials[0]!, id: 'mat_11112222', params: { maps: { roughnessMap: 'ast_00000001' } } },
      ],
    } as SceneDocument
    await cache.ensure(shared)
    // Materialise both variants the way applyParams would.
    const srgbVariant = cache.get('ast_00000001', samplerVariant('map', shared.materials[0]!))!
    cache.get('ast_00000001', samplerVariant('roughnessMap', shared.materials[1]!))
    expect(cache.variantCount).toBe(2)
    const disposed = vi.spyOn(srgbVariant, 'dispose')

    // The first material clears its slot; the asset must survive, its variant must not.
    const cleared: SceneDocument = {
      ...shared,
      materials: [{ ...shared.materials[0]!, params: { maps: {} } }, shared.materials[1]!],
    } as SceneDocument
    await cache.ensure(cleared)

    expect(cache.has('ast_00000001'), '另一个材质还在用，资产不能丢').toBe(true)
    expect(cache.variantCount, '被清掉的槽位的变体必须回收').toBe(1)
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
