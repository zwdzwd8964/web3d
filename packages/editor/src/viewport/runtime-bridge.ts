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
 *
 * One commit is not synchronous, though: an import adds an asset, and the nodes it brings
 * cannot be materialised until the bytes are parsed. So a batch that touches `/assets`
 * goes through a queue — `ensureAssets` first, then the patches. Everything else takes
 * the synchronous fast path, because a gizmo drag must not be pushed onto a microtask
 * queue behind an import that happened to still be loading.
 */
/**
 * Resolves once every queued patch batch has reached the runtime.
 *
 * T-146 · a library drop has to MEASURE what it just imported before it can rest it on a
 * surface, and the asset path is asynchronous — measuring straight after the commit
 * measures a scene graph the nodes have not reached yet, which reads as "the model ignores
 * where I dropped it". Callers on the fast path get an already-resolved promise.
 */
export function patchesSettled(): Promise<void> {
  return settled
}

let settled: Promise<void> = Promise.resolve()

export function createPatchForwarder(getRuntime: () => SceneRuntime | null) {
  // Serialises the slow path. Without it, two imports in quick succession could apply
  // their node patches in the order their assets finished parsing rather than the order
  // the user made them, and the second import's nodes would land against the first
  // import's document.
  let queue: Promise<void> = Promise.resolve()
  let queued = 0

  return (patches: Parameters<SceneRuntime['applyPatch']>[0], next: SceneDocument, prev: SceneDocument) => {
    const runtime = getRuntime()
    if (!runtime) return

    // Two kinds of patch need bytes in hand before they can be applied: an asset arriving,
    // and a material starting to reference a texture. The second is not obvious and cost
    // M11 a real bug — the cache loads what materials REFERENCE, but the reference is
    // usually set in a later commit than the import, so a picked texture was never loaded
    // and the slot rendered empty while the document said otherwise.
    //
    // Narrow on purpose: `/materials/3/params/maps/map`, not `/materials/**`. Dragging a
    // roughness slider emits sixty material patches a second and must stay on the
    // synchronous fast path.
    const touchesAssets = patches.some(
      (patch) =>
        patch.path[0] === 'assets' || (patch.path[0] === 'materials' && patch.path.includes('maps')),
    )
    if (!touchesAssets && queued === 0) {
      runtime.applyPatch(patches, next, prev)
      return
    }

    queued++
    queue = queue
      .then(async () => {
        const live = getRuntime()
        if (!live) return
        if (touchesAssets) await live.ensureAssets(next)
        live.applyPatch(patches, next, prev)
        // An import that adds nodes moves the camera to take them in. Without this the
        // model lands wherever the exporter put its origin — often outside the current
        // view — and the user gets the same "everything says it worked but I see no
        // change" experience that made the empty-resolver bug so hard to spot.
        if (touchesAssets && next.nodes.length > prev.nodes.length) live.camera.frameAll()
      })
      .finally(() => {
        // Back to the fast path once the queue drains: one import must not make every
        // later edit asynchronous for the rest of the session.
        queued--
      })
    settled = queue
  }
}
