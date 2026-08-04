import type { AssetAudit, AssetStats, AuditFinding, AuditLevel } from '@w3/schema'
import { Document, WebIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import type { AssetPolicy, PolicyScope } from './policy.js'
import { DEFAULT_POLICY, METRICS, WARN_RATIO, formatMetric, metricsFor } from './policy.js'
import { measureFromHeader, needsContainerRoute, readGlbHeader } from './glb-header.js'
import type { GlbHeader } from './glb-header.js'

/**
 * T-050 · the import health check (R01).
 *
 * Runs on the glTF document BEFORE any GPU resource exists, so an oversized model can be
 * reported — and refused — without first trying to upload it. That ordering is the whole
 * point: R01 is about the model that no architecture can save.
 *
 * The report is shown to the user and stored on the asset record. It is also the
 * contractual shield: `audit.policyId` records which threshold set produced the verdict,
 * so "we accepted this asset under Appendix A rev 1" stays answerable a year later.
 */

/** Extra measurements the schema's AssetStats does not carry but the policy checks. */
export interface AuditMeasurements extends AssetStats {
  /** Longest edge of the largest texture, in pixels. */
  readonly maxTextureSize: number
}

export interface AuditResult {
  readonly stats: AssetStats
  readonly measurements: AuditMeasurements
  readonly audit: AssetAudit
  readonly verdict: AuditLevel
  readonly failing: readonly AuditFinding[]
  readonly summary: string
}

export interface AuditOptions {
  readonly policy?: AssetPolicy
  /** Injected so the record is reproducible; production passes the real clock. */
  readonly now?: () => string
  /**
   * v0.5 · which metric set applies. Defaults to `'model'`, so every pre-v0.5 caller keeps
   * grading exactly the seven metrics it always did.
   */
  readonly scope?: PolicyScope
  /**
   * T-217 · an already-parsed container, so a caller that read the header to decide something
   * else does not pay for a second `JSON.parse` of a multi-megabyte JSON chunk.
   */
  readonly header?: GlbHeader
}

/** Decoded VRAM for one mip chain: w*h*4 bytes, plus ~1/3 again for the mipmaps. */
export function estimateTextureBytes(width: number, height: number): number {
  return Math.round(width * height * 4 * (4 / 3))
}

/**
 * Reads a GLB into a gltf-transform document. Isomorphic — works in Node and browsers.
 *
 * T-217 · `registerExtensions(ALL_EXTENSIONS)` is what lets the reader UNDERSTAND the
 * extensions a file declares. Without it, every `KHR_materials_*` block is dropped on the
 * floor and every optional extension logs `Missing optional extension, "…"` to stderr on
 * import — noise the user cannot act on, about data we then silently discard.
 *
 * **It does not make Draco readable, and the card says it does.** Measured: on a
 * Draco-declaring GLB, registering the extensions turns a legible
 * `Error: Missing required extension` into `TypeError: Cannot read properties of undefined
 * (reading 'DT_FLOAT32')`, because `KHRDracoMeshCompression.install()` eagerly calls
 * `initDecoderModule(undefined)` before it reaches its own "please install the decoder"
 * message. Compressed containers are routed away from this function entirely — see
 * `auditGlb`. That routing is the half that satisfies the acceptance bar.
 */
export async function readGlb(bytes: ArrayBuffer): Promise<Document> {
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS)
  return io.readBinary(new Uint8Array(bytes))
}

/**
 * Measures a glTF document.
 *
 * Triangle counting respects primitive mode: a POINTS or LINES primitive contributes no
 * triangles, and counting its vertices as `count / 3` would inflate the number that ends
 * up in the contract.
 */
export function measure(document: Document, byteLength: number): AuditMeasurements {
  const root = document.getRoot()

  let tris = 0
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      // glTF primitive modes: 4 = TRIANGLES, 5 = TRIANGLE_STRIP, 6 = TRIANGLE_FAN.
      const mode = primitive.getMode()
      const indices = primitive.getIndices()
      const position = primitive.getAttribute('POSITION')
      const count = indices ? indices.getCount() : (position?.getCount() ?? 0)
      if (mode === 4) tris += Math.floor(count / 3)
      else if (mode === 5 || mode === 6) tris += Math.max(0, count - 2)
    }
  }

  let textureBytes = 0
  let maxTextureSize = 0
  for (const texture of root.listTextures()) {
    const size = texture.getSize()
    if (!size) continue
    const [width, height] = size
    textureBytes += estimateTextureBytes(width, height)
    maxTextureSize = Math.max(maxTextureSize, width, height)
  }

  return {
    tris,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    bytes: byteLength,
    textureBytes,
    nodes: root.listNodes().length,
    animations: root.listAnimations().map((a) => a.getName()),
    maxTextureSize,
  }
}

/** Grades measurements against a policy and produces the stored audit record. */
export function grade(measurements: AuditMeasurements, options: AuditOptions = {}): AuditResult {
  const policy = options.policy ?? DEFAULT_POLICY
  const now = options.now ?? (() => new Date().toISOString())

  const findings: AuditFinding[] = metricsFor(options.scope ?? 'model').map((spec) => {
    const value = (measurements as unknown as Record<string, number>)[spec.metric] ?? 0
    const limit = spec.limit(policy)
    const level: AuditLevel = spec.level
      ? spec.level(value, limit)
      : value > limit
        ? 'fail'
        : value > limit * WARN_RATIO
          ? 'warn'
          : 'pass'
    return {
      metric: spec.metric,
      value,
      limit,
      level,
      advice: level === 'pass' ? '' : spec.advice(value, limit),
    }
  })

  const failing = findings.filter((f) => f.level === 'fail')
  const warning = findings.filter((f) => f.level === 'warn')
  const verdict: AuditLevel = failing.length > 0 ? 'fail' : warning.length > 0 ? 'warn' : 'pass'

  const summary =
    verdict === 'pass'
      ? `体检通过：${findings.length} 项全部在规范范围内。`
      : verdict === 'warn'
        ? `体检通过，但 ${warning.length} 项接近上限：${warning.map(labelOf).join('、')}。`
        : `体检未通过：${failing.length} 项超标 —— ${failing
            .map((f) => `${labelOf(f)} ${formatMetric(f.value, unitOf(f))}（限 ${formatMetric(f.limit, unitOf(f))}）`)
            .join('；')}。`

  // A WHITELIST, not a blacklist. This used to be `const { maxTextureSize: _dropped, ...rest }`
  // — drop the one key that is not part of `AssetStats` and keep everything else — and every
  // measurement added afterwards leaked straight into the document. `AssetStatsSchema` is
  // `.strict()`, so the leak turned every imported image, HDRI and audio file into a
  // document that **could not be published**: the panels use `checkIntegrity`, which does
  // not re-validate the schema, so the editor showed a healthy project right up until the
  // publish gate refused it.
  //
  // Found by golden path II step ⑫ (T-170), which is the first thing in the repo that ever
  // published a document containing a v0.5 asset. The import tests all asserted
  // `checkIntegrity` and none of them asserted `validate`.
  const stats: AssetStats = {
    tris: measurements.tris,
    materials: measurements.materials,
    textures: measurements.textures,
    bytes: measurements.bytes,
    textureBytes: measurements.textureBytes,
    nodes: measurements.nodes,
    animations: [...measurements.animations],
  }

  return {
    stats,
    measurements,
    audit: { checkedAt: now(), policyId: policy.id, findings },
    verdict,
    failing,
    summary,
  }
}

/**
 * Read, measure and grade in one call — what the import pipeline uses.
 *
 * T-217 · **two routes, chosen by the container.** A file whose `extensionsRequired` names a
 * compression extension is measured from its JSON chunk; everything else goes through the
 * document reader exactly as before.
 *
 * The routing is not an optimisation. Before it, importing a Draco-compressed GLB threw out
 * of `readGlb` with nothing caught anywhere between here and the drop controller, so the user
 * saw 「引入失败：Missing required extension, "KHR_draco_mesh_compression".」 and the health
 * check — the one thing that exists to say WHY a model is a problem — never ran. Every number
 * it reports lives in the JSON chunk, which needs no decoder.
 *
 * `options.header` lets a caller that has already parsed the container pass it in rather than
 * paying for a second `JSON.parse` of a multi-megabyte chunk.
 */
export async function auditGlb(bytes: ArrayBuffer, options: AuditOptions = {}): Promise<AuditResult> {
  const header = options.header ?? readGlbHeader(bytes)
  if (header && needsContainerRoute(header)) {
    return grade(measureFromHeader(header, bytes, bytes.byteLength), options)
  }
  const document = await readGlb(bytes)
  return grade(measure(document, bytes.byteLength), options)
}

const labelOf = (finding: AuditFinding) => METRICS.find((m) => m.metric === finding.metric)?.label ?? finding.metric
const unitOf = (finding: AuditFinding) => METRICS.find((m) => m.metric === finding.metric)?.unit ?? 'count'

/* ========================================================================== */
/* v0.5 · standalone images and environment maps (T-150)                      */
/* ========================================================================== */

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'ktx2' | 'hdr'

export interface ImageInfo {
  readonly format: ImageFormat
  readonly width: number
  readonly height: number
}

/**
 * Reads an image's dimensions out of its header.
 *
 * Header parsing rather than decoding, for three reasons that all matter here:
 *
 *  - **It runs in Node.** The audit is unit-tested without a DOM (C8); `createImageBitmap`
 *    and `<img>` are browser-only, and a check that can only run in a browser is a check
 *    that runs on nobody's machine before CI.
 *  - **It runs before the decode.** R01's premise is reporting on an asset that is too big
 *    BEFORE spending memory on it. Decoding an 8192×8192 PNG to discover that it is
 *    8192×8192 is the thing being warned about.
 *  - **`.hdr` and `.ktx2` cannot be decoded by the browser at all.** No `<img>` will ever
 *    say how big an environment map is.
 *
 * Returns null for bytes that are not a recognised image, which is how the importer tells
 * "unsupported file type" apart from "corrupt file".
 */
export function readImageInfo(bytes: ArrayBuffer): ImageInfo | null {
  const view = new DataView(bytes)
  const u8 = new Uint8Array(bytes)
  // Enough for a signature only. Each branch checks the length IT needs — a single
  // generous guard up front silently rejects short-but-valid files, and the reader would
  // report "unsupported format" for something perfectly ordinary.
  if (u8.length < 16) return null

  // PNG — fixed layout, IHDR is always the first chunk.
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    return u8.length < 24 ? null : { format: 'png', width: view.getUint32(16), height: view.getUint32(20) }
  }

  // KTX2 — «AB KTX 20 BB», then a fixed header.
  if (u8[0] === 0xab && u8[1] === 0x4b && u8[2] === 0x54 && u8[3] === 0x58) {
    return u8.length < 28 ? null : { format: 'ktx2', width: view.getUint32(20, true), height: view.getUint32(24, true) }
  }

  // JPEG — walk the marker chain to the frame header. The dimensions are not at a fixed
  // offset: EXIF blocks, ICC profiles and embedded thumbnails all sit in front of it.
  if (u8[0] === 0xff && u8[1] === 0xd8) {
    let at = 2
    while (at + 9 < u8.length) {
      if (u8[at] !== 0xff) {
        at++
        continue
      }
      const marker = u8[at + 1]!
      // SOF0…SOF15, excluding DHT (C4), JPG (C8) and DAC (CC), which are not frame headers.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpeg', width: view.getUint16(at + 7), height: view.getUint16(at + 5) }
      }
      if (marker >= 0xd0 && marker <= 0xd9) {
        at += 2
        continue
      }
      at += 2 + view.getUint16(at + 2)
    }
    return null
  }

  // WebP — one RIFF container, three codecs, three different ways to store the size.
  if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57) {
    if (u8.length < 30) return null
    const chunk = String.fromCharCode(u8[12]!, u8[13]!, u8[14]!, u8[15]!)
    if (chunk === 'VP8X') {
      return {
        format: 'webp',
        width: (u8[24]! | (u8[25]! << 8) | (u8[26]! << 16)) + 1,
        height: (u8[27]! | (u8[28]! << 8) | (u8[29]! << 16)) + 1,
      }
    }
    if (chunk === 'VP8L') {
      const bits = u8[21]! | (u8[22]! << 8) | (u8[23]! << 16) | (u8[24]! << 24)
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8 ') {
      return { format: 'webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    }
    return null
  }

  // Radiance — an ASCII header ending in a resolution line like `-Y 512 +X 1024`.
  if (u8[0] === 0x23 && u8[1] === 0x3f) {
    const head = new TextDecoder('latin1').decode(u8.subarray(0, Math.min(512, u8.length)))
    const match = /-Y\s+(\d+)\s+\+X\s+(\d+)/.exec(head)
    return match ? { format: 'hdr', width: Number(match[2]), height: Number(match[1]) } : null
  }

  return null
}

const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0

/** Extra measurements for a standalone image, on top of what AssetStats carries. */
export interface ImageMeasurements extends AuditMeasurements {
  readonly imageBytes: number
  readonly hdriBytes: number
  readonly imageSize: number
  readonly nonPowerOfTwo: number
}

/**
 * Measures a standalone image or environment map.
 *
 * `textures: 1` with a real `textureBytes` estimate, because that is what this asset costs
 * once it is on a material — the same budget the model path reports into, not a separate
 * scale. `tris` / `materials` / `nodes` are zero and are NOT graded for this scope (see
 * `metricsFor`), so they never show up in the report as pointless green rows.
 */
export function measureImage(info: ImageInfo, byteLength: number): ImageMeasurements {
  return {
    tris: 0,
    materials: 0,
    textures: 1,
    bytes: byteLength,
    textureBytes: estimateTextureBytes(info.width, info.height),
    nodes: 0,
    animations: [],
    maxTextureSize: Math.max(info.width, info.height),
    imageBytes: byteLength,
    hdriBytes: byteLength,
    imageSize: Math.max(info.width, info.height),
    nonPowerOfTwo: isPowerOfTwo(info.width) && isPowerOfTwo(info.height) ? 0 : 1,
  }
}

/** Reads, measures and grades a standalone image. Throws on bytes it cannot recognise. */
export function auditImage(bytes: ArrayBuffer, options: AuditOptions & { scope: 'image' | 'hdri' }): AuditResult {
  const info = readImageInfo(bytes)
  if (!info) throw new Error('无法识别的图片格式，支持 png / jpg / webp / ktx2 / hdr')
  return grade(measureImage(info, bytes.byteLength), options)
}

/**
 * Measures an audio or video file (T-160).
 *
 * There is nothing to inspect inside the bytes: an MP3's length is in a header format that
 * differs per encoder, and a container's dimensions need a demuxer. So the only measurement
 * is SIZE — which is also the only one the policy grades for these scopes, and the only one
 * that costs the user anything before playback starts.
 *
 * `durationS` is read separately, by the browser, at import (SCHEMA_SPEC §6.5). It is a
 * document field rather than an audit metric because it is a property of the content, not a
 * budget to stay under.
 */
export interface MediaMeasurements extends AuditMeasurements {
  readonly audioBytes: number
  readonly videoBytes: number
}

export function measureMedia(byteLength: number): MediaMeasurements {
  return {
    tris: 0,
    materials: 0,
    textures: 0,
    bytes: byteLength,
    textureBytes: 0,
    nodes: 0,
    animations: [],
    maxTextureSize: 0,
    audioBytes: byteLength,
    videoBytes: byteLength,
  }
}

/** Grades an audio or video file against its scope's one limit. */
export function auditMedia(byteLength: number, options: AuditOptions & { scope: 'audio' | 'video' }): AuditResult {
  return grade(measureMedia(byteLength), options)
}
