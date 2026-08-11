import type { SceneDocument } from '@w3/schema'
import { useEffect } from 'react'
import { useDocumentActions, useDocumentStore } from './store/StoreContext.js'
import { copyNodes, duplicateNodes, getClipboard, pasteNodes, setClipboard } from './store/clipboard.js'
import { getUi, setUi } from './store/ui-store.js'
import { chordOf, shortcutFor } from './shortcuts/table.js'

export * from './shortcuts/table.js'
export * from './shortcuts/docs-block.js'

/**
 * T-071 + T-144 + T-290 · the keyboard layer.
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
 *
 * ## T-290 · 从 `if` 链改成查表
 *
 * 这个文件的注释一直自称「唯一定义」，而 `Ctrl+S` **不在里面**——它住在
 * `useAutoSave.ts` 的第二个 keydown 监听里，因此**不经过下面那个文本框守卫**：在
 * 重命名输入框里按 `Ctrl+S` 会触发一次保存。本卡把它迁回表内并删掉那个监听器，
 * 于是「全编辑器只有一个 keydown 监听」变成一条可以 grep 的断言。
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
  readonly altKey?: boolean
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
  /** T-290 · Ctrl+S 迁回表内之后要的那一件事。 */
  readonly saveNow: () => void
  /** T-290 · 把焦点放到层级树的搜索框。DOM 操作由宿主注入，表本身留在纯逻辑里。 */
  readonly focusSearch: () => void
}

const TEXT_FIELDS = /^(INPUT|TEXTAREA|SELECT)$/

/** True while the user is typing, when every shortcut here belongs to the field instead. */
export function isTypingInto(target: ShortcutTarget | null): boolean {
  if (!target) return false
  return TEXT_FIELDS.test(target.tagName ?? '') || target.isContentEditable === true
}

/**
 * 一个快捷键真正做的事。**键位在表里，动作在这里，一一对应。**
 *
 * 返回 `false` 表示「这次不处理」——例如剪贴板是空的、或者没有选中任何东西。
 * 不处理就**不 `preventDefault`**，浏览器自己的行为照旧。
 */
const ACTIONS: Record<string, (deps: ShortcutDeps) => boolean> = {
  save(deps) {
    deps.saveNow()
    return true
  },
  undo(deps) {
    deps.undo()
    return true
  },
  redo(deps) {
    deps.redo()
    return true
  },
  copy(deps) {
    const { doc, selection } = deps.getState()
    // Copying nothing must not clear a clipboard the user filled a minute ago.
    const payload = copyNodes(doc, selection)
    if (!payload) return false
    setClipboard(payload)
    return true
  },
  paste(deps) {
    const payload = getClipboard()
    if (!payload) return false
    // One commit for the whole subtree: Ctrl+Z after a paste removes all of it, which is
    // what 「一次粘贴一条 commit」 means and what the card's acceptance asserts.
    let created: string[] = []
    deps.commit(`粘贴 ${payload.rootIds.length} 个对象`, (draft) => {
      created = pasteNodes(draft, payload).map((n) => n.id)
    })
    if (created.length > 0) deps.select(created)
    return true
  },
  duplicate(deps) {
    const { selection } = deps.getState()
    if (selection.length === 0) return false
    let created: string[] = []
    deps.commit(`复制 ${selection.length} 个对象`, (draft) => {
      created = duplicateNodes(draft, selection).map((n) => n.id)
    })
    // Selecting the copy is what makes 「Ctrl+D 然后拖一下」 work — the gesture the golden
    // path's placement step is built on.
    if (created.length > 0) deps.select(created)
    return true
  },
  remove(deps) {
    const { selection } = deps.getState()
    const first = selection[0]
    if (first === undefined) return false
    // **只提出请求，不删。** 真正的删除要先经过确认对话框，而那句问话由
    // `describeRemoval` 生成——树上的 ✕ 走的是同一条路。
    setUi({ pendingDelete: first })
    return true
  },
  rename(deps) {
    const first = deps.getState().selection[0]
    if (first === undefined) return false
    setUi({ renaming: first })
    return true
  },
  selectAll(deps) {
    deps.select(deps.getState().doc.nodes.map((n) => n.id))
    return true
  },
  deselect(deps) {
    // 面板开着时先关面板：Esc 的直觉是「退出当前这一层」，而不是「一次退两层」。
    if (getUi().helpOpen) {
      setUi({ helpOpen: false })
      return true
    }
    if (deps.getState().selection.length === 0) return false
    deps.select([])
    return true
  },
  search(deps) {
    deps.focusSearch()
    return true
  },
  help() {
    setUi({ helpOpen: !getUi().helpOpen })
    return true
  },
}

/**
 * Routes one keydown. Does nothing (and does not `preventDefault`) for keys it does not own,
 * so the browser's own Ctrl+C keeps working everywhere this declines to act.
 */
export function handleShortcut(event: ShortcutEvent, deps: ShortcutDeps): void {
  const shortcut = shortcutFor(chordOf(event))
  if (!shortcut) return
  // 表里那条 `allowInTextField` 就是在这里生效的。默认 false —— 在输入框里，
  // 每一个快捷键都属于那个输入框。
  if (!shortcut.allowInTextField && isTypingInto(event.target)) return
  const action = ACTIONS[shortcut.id]
  if (!action) throw new Error(`快捷键「${shortcut.id}」在表里，但没有对应的动作。`)
  if (action(deps)) event.preventDefault()
}

export interface UseShortcutsOptions {
  readonly saveNow: () => void
}

export function useShortcuts(options: UseShortcutsOptions): void {
  const { undo, redo, commit, select } = useDocumentActions()
  const store = useDocumentStore()
  const { saveNow } = options

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as (HTMLElement & ShortcutTarget) | null
      handleShortcut(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          target,
          preventDefault: () => event.preventDefault(),
        },
        {
          undo,
          redo,
          commit,
          select,
          saveNow,
          focusSearch: () => document.querySelector<HTMLInputElement>('.panel--left input[type="search"]')?.focus(),
          getState: () => {
            const { doc, selection } = store.getState()
            return { doc, selection }
          },
        },
      )
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, commit, select, store, saveNow])
}
