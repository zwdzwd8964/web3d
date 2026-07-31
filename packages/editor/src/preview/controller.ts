import type { Camera, SceneDocument } from '@w3/schema'
import { createPlaybackSession } from '@w3/core'
import type { PlaybackSession, SceneRuntime } from '@w3/core'
import type { PreviewStore } from './preview-store.js'

/**
 * T-093 + T-102 · the editor's preview session.
 *
 * This class used to build its own `EcaEngine`, wire its own runtime events and decide
 * for itself when to fire `sceneReady`. It no longer does any of that — all of it moved
 * into `createPlaybackSession`, which the player calls too.
 *
 * That split is what makes the parity test (T-103) mean anything. Had the editor kept its
 * own copy of the initialisation, parity would be comparing two things that were merely
 * similar by accident, and they would drift the first time one side was touched. What is
 * left in this file is the part that is genuinely editor-only: putting the edit state back
 * when the user leaves preview.
 *
 * The two editor-only obligations:
 *
 *   ECA_SPEC §7 — the engine runs ONLY inside a preview session. While editing, a click
 *   selects; if rules fired during editing, an object with a click rule could not be
 *   edited, by its own configuration.
 *
 *   T-093 acceptance — leaving preview restores the edit state completely. Rules move
 *   things, hide things, swap materials and move the camera. None of that is in the
 *   document, so none of it may survive the exit.
 */
export class PreviewController {
  private session: PlaybackSession | null = null
  /** Where the user was looking before the preview started. */
  private cameraBefore: Camera | null = null

  constructor(
    private readonly runtime: SceneRuntime,
    private readonly store: PreviewStore,
  ) {}

  get isActive(): boolean {
    return this.session !== null
  }

  /**
   * Enters preview.
   *
   * Async because `start()` loads assets — the same load the player performs. The editor
   * already has them cached so it resolves immediately in practice, but pretending it is
   * synchronous here would fork the path the moment loading actually took time.
   */
  async enter(doc: SceneDocument): Promise<void> {
    if (this.session) return

    // The camera is runtime state, not document state, so nothing else restores it — and
    // a rule that calls moveCamera would otherwise leave the editor pointing somewhere
    // the user never chose. Found by the golden-path E2E.
    this.cameraBefore = this.runtime.camera.captureViewpoint()
    this.setGridVisible(false)

    const session = createPlaybackSession({
      runtime: this.runtime,
      document: doc,
      onResult: (result) => this.store.getState().append(result),
    })

    this.session = session
    this.store.getState().setActive(true)

    await session.start()
    this.syncVariables(doc)
  }

  exit(): void {
    const session = this.session
    this.session = null
    // `dispose` stops the engine and resets the scene from the document; it deliberately
    // does not dispose the runtime, which the editor keeps rendering.
    session?.dispose()

    if (this.cameraBefore) {
      // A synthetic viewpoint: `jumpTo` takes one because that is the shape the camera
      // controller stores, not because this is a saved viewpoint. Never written to the
      // document.
      this.runtime.camera.jumpTo({ id: 'vpt_preview', name: '预览前视角', camera: this.cameraBefore })
      this.cameraBefore = null
    }
    this.setGridVisible(true)
    this.store.getState().setActive(false)
  }

  /** A click in the viewport while previewing is an ECA event, not a selection. */
  dispatchClick(nodeId: string, point?: readonly [number, number, number], distance?: number): void {
    this.session?.click(nodeId, point, distance)
  }

  /** A hotspot marker was clicked. Identical meaning to the player's (C3). */
  dispatchHotspotClick(hotspotId: string): void {
    this.session?.hotspotClick(hotspotId)
  }

  /** The node under the pointer, or null when over empty space. */
  dispatchPointerOver(nodeId: string | null): void {
    this.session?.pointerOver(nodeId)
  }

  /** Keeps the engine's dispatch index current when rules are edited mid-preview. */
  onDocumentChanged(doc: SceneDocument): void {
    this.session?.onDocumentChanged(doc)
  }

  /**
   * The editing grid is an editor affordance, not part of the scene.
   *
   * Leaving it on during preview would mean the thing the user is checking before
   * publishing is not what will be published.
   */
  private setGridVisible(visible: boolean): void {
    const grid = this.runtime.scene.getObjectByName('w3:grid')
    if (grid) grid.visible = visible
  }

  /** Mirrors runtime variables into the store. Called on an interval by the viewport. */
  syncVariables(doc: SceneDocument): void {
    if (!this.session) return

    const values: Record<string, ReturnType<SceneRuntime['getVar']>> = {}
    for (const variable of doc.variables) values[variable.id] = this.runtime.getVar(variable.id)

    // Only publish on an actual change: handing out a new object each tick would
    // re-render the variable panel for nothing.
    const previous = this.store.getState().variables
    const changed =
      Object.keys(values).length !== Object.keys(previous).length ||
      Object.keys(values).some((id) => previous[id] !== values[id])
    if (changed) this.store.getState().setVariables(values)
  }

  dispose(): void {
    this.exit()
  }
}
