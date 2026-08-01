import type { Transform } from '@w3/schema'
import { DomHotspotRenderer, Gizmo, SceneRuntime } from '@w3/core'
import type { GizmoMode, GizmoSpace } from '@w3/core'
import { useEffect, useRef, useState } from 'react'
import { usePreview, usePreviewStore } from '../preview/PreviewContext.jsx'
import { PreviewController } from '../preview/controller.js'
import { useProject } from '../project/ProjectContext.jsx'
import { useDocumentActions, useDocumentSelector, useDocumentStore } from '../store/StoreContext.js'
import { importLibraryItem } from '../lib/library.js'
import { acceptsDrag, endDrag, getDrag } from './drag.js'
import { DropController } from './drop-controller.js'
import { boundsOfPrimitive, resolveDropPoint, restOnPoint } from './place.js'
import { SnapToolbar } from './SnapToolbar.js'
import { ANGLE_STEP_DEG, getSnap, onSnapChange } from './snap.js'
import { fulfilPick, isPicking } from './pick-request.js'
import { patchesSettled } from './runtime-bridge.js'
import { setActiveRuntime } from './runtime-registry.js'

/**
 * T-062 + T-065 · the viewport.
 *
 * ADR-0009: no React Three Fiber. This component owns a bare `<canvas>` and hands it to
 * `SceneRuntime`; React never describes the 3D scene. That is what keeps the editor's
 * preview and the player on one code path (C3) and what lets D1's incremental patch
 * application mean anything.
 *
 * ECA stays disabled here (ECA_SPEC §7): in edit mode a click selects, it does not fire
 * rules — otherwise an object configured with a click interaction could not be edited.
 */

export function Viewport() {
  const hostRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const runtimeRef = useRef<SceneRuntime | null>(null)
  const gizmoRef = useRef<Gizmo | null>(null)

  const session = useProject()
  const store = useDocumentStore()
  const previewStore = usePreviewStore()
  const previewActive = usePreview((s) => s.active)
  const controllerRef = useRef<PreviewController | null>(null)
  // `commit` is deliberately absent: since T-146 every drop goes through `DropController`,
  // which uses the preview channel and collapses the whole gesture into one entry.
  const { previewStart, preview, previewCommit, previewAbort, toggleSelection, clearSelection, select } =
    useDocumentActions()
  const selection = useDocumentSelector((s) => s.selection)

  const [mode, setMode] = useState<GizmoMode>('translate')
  const [space, setSpace] = useState<GizmoSpace>('world')
  const [ready, setReady] = useState(false)
  /** A failed library import has to say so; the drop looked like it worked. */
  const [dropError, setDropError] = useState<string | null>(null)

  // Read inside the mount-only effect's callbacks, which would otherwise close over the
  // value `mode` had at mount and label every drag "移动对象".
  const modeRef = useRef<GizmoMode>(mode)
  modeRef.current = mode

  /**
   * Set by the gizmo's own dragging-changed event.
   *
   * Checking `gizmo.isDragging` is not enough: TransformControls clears it during its
   * pointerup handler, and whether that runs before or after ours is not defined. The
   * observable symptom is a click-select firing as you release a gizmo handle, which
   * changes the selection out from under the drag that just finished.
   */
  const gizmoDragging = useRef(false)

  // Mount once. The document is read from the store rather than passed as a prop so a
  // document change never remounts the renderer — that would drop the GPU context.
  useEffect(() => {
    const host = hostRef.current
    const overlay = overlayRef.current
    if (!host || !overlay) return

    // The canvas is created here rather than rendered by React on purpose.
    //
    // StrictMode mounts, unmounts and remounts every effect in development. Our cleanup
    // disposes the WebGLRenderer, which force-loses the GL context — and with a
    // JSX-rendered canvas the second mount got the SAME DOM element, now holding a dead
    // context. The observable symptom was `CONTEXT_LOST_WEBGL` on every cold start. A
    // fresh element per mount makes the double-invoke harmless, which is the point of
    // the double-invoke.
    const canvas = document.createElement('canvas')
    canvas.className = 'viewport__canvas'
    host.insertBefore(canvas, overlay)
    canvasRef.current = canvas

    const runtime = new SceneRuntime(store.getState().doc, {
      canvas,
      // One resolver for the whole editor, shared with the asset panel's importer. Two
      // of them is how "the tree grew but the viewport stayed empty" happened.
      resolver: session.resolver,
      mode: 'edit',
      hotspotRenderer: new DomHotspotRenderer({
        container: overlay,
        // T-162 · the SAME resolver the runtime uses, so a hotspot's image comes out of the
        // project's own storage rather than a second path that could drift (C3).
        resolveMedia: (url) => session.resolver.resolve(url),
        onWarn: (message) => console.warn(`[hotspot] ${message}`),
        // Edit mode selects; it does not fire rules (ECA_SPEC §7). Clicking a marker
        // selects the node it is anchored to, which is what you want when placing them.
        // C3 · in preview a hotspot click is an ECA event, exactly as in the player.
        // It used to always select the anchored node, which meant a `hotspotClick` rule
        // silently did nothing in the editor and worked in the player — the textbook
        // shape of "编辑器里是这样、发布出来不一样", and invisible to parity because both
        // sides of the harness were dispatching it directly.
        onActivate: (hotspotId) => {
          const controller = controllerRef.current
          if (controller?.isActive) {
            controller.dispatchHotspotClick(hotspotId)
            return
          }
          const hotspot = store.getState().doc.hotspots.find((h) => h.id === hotspotId)
          if (hotspot) toggleSelection(hotspot.anchor.nodeId, false)
        },
      }),
      onLog: (level, message) => {
        if (level !== 'debug') console.warn(`[runtime] ${message}`)
      },
    })
    runtimeRef.current = runtime
    setActiveRuntime(runtime)
    controllerRef.current = new PreviewController(runtime, previewStore)

    const gizmo = new Gizmo({
      graph: runtime.graph,
      camera: runtime.camera.camera,
      domElement: canvas,
      onStart: () => previewStart(),
      onChange: (transforms: ReadonlyMap<string, Transform>) =>
        preview((draft) => writeTransforms(draft.nodes, transforms)),
      // D2 · one drag, one undo entry.
      onEnd: () => previewCommit(LABELS[modeRef.current]),
      onDraggingChanged: (dragging) => {
        gizmoDragging.current = dragging
      },
    })
    gizmoRef.current = gizmo
    // T-143 · the gizmo lives outside React, so it subscribes to the session store rather
    // than being re-rendered with a prop. Applied immediately too: a viewport remounted
    // mid-session must not silently forget the grid the user is working on.
    const applySnap = (settings: { translate: number | null; rotate: boolean }) =>
      gizmo.setSnap({ translate: settings.translate, rotateDeg: settings.rotate ? ANGLE_STEP_DEG : null })
    applySnap(getSnap())
    const unsubscribeSnap = onSnapChange(applySnap)
    runtime.scene.add(gizmo.helper, gizmo.proxyObject)

    let cancelled = false
    void (async () => {
      await runtime.load(store.getState().doc)
      if (cancelled) return
      setReady(true)
    })()
    runtime.start()

    const resize = new ResizeObserver(() => runtime.resize(host.clientWidth, host.clientHeight))
    resize.observe(host)

    return () => {
      cancelled = true
      unsubscribeSnap()
      resize.disconnect()
      controllerRef.current?.dispose()
      controllerRef.current = null
      gizmo.dispose()
      runtime.dispose()
      canvas.remove()
      setActiveRuntime(null)
      runtimeRef.current = null
      gizmoRef.current = null
      canvasRef.current = null
    }
    // Mount-only on purpose; everything else is pushed in through refs and the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // ECA_SPEC §7 · the gizmo belongs to edit mode. Leaving it attached during preview
    // would put a translate handle on top of whatever the viewer is looking at.
    gizmoRef.current?.attach(previewActive ? [] : selection)
  }, [selection, ready, previewActive])

  useEffect(() => {
    // …and so do the grid and the light helpers. Preview keeps the edit-mode runtime, so
    // everything `mode: 'edit'` built is still in the scene unless it is taken away here.
    // Left in, 「预览」 shows a grid and light wireframes the player never draws, and a
    // click that lands on a helper does not reach the object the viewer aimed at (C3).
    if (!ready) return
    runtimeRef.current?.setEditorChromeVisible(!previewActive)
  }, [previewActive, ready])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller || !ready) return
    if (previewActive) void controller.enter(store.getState().doc)
    else if (controller.isActive) controller.exit()
  }, [previewActive, ready, store])

  // Rules edited mid-preview take effect immediately; the engine's dispatch index is
  // derived from the document and would otherwise keep firing the old ones.
  useEffect(() => {
    if (!previewActive) return
    let previous = store.getState().doc
    const unsubscribe = store.subscribe((state) => {
      if (state.doc === previous) return
      previous = state.doc
      controllerRef.current?.onDocumentChanged(state.doc)
      controllerRef.current?.syncVariables(state.doc)
    })
    return unsubscribe
  }, [previewActive, store])

  // Variable values are runtime state, not document state, so nothing else would notice
  // them changing. Polled on an interval rather than per frame: the panel is for reading,
  // and sixty updates a second of a number nobody can read that fast is pure waste.
  useEffect(() => {
    if (!previewActive) return
    const handle = setInterval(() => controllerRef.current?.syncVariables(store.getState().doc), 100)
    return () => clearInterval(handle)
  }, [previewActive, store])

  useEffect(() => {
    gizmoRef.current?.setMode(mode)
  }, [mode])

  useEffect(() => {
    gizmoRef.current?.setSpace(space)
  }, [space])

  // Camera orbit. Skipped while a gizmo handle is being dragged, or the camera would
  // chase the pointer that is moving the object.
  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    // `ready` is in the dependency list so this re-runs once the mount effect has created
    // the canvas; on the first pass there is nothing to bind to yet.
    if (!canvas || !host) return

    let dragging: { x: number; y: number; button: number } | null = null
    let moved = 0

    const down = (event: PointerEvent) => {
      if (gizmoDragging.current) return
      dragging = { x: event.clientX, y: event.clientY, button: event.button }
      moved = 0
      canvas.setPointerCapture(event.pointerId)
    }
    /**
     * Hover, in preview only.
     *
     * Throttled to ~15 Hz: this raycasts, and a raycast per pointermove on a 30k-triangle
     * model is a measurable frame cost for an event whose rules cannot possibly need
     * sub-frame precision.
     */
    let lastHoverAt = 0
    const reportHover = (event: PointerEvent) => {
      const controller = controllerRef.current
      const runtime = runtimeRef.current
      if (!controller?.isActive || !runtime) return
      const stamp = event.timeStamp
      if (stamp - lastHoverAt < 66) return
      lastHoverAt = stamp

      const rect = canvas.getBoundingClientRect()
      const hit = runtime.picker.pick(
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect.width,
        rect.height,
        runtime.camera.camera,
        store.getState().doc,
      )
      controller.dispatchPointerOver(hit?.nodeId ?? null)
    }

    const move = (event: PointerEvent) => {
      const runtime = runtimeRef.current
      reportHover(event)
      if (!dragging || !runtime || gizmoDragging.current) return
      const dx = event.clientX - dragging.x
      const dy = event.clientY - dragging.y
      moved += Math.abs(dx) + Math.abs(dy)
      if (dragging.button === 0) runtime.camera.rotate(dx * 0.005, dy * 0.005)
      else runtime.camera.pan(dx, dy)
      dragging = { ...dragging, x: event.clientX, y: event.clientY }
    }
    const up = (event: PointerEvent) => {
      const runtime = runtimeRef.current
      canvas.releasePointerCapture(event.pointerId)
      // A drag is a camera move; only a still click is a selection.
      if (dragging && moved < 4 && runtime && !gizmoDragging.current) {
        const rect = canvas.getBoundingClientRect()
        const hit = runtime.picker.pick(
          event.clientX - rect.left,
          event.clientY - rect.top,
          rect.width,
          rect.height,
          runtime.camera.camera,
          store.getState().doc,
        )

        // Three meanings for one click, in priority order. The rule editor's "拾取" wins
        // because the user just armed it; preview wins over selection because in preview
        // the click belongs to the scene, not to the editor (ECA_SPEC §7).
        if (hit && isPicking()) {
          fulfilPick(hit.nodeId)
        } else if (controllerRef.current?.isActive) {
          if (hit) controllerRef.current.dispatchClick(hit.nodeId, hit.point, hit.distance)
        } else if (hit) {
          toggleSelection(hit.nodeId, event.ctrlKey || event.metaKey)
        } else if (!event.ctrlKey && !event.metaKey) {
          clearSelection()
        }
      }
      dragging = null
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      runtimeRef.current?.camera.dolly(event.deltaY > 0 ? 1.1 : 0.9)
    }
    const contextMenu = (event: Event) => event.preventDefault()
    // Leaving the canvas is a hoverLeave; without it the last hovered object stays
    // "entered" forever and its leave rule never runs.
    const leave = () => controllerRef.current?.dispatchPointerOver(null)

    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    canvas.addEventListener('contextmenu', contextMenu)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('wheel', wheel)
      canvas.removeEventListener('contextmenu', contextMenu)
      canvas.removeEventListener('pointerleave', leave)
    }
  }, [store, toggleSelection, clearSelection, ready])

  /**
   * T-142 · D18 · a drop from the resource library.
   *
   * One `commit` for the whole placement — the node, its material record, and the position
   * the drop resolved to. Ctrl+Z takes all of it away, which is what "一次放置 = 一条撤销"
   * means and what the E2E asserts.
   *
   * The document is read from the store rather than from this render's closure: a library
   * model import is async, and committing against a stale document would resurrect whatever
   * the user changed while it ran.
   */
  const dropRef = useRef<DropController | null>(null)
  if (!dropRef.current) {
    dropRef.current = new DropController({
      previewStart,
      preview,
      previewCommit,
      previewAbort,
      select,
      boundsOf: (ids) => runtimeRef.current?.boundsOf(ids) ?? null,
      settle: patchesSettled,
      importItem: (item) =>
        importLibraryItem({
          item,
          doc: store.getState().doc,
          storage: session.storage,
          loader: session.loader,
          // The app's own origin, from the document itself — never a constant (C6).
          base: document.baseURI,
        }),
      onError: (message) => setDropError(message),
    })
  }

  /** Pointer position in canvas coordinates, or null when there is no canvas yet. */
  const pointerOf = (event: React.DragEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height }
  }

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    // `dataTransfer.getData` is unreadable during dragover (protected mode), so what is
    // being dragged comes from the session store and only the TYPES are read here.
    if (!acceptsDrag(Array.from(event.dataTransfer.types))) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'

    const payload = getDrag()
    const runtime = runtimeRef.current
    const pointer = pointerOf(event)
    if (!payload || !runtime || !pointer) return
    dropRef.current?.over(payload, (primitive, exclude) =>
      restOnPoint(
        resolveDropPoint(runtime, store.getState().doc, pointer, { exclude }).point,
        boundsOfPrimitive(primitive),
      ),
    )
  }

  /**
   * The pointer left the viewport — roll the ghost back.
   *
   * `relatedTarget` guards against the leave that fires when the pointer crosses onto a
   * CHILD of the viewport (the overlay, the toolbar): without it the ghost would flicker
   * out of existence every time the cursor passed over the tools row.
   */
  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (next instanceof globalThis.Node && event.currentTarget.contains(next)) return
    dropRef.current?.leave()
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!acceptsDrag(Array.from(event.dataTransfer.types))) return
    event.preventDefault()

    const payload = getDrag()
    const runtime = runtimeRef.current
    const pointer = pointerOf(event)
    endDrag()
    if (!payload || !runtime || !pointer) {
      dropRef.current?.leave()
      return
    }

    setDropError(null)
    void dropRef.current?.drop(
      payload,
      (primitive, exclude) =>
        restOnPoint(
          resolveDropPoint(runtime, store.getState().doc, pointer, { exclude }).point,
          boundsOfPrimitive(primitive),
        ),
      () => resolveDropPoint(runtime, store.getState().doc, pointer).point,
    )
  }

  return (
    <div
      className="viewport"
      ref={hostRef}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* The canvas is inserted before this overlay by the mount effect. */}
      <div className="viewport__overlay" ref={overlayRef} />
      <div className="viewport__tools">
        <div className="seg">
          {(['translate', 'rotate', 'scale'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === 'translate' ? '移动' : m === 'rotate' ? '旋转' : '缩放'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="tbtn"
          onClick={() => setSpace(space === 'world' ? 'local' : 'world')}
          title="切换世界 / 局部坐标系"
        >
          {space === 'world' ? '世界' : '局部'}
        </button>
        <SnapToolbar />
        <button type="button" className="tbtn" onClick={() => runtimeRef.current?.camera.frameAll()}>
          全览
        </button>
      </div>
      {dropError !== null && (
        <div className="viewport__note" role="status">
          {dropError}
          <button type="button" className="tbtn" onClick={() => setDropError(null)}>
            知道了
          </button>
        </div>
      )}
    </div>
  )
}

const LABELS: Record<GizmoMode, string> = {
  translate: '移动对象',
  rotate: '旋转对象',
  scale: '缩放对象',
}

/** Writes the gizmo's reported transforms onto the draft. */
function writeTransforms(nodes: { id: string; transform: Transform }[], transforms: ReadonlyMap<string, Transform>) {
  for (const node of nodes) {
    const next = transforms.get(node.id)
    if (!next) continue
    node.transform.p = [...next.p]
    node.transform.r = [...next.r]
    node.transform.s = [...next.s]
  }
}
