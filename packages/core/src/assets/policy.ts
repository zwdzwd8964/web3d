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
}

/** A measurement is flagged "接近上限" once it passes this fraction of the limit. */
export const WARN_RATIO = 0.8

export interface MetricSpec {
  readonly metric: string
  readonly label: string
  readonly limit: (policy: AssetPolicy) => number
  readonly unit: 'count' | 'bytes' | 'px'
  /** Concrete, actionable Chinese. "4K 降 2K", never "请优化". */
  readonly advice: (value: number, limit: number) => string
}

export const METRICS: readonly MetricSpec[] = [
  {
    metric: 'bytes',
    label: '文件大小',
    limit: (p) => p.maxBytes,
    unit: 'bytes',
    advice: (v, l) => `文件 ${formatBytes(v)} 超出 ${formatBytes(l)}。建议启用 Draco 几何压缩与 KTX2 贴图压缩后重新导出。`,
  },
  {
    metric: 'tris',
    label: '三角面数',
    limit: (p) => p.maxTriangles,
    unit: 'count',
    advice: (v, l) =>
      `面数 ${formatCount(v)} 超出 ${formatCount(l)}。建议在建模软件中减面，或删除不参与演示的内部结构（管道内壁、螺纹）。`,
  },
  {
    metric: 'materials',
    label: '材质数量',
    limit: (p) => p.maxMaterials,
    unit: 'count',
    advice: (v, l) => `材质 ${formatCount(v)} 种超出 ${formatCount(l)}。建议合并参数相同的材质；材质数直接放大绘制批次。`,
  },
  {
    metric: 'textures',
    label: '贴图数量',
    limit: (p) => p.maxTextures,
    unit: 'count',
    advice: (v, l) => `贴图 ${formatCount(v)} 张超出 ${formatCount(l)}。建议合并为图集，或移除未被任何材质引用的贴图。`,
  },
  {
    metric: 'textureBytes',
    label: '贴图显存占用',
    limit: (p) => p.maxTextureBytes,
    unit: 'bytes',
    advice: (v, l) =>
      `贴图显存约 ${formatBytes(v)} 超出 ${formatBytes(l)}。建议将 4K 贴图降至 2K，或转为 KTX2；这是移动端与集显崩溃的首要原因。`,
  },
  {
    metric: 'maxTextureSize',
    label: '单张贴图最大边长',
    limit: (p) => p.maxTextureSize,
    unit: 'px',
    advice: (v, l) => `存在 ${formatCount(v)} px 的贴图，超出 ${formatCount(l)} px。超过此值在国产浏览器内核上支持不稳定。`,
  },
  {
    metric: 'nodes',
    label: '对象数量',
    limit: (p) => p.maxNodes,
    unit: 'count',
    advice: (v, l) => `对象 ${formatCount(v)} 个超出 ${formatCount(l)}。建议在导出前合并零件层级；对象数影响层级树与拾取性能。`,
  },
]

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
export function describePolicy(policy: AssetPolicy = DEFAULT_POLICY): string {
  return METRICS.map((m) => `${m.label} ≤ ${formatMetric(m.limit(policy), m.unit)}`).join('\n')
}
