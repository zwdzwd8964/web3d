import { Document, WebIO } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import { auditGlb, measure, readGlb } from '../../src/assets/audit.js'
import { measureFromHeader, needsContainerRoute, readGlbHeader } from '../../src/assets/glb-header.js'
import { buildPumpGlb } from './glb.js'

/**
 * T-217 · GLB 容器感知与压缩件体检。
 *
 * The bar is not "the header reader works". It is **the two routes produce the same numbers**,
 * because the moment they diverge the health check starts reporting a different triangle count
 * depending on whether the file happened to be compressed — and that number goes into a
 * contract (附件A).
 *
 * ⚠ **A card-face correction is recorded here, not just in the commit message.** The card's
 * acceptance says 「`readGlb` 改用 `registerExtensions(ALL_EXTENSIONS)`」 makes 「`auditGlb` 对
 * 声明 Draco 的 GLB 不再抛异常」. Measured, it does the opposite: it replaces a legible
 * `Error: Missing required extension` with `TypeError: Cannot read properties of undefined
 * (reading 'DT_FLOAT32')`. Only the container routing satisfies that acceptance. Both halves
 * are still delivered — they just do different jobs, and the tests below say which is which.
 */

/** Rewrites a GLB's JSON chunk in place, re-padding and re-stamping the container. */
function rewriteJson(bytes: ArrayBuffer, mutate: (json: Record<string, unknown>) => void): ArrayBuffer {
  const view = new DataView(bytes)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength))) as Record<string, unknown>
  mutate(json)

  let text = JSON.stringify(json)
  while (text.length % 4 !== 0) text += ' '
  const jsonBytes = new TextEncoder().encode(text)
  const rest = new Uint8Array(bytes, 20 + jsonLength)

  const out = new Uint8Array(20 + jsonBytes.length + rest.length)
  const outView = new DataView(out.buffer)
  out.set(new Uint8Array(bytes, 0, 20))
  outView.setUint32(0, 0x46546c67, true)
  outView.setUint32(4, 2, true)
  outView.setUint32(8, out.length, true)
  outView.setUint32(12, jsonBytes.length, true)
  outView.setUint32(16, 0x4e4f534a, true)
  out.set(jsonBytes, 20)
  out.set(rest, 20 + jsonBytes.length)
  return out.buffer
}

/** Declares `extensionsUsed` / `extensionsRequired` on an otherwise ordinary GLB. */
function declareExtensions(bytes: ArrayBuffer, used: string[], required: string[]): ArrayBuffer {
  return rewriteJson(bytes, (json) => {
    json['extensionsUsed'] = used
    if (required.length > 0) json['extensionsRequired'] = required
  })
}

/**
 * A GLB whose primitives span every mode the triangle formula branches on.
 *
 * `buildPumpGlb` only ever emits mode 4, so a cross-check built on it alone **cannot tell
 * `mode === 4 ? count/3 : …` from `count/3` unconditionally** — measured: collapsing the
 * formula to `count/3` left all eighteen tests green. POINTS and LINES must contribute zero,
 * and a TRIANGLE_STRIP must contribute `count - 2`.
 */
async function buildMixedModeGlb(): Promise<ArrayBuffer> {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const material = doc.createMaterial('steel')
  const mesh = doc.createMesh('Mixed')
  // 0 = POINTS · 1 = LINES · 4 = TRIANGLES · 5 = TRIANGLE_STRIP · 6 = TRIANGLE_FAN
  for (const mode of [0, 1, 4, 5, 6] as const) {
    /**
     * **Seven vertices, and the number is load-bearing.**
     *
     * With four (or six) the correct total and the collapsed-to-`count/3` total are the same
     * number: `0+0+1+2+2 = 5` and `1+1+1+1+1 = 5`. Measured — the mutation stayed green on a
     * four-vertex fixture. Seven separates them (`0+0+2+5+5 = 12` vs `2×5 = 10`).
     *
     * A fixture can satisfy every structural requirement of a test and still be unable to
     * fail it. That is only visible by running the mutation.
     */
    const vertices = new Float32Array(3 * 7)
    const position = doc.createAccessor().setType('VEC3').setArray(vertices).setBuffer(buffer)
    mesh.addPrimitive(doc.createPrimitive().setMode(mode).setAttribute('POSITION', position).setMaterial(material))
  }
  doc.createScene('Scene').addChild(doc.createNode('Mixed').setMesh(mesh))
  return (await new WebIO().writeBinary(doc)).buffer as ArrayBuffer
}

/**
 * A GLB where ONE image backs TWO textures.
 *
 * gltf-transform's reader creates one `Texture` per `images[]` entry, so `measure().textures`
 * counts images. The existing fixture has 1 image and 1 texture, which makes
 * `json.textures.length` and `json.images.length` indistinguishable — measured: swapping them
 * left all eighteen tests green.
 */
async function buildSharedImageGlb(): Promise<ArrayBuffer> {
  // gltf-transform's WRITER emits one image per Texture even when the bytes are identical, so
  // the shape has to be built by rewriting the JSON chunk: two `textures` entries both
  // pointing at `source: 0`. That is an entirely ordinary thing for a real exporter to emit
  // (one map, two samplers) and it is the only shape that tells the two counts apart.
  const base = await buildPumpGlb({ withTexture: { width: 32, height: 16 } })
  return rewriteJson(base, (json) => {
    const textures = json['textures'] as { source?: number }[]
    textures.push({ ...textures[0] })
  })
}

describe('readGlbHeader · 容器解析', () => {
  it('reads magic, version, chunk table and the extension lists', async () => {
    const bytes = await buildPumpGlb({ withTexture: { width: 64, height: 32 } })
    const header = readGlbHeader(bytes)

    expect(header).not.toBe(null)
    // Shape assertions, not `not.toBeNull()`: the latter is also true of `undefined`, which
    // is how three of v0.5's E18 mutations survived.
    expect(typeof header?.json).toBe('object')
    expect(header?.binOffset).toBeTypeOf('number')
    expect(header?.binLength).toBeGreaterThan(0)
    expect(header?.extensionsUsed).toEqual([])
    expect(header?.extensionsRequired).toEqual([])
  })

  it.each([
    ['draco', ['KHR_draco_mesh_compression'], true],
    ['meshopt', ['EXT_meshopt_compression'], true],
    ['basisu (used only, not required)', [], false],
  ])('routes %s correctly', async (_label, required, expected) => {
    const base = await buildPumpGlb()
    const bytes = declareExtensions(base, required.length > 0 ? required : ['KHR_texture_basisu'], required)
    const header = readGlbHeader(bytes)

    expect(header).not.toBe(null)
    expect(header?.extensionsRequired).toEqual(required)
    expect(needsContainerRoute(header!)).toBe(expected)
  })

  it.each([
    ['空字节', new ArrayBuffer(0)],
    ['太短', new ArrayBuffer(8)],
    // magic wrong but version RIGHT. With version left at 0 the version check catches it
    // first, and the magic check can be deleted with every test still green — measured.
    ['magic 不对（version 正确）', (() => {
      const b = new ArrayBuffer(64)
      const v = new DataView(b)
      v.setUint32(0, 0x12345678, true)
      v.setUint32(4, 2, true)
      v.setUint32(12, 4, true)
      v.setUint32(16, 0x4e4f534a, true)
      return b
    })()],
    ['version 不是 2', (() => {
      const b = new ArrayBuffer(64)
      const v = new DataView(b)
      v.setUint32(0, 0x46546c67, true)
      v.setUint32(4, 1, true)
      return b
    })()],
  ])('returns null rather than throwing for %s', (_label, bytes) => {
    expect(readGlbHeader(bytes)).toBe(null)
  })

  /**
   * A file that is a valid GLB in every respect EXCEPT its magic.
   *
   * The synthetic cases above cannot prove the magic check does anything: their JSON chunk is
   * four zero bytes, so `JSON.parse` throws and the function returns null whether the magic is
   * checked or not. Measured — deleting the magic check left all twenty tests green.
   *
   * Flipping four bytes on a real GLB is also the realistic shape: a `.bin`, a `.zip` or a
   * truncated upload that happens to have a plausible tail. Accepting one means measuring
   * whatever the bytes at offset 20 decode to.
   */
  it('rejects a file that is a valid GLB apart from its magic', async () => {
    const bytes = await buildPumpGlb({ withTexture: { width: 64, height: 32 } })
    expect(readGlbHeader(bytes)).not.toBe(null)

    const corrupted = bytes.slice(0)
    new DataView(corrupted).setUint32(0, 0x04034b50, true) // PK\x03\x04 — a zip
    expect(readGlbHeader(corrupted)).toBe(null)
  })
})

describe('measureFromHeader · 与文档路交叉校验', () => {
  /**
   * The contract. Both routes over the SAME uncompressed file must agree field for field.
   *
   * Not a spot check on `tris`: four of the eight fields are computed differently on the two
   * routes (`textures` counts images, triangles fall back to POSITION, mode picks the
   * formula, an unnamed animation is `''`), and each of those would be a plausible wrong
   * number rather than a crash.
   */
  it.each([
    ['朴素', {}],
    ['带贴图', { withTexture: { width: 64, height: 32 } }],
    ['多三角面', { trianglesPerMesh: 12 }],
    ['带动画', { animationName: 'Disassemble', animationSeconds: 2 }],
    ['多材质', { extraMaterials: 3 }],
    ['合起来', { withTexture: { width: 128, height: 128 }, trianglesPerMesh: 5, extraMaterials: 2, animationName: '拆装', animationSeconds: 1 }],
  ])('agrees with the document route on a %s GLB', async (_label, options) => {
    const bytes = await buildPumpGlb(options)
    const header = readGlbHeader(bytes)
    expect(header).not.toBe(null)

    const viaDocument = measure(await readGlb(bytes), bytes.byteLength)
    const viaHeader = measureFromHeader(header!, bytes, bytes.byteLength)

    expect(viaHeader).toEqual(viaDocument)
  })

  /**
   * The two fixtures that make the cross-check able to fail.
   *
   * Both were added because a mutation came back green: with only `buildPumpGlb` (mode 4
   * throughout, one image backing one texture), collapsing the triangle formula to `count/3`
   * and swapping `images.length` for `textures.length` were both **invisible**. A cross-check
   * that cannot distinguish the two implementations is not a cross-check.
   */
  it('agrees on a GLB spanning every primitive mode', async () => {
    const bytes = await buildMixedModeGlb()
    const header = readGlbHeader(bytes)
    const viaDocument = measure(await readGlb(bytes), bytes.byteLength)
    const viaHeader = measureFromHeader(header!, bytes, bytes.byteLength)

    expect(viaHeader).toEqual(viaDocument)
    // 7 vertices per primitive: TRIANGLES → 2, STRIP → 5, FAN → 5, POINTS/LINES → 0.
    expect(viaDocument.tris).toBe(12)
  })

  it('agrees on a GLB where one image backs two textures', async () => {
    const bytes = await buildSharedImageGlb()
    const header = readGlbHeader(bytes)
    const viaDocument = measure(await readGlb(bytes), bytes.byteLength)
    const viaHeader = measureFromHeader(header!, bytes, bytes.byteLength)

    expect(viaHeader).toEqual(viaDocument)
    // The number that tells the two implementations apart: 1 image, 2 textures.
    expect(header!.json.images).toHaveLength(1)
    expect(header!.json.textures).toHaveLength(2)
    expect(viaDocument.textures).toBe(1)
  })
})

describe('auditGlb · 压缩件不再抛异常', () => {
  it('grades a Draco-declaring GLB instead of throwing', async () => {
    const base = await buildPumpGlb({ trianglesPerMesh: 12 })
    const bytes = declareExtensions(base, ['KHR_draco_mesh_compression'], ['KHR_draco_mesh_compression'])

    const result = await auditGlb(bytes)

    // The numbers, not just "it did not throw": a route that returned zeros would also not
    // throw, and the whole point of the health check is the triangle count.
    expect(result.measurements.tris).toBe(24)
    expect(result.measurements.materials).toBe(1)
    expect(result.stats.bytes).toBe(bytes.byteLength)
  })

  it('grades a meshopt-declaring GLB too', async () => {
    const base = await buildPumpGlb()
    const bytes = declareExtensions(base, ['EXT_meshopt_compression'], ['EXT_meshopt_compression'])
    await expect(auditGlb(bytes)).resolves.toBeTruthy()
  })

  it('still uses the document route for an uncompressed file', async () => {
    // The negative half. If routing sent everything down the container path, every
    // cross-check above would compare the container route with itself and pass forever.
    const bytes = await buildPumpGlb({ withTexture: { width: 64, height: 32 } })
    const header = readGlbHeader(bytes)
    expect(needsContainerRoute(header!)).toBe(false)

    const result = await auditGlb(bytes)
    expect(result.measurements).toEqual(measure(await readGlb(bytes), bytes.byteLength))
  })

  it('reads an extension block into the document instead of dropping it', async () => {
    /**
     * What `registerExtensions` actually buys — and the reason the mutation the card
     * prescribes for it (「去掉 registerExtensions → 『Draco 不再抛异常』红」) cannot work:
     * that acceptance is satisfied by the ROUTING, not by the registration. This is the
     * assertion that does go red when the registration is removed.
     */
    const base = await buildPumpGlb()
    const bytes = declareExtensions(base, ['KHR_materials_emissive_strength'], [])
    const document = await readGlb(bytes)
    expect(document.getRoot().listExtensionsUsed().map((e) => e.extensionName)).toContain('KHR_materials_emissive_strength')
  })
})
