import { z } from 'zod'
import { HexColorSchema } from './primitives.js'

/**
 * v1.0 · 雾。**独立块 `meta.fog`，刻意不并进 `meta.effects`**（冲突登记 X-01 · D30）。
 *
 * Fog is not post-processing. It is a material property three applies during the ordinary
 * render, so it costs nothing extra, needs no `EffectComposer`, and survives a transparent
 * capture (fog paints on the object's pixels; the background stays alpha 0). Outline is the
 * opposite on all three counts. Merging them would tie the cheap path to the expensive
 * decision — the consumers, the cost and the capture ruling all differ.
 */

export const FOG_TYPES = ['linear', 'exp2'] as const
export const FogTypeSchema = z.enum(FOG_TYPES)
export type FogType = z.infer<typeof FogTypeSchema>

export const FogSchema = z
  .object({
    /** Off by default — an existing document must look **exactly** as it did in v2. */
    enabled: z.boolean().default(false),
    type: FogTypeSchema.default('linear'),
    /** Same as the default background, so enabling fog does not reveal a seam at the horizon. */
    color: HexColorSchema.default('#1a1a1a'),
    /**
     * `near` / `far` are kept even while `type` is `exp2`, and `density` while `linear`.
     *
     * No discriminated union on purpose: switching to `exp2` and back must not lose the
     * numbers the author already tuned. A union would drop them on the first switch.
     */
    near: z.number().min(0).default(10),
    far: z.number().min(0).default(100),
    /** `exp2` only. */
    density: z.number().min(0).max(1).default(0.02),
  })
  .strict()
export type Fog = z.infer<typeof FogSchema>

/**
 * ⚠ **10 / 100 are decided, not measured.** G0.5-8's target-machine benchmark is still open
 * (ADR-0022, re-hung as v1.0's exit gate H1). Do not cite them as findings.
 */
export const DEFAULT_FOG: Fog = {
  enabled: false,
  type: 'linear',
  color: '#1a1a1a',
  near: 10,
  far: 100,
  density: 0.02,
}
