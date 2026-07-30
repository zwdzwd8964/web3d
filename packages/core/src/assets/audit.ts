import type { AssetAudit, AssetStats, AuditFinding, AuditLevel } from '@w3/schema'
import { Document, WebIO } from '@gltf-transform/core'
import type { AssetPolicy } from './policy.js'
import { DEFAULT_POLICY, METRICS, WARN_RATIO, formatMetric } from './policy.js'

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
}

/** Decoded VRAM for one mip chain: w*h*4 bytes, plus ~1/3 again for the mipmaps. */
export function estimateTextureBytes(width: number, height: number): number {
  return Math.round(width * height * 4 * (4 / 3))
}

/** Reads a GLB into a gltf-transform document. Isomorphic — works in Node and browsers. */
export async function readGlb(bytes: ArrayBuffer): Promise<Document> {
  const io = new WebIO()
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

  const findings: AuditFinding[] = METRICS.map((spec) => {
    const value = (measurements as unknown as Record<string, number>)[spec.metric] ?? 0
    const limit = spec.limit(policy)
    const level: AuditLevel = value > limit ? 'fail' : value > limit * WARN_RATIO ? 'warn' : 'pass'
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

  const { maxTextureSize: _dropped, ...stats } = measurements
  void _dropped

  return {
    stats,
    measurements,
    audit: { checkedAt: now(), policyId: policy.id, findings },
    verdict,
    failing,
    summary,
  }
}

/** Read, measure and grade in one call — what the import pipeline uses. */
export async function auditGlb(bytes: ArrayBuffer, options: AuditOptions = {}): Promise<AuditResult> {
  const document = await readGlb(bytes)
  return grade(measure(document, bytes.byteLength), options)
}

const labelOf = (finding: AuditFinding) => METRICS.find((m) => m.metric === finding.metric)?.label ?? finding.metric
const unitOf = (finding: AuditFinding) => METRICS.find((m) => m.metric === finding.metric)?.unit ?? 'count'
