import { z } from 'zod'
import { EasingSchema, Vec3Schema } from './primitives.js'

/**
 * v1.0 · 爆炸视图，**分组模型**（冲突登记 X-04 · D28）。
 *
 * A node with a non-null `explode` **is** an explode group; its members are its DIRECT
 * children. Nothing else carries state: the offsets are derived, and a member may pin its
 * own with `explodeOffset`.
 *
 * ⚠ **X-04 卡面上写的 `explode{mode,dir,distance}` 是残留**，抄自被否决的「每节点爆炸」模型。
 * 分组模型里没有 `dir` / `distance`：方向由 `mode` + `axis` 决定，距离由 `gain` / `spacing`
 * 与逐件的 `explodeOffset` 决定。以本文件为准——否则 D28 的 `explodeOffsets(doc, groupId)`
 * 写不出来。
 */

export const EXPLODE_MODES = ['radial', 'axis'] as const
export const ExplodeModeSchema = z.enum(EXPLODE_MODES)
export type ExplodeMode = z.infer<typeof ExplodeModeSchema>

/** 面板上给人读的。中文——它出现在界面里，不是日志里。 */
export const EXPLODE_MODE_LABELS: Record<ExplodeMode, string> = {
  radial: '径向（以质心为中心散开）',
  axis: '轴向（沿一条轴依次排开）',
}

export const ExplodeSchema = z
  .object({
    mode: ExplodeModeSchema.default('radial'),
    /** radial：factor=1 时锚点相对质心放大 (1 + gain) 倍。 */
    gain: z.number().min(0).max(20).default(1.5),
    /** axis：排布轴，分组根的局部空间；运行时归一化。零向量由 I23 在发布前拦住。 */
    axis: Vec3Schema.default([0, 1, 0]),
    /** axis：相邻名次的间距，factor=1 时的满量程。文档单位（meta.unit）。 */
    spacing: z.number().min(0).max(1000).default(0.5),
    /** 与补间共用同一张封闭表（primitives.ts 的 EASINGS）。 */
    easing: EasingSchema.default('easeInOutCubic'),
  })
  .strict()
export type Explode = z.infer<typeof ExplodeSchema>

/**
 * 「设为爆炸分组」写下去的那一份。
 *
 * 与上面每个字段的 `.default(...)` **同一处真源**——由 zod 自己解析空对象得出，不是
 * 另抄一遍。抄一遍的结果是 schema 改了默认值而面板没跟上，两处各说各的
 * （T-215 的高亮预设正是这么漂的）。
 */
export const DEFAULT_EXPLODE: Explode = ExplodeSchema.parse({})
