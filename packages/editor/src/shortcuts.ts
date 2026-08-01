import type { SceneDocument } from '@w3/schema'
import { useEffect } from 'react'
import { useDocumentActions, useDocumentStore } from './store/StoreContext.js'
import { copyNodes, duplicateNodes, getClipboard, pasteNodes, setClipboard } from './store/clipboard.js'

/**
 * T-071 + T-144 · the keyboard layer.
 *
 * Moved out of `App.tsx` when copy/paste arrived: one place that owns "what does this key
 * do" is the only way the guard below stays true of every shortcut rather than of the two
 * that happened to be written first.
 *
 * **The text-field guard is not optional.** Without it Ctrl+Z inside the rename box undoes
 * a scene edit instead of the typing, and Ctrl+C copies the selected OBJECT instead of the
 * selected text — the kind of bug that makes people stop trusting undo generally.
 *
 * The decision logic is `handleShortcut`, a plain function over a structural event. The
 * hook is only the wiring: the editor's tests run in plain Node (no jsdom), so a rule that
 * lived inside `useEffect` could be described in a test but never actually exercised.
 */

/** Just enough of an element to decide whether the user is typing into it. */
export interface ShortcutTarget {
  readonly tagName?: string
  readonly isContentEditable?: boolean
}

/** Just enough of a KeyboardEvent to route a shortcut. */
export interface ShortcutEvent {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly target: ShortcutTarget | null
  preventDefault(): void
}

export interface ShortcutDeps {
  readonly undo: () => void
  readonly redo: () => void
  readonly commit: (label: string, recipe: (draft: SceneDocument) => void) => void
  readonly select: (nodeIds: readonly string[]) => void
  readonly getState: () => { readonly doc: SceneDocument; readonly selection: readonly string[] }
}

const TEXT_FIELDS = /^(INPUT|TEXTAREA|SELECT)$/

/** True while the user is typing, when every shortcut here belongs to the field instead. */
export function isTypingInto(target: ShortcutTarget | null): boolean {
  if (!target) return false
  return TEXT_FIELDS.test(target.tagName ?? '') || target.isContentEditable === true
}

/**
 * Routes one keydown. Does nothing (and does not `preventDefault`) for keys it does not own,
 * so the browser's own Ctrl+C keeps working everywhere this declines to act.
 */
export function handleShortcut(event: ShortcutEvent, deps: ShortcutDeps): void {
  if (isTypingInto(event.target)) return
  if (!(event.ctrlKey || event.metaKey)) return

  const key = event.key.toLowerCase()
  const { doc, selection } = deps.getState()

  if (key === 'z' && !event.shiftKey) {
    event.preventDefault()
    deps.undo()
    return
  }
  if ((key === 'z' && event.shiftKey) || key === 'y') {
    event.preventDefault()
    deps.redo()
    return
  }

  if (key === 'c') {
    // Copying nothing must not clear a clipboard the user filled a minute ago.
    const payload = copyNodes(doc, selection)
    if (!payload) return
    event.preventDefault()
    setClipboard(payload)
    return
  }

  if (key === 'v') {
    const payload = getClipboard()
    if (!payload) return
    event.preventDefault()
    // One commit for the whole subtree: Ctrl+Z after a paste removes all of it, which is
    // what 「一次粘贴一条 commit」 means and what the card's acceptance asserts.
    let created: string[] = []
    deps.commit(`粘贴 ${payload.rootIds.length} 个对象`, (draft) => {
      created = pasteNodes(draft, payload).map((n) => n.id)
    })
    if (created.length > 0) deps.select(created)
    return
  }

  if (key === 'd') {
    if (selection.length === 0) return
    event.preventDefault()
    let created: string[] = []
    deps.commit(`复制 ${selection.length} 个对象`, (draft) => {
      created = duplicateNodes(draft, selection).map((n) => n.id)
    })
    // Selecting the copy is what makes 「Ctrl+D 然后拖一下」 work — the gesture the golden
    // path's placement step is built on.
    if (created.length > 0) deps.select(created)
  }
}

export function useShortcuts(): void {
  const { undo, redo, commit, select } = useDocumentActions()
  const store = useDocumentStore()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as (HTMLElement & ShortcutTarget) | null
      handleShortcut(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          target,
          preventDefault: () => event.preventDefault(),
        },
        {
          undo,
          redo,
          commit,
          select,
          getState: () => {
            const { doc, selection } = store.getState()
            return { doc, selection }
          },
        },
      )
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, commit, select, store])
}
