import type { AuditLevel } from '@w3/schema'

/**
 * T-050 · R01 · asset limits, in one place, as numbers.
 *
 * These constants do double duty. Technically they are the import health check — the
 * only real defence against a customer handing over a CAD export no architecture can
 * save. Commercially they are the draft of Appendix A: these exact numbers become the
 * contractual precondition for every performance acceptance criterion (contract §6.3).
 *
 * Which is why they live in one file and not scattered through the importer: when the
 * customer's real hardware forces a change, exactly one file moves and Appendix A is
 * regenerated from it (T-113).
 */

export interface AssetPolicy {
  readonly id: string
  readonly maxBytes: number
  readonly maxTriangles: number
  readonly maxMaterials: number
  readonly maxTextures: number
  /** Decoded VRAM, not file size. This is what exhausts a GPU. */
  readonly maxTextureBytes: number
  readonly maxTextureSize: number
  readonly maxNodes: number
  /** v0.5 · a standalone png/jpg/webp/ktx2 imported as a texture. */
  readonly maxImageBytes: number
  /** v0.5 · a standalone `.hdr` imported as an environment map. */
  readonly maxHdriBytes: number
  /** v0.5 · an audio file. Small on purpose: it downloads before anyone hears it. */
  readonly maxAudioBytes: number
  /** v0.5 · a video file. */
  readonly maxVideoBytes: number
}

export const DEFAULT_POLICY: AssetPolicy = {
  id: 'default-v1',
  maxBytes: 60 * 1024 * 1024,
  maxTriangles: 300_000,
  maxMaterials: 60,
  maxTextures: 40,
  maxTextureBytes: 128 * 1024 * 1024,
  maxTextureSize: 2048,
  maxNodes: 5_000,

  // v0.5 · standalone image and environment imports (T-150). Provisional: 附件A §7 is
  // regenerated from this file (T-175), and these two numbers are the ones H3's weak-machine
  // run is most likely to move. They are deliberately generous — a texture that fits in
  // `maxTextureSize` is already bounded in VRAM, and this limit is about download and
  // decode time, not about the GPU.
  maxImageBytes: 8 * 1024 * 1024,
  maxHdriBytes: 32 * 1024 * 1024,

  // v0.5 · media (T-160). Both are about WAITING, not about the GPU: a narration clip is
  // heard once and a video plays inside a hotspot panel the size of a postcard, so the
  // limits are set where the download stops being unnoticeable on a slow internal network.
  maxAudioBytes: 10 * 1024 * 1024,
  maxVideoBytes: 50 * 1024 * 1024,
}

/** A measurement is flagged "接近上限" once it passes this fraction of the limit. */
export const WARN_RATIO = 0.8

/**
 * v0.5 · which kind of asset a metric applies to.
 *
 * Before v0.5 every asset was a model, so one flat metric list was the whole story. A PNG
 * graded against `maxTriangles` reports "三角面数 0 / 300,000 通过", which is not wrong and
 * is exactly the kind of noise that teaches people to stop reading the report.
 */
export type PolicyScope = 'model' | 'image' | 'hdri' | 'audio' | 'video'

export interface MetricSpec {
  readonly metric: string
  readonly label: string
  readonly limit: (policy: AssetPolicy) => number
  readonly unit: 'count' | 'bytes' | 'px'
  /** Which asset kinds this metric is measured for. */
  readonly scopes: readonly PolicyScope[]
  /** Concrete, actionable Chinese. "4K 降 2K", never "请优化". */
  readonly advice: (value: number, limit: number) => string
  /**
   * Overrides the default `value > limit ? fail : value > limit * WARN_RATIO ? warn : pass`.
   *
   * Needed for checks that are not a threshold at all — "is this a power of two" is a
   * yes/no question, and forcing it into a comparison would make the stored `limit` a lie.
   */
  readonly level?: (value: number, limit: number) => AuditLevel
}

export const METRICS: readonly MetricSpec[] = [
  {
    metric: 'bytes',
    label: '文件大小',
    limit: (p) => p.maxBytes,
    unit: 'bytes',
    scopes: ['model'],
    advice: (v, l) => `文件 ${formatBytes(v)} 超出 ${formatBytes(l)}。建议启用 Draco 几何压缩与 KTX2 贴图压缩后重新导出。`,
  },
  {
    metric: 'tris',
    label: '三角面数',
    limit: (p) => p.maxTriangles,
    unit: 'count',
    scopes: ['model'],
    advice: (v, l) =>
      `面数 ${formatCount(v)} 超出 ${formatCount(l)}。建议在建模软件中减面，或删除不参与演示的内部结构（管道内壁、螺纹）。`,
  },
  {
    metric: 'materials',
    label: '材质数量',
    limit: (p) => p.maxMaterials,
    unit: 'count',
    scopes: ['model'],
    advice: (v, l) => `材质 ${formatCount(v)} 种超出 ${formatCount(l)}。建议合并参数相同的材质；材质数直接放大绘制批次。`,
  },
  {
    metric: 'textures',
    label: '贴图数量',
    limit: (p) => p.maxTextures,
    unit: 'count',
    scopes: ['model'],
    advice: (v, l) => `贴图 ${formatCount(v)} 张超出 ${formatCount(l)}。建议合并为图集，或移除未被任何材质引用的贴图。`,
  },
  {
    metric: 'textureBytes',
    label: '贴图显存占用',
    limit: (p) => p.maxTextureBytes,
    unit: 'bytes',
    scopes: ['model'],
    advice: (v, l) =>
      `贴图显存约 ${formatBytes(v)} 超出 ${formatBytes(l)}。建议将 4K 贴图降至 2K，或转为 KTX2；这是移动端与集显崩溃的首要原因。`,
  },
  {
    metric: 'maxTextureSize',
    label: '单张贴图最大边长',
    limit: (p) => p.maxTextureSize,
    unit: 'px',
    scopes: ['model'],
    advice: (v, l) => `存在 ${formatCount(v)} px 的贴图，超出 ${formatCount(l)} px。超过此值在国产浏览器内核上支持不稳定。`,
  },
  /* --- v0.5 · standalone images and environment maps (T-150) --------------- */
  {
    metric: 'imageBytes',
    label: '图片文件大小',
    limit: (p) => p.maxImageBytes,
    unit: 'bytes',
    scopes: ['image'],
    advice: (v, l) =>
      `图片 ${formatBytes(v)} 超出 ${formatBytes(l)}。建议改存 JPEG（无透明通道时）或转 KTX2；贴图的下载时间直接变成用户打开场景的等待时间。`,
  },
  /* --- v0.5 · media (T-160) ------------------------------------------------ */
  {
    metric: 'audioBytes',
    label: '音频文件大小',
    limit: (p) => p.maxAudioBytes,
    unit: 'bytes',
    scopes: ['audio'],
    advice: (v, l) =>
      `音频 ${formatBytes(v)} 超出 ${formatBytes(l)}。建议转 MP3 128kbps 单声道（讲解语音用不到立体声），或把长录音拆成按步骤触发的短段——用户听到第一个字之前要等的就是这段下载。`,
  },
  {
    metric: 'videoBytes',
    label: '视频文件大小',
    limit: (p) => p.maxVideoBytes,
    unit: 'bytes',
    scopes: ['video'],
    advice: (v, l) =>
      `视频 ${formatBytes(v)} 超出 ${formatBytes(l)}。建议压到 720p / H.264，码率 2Mbps 上下；视频在热点面板里播放，尺寸远小于原始分辨率，多出来的像素只变成等待时间。`,
  },
  {
    metric: 'hdriBytes',
    label: 'HDRI 文件大小',
    limit: (p) => p.maxHdriBytes,
    unit: 'bytes',
    scopes: ['hdri'],
    advice: (v, l) =>
      `环境贴图 ${formatBytes(v)} 超出 ${formatBytes(l)}。建议把全景图降到 2048×1024 后重新导出；IBL 只取低频光照，分辨率对成像的影响远小于对加载时间的影响。`,
  },
  {
    metric: 'imageSize',
    label: '图片最大边长',
    limit: (p) => p.maxTextureSize,
    unit: 'px',
    scopes: ['image', 'hdri'],
    advice: (v, l) => `图片最长边 ${formatCount(v)} px，超出 ${formatCount(l)} px。建议降到 ${formatCount(l)}。`,
  },
  {
    /**
     * Non-power-of-two, as a warning.
     *
     * `value` is 1 when the image is NPOT and 0 when it is not — there is no threshold
     * here, which is why this metric carries its own `level`. WebGL2 samples NPOT textures
     * fine, but mipmap generation for them is where drivers differ, and "the texture looks
     * blurry only on that one machine" is the symptom nobody can reproduce.
     */
    metric: 'nonPowerOfTwo',
    label: '非 2 的幂尺寸',
    limit: () => 0,
    unit: 'count',
    scopes: ['image'],
    level: (value) => (value > 0 ? 'warn' : 'pass'),
    advice: () =>
      '图片尺寸不是 2 的幂。可以正常使用，但 mipmap 生成在不同驱动上表现不一致，建议裁到 1024 / 2048 这类尺寸。',
  },
  {
    metric: 'nodes',
    label: '对象数量',
    limit: (p) => p.maxNodes,
    unit: 'count',
    scopes: ['model'],
    advice: (v, l) => `对象 ${formatCount(v)} 个超出 ${formatCount(l)}。建议在导出前合并零件层级；对象数影响层级树与拾取性能。`,
  },
]

/** The metrics that apply to one kind of asset. `grade` uses this; nothing else should. */
export const metricsFor = (scope: PolicyScope): readonly MetricSpec[] => METRICS.filter((m) => m.scopes.includes(scope))

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export const formatCount = (n: number): string => n.toLocaleString('en-US')

export function formatMetric(value: number, unit: MetricSpec['unit']): string {
  if (unit === 'bytes') return formatBytes(value)
  if (unit === 'px') return `${formatCount(value)} px`
  return formatCount(value)
}

/** Renders the numbers behind Appendix A, so the contract annex is never hand-typed (T-113). */
export function describePolicy(policy: AssetPolicy = DEFAULT_POLICY, scope?: PolicyScope): string {
  // Threshold-less metrics (the NPOT warning) are skipped: 「非 2 的幂尺寸 ≤ 0」 is not a
  // sentence anyone can put in a contract annex.
  const metrics = (scope ? metricsFor(scope) : METRICS).filter((m) => m.level === undefined)
  return metrics.map((m) => `${m.label} ≤ ${formatMetric(m.limit(policy), m.unit)}`).join('\n')
}
