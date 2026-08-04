import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { auditGlb } from '../../src/assets/audit.js'
import { readGlbHeader, needsContainerRoute } from '../../src/assets/glb-header.js'
import { buildSamplePumpGlb } from '../../src/assets/sample.js'

/**
 * T-218 · the Draco fixture, in three layers that each prove a different thing.
 *
 * 债 H: Draco was 「装了但没跑过」 — wired since v0, never once exercised on a real compressed
 * asset. `IMPL_NOTES` U-15 recorded it as unverified and nothing here could have changed that,
 * because the repository had no Draco-compressed file at all.
 *
 * **The card asked for a third layer this file cannot have.** It specified
 * `AssetLoader.parse`'s `indexObjects` key set against an uncompressed twin — but three's
 * `DRACOLoader` cannot initialise under Node: `_loadLibrary` (DRACOLoader.js:358) goes through
 * three's `FileLoader`, which calls `fetch`, and Node's `fetch` does not do `file://`; the
 * decode itself needs `new Worker`, which Node has no global for. Measured, not assumed:
 * instantiating it here reports `TypeError: fetch failed`. Running the editor's vitest under
 * `environment: 'node'` is a C8 requirement, so that layer belongs in the browser and now
 * lives in `e2e/tests/decoders.spec.ts`.
 *
 * What replaces it is stronger than a key-set comparison anyway: layer 3 below decodes the
 * fixture with the SAME `draco3dgltf` module that produced it and compares real geometry —
 * vertex and triangle counts, not just names. See ADR-0032.
 */

const require = createRequire(new URL('../../package.json', import.meta.url))
/**
 * The fixture's bytes, as an `ArrayBuffer` — which is what `readGlbHeader` / `auditGlb` take.
 *
 * `readFileSync` hands back a `Buffer` that is a VIEW into a pooled allocation, so its
 * `.buffer` is far larger than the file and starts at a non-zero `byteOffset`. Passing that
 * straight through is the classic way to read a neighbouring file's bytes as a GLB header.
 */
function fixture(): ArrayBuffer {
  const buf = readFileSync(fileURLToPath(new URL('../../../../e2e/fixtures/pump-draco.glb', import.meta.url)))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/* -------------------------------------------------------------------------- */
/* 第 1 层 · 容器里确实声明了 Draco                                             */
/* -------------------------------------------------------------------------- */

describe('T-218 第 1 层 · GLB 容器声明', () => {
  /**
   * ⚠ **这一层不证明解码。** It reads the JSON chunk and nothing else — a hand-written file
   * claiming `KHR_draco_mesh_compression` would pass it. It exists to catch the fixture
   * silently degrading into an ordinary GLB, which is mutation ② below.
   */
  it('declares KHR_draco_mesh_compression as REQUIRED, not merely used', () => {
    const header = readGlbHeader(fixture())
    expect(header).not.toBeNull()
    expect(header!.extensionsRequired).toContain('KHR_draco_mesh_compression')
    expect(header!.json.meshes?.length ?? 0).toBeGreaterThan(0)
  })

  it('and is therefore routed away from the three-based reader', () => {
    // `required` is what makes the file unreadable without a decoder. A merely-`used`
    // extension would let a decoder-less loader open it and quietly show nothing.
    expect(needsContainerRoute(readGlbHeader(fixture())!)).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* 第 2 层 · 体检数字与未压缩同源件逐项相等                                     */
/* -------------------------------------------------------------------------- */

describe('T-218 第 2 层 · auditGlb 的测量值', () => {
  it('reports the same geometry as the uncompressed twin', async () => {
    const compressed = await auditGlb(fixture())
    const plain = await auditGlb(await buildSamplePumpGlb())

    expect(compressed.measurements.tris).toBe(plain.measurements.tris)
    expect(compressed.measurements.nodes).toBe(plain.measurements.nodes)
    expect(compressed.measurements.materials).toBe(plain.measurements.materials)
    expect(compressed.measurements.textures).toBe(plain.measurements.textures)
    // Same geometry, fewer bytes — otherwise the "compressed" fixture is not compressed.
    expect(fixture().byteLength).toBeLessThan((await buildSamplePumpGlb()).byteLength)
  })

  /**
   * **This layer is decoder-independent by design, and the card got that wrong.**
   *
   * Mutation ① (unhook `setDRACOLoader`) is written on the card as 「第 2 层必须红」. It cannot
   * be: `auditGlb` sees `needsContainerRoute` is true and returns `measureFromHeader`, which
   * reads the JSON chunk's accessor counts and never touches three. That routing is exactly
   * what T-217 built, and it is why a compressed file can be measured at all. The mutation's
   * real landing places are E2E import and layer 3.
   */
  it('measures a compressed file without any decoder present — that is the point of T-217', async () => {
    const report = await auditGlb(fixture())
    expect(report.measurements.tris).toBeGreaterThan(0)
  })
})

/* -------------------------------------------------------------------------- */
/* 第 3 层 · 真解码，几何逐项相等                                               */
/* -------------------------------------------------------------------------- */

describe('T-218 第 3 层 · 真的解一遍', () => {
  /**
   * Decoded with `draco3dgltf` — the same module that encoded it — through gltf-transform.
   *
   * This is the layer that would have caught 债 H if it had existed: it fails if the payload
   * is not decodable, not merely if the header lies about it.
   */
  it('decodes to the same vertex and triangle counts as the uncompressed twin', async () => {
    const { NodeIO } = require('@gltf-transform/core')
    const { KHRDracoMeshCompression } = require('@gltf-transform/extensions')
    const draco3d = require('draco3dgltf')

    const io = new NodeIO()
      .registerExtensions([KHRDracoMeshCompression])
      .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() })

    const decoded = await io.readBinary(new Uint8Array(fixture()))
    const plain = await new NodeIO().readBinary(new Uint8Array(await buildSamplePumpGlb()))

    const count = (doc: { getRoot(): { listMeshes(): unknown[] } }) => {
      let vertices = 0
      let triangles = 0
      for (const mesh of doc.getRoot().listMeshes() as { listPrimitives(): unknown[] }[]) {
        for (const prim of mesh.listPrimitives() as {
          getAttribute(name: string): { getCount(): number } | null
          getIndices(): { getCount(): number } | null
        }[]) {
          vertices += prim.getAttribute('POSITION')?.getCount() ?? 0
          triangles += (prim.getIndices()?.getCount() ?? 0) / 3
        }
      }
      return { vertices, triangles }
    }

    const a = count(decoded)
    const b = count(plain)
    expect(a.vertices).toBeGreaterThan(0)
    expect(a).toEqual(b)
  })

  it('and refuses the file when no decoder is registered', async () => {
    const { NodeIO } = require('@gltf-transform/core')
    const { KHRDracoMeshCompression } = require('@gltf-transform/extensions')
    // Extension registered, decoder dependency deliberately absent — the shape of a build
    // that shipped the loader wiring but never the WASM.
    const io = new NodeIO().registerExtensions([KHRDracoMeshCompression])
    await expect(io.readBinary(new Uint8Array(fixture()))).rejects.toThrow()
  })
})
