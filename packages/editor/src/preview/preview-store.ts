import type { ExecResult, VarValue } from '@w3/core'
import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'

/**
 * T-093 · preview-mode state.
 *
 * Deliberately NOT part of the document store. None of this is document state — it is
 * what the running scene currently happens to be doing — and putting it there would blur
 * the one line the whole architecture rests on (C1: the document is the single source of
 * truth). It would also make every rule execution bump the document revision, which the
 * autosaver watches.
 */

export interface PreviewState {
  /** True from 进入预览 to 退出预览. The ECA engine is enabled exactly in this window. */
  readonly active: boolean
  /** Live variable values, mirrored out of the runtime once per frame. */
  readonly variables: Readonly<Record<string, VarValue>>
  /** Newest last. Capped, because a repeating timer rule would otherwise grow forever. */
  readonly log: readonly ExecResult[]
}

export interface PreviewActions {
  setActive(active: boolean): void
  setVariables(variables: Readonly<Record<string, VarValue>>): void
  append(result: ExecResult): void
  clearLog(): void
}

export type PreviewStore = StoreApi<PreviewState & PreviewActions>

const LOG_LIMIT = 200

export function createPreviewStore(): PreviewStore {
  return createStore<PreviewState & PreviewActions>((set) => ({
    active: false,
    variables: {},
    log: [],

    setActive(active) {
      // Entering preview clears the log: the previous session's results describe a scene
      // state that no longer exists, and mixing them in makes the panel a source of
      // confusion rather than of answers.
      set({ active, log: [], variables: {} })
    },

    setVariables(variables) {
      set({ variables })
    },

    append(result) {
      set((state) => ({
        log: state.log.length >= LOG_LIMIT ? [...state.log.slice(1), result] : [...state.log, result],
      }))
    },

    clearLog() {
      set({ log: [] })
    },
  }))
}
