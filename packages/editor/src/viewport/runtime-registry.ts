import type { SceneRuntime } from '@w3/core'

/**
 * The one live SceneRuntime, so the document store's `onPatch` can reach it.
 *
 * A module-level handle rather than React context because the store is created before
 * the tree mounts and outlives it: threading it through context would mean the store had
 * to be recreated whenever the viewport remounted, which would drop the undo history.
 *
 * This holds a RUNTIME object, not business state — C1 is about persistable state, and a
 * renderer handle is neither persistable nor state.
 */
let active: SceneRuntime | null = null

export function setActiveRuntime(runtime: SceneRuntime | null): void {
  active = runtime
}

export function getActiveRuntime(): SceneRuntime | null {
  return active
}

/** D1's fallback counter, surfaced for the status bar and for the E2E assertion. */
export function fullRebuildCount(): number {
  return active?.fullRebuildCount ?? 0
}
