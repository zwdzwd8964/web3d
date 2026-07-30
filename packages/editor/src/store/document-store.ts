import type { SceneDocument } from '@w3/schema'
import type { Draft, Patch } from 'immer'
import { applyPatches, enablePatches, produceWithPatches } from 'immer'
import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import { History, compactInversePatches, compactPatches } from './history.js'
import type { HistoryEntry } from './history.js'

// Immer ships patch support as an opt-in plugin. Enabling it here, once, at the only
// module that needs it — undo/redo silently produces empty patch arrays otherwise.
enablePatches()

/**
 * T-061 · SCHEMA_SPEC §11 · the document write API.
 *
 * **Every** write goes through here. UI code never mutates the document object and never
 * reaches for a three.js object to "implement" an edit — that is constitution C1 and
 * anti-pattern A1, and breaking it produces three bugs at once: undo stops working,
 * publishing loses the change, and the player disagrees with the editor.
 *
 * Two channels, because a gizmo drag and a property edit are not the same event:
 *
 *   commit(label, recipe)   one user action, one undo entry
 *   preview(recipe)         a frame of an ongoing drag: writes the document, no entry
 *   previewStart/Commit     the drag's net change collapses into ONE entry (D2)
 *
 * Committing every frame would put three hundred entries on the stack for one drag and
 * turn Ctrl+Z into slow-motion replay.
 */

export type Recipe = (draft: Draft<SceneDocument>) => void

export interface DocumentStoreOptions {
  /** Forwarded to the runtime for incremental application (D1). */
  readonly onPatch?: (patches: Patch[], next: SceneDocument, prev: SceneDocument) => void
  /** Injected so merge-window behaviour is testable without waiting 500 ms. */
  readonly now?: () => number
  readonly historyLimit?: number
  readonly onLog?: (level: 'debug' | 'warn' | 'error', message: string) => void
}

export interface DocumentState {
  readonly doc: SceneDocument
  /** Node ids. A set from the start: retrofitting multi-select means rewriting every panel. */
  readonly selection: readonly string[]
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly historyDepth: number
  /** True between previewStart and previewCommit/Abort. */
  readonly previewing: boolean
  /** Bumped on every document change, so React subscribers can cheaply detect one. */
  readonly revision: number
}

export interface DocumentActions {
  commit(label: string, recipe: Recipe): boolean
  preview(recipe: Recipe): boolean
  previewStart(): void
  previewCommit(label: string): boolean
  previewAbort(): void
  undo(): boolean
  redo(): boolean
  clearHistory(): void
  replaceDocument(doc: SceneDocument, options?: { keepHistory?: boolean }): void

  select(nodeIds: readonly string[]): void
  toggleSelection(nodeId: string, additive?: boolean): void
  clearSelection(): void

  readonly history: History
}

export type DocumentStore = StoreApi<DocumentState & DocumentActions>

export function createDocumentStore(initial: SceneDocument, options: DocumentStoreOptions = {}): DocumentStore {
  const now = options.now ?? (() => Date.now())
  const history = new History(options.historyLimit)

  /** Set between previewStart and previewCommit/Abort. */
  let pendingPatches: Patch[] = []
  let pendingInverse: Patch[] = []
  let previewBaseline: SceneDocument | null = null

  return createStore<DocumentState & DocumentActions>((set, get) => {
    /** The one place the document object is replaced. */
    const write = (recipe: Recipe): { patches: Patch[]; inverse: Patch[]; next: SceneDocument } | null => {
      const prev = get().doc
      const [next, patches, inverse] = produceWithPatches(prev, recipe)
      if (patches.length === 0) return null
      set((state) => ({ doc: next, revision: state.revision + 1 }))
      options.onPatch?.(patches, next, prev)
      return { patches, inverse, next }
    }

    const syncHistoryFlags = () =>
      set({ canUndo: history.canUndo, canRedo: history.canRedo, historyDepth: history.depth })

    /** Applies a stored patch set without creating a new history entry. */
    const applyStored = (patches: readonly Patch[]): void => {
      const prev = get().doc
      const next = applyPatches(prev, patches as Patch[])
      set((state) => ({ doc: next, revision: state.revision + 1 }))
      options.onPatch?.(patches as Patch[], next, prev)
    }

    return {
      doc: initial,
      selection: [],
      canUndo: false,
      canRedo: false,
      historyDepth: 0,
      previewing: false,
      revision: 0,
      history,

      commit(label, recipe) {
        if (previewBaseline !== null) {
          // Committing mid-drag would interleave two entries and leave the drag's own
          // entry describing a change that already happened.
          options.onLog?.('warn', `commit("${label}") 在预览进行中被调用，已忽略。请先 previewCommit 或 previewAbort。`)
          return false
        }
        const result = write(recipe)
        if (!result) return false

        history.push({
          label,
          patches: compactPatches(result.patches),
          inversePatches: compactInversePatches(result.inverse),
          at: now(),
        })
        syncHistoryFlags()
        return true
      },

      /** D2 · a frame of an ongoing interaction. Writes the document, no undo entry. */
      preview(recipe) {
        const result = write(recipe)
        if (!result) return false
        if (previewBaseline !== null) {
          pendingPatches.push(...result.patches)
          // Undo runs newest-first.
          pendingInverse.unshift(...result.inverse)
        }
        return true
      },

      previewStart() {
        if (previewBaseline !== null) return
        previewBaseline = get().doc
        pendingPatches = []
        pendingInverse = []
        set({ previewing: true })
      },

      /** Collapses everything since previewStart into exactly one undo entry (D2). */
      previewCommit(label) {
        if (previewBaseline === null) {
          options.onLog?.('warn', `previewCommit("${label}") 在没有 previewStart 的情况下被调用，已忽略。`)
          return false
        }
        const patches = compactPatches(pendingPatches)
        const inverse = compactInversePatches(pendingInverse)

        previewBaseline = null
        pendingPatches = []
        pendingInverse = []
        set({ previewing: false })

        if (patches.length === 0) return false

        history.push({ label, patches, inversePatches: inverse, at: now() })
        syncHistoryFlags()
        return true
      },

      /** Rolls the document back to the state at previewStart. Used when a drag is cancelled. */
      previewAbort() {
        if (previewBaseline === null) return
        const inverse = compactInversePatches(pendingInverse)
        previewBaseline = null
        pendingPatches = []
        pendingInverse = []
        set({ previewing: false })
        if (inverse.length > 0) applyStored(inverse)
      },

      undo() {
        if (previewBaseline !== null) {
          options.onLog?.('warn', 'undo 在预览进行中被调用，已忽略。')
          return false
        }
        const entry: HistoryEntry | null = history.undo()
        if (!entry) return false
        applyStored(entry.inversePatches)
        syncHistoryFlags()
        return true
      },

      redo() {
        if (previewBaseline !== null) return false
        const entry = history.redo()
        if (!entry) return false
        applyStored(entry.patches)
        syncHistoryFlags()
        return true
      },

      clearHistory() {
        history.clear()
        syncHistoryFlags()
      },

      /** Wholesale replacement — opening a project, or loading a snapshot. */
      replaceDocument(doc, replaceOptions) {
        previewBaseline = null
        pendingPatches = []
        pendingInverse = []
        if (!replaceOptions?.keepHistory) history.clear()
        set((state) => ({
          doc,
          previewing: false,
          revision: state.revision + 1,
          // Ids from the previous document mean nothing in this one.
          selection: [],
        }))
        syncHistoryFlags()
      },

      select(nodeIds) {
        set({ selection: [...new Set(nodeIds)] })
      },

      toggleSelection(nodeId, additive = false) {
        const current = get().selection
        if (!additive) {
          set({ selection: current.length === 1 && current[0] === nodeId ? [] : [nodeId] })
          return
        }
        set({
          selection: current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId],
        })
      },

      clearSelection() {
        set({ selection: [] })
      },
    }
  })
}
