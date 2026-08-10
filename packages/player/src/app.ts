import { createPackageResolver } from '@w3/storage'
import type { SceneDocument } from '@w3/schema'
import type { CapabilityReport } from '@w3/core'
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
  /**
   * T-273 · 场景起来之后交出会话与运行时，**一次**。
   *
   * ⚠ **不做成 public getter。** 一个 `player.session` / `player.runtime` 意味着页面上
   * 任何拿得到 Player 的代码都能绕过嵌入控制器直接改场景——而控制器存在的全部理由，
   * 就是宿主只能通过一条受检的通道说话。回调只在装配时被调一次，拿到的人是装配它的人。
   */
  readonly onSession?: (parts: { session: PlaybackSession; runtime: SceneRuntime }) => void
  /**
   * T-273 · 这台机器跑不了，说出去。
   *
   * 页面里那句中文提示在 iframe 里，**宿主的 JS 读不到它**——不发这一条，宿主看到的
   * 就是一个永远不响应的黑框。
   */
  readonly onUnsupported?: (capability: CapabilityReport) => void
}

export class Player {
  private session: PlaybackSession | null = null
  private runtime: SceneRuntime | null = null
  private canvas: HTMLCanvasElement | null = null
  private overlay: HTMLDivElement | null = null
  private resize: ResizeObserver | null = null
  private detachPointer: (() => void) | null = null
  private detachLifecycle: (() => void) | null = null

  /**
   * T-273 · 跑不跑，由三个输入量的**与**决定。
   *
   * 三个各自只被一处改：`hostWantsPlay` 只由 `pause()` / `resume()` 改，
   * `documentVisible` 只由 `visibilitychange` 改，`onScreen` 只由 `IntersectionObserver` 改。
   *
   * **不许在三处各自 start/stop。** 那样写的话，标签页切走再切回来会无条件 `start()`，
   * 把宿主刚 `pause()` 的播放器又跑起来——而宿主并没有再点过播放。与门让「谁都可以
   * 摁住，只有全部松开才跑」成为结构，而不是一句要记住的纪律。
   */
  private hostWantsPlay = true
  private documentVisible = true
  private onScreen = true

  constructor(private readonly options: PlayerOptions) {}

  async start(): Promise<void> {
    const { host } = this.options

    // Before anything is built: a black page with a console message is not an error
    // report (T-111 / ADR-0013).
    const capability = detectCapability()
    if (capability.level === 'unsupported') {
      renderCapabilityNotice(host, capability)
      // T-273 · **不能直接 return。** 嵌入时宿主看到的是一个黑框，而它无从知道原因——
      // 页面里那句中文提示在 iframe 里，宿主的 JS 读不到。把这件事从通道里说出去：
      // 宿主拿到一次 `ready`（我起来了）加一次 `error`（但我跑不了，原因是这个）。
      this.options.onUnsupported?.(capability)
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
    // T-162 · the SAME resolver the runtime reads assets through, so a hotspot's image comes
    // out of the package it arrived in rather than a second path that could drift (C3, C6).
    const resolver = createPackageResolver(pkg)
    const { runtime, session } = createPlayerSession({
      pkg,
      canvas,
      resolver,
      hotspotRenderer: new DomHotspotRenderer({
        container: overlay,
        resolveMedia: (url) => resolver.resolve(url),
        onWarn: (message) => this.options.onLog?.('warn', message),
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
    // 起点由与门决定，而不是无条件 `start()`：嵌入宿主可能在场景加载完之前就已经
    // `pause()` 过了（例如它想先自己布好局再放）。
    this.applyRunState()
    this.installLifecycle(host)
    this.options.onSession?.({ session: this.session, runtime })

    if (import.meta.env.DEV) {
      // DEV-only, stripped from production builds. See the editor's equivalent.
      ;(globalThis as Record<string, unknown>)['__w3DevLocate'] = (nodeId: string) =>
        runtime.projectToScreen(nodeId)
      ;(globalThis as Record<string, unknown>)['__w3DevNodes'] = () =>
        pkg.document.nodes.map((n) => ({ id: n.id, name: n.name }))
    }
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

  /** 宿主要求暂停。三个输入量之一。 */
  pause(): void {
    this.hostWantsPlay = false
    this.applyRunState()
  }

  /** 宿主要求继续。**不保证真的跑起来**——另外两个输入量也得松开。 */
  resume(): void {
    this.hostWantsPlay = true
    this.applyRunState()
  }

  /** 与门的唯一落点。全仓只有这一处调 `runtime.start()` / `runtime.stop()`。 */
  private applyRunState(): void {
    const shouldRun = this.hostWantsPlay && this.documentVisible && this.onScreen
    if (shouldRun) this.runtime?.start()
    else this.runtime?.stop()
  }

  /**
   * 装上两个「省电」输入量。**各自只改一个量**，然后一起交给与门。
   *
   * `IntersectionObserver` 在老内核上可能不存在——那时候 `onScreen` 保持 true，
   * 退化成「只看可见性」，而不是整个播放器不跑。
   */
  private installLifecycle(host: HTMLElement): void {
    const onVisibility = (): void => {
      this.documentVisible = document.visibilityState !== 'hidden'
      this.applyRunState()
    }
    document.addEventListener('visibilitychange', onVisibility)

    let observer: IntersectionObserver | null = null
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        this.onScreen = entry.isIntersecting
        this.applyRunState()
      })
      observer.observe(host)
    }

    this.detachLifecycle = () => {
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
    }
  }

  dispose(): void {
    this.resize?.disconnect()
    this.detachLifecycle?.()
    this.detachPointer?.()
    this.session?.dispose()
    this.runtime?.dispose()
    this.canvas?.remove()
    this.overlay?.remove()
    this.detachLifecycle = null
    this.session = null
    this.runtime = null
    this.canvas = null
    this.overlay = null
  }
}


