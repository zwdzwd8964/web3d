/**
 * T-224 · editor UI transients, as a module-level session store.
 *
 * **Not in the document, and not in localStorage.** A search term, which row is being
 * renamed, which row is awaiting a delete confirmation, and whether the shortcut sheet is
 * open are all properties of what the user is doing *right now* — not of the scene. Putting
 * them in the document would send them to the player, into the undo stack and into the
 * published package; putting them in `localStorage` would break C7 for state nobody would
 * miss across a reload.
 *
 * ⚠ **This is a widening of 铁律 1's exception and it is worth being explicit about.** The
 * rule's own examples are runtime/render transients (playback head, hovered object, live
 * camera). A search box is not one of those — read literally, it falls on the *forbidden*
 * side ("业务状态记在组件 state 里"). The distinction that makes it legitimate: none of these
 * four survives a reload, none of them is observable in the player, and none of them changes
 * what the scene IS. Same reasoning, same shape, and the same file-header treatment as
 * `viewport/snap.ts` (D18), which is the precedent.
 *
 * A module-level store rather than a zustand store in a provider, for a concrete reason:
 * `document-store` bumps `revision` on every write and the autosaver watches `revision`.
 * A search term routed through it would trigger a save **per keystroke**.
 */

import { useSyncExternalStore } from 'react'

export interface UiState {
  /** Hierarchy-tree search box. Empty string = not filtering (see `filterNodes`). */
  readonly search: string
  /** Node id whose name is being edited inline, or null. */
  readonly renaming: string | null
  /** Node id awaiting delete confirmation, or null. */
  readonly pendingDelete: string | null
  /**
   * Whether the keyboard-shortcut sheet is open.
   *
   * Declared here and **read by T-290**, which builds the sheet itself. The field is in
   * this card because T-290 also rewrites `HierarchyTree.tsx`'s delete entry — landing the
   * store's shape once avoids two cards editing the same four-field type.
   */
  readonly helpOpen: boolean
}

const INITIAL: UiState = { search: '', renaming: null, pendingDelete: null, helpOpen: false }

let current: UiState = INITIAL
const listeners = new Set<() => void>()

export function getUi(): UiState {
  return current
}

export function setUi(patch: Partial<UiState>): void {
  const next = { ...current, ...patch }
  // Reference equality is what `useSyncExternalStore` compares; emitting a new object for a
  // no-op write would re-render the tree on every keystroke that changed nothing.
  if (
    next.search === current.search &&
    next.renaming === current.renaming &&
    next.pendingDelete === current.pendingDelete &&
    next.helpOpen === current.helpOpen
  ) {
    return
  }
  current = next
  for (const listener of [...listeners]) listener()
}

export function onUiChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test seam. Production never needs to reset a session setting — same as `resetSnap()`. */
export function resetUi(): void {
  current = INITIAL
  for (const listener of [...listeners]) listener()
}

/**
 * Subscribes a component to the four transients.
 *
 * `getUi` serves as both snapshot and server snapshot: the store has no SSR path, and
 * returning the same frozen initial object on both sides is what keeps hydration quiet.
 */
export function useUi(): UiState {
  return useSyncExternalStore(onUiChange, getUi, getUi)
}
