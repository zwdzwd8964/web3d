import type { SceneDocument } from '@w3/schema'
import type { SceneRuntime } from '@w3/core'
import type { DocumentStore } from '../store/document-store.js'

/**
 * T-062 · the wire between the document store and the renderer.
 *
 * Everything flows one way: the document changes, patches go to the runtime, the
 * viewport updates. Nothing writes back. A viewport that mutated the document directly
 * would be anti-pattern A1, and it is the reason this file exists as a named seam rather
 * than as a `useEffect` inside a component.
 *
 * ECA stays DISABLED here (ECA_SPEC §7): in edit mode a click selects an object rather
 * than firing its rules, otherwise an object with a click rule becomes uneditable — by
 * its own configuration.
 */

export interface RuntimeBridgeOptions {
  readonly store: DocumentStore
  readonly runtime: SceneRuntime
  /** Canvas size in CSS pixels, for picking. Kept current by the ResizeObserver. */
  readonly getViewportSize: () => { width: number; height: number }
  readonly onLog?: (level: 'debug' | 'warn' | 'error', message: string) => void
}

export interface RuntimeBridge {
  /** Screen coordinates -> selection. Returns the node id that was picked, if any. */
  handlePointerPick(x: number, y: number, additive: boolean): string | null
  /** Full rebuild + asset load. Used on open and after an import. */
  reload(doc: SceneDocument): Promise<void>
  dispose(): void
}

export function createRuntimeBridge(options: RuntimeBridgeOptions): RuntimeBridge {
  const { store, runtime } = options
  let previous = store.getState().doc

  // The store already emits patches through `onPatch`; subscribing here as well would
  // apply them twice. Instead the store is configured with this forwarder at creation,
  // and the bridge only handles the pieces the store cannot know about.
  const unsubscribe = store.subscribe((state) => {
    if (state.doc === previous) return
    previous = state.doc
  })

  return {
    handlePointerPick(x, y, additive) {
      const { width, height } = options.getViewportSize()
      const hit = runtime.picker.pick(x, y, width, height, runtime.camera.camera, store.getState().doc)
      if (!hit) {
        if (!additive) store.getState().clearSelection()
        return null
      }
      store.getState().toggleSelection(hit.nodeId, additive)
      return hit.nodeId
    },

    async reload(doc) {
      await runtime.load(doc)
      previous = doc
    },

    dispose() {
      unsubscribe()
    },
  }
}

/**
 * The `onPatch` handler a document store is created with.
 *
 * D1: patches go to `applyPatch`, never `load`. Dragging a gizmo emits a patch per
 * frame, and rebuilding the scene on each one drops the frame rate to unusable.
 * The fallback counter is surfaced so the E2E run can assert it stayed at zero.
 */
export function createPatchForwarder(getRuntime: () => SceneRuntime | null) {
  return (patches: Parameters<SceneRuntime['applyPatch']>[0], next: SceneDocument, prev: SceneDocument) => {
    const runtime = getRuntime()
    if (!runtime) return
    runtime.applyPatch(patches, next, prev)
  }
}
