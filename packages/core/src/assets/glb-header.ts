import type { AuditMeasurements } from './audit.js'
import { estimateTextureBytes, readImageInfo } from './audit.js'

/**
 * T-217 · reading a GLB's container without decoding a byte of its geometry.
 *
 * `auditGlb` today hands the file to `@gltf-transform/core`, whose reader **throws before it
 * reads anything** when `extensionsRequired` names an extension it does not have:
 *
 *   `Error: Missing required extension, "KHR_draco_mesh_compression".`
 *
 * That error reaches the user as 「引入失败：Missing required extension, …」 — an English
 * sentence prefixed by a Chinese one — and it makes a Draco-compressed model impossible to
 * even measure. Every number the health check exists to report (triangles, textures, texture
 * bytes) lives in the **JSON chunk**, which is plain text and needs no decoder at all.
 *
 * ⚠ **Registering the extensions does NOT fix this, and the card says it does.** Measured:
 * `new WebIO().registerExtensions(ALL_EXTENSIONS)` on a Draco file throws
 * `TypeError: Cannot read properties of undefined (reading 'DT_FLOAT32')` instead — because
 * `KHRDracoMeshCompression.install()` calls `initDecoderModule(undefined)` eagerly, before
 * the readable「please install the decoder」message it was supposed to produce. So the routing
 * below is the only half that works; `registerExtensions` earns its place for a different
 * reason (see `readGlb`).
 *
 * Zero dependencies, zero geometry parsing. An invalid container returns `null` rather than
 * throwing: "this is not a GLB" is an answer, not a crash.
 */

/** glTF 2.0 container constants, little-endian uint32 as they appear in the file. */
const MAGIC_GLTF = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942
const HEADER_BYTES = 12
const CHUNK_HEADER_BYTES = 8

/** Extensions whose payload cannot be read without a decoder module. */
export const COMPRESSED_EXTENSIONS = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression'] as const

export interface GlbHeader {
  /** The glTF JSON root object, parsed. Everything the audit needs is in here. */
  readonly json: GltfJson
  /** Offset of the BIN chunk's data within the file, or null when there is no BIN chunk. */
  readonly binOffset: number | null
  readonly binLength: number
  readonly extensionsUsed: readonly string[]
  readonly extensionsRequired: readonly string[]
}

/** Only the parts of the glTF root this file reads. Deliberately not the whole spec. */
export interface GltfJson {
  readonly extensionsUsed?: string[]
  readonly extensionsRequired?: string[]
  readonly meshes?: { primitives?: { mode?: number; indices?: number; attributes?: Record<string, number> }[] }[]
  readonly accessors?: { count?: number }[]
  readonly materials?: unknown[]
  readonly images?: { bufferView?: number; uri?: string; mimeType?: string }[]
  readonly textures?: unknown[]
  readonly nodes?: unknown[]
  readonly animations?: { name?: string }[]
  readonly bufferViews?: { buffer?: number; byteOffset?: number; byteLength?: number }[]
}

/**
 * Parses a GLB's 12-byte header and chunk table.
 *
 * Returns `null` — never throws — when the bytes are not a glTF 2.0 binary. Callers use this
 * to decide *whether* to take the container route, so a throw here would defeat the point.
 */
export function readGlbHeader(bytes: ArrayBuffer): GlbHeader | null {
  if (bytes.byteLength < HEADER_BYTES + CHUNK_HEADER_BYTES) return null
  const view = new DataView(bytes)

  if (view.getUint32(0, true) !== MAGIC_GLTF) return null
  if (view.getUint32(4, true) !== 2) return null

  const jsonLength = view.getUint32(12, true)
  if (view.getUint32(16, true) !== CHUNK_JSON) return null
  const jsonStart = HEADER_BYTES + CHUNK_HEADER_BYTES
  if (jsonStart + jsonLength > bytes.byteLength) return null

  let json: GltfJson
  try {
    json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, jsonStart, jsonLength))) as GltfJson
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null) return null

  // The BIN chunk is optional, and a second chunk that is not BIN is ignored rather than
  // hunted past — the same thing gltf-transform's own reader does.
  let binOffset: number | null = null
  let binLength = 0
  const binHeader = jsonStart + jsonLength
  if (binHeader + CHUNK_HEADER_BYTES <= bytes.byteLength) {
    const length = view.getUint32(binHeader, true)
    if (view.getUint32(binHeader + 4, true) === CHUNK_BIN && binHeader + CHUNK_HEADER_BYTES + length <= bytes.byteLength) {
      binOffset = binHeader + CHUNK_HEADER_BYTES
      binLength = length
    }
  }

  return {
    json,
    binOffset,
    binLength,
    extensionsUsed: json.extensionsUsed ?? [],
    extensionsRequired: json.extensionsRequired ?? [],
  }
}

/** Whether this container declares a compression extension the reader cannot decode. */
export function needsContainerRoute(header: GlbHeader): boolean {
  return header.extensionsRequired.some((name) => (COMPRESSED_EXTENSIONS as readonly string[]).includes(name))
}

/**
 * Produces the SAME `AuditMeasurements` the document route produces, from the container alone.
 *
 * "The same" is the whole contract, and it is asserted by a cross-check test on an
 * uncompressed file. Four details are easy to get subtly wrong, and each one would produce a
 * number that is plausible, different, and green on the current fixture:
 *
 *  1. **`textures` counts glTF `images`, not `textures`.** gltf-transform's reader creates
 *     one `Texture` per `images[]` entry (`context.textures = imageDefs.map(...)`), so a file
 *     where two samplers share one image reports 1 from `measure()` and 2 from a naive
 *     `json.textures.length`. The current fixture has 1 of each — the difference would not
 *     show up until a real model arrived.
 *  2. **Triangles fall back to POSITION when there are no indices.** The repository's own
 *     test fixture has no indices (`glb.ts:51`), so getting this wrong zeroes the headline
 *     number on the file every other test uses.
 *  3. **Mode decides the formula.** POINTS and LINES contribute no triangles; counting their
 *     vertices as `count / 3` inflates a number that ends up in the contract.
 *  4. **An unnamed animation is `''`, not `undefined`.** `createAnimation(name = "")` is what
 *     the document route goes through; `json.animations[i].name` is absent. `toEqual` on two
 *     arrays of strings would fail on exactly that.
 */
export function measureFromHeader(header: GlbHeader, bytes: ArrayBuffer, byteLength: number): AuditMeasurements {
  const { json } = header
  const accessors = json.accessors ?? []

  let tris = 0
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      // Absent `mode` means TRIANGLES (glTF default 4) — not "no mode".
      const mode = primitive.mode ?? 4
      const indexed = primitive.indices !== undefined ? accessors[primitive.indices]?.count : undefined
      const position = primitive.attributes?.['POSITION'] !== undefined ? accessors[primitive.attributes['POSITION']]?.count : undefined
      const count = indexed ?? position ?? 0
      if (mode === 4) tris += Math.floor(count / 3)
      else if (mode === 5 || mode === 6) tris += Math.max(0, count - 2)
    }
  }

  let textureBytes = 0
  let maxTextureSize = 0
  for (const image of json.images ?? []) {
    const size = imageSize(image, header, bytes)
    if (!size) continue
    textureBytes += estimateTextureBytes(size.width, size.height)
    maxTextureSize = Math.max(maxTextureSize, size.width, size.height)
  }

  return {
    tris,
    materials: (json.materials ?? []).length,
    // See note 1: images, not textures.
    textures: (json.images ?? []).length,
    bytes: byteLength,
    textureBytes,
    nodes: (json.nodes ?? []).length,
    // See note 4: `''` for an unnamed animation, matching `createAnimation(name = "")`.
    animations: (json.animations ?? []).map((a) => a.name ?? ''),
    maxTextureSize,
  }
}

/** An embedded image's pixel dimensions, read from its own header inside the BIN chunk. */
function imageSize(
  image: { bufferView?: number; uri?: string },
  header: GlbHeader,
  bytes: ArrayBuffer,
): { width: number; height: number } | null {
  if (image.bufferView === undefined || header.binOffset === null) return null
  const view = header.json.bufferViews?.[image.bufferView]
  if (!view || view.byteLength === undefined) return null
  const start = header.binOffset + (view.byteOffset ?? 0)
  if ((view.byteOffset ?? 0) + view.byteLength > header.binLength) return null
  if (start + view.byteLength > bytes.byteLength) return null
  // `readImageInfo` reads only the signature and dimensions; it never decodes pixels.
  const info = readImageInfo(bytes.slice(start, start + view.byteLength))
  return info ? { width: info.width, height: info.height } : null
}
