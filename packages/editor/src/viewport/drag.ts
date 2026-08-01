import type { LibraryItem, PrimitiveTemplate } from '../lib/library.js'

/**
 * T-146 · what is currently being dragged.
 *
 * **Why a module-level store and not `dataTransfer`.** During `dragover` the browser puts
 * the drag data in *protected mode*: `dataTransfer.types` is readable, `getData()` returns
 * an empty string. That is a security rule, not a quirk — a page must not be able to read
 * a file's contents just because the cursor passed over it. But a ghost preview has to know
 * WHICH object is being dragged on every `dragover`, long before the drop.
 *
 * So the MIME types still travel on `dataTransfer` (they are what makes the drop target
 * decide whether it wants the drag at all, and they are what a cross-window drag would
 * carry), and the payload itself is parked here by `dragstart`. Both ends are in the same
 * document, so this is the same trick `snap.ts` uses: transient session state that never
 * touches the document (铁律 1's runtime-transient exception).
 */

/** The MIME the tile advertises, and the viewport tests `types` for. */
export const PRIMITIVE_MIME = 'application/x-w3-primitive'
export const LIBRARY_MIME = 'application/x-w3-library'

export type DragPayload =
  | { readonly kind: 'primitive'; readonly template: PrimitiveTemplate }
  | { readonly kind: 'library'; readonly item: LibraryItem }

let current: DragPayload | null = null

/** Call from `dragstart`. */
export const beginDrag = (payload: DragPayload): void => void (current = payload)

/** What is being dragged, or null when the drag did not start in this app. */
export const getDrag = (): DragPayload | null => current

/** Call from `dragend` and after a drop. Leaving a stale payload would make the NEXT drag lie. */
export const endDrag = (): void => void (current = null)

/** True when this drag is one of ours, judged from `types` alone (all `dragover` can see). */
export function acceptsDrag(types: readonly string[]): boolean {
  return types.includes(PRIMITIVE_MIME) || types.includes(LIBRARY_MIME)
}
