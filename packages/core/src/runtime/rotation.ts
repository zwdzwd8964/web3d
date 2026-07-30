import type { Quat, Vec3 } from '@w3/schema'
import { Euler, Quaternion } from 'three'

/**
 * T-064 · the UI shows Euler angles; the document stores a quaternion.
 *
 * Lives in @w3/core rather than in the editor because CLAUDE.md's boundary table forbids
 * the editor from importing three directly — and because there must be exactly one
 * conversion. A second implementation in the panel would drift from what the runtime
 * does with the same quaternion, and the symptom would be an object that snaps when you
 * click into the rotation field.
 *
 * SCHEMA_SPEC §4.1-3 is explicit that Euler angles must not be persisted — they carry
 * gimbal lock and interpolation ambiguity into the data. But nobody types quaternions,
 * so the property panel converts at its own edge.
 *
 * The conversion is not symmetric: many Euler triples map to the same rotation, so
 * `toEuler(toQuaternion(e))` need not return `e` — it returns an equivalent rotation.
 * That matters for the panel: reading the field back after every keystroke would make
 * the number jump under the user's cursor, so the panel keeps its own draft while
 * focused (see PropertiesPanel).
 */

const DEG = 180 / Math.PI
const RAD = Math.PI / 180

const _q = new Quaternion()
const _e = new Euler()

/** Document quaternion -> degrees, XYZ order. */
export function toEulerDegrees(q: Quat): Vec3 {
  _q.set(q[0], q[1], q[2], q[3]).normalize()
  _e.setFromQuaternion(_q, 'XYZ')
  return [round(_e.x * DEG), round(_e.y * DEG), round(_e.z * DEG)]
}

/** Degrees, XYZ order -> document quaternion. */
export function fromEulerDegrees(euler: Vec3): Quat {
  _e.set(euler[0] * RAD, euler[1] * RAD, euler[2] * RAD, 'XYZ')
  _q.setFromEuler(_e).normalize()
  return [round(_q.x), round(_q.y), round(_q.z), round(_q.w)]
}

/** True when two quaternions describe the same rotation (q and -q do). */
export function sameRotation(a: Quat, b: Quat, epsilon = 1e-6): boolean {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  return Math.abs(Math.abs(dot) - 1) < epsilon
}

export const IDENTITY_QUAT: Quat = [0, 0, 0, 1]

/** 6 decimals: below any visible difference, and keeps document diffs readable. */
function round(n: number): number {
  const r = Math.round(n * 1e6) / 1e6
  return Object.is(r, -0) ? 0 : r
}
