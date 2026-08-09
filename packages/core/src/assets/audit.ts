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

/**
 * Extra measurements the schema's AssetStats does not carry but the policy checks.
 *
 * ⚠ **这些键绝不能进 `AssetStats`。** `AssetStatsSchema` 是 `.strict()`，而
 * `checkIntegrity` 不重跑 schema 校验——多一个测量键的后果是「编辑器全绿、发布闸门拒绝」
 * （T-176 实测过一次）。测量是过程，stats 是文档字段，两者的生命周期不同。
 */
export interface AuditMeasurements extends AssetStats {
  /** Longest edge of the largest texture, in pixels. */
  readonly maxTextureSize: number
  /** 指向包外文件的 buffer / image 个数（`.bin` 与散图）。非 0 就意味着这份资产不自洽。 */
  readonly externalRefs: number
  /** `extensionsRequired` 里我们读不了的那些（meshopt 等）。非 0 就意味着打开会失败。 */
  readonly unsupportedExtensions: number
  /** 同一批贴图按未压缩（rgba8）算出来的显存。与 `textureBytes` 的比值就是压缩收益。 */
  readonly textureBytesFallback: number
  /** KTX2 贴图张数。为 0 时「压缩收益」那条指标不适用。 */
  readonly compressedTextureCount: number
}

/** 贴图在显存里的格式。bpp 差 4~8 倍，按 rgba8 一刀切会让 KTX2 的收益完全看不见。 */
export type TextureFormat = 'rgba8' | 'etc1s' | 'uastc'

const TEXTURE_BPP: Record<TextureFormat, number> = { rgba8: 32, etc1s: 4, uastc: 8 }

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

/**
 * Decoded VRAM for one mip chain: `w*h*bpp/8` bytes, plus ~1/3 again for the mipmaps.
 *
 * `format` 默认 `rgba8`，且那一支与旧式 `w*h*4*(4/3)` **逐字节相同**（4 === 32/8）——
 * 有一条对拍断言钉住这一点，因为所有历史阈值都是按旧公式定的。
 */
export function estimateTextureBytes(width: number, height: number, format: TextureFormat = 'rgba8'): number {
  return Math.round(width * height * (TEXTURE_BPP[format] / 8) * (4 / 3))
}

/**
 * 每条动画片段的时长，从 sampler 的输入访问器量出来。
 *
 * **一条 animation 的时长是它所有 sampler 输入时间的最大值。** 不同 sampler 可以在不同
 * 时刻结束（位置轨道到 2.4 秒、旋转轨道到 1.8 秒），播放器播的是最长的那条。
 *
 * ⚠ 这里改正了一条我自己写错的注释：T-225 在这个位置留了「时长拿不到，要解 BIN chunk」。
 * **不对**——访问器自带 `max`，glTF 规范要求 animation input 必须有它，gltf-transform
 * 直接给得出来。那条注释还被抄进了 `docs/METRICS.md` 的趋势观察点。
 */
function clipDurationsOf(document: Document): Record<string, number> {
  const out: Record<string, number> = {}
  for (const animation of document.getRoot().listAnimations()) {
    let duration = 0
    // **从 channel 走到 sampler，不用 `listSamplers()`。** 后者只列出被这个 Animation
    // 直接持有的 sampler；实测在 gltf-transform 读回来的文档上它是空的，而 channel
    // 一侧的 `getSampler()` 有值——于是时长会静默变成 0，而 `stats.animations` 照样对。
    for (const channel of animation.listChannels()) {
      const input = channel.getSampler()?.getInput()
      if (!input) continue
      const max = input.getMax([])[0]
      if (typeof max === 'number' && Number.isFinite(max)) duration = Math.max(duration, max)
    }
    const name = animation.getName()
    // 同名片段取较大值：glTF 不保证 name 唯一，而 `stats.animations` 也是按 name 存的
    out[name] = Math.max(out[name] ?? 0, duration)
  }
  return out
}

/**
 * 贴图的显存格式。
 *
 * KTX2 的 `supercompressionScheme`（头部偏移 44 的 uint32）为 1 时是 BasisLZ/ETC1S，
 * 否则按 UASTC 算。两者 bpp 差一倍，而与 rgba8 差 8 倍与 4 倍——这正是「压缩收益」
 * 那条指标要说的事。
 */
function textureFormatOf(texture: { getMimeType(): string | null; getImage(): Uint8Array | null }): TextureFormat {
  if (texture.getMimeType() !== 'image/ktx2') return 'rgba8'
  const image = texture.getImage()
  if (!image || image.byteLength < 48) return 'uastc'
  // 逐字节读而不是 `new DataView(image.buffer, …)`：`getImage()` 在不同宿主上给回来的
  // 底层缓冲区类型不一样（Node 的 Buffer 视图会让 DataView 构造直接抛）。
  const scheme = image[44]! | (image[45]! << 8) | (image[46]! << 16) | (image[47]! << 24)
  return scheme === 1 ? 'etc1s' : 'uastc'
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
/**
 * 我们真的读得了的必需扩展。**白名单，不是黑名单。**
 *
 * 黑名单的失效方式是安静的：明年出一个新的必需扩展，它不在黑名单里，于是被判成
 * 「支持」，而用户拿到的是一个打不开的文件。
 */
export const SUPPORTED_REQUIRED_EXTENSIONS = new Set([
  'KHR_draco_mesh_compression',
  'KHR_texture_basisu',
  'KHR_materials_unlit',
  'KHR_texture_transform',
])

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
  let textureBytesFallback = 0
  let compressedTextureCount = 0
  let maxTextureSize = 0
  for (const texture of root.listTextures()) {
    const size = texture.getSize()
    if (!size) continue
    const [width, height] = size
    const format = textureFormatOf(texture)
    if (format !== 'rgba8') compressedTextureCount++
    textureBytes += estimateTextureBytes(width, height, format)
    // 同一批贴图按未压缩算一遍。两个数的比值就是压缩买到了什么，
    // 而单看 textureBytes 说不出「已经压过了」还是「本来就小」。
    textureBytesFallback += estimateTextureBytes(width, height, 'rgba8')
    maxTextureSize = Math.max(maxTextureSize, width, height)
  }

  // 指向包外的引用。一份带外部 .bin 的 glTF 拷给客户就是打不开，而它自己完全「有效」。
  const isExternal = (uri: string | null) => uri !== null && uri !== '' && !uri.startsWith('data:')
  const externalRefs =
    root.listBuffers().filter((b) => isExternal(b.getURI())).length +
    root.listTextures().filter((t) => isExternal(t.getURI())).length

  // `extensionsRequired` 里我们读不了的那些。必需扩展读不了 = 整个文件打不开。
  const unsupportedExtensions = root
    .listExtensionsRequired()
    .filter((e) => !SUPPORTED_REQUIRED_EXTENSIONS.has(e.extensionName)).length

  return {
    tris,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    bytes: byteLength,
    textureBytes,
    nodes: root.listNodes().length,
    animations: root.listAnimations().map((a) => a.getName()),
    clipDurations: clipDurationsOf(document),
    maxTextureSize,
    externalRefs,
    unsupportedExtensions,
    textureBytesFallback,
    compressedTextureCount,
  }
}

/** Grades measurements against a policy and produces the stored audit record. */
export function grade(measurements: AuditMeasurements, options: AuditOptions = {}): AuditResult {
  const policy = options.policy ?? DEFAULT_POLICY
  const now = options.now ?? (() => new Date().toISOString())

  const findings: AuditFinding[] = metricsFor(options.scope ?? 'model')
    // `applicable` 缺省恒真。**过滤发生在算 finding 之前**：不适用的指标应当整条不出现，
    // 而不是出现且 pass —— 后者在报告里读起来像「测过了，没问题」，那是另一个意思。
    .filter((spec) => spec.applicable?.(measurements) ?? true)
    .map((spec) => {
    // `measured` 在的话走它（类型检查得到的读取），否则按 metric 同名取。
    // 后一条是历史指标的路，它的失效方式是安静的：metric 拼错 → undefined → `?? 0`
    // → 报告里一条「0，通过」。
    const value = spec.measured?.(measurements) ?? (measurements as unknown as Record<string, number>)[spec.metric] ?? 0
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
    // T-234 · 之前这里是写死的 `{}` —— 白名单把测量结果挡在了文档外面，于是
    // `measure()` 量得再准，`stats.clipDurations` 也永远是空表。**白名单的代价就在这里**：
    // 它拦住了泄漏，也拦住了新字段，而两者的症状完全不同（前者发布失败，后者静默为空）。
    clipDurations: { ...measurements.clipDurations },
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
    clipDurations: {},
    maxTextureSize: Math.max(info.width, info.height),
    externalRefs: 0,
    unsupportedExtensions: 0,
    textureBytesFallback: 0,
    compressedTextureCount: 0,
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
    clipDurations: {},
    maxTextureSize: 0,
    externalRefs: 0,
    unsupportedExtensions: 0,
    textureBytesFallback: 0,
    compressedTextureCount: 0,
    audioBytes: byteLength,
    videoBytes: byteLength,
  }
}

/** Grades an audio or video file against its scope's one limit. */
export function auditMedia(byteLength: number, options: AuditOptions & { scope: 'audio' | 'video' }): AuditResult {
  return grade(measureMedia(byteLength), options)
}

/* ========================================================================== */
/* T-261 · 重新体检（只读）                                                    */
/* ========================================================================== */

/** 一次重新判级的结果：收检时的那份结论，和按今天的阈值重算的那份。 */
export interface RegradeResult {
  /** 文档里存着的那一份，**逐字节原样返回**，没有被重新计算过。 */
  readonly stored: AssetAudit
  /** 按传入 policy 重算的结论。**不写文档**——它是一个视图，不是一次编辑。 */
  readonly current: AuditResult
  /** 两次判级的结论是否不同。true 就意味着阈值在这中间改过。 */
  readonly changed: boolean
  /** 两句中文，直接给报告顶部用。 */
  readonly notes: readonly string[]
}

/**
 * 按今天的阈值，用**已存的 stats** 重新判一次级。
 *
 * ## 为什么不重读字节
 *
 * 资产的字节可能已经不在本地了——用户换了台机器、清了缓存、或者这份文档是别人发来的。
 * 「重新体检」如果需要原文件，那它在最需要用到的时候恰好用不了。而重新判级要的只是
 * 「这些数字对上今天的上限是什么结论」，那些数字早就存在 `asset.stats` 里。
 *
 * 代价写清楚：**它只能重判阈值，不能发现新的测量维度**。v0.5 之后新增的指标（贴图显存、
 * 单张贴图边长）在老资产的 `stats` 里没有，重判时按 0 处理，报告里会是「0，通过」——
 * 那不是真的通过，是没测过。所以两句话里第二句必须写明「按当前阈值重算」，而不是
 * 「重新体检」——后者暗示重新测量了。
 *
 * @param stats 文档里存着的测量结果
 * @param stored 文档里存着的体检结论。原样返回，**一个字节都不动**
 * @param options 判级用的 policy 与时钟
 */
export function regrade(stats: AssetStats, stored: AssetAudit, options: AuditOptions = {}): RegradeResult {
  // 缺失的维度补 0 而不是补上限：补上限会让老资产在报告里显示「刚好卡线通过」，
  // 那比「0」更容易被当成真的测过了。
  const measurements: AuditMeasurements = {
    ...stats,
    maxTextureSize: 0,
    externalRefs: 0,
    unsupportedExtensions: 0,
    textureBytesFallback: 0,
    compressedTextureCount: 0,
  }
  const current = grade(measurements, options)
  const storedVerdict = verdictOf(stored.findings)

  return {
    stored,
    current,
    changed: storedVerdict !== current.verdict,
    notes: [
      `收检时（${stored.checkedAt.slice(0, 10)}，阈值 ${stored.policyId}）：${describeVerdict(storedVerdict, stored.findings)}`,
      `按当前阈值（${current.audit.policyId}）重算：${current.summary}`,
    ],
  }
}

/** 一组 finding 的总结论。fail 压过 warn，warn 压过 pass。 */
function verdictOf(findings: readonly AuditFinding[]): AuditLevel {
  if (findings.some((f) => f.level === 'fail')) return 'fail'
  return findings.some((f) => f.level === 'warn') ? 'warn' : 'pass'
}

/** 一句中文结论，形状与 `grade` 的 `summary` 一致，好让两句话读起来是同一种东西。 */
function describeVerdict(verdict: AuditLevel, findings: readonly AuditFinding[]): string {
  const failing = findings.filter((f) => f.level === 'fail')
  const warning = findings.filter((f) => f.level === 'warn')
  if (verdict === 'pass') return `体检通过：${findings.length} 项全部在规范范围内。`
  if (verdict === 'warn') return `体检通过，但 ${warning.length} 项接近上限：${warning.map(labelOf).join('、')}。`
  return `体检未通过：${failing.length} 项超标 —— ${failing.map(labelOf).join('、')}。`
}
