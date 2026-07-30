import type { Camera, SceneDocument } from '@w3/schema'
import { EcaEngine } from '@w3/core'
import type { SceneRuntime } from '@w3/core'
import type { PreviewStore } from './preview-store.js'

/**
 * T-093 · the preview session.
 *
 * The evaluation report's finding was blunt: `EcaEngine` had zero references anywhere in
 * the editor. Thirteen actions, an executor, a condition evaluator and a dispatch engine
 * existed with full headless test coverage and had never once run end to end. The sample
 * document's rule was visible only as a count — 「规则编辑器：T-091 · 当前 1 条」 — with no
 * way to see it, edit it, or fire it.
 *
 * Two invariants this class exists to hold:
 *
 *   ECA_SPEC §7 — the engine is enabled ONLY inside a preview session. While editing, a
 *   click selects; if rules fired during editing, an object with a click rule could not
 *   be edited, by its own configuration.
 *
 *   T-093 acceptance — leaving preview restores the edit state completely. Rules move
 *   things, hide things and swap materials; none of that may survive the exit, because
 *   none of it is in the document.
 */
export class PreviewController {
  private engine: EcaEngine | null = null
  private detachRuntime: (() => void) | null = null
  /** Where the user was looking before the preview started. */
  private cameraBefore: Camera | null = null

  constructor(
    private readonly runtime: SceneRuntime,
    private readonly store: PreviewStore,
  ) {}

  get isActive(): boolean {
    return this.engine !== null
  }

  enter(doc: SceneDocument): void {
    if (this.engine) return

    // The camera is runtime state, not document state, so `resetScene` does not touch it
    // — and a rule that calls moveCamera would otherwise leave the editor pointing
    // somewhere the user never chose. Found by the golden-path E2E: after previewing the
    // sample scene, the viewport came back showing a different view.
    this.cameraBefore = this.runtime.camera.captureViewpoint()

    // Start from the document, not from whatever the editing session left behind — a
    // half-dragged gizmo or a selection highlight is not part of what the viewer sees.
    this.runtime.resetScene()

    const engine = new EcaEngine(this.runtime, {
      onResult: (result) => this.store.getState().append(result),
    })
    engine.attach(doc)
    engine.setEnabled(true)
    this.engine = engine

    // The runtime raises variableChange, animationEnd and hotspotClick itself; those have
    // to reach the engine or half the event types would simply never fire.
    this.detachRuntime = this.runtime.onEvent((event) => engine.dispatch(event))

    this.store.getState().setActive(true)
    this.syncVariables(doc)

    engine.dispatch({ event: 'sceneReady' })
    this.syncVariables(doc)
  }

  exit(): void {
    const engine = this.engine
    this.engine = null
    this.detachRuntime?.()
    this.detachRuntime = null

    // detach aborts every in-flight sequence and cancels every timer before the scene is
    // rebuilt. The other order lets a surviving action write to a graph that has just
    // been replaced under it.
    engine?.setEnabled(false)
    engine?.detach()

    this.runtime.resetScene()
    if (this.cameraBefore) {
      // A synthetic viewpoint: `jumpTo` takes one because that is the shape the camera
      // controller stores, not because this is a saved viewpoint. It is never written to
      // the document.
      this.runtime.camera.jumpTo({ id: 'vpt_preview', name: '预览前视角', camera: this.cameraBefore })
      this.cameraBefore = null
    }
    this.store.getState().setActive(false)
  }

  /** A click in the viewport while previewing is an ECA event, not a selection. */
  dispatchClick(nodeId: string, point?: readonly [number, number, number], distance?: number): void {
    this.engine?.dispatch({
      event: 'click',
      nodeId,
      ...(point ? { point } : {}),
      ...(distance !== undefined ? { distance } : {}),
    })
  }

  /** Keeps the engine's dispatch index current when rules are edited mid-preview. */
  onDocumentChanged(doc: SceneDocument): void {
    this.engine?.onDocumentPatch(doc)
  }

  /** Mirrors runtime variables into the store. Called once per frame by the viewport. */
  syncVariables(doc: SceneDocument): void {
    if (!this.engine) return
    const values: Record<string, ReturnType<SceneRuntime['getVar']>> = {}
    for (const variable of doc.variables) values[variable.id] = this.runtime.getVar(variable.id)

    // Only publish on an actual change: this runs every frame, and handing out a new
    // object each time would re-render the variable panel sixty times a second for
    // nothing.
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
