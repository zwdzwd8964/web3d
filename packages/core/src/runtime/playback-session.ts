import type { SceneDocument } from '@w3/schema'
import { EcaEngine } from '../eca/engine.js'
import type { ActionRegistry } from '../eca/actions/registry.js'
import type { ExecResult, RuntimeEvent } from '../eca/types.js'
import type { SceneRuntime } from './scene-runtime.js'

/**
 * T-102 · the one playback path, shared by the editor's preview and the player.
 *
 * Constitution C3 says "one core, two views". Until this file existed that was an
 * intention, not a fact: the editor had `PreviewController` and the player had nothing,
 * and the moment the player was written it would have grown its own slightly different
 * initialisation — a different event wiring order, a different reset, a different moment
 * to fire `sceneReady`. Those differences are invisible until a customer says "it worked
 * in the editor", which MVP_V0 §1.1 names as the acceptance disaster this whole
 * architecture exists to prevent.
 *
 * So both sides call THIS function and nothing else. The parity test (T-103) is only
 * meaningful because of that — and, importantly, it is not self-proving: the two sides
 * still differ in renderer, resolver, hotspot renderer and clock source, and parity
 * asserts that none of those differences leak into behaviour.
 *
 * Lives in core rather than in the editor because the player must not depend on the
 * editor (MVP §3's dependency direction), and duplicating it would be the exact failure
 * it prevents.
 */

export interface PlaybackSessionOptions {
  /**
   * A runtime the HOST built.
   *
   * Deliberately not constructed in here. Canvas, renderer, resolver and clock differ
   * legitimately between the editor (a canvas inside a four-pane layout, assets from
   * IndexedDB), the player (a full-page canvas, assets from an unpacked .w3p) and the
   * parity harness (no canvas at all, a fake clock). Those are the differences parity
   * exists to prove do NOT leak into behaviour — so they belong to the host, and
   * everything behavioural belongs to this file.
   */
  readonly runtime: SceneRuntime
  readonly document: SceneDocument
  readonly registry?: ActionRegistry
  /** Every finished rule execution, in order. The debug panel and parity both read it. */
  readonly onResult?: (result: ExecResult) => void
}

export interface PlaybackSession {
  readonly runtime: SceneRuntime
  readonly engine: EcaEngine
  /**
   * Loads assets, builds the scene, enables the engine and fires `sceneReady`.
   *
   * Separate from construction because it is async and because a host may want to show
   * a progress indicator around it.
   */
  start(): Promise<void>
  /** A click in the viewport, in play semantics: an ECA event, never a selection. */
  click(nodeId: string, point?: readonly [number, number, number], distance?: number): void
  /**
   * The node under the pointer, or null. The host picks; this owns the state machine.
   *
   * `hoverEnter` / `hoverLeave` are v0 events (ECA_SPEC §2.1) and the rule editor offers
   * them — but until this method existed NOTHING in the repo emitted them. A rule could
   * be configured, saved and published, and never once fire. The enter/leave bookkeeping
   * lives here rather than in each host so the two cannot disagree about when a hover
   * starts.
   */
  pointerOver(nodeId: string | null): void
  /** A hotspot marker was activated. Same meaning in the editor's preview and the player. */
  hotspotClick(hotspotId: string): void
  dispatch(event: RuntimeEvent): void
  /** Advances animations and the hotspot projector. Hosts call this once per frame. */
  tick(): void
  /** Re-derives the dispatch index after the document changed under a live session. */
  onDocumentChanged(doc: SceneDocument): void
  /** Stops everything the session started. Safe to call twice. */
  stop(): void
  dispose(): void
  readonly isRunning: boolean
}

export function createPlaybackSession(options: PlaybackSessionOptions): PlaybackSession {
  const { runtime } = options

  const engine = new EcaEngine(runtime, {
    ...(options.registry ? { registry: options.registry } : {}),
    ...(options.onResult ? { onResult: options.onResult } : {}),
  })

  let running = false
  let detachRuntime: (() => void) | null = null
  let document = options.document
  /** The node the pointer was over on the previous report. */
  let hovered: string | null = null

  return {
    runtime,
    engine,

    get isRunning() {
      return running
    },

    async start() {
      if (running) return
      await runtime.load(document)

      engine.attach(document)
      engine.setEnabled(true)

      // The runtime raises variableChange and animationEnd itself; those have to reach
      // the engine or those two event types would never fire. Pointer-derived events
      // (click / hover / hotspotClick) arrive through this object's own methods instead,
      // because only the host has a canvas to pick against.
      //
      // Wiring this AFTER attach and BEFORE sceneReady is not incidental: an event raised
      // during the sceneReady chain must reach the engine, and one raised before attach
      // has no index to dispatch against.
      detachRuntime = runtime.onEvent((event) => engine.dispatch(event))

      running = true
      engine.dispatch({ event: 'sceneReady' })
    },

    click(nodeId, point, distance) {
      if (!running) return
      engine.dispatch({
        event: 'click',
        nodeId,
        ...(point ? { point } : {}),
        ...(distance !== undefined ? { distance } : {}),
      })
    },

    pointerOver(nodeId) {
      if (!running || nodeId === hovered) return
      const previous = hovered
      hovered = nodeId
      // Leave before enter. Moving straight from one object onto another must not let the
      // new object's enter rule run against state the old object's leave rule is about to
      // undo — and leave-then-enter is the order every UI toolkit uses, so a rule author's
      // intuition matches what happens.
      if (previous !== null) engine.dispatch({ event: 'hoverLeave', nodeId: previous })
      if (nodeId !== null) engine.dispatch({ event: 'hoverEnter', nodeId })
    },

    hotspotClick(hotspotId) {
      if (!running) return
      engine.dispatch({ event: 'hotspotClick', hotspotId })
    },

    dispatch(event) {
      if (!running) return
      engine.dispatch(event)
    },

    tick() {
      runtime.tick()
    },

    onDocumentChanged(doc) {
      document = doc
      engine.onDocumentPatch(doc)
    },

    stop() {
      if (!running) return
      running = false
      hovered = null
      detachRuntime?.()
      detachRuntime = null
      // Order matters: detach aborts every in-flight sequence and cancels every timer.
      // Resetting the scene first would let a surviving action write into a graph that
      // has just been replaced under it.
      engine.setEnabled(false)
      engine.detach()
      runtime.resetScene()
    },

    dispose() {
      // Stops the session but does NOT dispose the runtime: the host built it and may
      // still need it (the editor keeps rendering the same canvas after preview ends).
      this.stop()
    },
  }
}
