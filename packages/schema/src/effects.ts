import { z } from 'zod'
import { HexColorSchema } from './primitives.js'

/**
 * v1.0 · 后处理效果。**只有描边**（冲突登记 X-02 · D31）。
 *
 * ⚠ **刻意不含 `bloom` / `ssao` 的占位字段。** 占位字段是承诺：留一个 `bloom: null` 在这里，
 * 下一个读到它的人会把它读成「计划内，只是还没做」，而合同措辞（拍板项 P-9）已经把特效
 * 收窄成「描边、雾等预设效果」，发光 / Bloom / 粒子是**变更项计价**。
 *
 * `outline.enabled` 是整条后处理管线的总开关：为 `false` 时**一个 `RenderTarget` 都不建**。
 * 这一个字段就是「老文档观感逐参数不变」的落点——v2 文档迁上来之后它是 `false`，
 * 于是 composer 根本不构造，帧率与像素都与 v2 逐字相同。
 */

/** How an edge hidden behind geometry is drawn. Closed set — R07's defence line. */
export const HIDDEN_EDGE_MODES = ['hide', 'dim', 'show'] as const
export const HiddenEdgeModeSchema = z.enum(HIDDEN_EDGE_MODES)
export type HiddenEdgeMode = z.infer<typeof HiddenEdgeModeSchema>

export const OutlineEffectSchema = z
  .object({
    /** The whole post-processing pipeline's switch. `false` builds no RenderTarget at all. */
    enabled: z.boolean().default(false),
    /** Editor selection + the fallback. **Never overrides `highlight.preset`.** */
    color: HexColorSchema.default('#ffb020'),
    /**
     * **Approximate** pixels — the panel copy must say 「近似」.
     *
     * The underlying value is a blur-kernel radius, not a pixel width. Promising exactness
     * would be a lie the first time someone measures it.
     */
    widthPx: z.number().min(1).max(8).default(3),
    strength: z.number().min(0).max(5).default(3),
    hiddenEdge: HiddenEdgeModeSchema.default('dim'),
  })
  .strict()
export type OutlineEffect = z.infer<typeof OutlineEffectSchema>

export const DEFAULT_OUTLINE: OutlineEffect = {
  enabled: false,
  color: '#ffb020',
  widthPx: 3,
  strength: 3,
  hiddenEdge: 'dim',
}

export const EffectsSchema = z
  .object({
    outline: OutlineEffectSchema.default(DEFAULT_OUTLINE),
  })
  .strict()
export type Effects = z.infer<typeof EffectsSchema>

export const DEFAULT_EFFECTS: Effects = { outline: DEFAULT_OUTLINE }
