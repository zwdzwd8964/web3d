import type { AssetStats } from './assets.js'

/**
 * R01 · asset limits, in one place, as numbers.
 *
 * These constants do double duty. Technically they are the import health check —
 * the only real defence against a customer handing over a CAD export that no
 * architecture can save. Commercially they are the draft of Appendix A: the numbers
 * below are literally what gets written into the contract as the precondition for
 * every performance acceptance criterion (contract clause §6.3).
 *
 * Which is why they live here and not scattered through the importer: when the
 * customer's real hardware forces a change, exactly one file moves, and Appendix A
 * is regenerated from it.
 */

export interface AssetPolicy {
  readonly maxBytes: number
  readonly maxTriangles: number
  readonly maxDrawCalls: number
  readonly maxMaterials: number
  readonly maxTextures: number
  /** Decoded texture memory, not file size. This is what exhausts a GPU. */
  readonly maxTextureBytes: number
  readonly maxTextureSize: number
  readonly maxNodes: number
}

export const DEFAULT_ASSET_POLICY: AssetPolicy = {
  maxBytes: 60 * 1024 * 1024,
  maxTriangles: 300_000,
  maxDrawCalls: 300,
  maxMaterials: 60,
  maxTextures: 40,
  maxTextureBytes: 128 * 1024 * 1024,
  maxTextureSize: 2048,
  maxNodes: 5_000,
}

/** A measurement is flagged "接近上限" once it passes this fraction of the limit. */
export const WARN_RATIO = 0.8

export type AssetVerdict = 'pass' | 'warn' | 'fail'

export interface AssetCheckLine {
  readonly key: string
  readonly label: string
  readonly actual: number
  readonly limit: number
  readonly unit: 'count' | 'bytes' | 'px'
  readonly verdict: AssetVerdict
  /** Concrete next step, not "consider optimising". */
  readonly advice: string
}

export interface AssetHealthReport {
  readonly verdict: AssetVerdict
  readonly lines: readonly AssetCheckLine[]
  readonly failing: readonly AssetCheckLine[]
  readonly summary: string
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

function formatValue(n: number, unit: AssetCheckLine['unit']): string {
  if (unit === 'bytes') return formatBytes(n)
  if (unit === 'px') return `${formatCount(n)} px`
  return formatCount(n)
}

interface LineSpec {
  key: string
  label: string
  actual: number
  limit: number
  unit: AssetCheckLine['unit']
  advice: string
}

export function evaluateAsset(stats: AssetStats, policy: AssetPolicy = DEFAULT_ASSET_POLICY): AssetHealthReport {
  const specs: LineSpec[] = [
    {
      key: 'bytes',
      label: '文件大小',
      actual: stats.bytes,
      limit: policy.maxBytes,
      unit: 'bytes',
      advice: '启用 Draco 几何压缩与 KTX2 贴图压缩后重新导出',
    },
    {
      key: 'triangles',
      label: '三角面数',
      actual: stats.triangles,
      limit: policy.maxTriangles,
      unit: 'count',
      advice: '在建模软件中减面，或删除不参与演示的内部结构',
    },
    {
      key: 'drawCalls',
      label: '绘制批次',
      actual: stats.drawCalls,
      limit: policy.maxDrawCalls,
      unit: 'count',
      advice: '合并使用同一材质的网格；批次数比面数更直接决定帧率',
    },
    {
      key: 'materials',
      label: '材质数量',
      actual: stats.materials,
      limit: policy.maxMaterials,
      unit: 'count',
      advice: '合并参数相同的材质；材质数直接放大绘制批次',
    },
    {
      key: 'textures',
      label: '贴图数量',
      actual: stats.textures,
      limit: policy.maxTextures,
      unit: 'count',
      advice: '合并为图集，或移除未被任何材质引用的贴图',
    },
    {
      key: 'textureBytes',
      label: '贴图显存占用',
      actual: stats.textureBytes,
      limit: policy.maxTextureBytes,
      unit: 'bytes',
      advice: '降低贴图分辨率或转 KTX2；这是移动端与集显崩溃的首要原因',
    },
    {
      key: 'maxTextureSize',
      label: '单张贴图最大边长',
      actual: stats.maxTextureSize,
      limit: policy.maxTextureSize,
      unit: 'px',
      advice: `缩放到 ${policy.maxTextureSize} px 以内；超过此值在国产浏览器内核上支持不稳定`,
    },
    {
      key: 'nodes',
      label: '对象数量',
      actual: stats.nodes,
      limit: policy.maxNodes,
      unit: 'count',
      advice: '在导出前合并零件层级；对象数影响层级树与拾取性能',
    },
  ]

  const lines: AssetCheckLine[] = specs.map((s) => {
    const verdict: AssetVerdict = s.actual > s.limit ? 'fail' : s.actual > s.limit * WARN_RATIO ? 'warn' : 'pass'
    return {
      key: s.key,
      label: s.label,
      actual: s.actual,
      limit: s.limit,
      unit: s.unit,
      verdict,
      advice: verdict === 'pass' ? '' : s.advice,
    }
  })

  const failing = lines.filter((l) => l.verdict === 'fail')
  const warning = lines.filter((l) => l.verdict === 'warn')
  const verdict: AssetVerdict = failing.length > 0 ? 'fail' : warning.length > 0 ? 'warn' : 'pass'

  const summary =
    verdict === 'pass'
      ? `体检通过：${lines.length} 项全部在规范范围内。`
      : verdict === 'warn'
        ? `体检通过，但 ${warning.length} 项接近上限：${warning.map((l) => l.label).join('、')}。`
        : `体检未通过：${failing.length} 项超标 —— ${failing
            .map((l) => `${l.label} ${formatValue(l.actual, l.unit)}（限 ${formatValue(l.limit, l.unit)}）`)
            .join('；')}。`

  return { verdict, lines, failing, summary }
}

/** Renders the numbers behind Appendix A, so the contract annex is never hand-typed. */
export function describePolicy(policy: AssetPolicy = DEFAULT_ASSET_POLICY): string {
  return [
    `单文件大小 ≤ ${formatBytes(policy.maxBytes)}`,
    `三角面数 ≤ ${formatCount(policy.maxTriangles)}`,
    `绘制批次 ≤ ${formatCount(policy.maxDrawCalls)}`,
    `材质数量 ≤ ${formatCount(policy.maxMaterials)}`,
    `贴图数量 ≤ ${formatCount(policy.maxTextures)}`,
    `贴图显存 ≤ ${formatBytes(policy.maxTextureBytes)}`,
    `单张贴图边长 ≤ ${formatCount(policy.maxTextureSize)} px`,
    `对象数量 ≤ ${formatCount(policy.maxNodes)}`,
  ].join('\n')
}
