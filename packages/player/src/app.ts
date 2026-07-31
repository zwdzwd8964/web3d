import type { SceneDocument } from '@w3/schema'
import { DomHotspotRenderer, detectCapability, renderCapabilityNotice } from '@w3/core'
import type { PlaybackSession, SceneRuntime } from '@w3/core'
import { unpackScene } from '@w3/storage'
import { createPlayerSession } from './session.js'

/**
 * T-101 · the player.
 *
 * Read-only, by construction rather than by discipline: it holds no document store, no
 * history, no commit path. There is nothing here that could write to the document even by
 * mistake.
 *
 * Everything behavioural comes from `createPlaybackSession`, which the editor's preview
 * calls too (T-102). This file only does the three things the editor does not: unpack a
 * `.w3p`, own a full-page canvas, and orbit the camera. If a fourth thing ever appears
 * here that affects WHAT HAPPENS rather than what it looks like, C3 has been broken and
 * the parity test should be the one to say so.
 *
 * No UI framework at all. That is not a micro-optimisation — it is the standing proof
 * that `@w3/core` is framework-agnostic (C2), and it is most of the gzip budget.
 */

export interface PlayerOptions {
  readonly host: HTMLElement
  /** Bytes of a `.w3p`. */
  readonly bytes: Uint8Array
  readonly onLog?: (level: string, message: string) => void
}

export class Player {
  private session: PlaybackSession | null = null
  private runtime: SceneRuntime | null = null
  private canvas: HTMLCanvasElement | null = null
  private overlay: HTMLDivElement | null = null
  private resize: ResizeObserver | null = null
  private detachPointer: (() => void) | null = null

  constructor(private readonly options: PlayerOptions) {}

  async start(): Promise<void> {
    const { host } = this.options

    // Before anything is built: a black page with a console message is not an error
    // report (T-111 / ADR-0013).
    const capability = detectCapability()
    if (capability.level === 'unsupported') {
      renderCapabilityNotice(host, capability)
      return
    }

    const pkg = unpackScene(this.options.bytes)

    const canvas = document.createElement('canvas')
    canvas.className = 'player__canvas'
    const overlay = document.createElement('div')
    overlay.className = 'player__overlay'
    host.append(canvas, overlay)
    this.canvas = canvas
    this.overlay = overlay

    if (capability.level === 'software') renderCapabilityNotice(host, capability)

    // Everything behavioural comes from here, and the parity suite drives this exact
    // function — so a divergence between player and editor cannot hide in this file.
    const { runtime, session } = createPlayerSession({
      pkg,
      canvas,
      hotspotRenderer: new DomHotspotRenderer({
        container: overlay,
        onActivate: (hotspotId) => this.session?.hotspotClick(hotspotId),
      }),
      onLog: (level, message) => this.options.onLog?.(level, message),
    })
    this.runtime = runtime
    this.session = session

    this.installPointer(canvas, runtime, pkg.document)
    this.resize = new ResizeObserver(() => runtime.resize(host.clientWidth, host.clientHeight))
    this.resize.observe(host)
    runtime.resize(host.clientWidth, host.clientHeight)

    await this.session.start()
    runtime.start()
  }

  /**
   * Orbit, pan, dolly, and click-to-fire.
   *
   * The same 4-pixel threshold the editor uses to tell a drag from a click. Without it
   * every camera orbit that ends over an object fires that object's rules, which reads as
   * "it triggers randomly".
   */
  private installPointer(canvas: HTMLCanvasElement, runtime: SceneRuntime, doc: SceneDocument): void {
    let dragging: { x: number; y: number; button: number } | null = null
    let moved = 0

    const down = (event: PointerEvent) => {
      dragging = { x: event.clientX, y: event.clientY, button: event.button }
      moved = 0
      canvas.setPointerCapture(event.pointerId)
    }
    // Same 15 Hz throttle as the editor's preview. Both hosts pick and report; the
    // session owns the enter/leave state machine, so they cannot disagree about when a
    // hover began (C3).
    let lastHoverAt = 0
    const reportHover = (event: PointerEvent) => {
      if (event.timeStamp - lastHoverAt < 66) return
      lastHoverAt = event.timeStamp
      const rect = canvas.getBoundingClientRect()
      const hit = runtime.picker.pick(
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect.width,
        rect.height,
        runtime.camera.camera,
        doc,
      )
      this.session?.pointerOver(hit?.nodeId ?? null)
    }

    const move = (event: PointerEvent) => {
      reportHover(event)
      if (!dragging) return
      const dx = event.clientX - dragging.x
      const dy = event.clientY - dragging.y
      moved += Math.abs(dx) + Math.abs(dy)
      if (dragging.button === 0) runtime.camera.rotate(dx * 0.005, dy * 0.005)
      else runtime.camera.pan(dx, dy)
      dragging = { ...dragging, x: event.clientX, y: event.clientY }
    }
    const up = (event: PointerEvent) => {
      canvas.releasePointerCapture(event.pointerId)
      if (dragging && moved < 4) {
        const rect = canvas.getBoundingClientRect()
        const hit = runtime.picker.pick(
          event.clientX - rect.left,
          event.clientY - rect.top,
          rect.width,
          rect.height,
          runtime.camera.camera,
          doc,
        )
        if (hit) this.session?.click(hit.nodeId, hit.point, hit.distance)
      }
      dragging = null
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      runtime.camera.dolly(event.deltaY > 0 ? 1.1 : 0.9)
    }
    const contextMenu = (event: Event) => event.preventDefault()
    const leave = () => this.session?.pointerOver(null)

    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    canvas.addEventListener('contextmenu', contextMenu)

    this.detachPointer = () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('wheel', wheel)
      canvas.removeEventListener('contextmenu', contextMenu)
      canvas.removeEventListener('pointerleave', leave)
    }
  }

  dispose(): void {
    this.resize?.disconnect()
    this.detachPointer?.()
    this.session?.dispose()
    this.runtime?.dispose()
    this.canvas?.remove()
    this.overlay?.remove()
    this.session = null
    this.runtime = null
    this.canvas = null
    this.overlay = null
  }
}

