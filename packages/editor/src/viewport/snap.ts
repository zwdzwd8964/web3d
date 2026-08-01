import type { Vec3 } from '@w3/schema'

/**
 * T-143 · D18 · snapping, as editor session state.
 *
 * **Not in the document, and not in localStorage.** Whether the user likes half-metre grid
 * snapping is a property of how they are working right now, not of the scene — putting it
 * in the document would mean it travels to the player, shows up in the undo stack and gets
 * published; putting it in localStorage would violate C7 for a setting nobody would miss
 * across a reload. The document only ever contains the coordinate that came OUT of a snap.
 *
 * A module-level store rather than React state because two very different things read it —
 * the gizmo (which lives outside React entirely, ADR-0009) and the drop handler — and
 * threading it through props would mean the viewport re-mounts the renderer when a toolbar
 * button is pressed.
 */

/** The three grid sizes the toolbar offers, in metres. */
export const GRID_STEPS = [0.1, 0.5, 1] as const
export type GridStep = (typeof GRID_STEPS)[number]

/** The one angle step. 15° divides 90 and 360 evenly, which is what makes it useful. */
export const ANGLE_STEP_DEG = 15

export interface SnapSettings {
  /** Grid size in metres, or null for free movement. */
  readonly translate: GridStep | null
  /** True to snap rotation to `ANGLE_STEP_DEG`. */
  readonly rotate: boolean
}

/** Off by default: v0's behaviour, so nothing changes for anyone who never touches it. */
const DEFAULT: SnapSettings = { translate: null, rotate: false }

let current: SnapSettings = DEFAULT
let listeners: ((settings: SnapSettings) => void)[] = []

export const getSnap = (): SnapSettings => current

export function setSnap(next: Partial<SnapSettings>): SnapSettings {
  current = { ...current, ...next }
  for (const listener of listeners) listener(current)
  return current
}

/** Subscribes to changes. Returns the unsubscribe. */
export function onSnapChange(listener: (settings: SnapSettings) => void): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

/** Test seam. Production never needs to reset a session setting. */
export function resetSnap(): void {
  current = DEFAULT
  listeners = []
}

/**
 * Rounds one coordinate to the grid.
 *
 * `Math.round`, so a value lands on the NEAREST grid point rather than the one below it.
 * Flooring would make every dragged object drift consistently towards negative infinity —
 * slow enough that it reads as "the gizmo is imprecise" rather than as a bug.
 */
export const snapValue = (value: number, step: number | null): number =>
  step === null || step <= 0 ? value : Math.round(value / step) * step

/**
 * Snaps a drop position.
 *
 * X and Z only. Y is where the object RESTS — it came out of a ray hitting a surface, and
 * rounding it to the grid would lift a box off the table it was just dropped on or sink it
 * into the floor. The grid is a floor plan, not a lattice.
 */
export function snapPosition(position: Vec3, settings: SnapSettings = current): Vec3 {
  return [snapValue(position[0], settings.translate), position[1], snapValue(position[2], settings.translate)]
}
