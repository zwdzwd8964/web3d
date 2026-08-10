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
  /**
   * T-271 · 进入引擎的每一条事件，**恰好一次**。
   *
   * 「恰好一次」是这个回调唯一的契约，也是它唯一容易破的地方：漏发（某一处仍然直接
   * `engine.dispatch`）与重发（发完又 dispatch 了一次）在长度断言之外都看不出来——
   * 两种情况下宿主都「收到了事件」。嵌入控制器的全部事件来源就是这里。
   *
   * ⚠ 顺序是**先通知宿主、再进引擎**。反过来的话，规则在处理事件时改的状态会先于
   * 事件本身到达宿主，宿主看到的是一个已经被处理过的世界。
   */
  readonly onEvent?: (event: RuntimeEvent) => void
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
  /**
   * T-271 · **进引擎的唯一一道门。**
   *
   * 全文件不再有第二处 `engine.dispatch(`（`engine.test.ts` 那种直接驱动引擎的用法
   * 不算，那是引擎自己的测试）。写成一个函数而不是「在六处各加一行 onEvent」，
   * 是因为后者的失效方式是漏掉第七处——而漏掉的那一处在宿主眼里只是「有时候收不到
   * 某种事件」。
   */
  const fire = (event: RuntimeEvent): void => {
    options.onEvent?.(event)
    engine.dispatch(event)
  }

  const { runtime } = options

  const engine = new EcaEngine(runtime, {
    ...(options.registry ? { registry: options.registry } : {}),
    ...(options.onResult ? { onResult: options.onResult } : {}),
  })

  let running = false
  let detachRuntime: (() => void) | null = null
  let document = options.document
  /**
   * Bumped by every `stop()`, captured by every `start()`.
   *
   * `start()` awaits `runtime.load()`, and `running` was only set to true afterwards —
   * so a `stop()` arriving during that window hit `if (!running) return` and did
   * nothing, and `start()` then resumed and enabled an engine whose host had already
   * thrown away its reference. The result was an unstoppable session: timers firing
   * forever against a disposed runtime, rules running in edit mode (ECA_SPEC §7), and a
   * second `enter()` producing two live engines on one runtime.
   *
   * A generation counter rather than a boolean because `stop(); start(); stop()` must
   * not let the first stop cancel the second start.
   */
  let generation = 0
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
      const mine = generation
      await runtime.load(document)
      // Someone stopped us while the assets were loading. Do nothing at all — not even
      // attach — and leave the runtime exactly as `stop()` left it.
      if (mine !== generation) return

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
      detachRuntime = runtime.onEvent(fire)

      running = true
      fire({ event: 'sceneReady' })
    },

    click(nodeId, point, distance) {
      if (!running) return
      fire({
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
      if (previous !== null) fire({ event: 'hoverLeave', nodeId: previous })
      if (nodeId !== null) fire({ event: 'hoverEnter', nodeId })
    },

    hotspotClick(hotspotId) {
      if (!running) return
      fire({ event: 'hotspotClick', hotspotId })
    },

    dispatch(event) {
      if (!running) return
      fire(event)
    },

    tick() {
      runtime.tick()
    },

    onDocumentChanged(doc) {
      document = doc
      engine.onDocumentPatch(doc)
    },

    stop() {
      // Invalidate any `start()` still inside its await window, whether or not we are
      // currently running. This line is the whole fix, and it must come BEFORE the early
      // return — `if (!running) return` was the bug.
      generation++

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
