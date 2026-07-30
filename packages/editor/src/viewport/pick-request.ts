import type { RefKind } from '@w3/core'
import { useSyncExternalStore } from 'react'

/**
 * T-091 · "pick the target in the viewport".
 *
 * A module-level channel rather than context, because the two ends are far apart in the
 * tree — the rule editor lives in the bottom dock, the viewport in the centre — and
 * threading a callback between them would put a prop about rule editing on every
 * component in between.
 *
 * Deliberately holds ONE outstanding request. Two panels both waiting for a click would
 * have no way to decide whose click it was, and the resulting behaviour would depend on
 * mount order.
 */

export interface PickRequest {
  readonly refKind: RefKind
  /** Identifies the field being filled, so the editor can show which one is armed. */
  readonly key: string
  readonly resolve: (id: string) => void
}

let current: PickRequest | null = null
const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Called by the viewport when a node is clicked while a request is outstanding. */
export function fulfilPick(nodeId: string): boolean {
  if (!current) return false
  const request = current
  current = null
  emit()
  request.resolve(nodeId)
  return true
}

export function cancelPick(): void {
  if (!current) return
  current = null
  emit()
}

export function activePick(): PickRequest | null {
  return current
}

/** True while the viewport should route clicks to a pick request instead of selection. */
export function isPicking(): boolean {
  return current !== null
}

export function usePickRequest(): {
  picking: PickRequest | null
  request: (refKind: RefKind, resolve: (id: string) => void, key: string) => void
  cancel: () => void
} {
  const picking = useSyncExternalStore(subscribe, activePick, activePick)
  return {
    picking,
    request: (refKind, resolve, key) => {
      current = { refKind, key, resolve }
      emit()
    },
    cancel: cancelPick,
  }
}
