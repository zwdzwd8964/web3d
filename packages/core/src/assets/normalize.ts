import type { AssetNormalized, Meta } from '@w3/schema'
import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Box3 } from 'three'

/**
 * T-051 · SCHEMA_SPEC §5.2 · normalise once at import, convert never at runtime.
 *
 * glTF is defined as metres and Y-up, so a conforming exporter needs nothing done. The
 * cases that need this are CAD and DCC exports that ignored the spec — a Z-up assembly
 * from SolidWorks, or a model authored in millimetres where the pump is 1,200 units tall.
 *
 * The correction is applied to the instantiated ROOT node's transform and recorded in
 * `asset.normalized`, so it stays traceable. It is never re-applied per frame: a runtime
 * unit conversion is a rounding error you get to debug at acceptance.
 */

export type SceneUnit = Meta['unit']
export type UpAxis = Meta['upAxis']

/** Metres per source unit. */
const UNIT_SCALE: Record<SceneUnit, number> = { m: 1, cm: 0.01, mm: 0.001 }

export interface NormalizeInput {
  readonly sourceUnit?: SceneUnit
  readonly sourceUpAxis?: UpAxis
  readonly targetUnit: SceneUnit
  readonly targetUpAxis: UpAxis
}

export interface NormalizeResult {
  readonly record: AssetNormalized
  /** Apply to the root node of the instantiated hierarchy. */
  readonly matrix: Matrix4
}

export function computeNormalization(input: NormalizeInput): NormalizeResult {
  const sourceUnit = input.sourceUnit ?? 'm'
  const sourceUpAxis = input.sourceUpAxis ?? 'Y'

  const scaleApplied = UNIT_SCALE[sourceUnit] / UNIT_SCALE[input.targetUnit]
  const axisRotated = sourceUpAxis !== input.targetUpAxis

  const matrix = new Matrix4()
  if (axisRotated) {
    // Z-up -> Y-up is -90° about X. The reverse is +90°; getting the sign wrong lays the
    // model on its face, which reads as "the model is broken" rather than "the axis is".
    const angle = sourceUpAxis === 'Z' ? -Math.PI / 2 : Math.PI / 2
    matrix.makeRotationX(angle)
  }
  if (scaleApplied !== 1) matrix.scale(new Vector3(scaleApplied, scaleApplied, scaleApplied))

  return { record: { scaleApplied, axisRotated }, matrix }
}

/** The identity record, for an asset that needed nothing. */
export const NO_NORMALIZATION: AssetNormalized = { scaleApplied: 1, axisRotated: false }

/**
 * Guesses the authoring unit from the model's size.
 *
 * Purely advisory — it pre-selects a value in the import dialog rather than deciding.
 * Auto-scaling on a guess is worse than asking: a genuinely 1,200 m site model would be
 * silently shrunk to the size of a shoe.
 */
export function suggestUnit(bounds: Box3): { unit: SceneUnit; confident: boolean; reason: string } {
  const size = bounds.getSize(new Vector3())
  const largest = Math.max(size.x, size.y, size.z)

  if (largest === 0 || !Number.isFinite(largest)) {
    return { unit: 'm', confident: false, reason: '包围盒为空，无法判断单位' }
  }
  if (largest > 500) {
    return { unit: 'mm', confident: largest > 5000, reason: `最长边 ${largest.toFixed(0)} 单位，按米算过大，疑似毫米` }
  }
  if (largest > 50) {
    return { unit: 'cm', confident: false, reason: `最长边 ${largest.toFixed(0)} 单位，疑似厘米` }
  }
  return { unit: 'm', confident: true, reason: `最长边 ${largest.toFixed(2)} 单位，符合米制` }
}

/** Decomposes a matrix into the document's p / r / s triple. */
export function decompose(matrix: Matrix4): {
  p: [number, number, number]
  r: [number, number, number, number]
  s: [number, number, number]
} {
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  return {
    p: [round(position.x), round(position.y), round(position.z)],
    r: [round(quaternion.x), round(quaternion.y), round(quaternion.z), round(quaternion.w)],
    s: [round(scale.x), round(scale.y), round(scale.z)],
  }
}

/** 6 decimals: enough for millimetre precision at building scale, and diffs stay readable. */
const round = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6
  return Object.is(r, -0) ? 0 : r
}
