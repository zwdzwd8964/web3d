import type { Easing } from '@w3/schema'

/**
 * T-038 · one function per member of SCHEMA_SPEC §6.2's closed easing enum.
 *
 * Kept as plain maths with no dependency so the tween player stays unit-testable and
 * the player bundle carries no animation library.
 */

const BACK_C1 = 1.70158
const BACK_C2 = BACK_C1 * 1.525
const BACK_C3 = BACK_C1 + 1

export const EASING_FUNCTIONS: Record<Easing, (t: number) => number> = {
  linear: (t) => t,

  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),

  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),

  easeInBack: (t) => BACK_C3 * t * t * t - BACK_C1 * t * t,
  easeOutBack: (t) => 1 + BACK_C3 * (t - 1) ** 3 + BACK_C1 * (t - 1) ** 2,
  easeInOutBack: (t) =>
    t < 0.5
      ? ((2 * t) ** 2 * ((BACK_C2 + 1) * 2 * t - BACK_C2)) / 2
      : ((2 * t - 2) ** 2 * ((BACK_C2 + 1) * (t * 2 - 2) + BACK_C2) + 2) / 2,
}

/** Clamps progress to [0,1] and applies the named curve. */
export function ease(name: Easing, t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t
  return (EASING_FUNCTIONS[name] ?? EASING_FUNCTIONS.linear)(clamped)
}
