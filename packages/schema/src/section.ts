import { z } from 'zod'
import { Vec2Schema } from './primitives.js'

/**
 * v1.0 · 剖切平面，作为节点的**第四种承载体**（冲突登记 X-03）。
 *
 * A section plane is a node — same as a light (D12), a primitive and an asset reference.
 * That is what makes it free: it inherits the transform (the plane's position and normal
 * ARE the node's), `visible` is its on/off switch, the hierarchy tree already draws it, and
 * `resetScene` already restores it. **Zero new actions** for the whole feature.
 */

/**
 * Single-member closed enum, on purpose.
 *
 * Adding `'subtree'` would force a schema change, which mechanically triggers triage Q3 —
 * and that is the point: per-subtree clipping means per-material clipping planes, which
 * collides head-on with ADR-0011's material ownership. Making it *look* easy is how that
 * collision gets discovered late.
 */
export const SECTION_SCOPES = ['scene'] as const
export const SectionScopeSchema = z.enum(SECTION_SCOPES)
export type SectionScope = z.infer<typeof SectionScopeSchema>

export const SectionSchema = z
  .object({
    scope: SectionScopeSchema.default('scene'),
    /** 编辑期指示矩形的宽高（米）。不影响剖切结果，只影响你看得见平面在哪。 */
    size: Vec2Schema.default([4, 4]),
  })
  .strict()
export type Section = z.infer<typeof SectionSchema>
