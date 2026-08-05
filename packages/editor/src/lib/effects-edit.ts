import type { Fog, OutlineEffect, SceneDocument } from '@w3/schema'

/**
 * T-239 · 场景效果（雾 / 描边）的 commit 构造器。
 *
 * 形状与 `lib/environment-edit.ts` 逐字同形：每个函数收一份 immer draft，整块替换
 * `meta.fog`。**整块替换而不是逐字段赋值**——`meta.fog` 是一个原子的配置块，
 * 逐字段改会产生一串 patch，而 `applyMeta` 那条 fallthrough 对每一条都要跑一次
 * `syncScene`（拖一次滑块跑几十次）。
 */

/** 开 / 关雾。**不动其余字段**——关掉再打开应当回到原来的参数。 */
export function setFogEnabled(draft: SceneDocument, enabled: boolean): void {
  draft.meta.fog = { ...draft.meta.fog, enabled }
}

/**
 * 切换雾的类型。
 *
 * **不清空另一组数值**（`fog.ts` 明确要求）：`linear` 用 near/far、`exp2` 用 density，
 * 而在两者之间来回切是调参时最常见的动作。清空的话，切过去再切回来，用户调好的
 * near/far 就没了。
 */
export function setFogType(draft: SceneDocument, type: Fog['type']): void {
  draft.meta.fog = { ...draft.meta.fog, type }
}

/** 改一组雾参数。 */
export function setFogParams(
  draft: SceneDocument,
  patch: Partial<Pick<Fog, 'color' | 'near' | 'far' | 'density'>>,
): void {
  draft.meta.fog = { ...draft.meta.fog, ...patch }
}

/**
 * 套用按场景大小估出来的 near / far。
 *
 * 只写 near/far，**顺带把 type 切成 linear**——「按场景大小估算」这个动作只对 linear
 * 有意义（`exp2` 没有 near/far），而估完之后停在 exp2 上会让用户以为按钮没生效。
 */
export function applySuggestedFogRange(draft: SceneDocument, range: { near: number; far: number }): void {
  draft.meta.fog = { ...draft.meta.fog, type: 'linear', near: range.near, far: range.far }
}

/* --- 描边（T-241）--------------------------------------------------------- */

/** 开 / 关描边。**不动其余字段**——关掉再打开应当回到原来的参数（与雾同一条纪律）。 */
export function setOutlineEnabled(draft: SceneDocument, enabled: boolean): void {
  draft.meta.effects.outline = { ...draft.meta.effects.outline, enabled }
}

/**
 * 改一组描边参数。
 *
 * `color` 只作用于**编辑器选中态**与回落色：`highlight.preset` 的颜色永远来自预设表
 * （规划 §4 的字段注释逐字写着 "Never overrides `highlight.preset`"）。面板文案要说清
 * 这一点，否则用户会以为这里能改规则高亮的颜色，改完发现没变。
 */
export function setOutlineParams(
  draft: SceneDocument,
  patch: Partial<Pick<OutlineEffect, 'color' | 'widthPx' | 'strength' | 'hiddenEdge'>>,
): void {
  draft.meta.effects.outline = { ...draft.meta.effects.outline, ...patch }
}
