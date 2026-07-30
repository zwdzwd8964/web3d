import type { Transform } from '@w3/schema'
import { Gizmo, SceneRuntime, createMemoryResolver } from '@w3/core'
import type { GizmoMode, GizmoSpace } from '@w3/core'
import { useEffect, useRef, useState } from 'react'
import { useDocumentActions, useDocumentSelector, useDocumentStore } from '../store/StoreContext.js'
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<SceneRuntime | null>(null)
  const gizmoRef = useRef<Gizmo | null>(null)

  const store = useDocumentStore()
  const { previewStart, preview, previewCommit, toggleSelection, clearSelection } = useDocumentActions()
  const selection = useDocumentSelector((s) => s.selection)

  const [mode, setMode] = useState<GizmoMode>('translate')
  const [space, setSpace] = useState<GizmoSpace>('world')
  const [ready, setReady] = useState(false)

  // Mount once. The document is read from the store rather than passed as a prop so a
  // document change never remounts the renderer — that would drop the GPU context.
  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    const runtime = new SceneRuntime(store.getState().doc, {
      canvas,
      // Assets come from storage in T-066; until then the runtime builds placeholders.
      resolver: createMemoryResolver(new Map()),
      mode: 'edit',
      onLog: (level, message) => {
        if (level !== 'debug') console.warn(`[runtime] ${message}`)
      },
    })
    runtimeRef.current = runtime
    setActiveRuntime(runtime)

    const gizmo = new Gizmo({
      graph: runtime.graph,
      camera: runtime.camera.camera,
      domElement: canvas,
      onStart: () => previewStart(),
      onChange: (transforms: ReadonlyMap<string, Transform>) =>
        preview((draft) => writeTransforms(draft.nodes, transforms)),
      // D2 · one drag, one undo entry.
      onEnd: () => previewCommit(mode === 'translate' ? '移动对象' : mode === 'rotate' ? '旋转对象' : '缩放对象'),
    })
    gizmoRef.current = gizmo
    runtime.scene.add(gizmo.helper, gizmo.proxyObject)

    void runtime.load(store.getState().doc).then(() => setReady(true))
    runtime.start()

    const resize = new ResizeObserver(() => runtime.resize(host.clientWidth, host.clientHeight))
    resize.observe(host)

    return () => {
      resize.disconnect()
      gizmo.dispose()
      runtime.dispose()
      setActiveRuntime(null)
      runtimeRef.current = null
      gizmoRef.current = null
    }
    // Mount-only on purpose; everything else is pushed in through refs and the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    gizmoRef.current?.attach(selection)
  }, [selection, ready])

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
    if (!canvas || !host) return

    let dragging: { x: number; y: number; button: number } | null = null
    let moved = 0

    const down = (event: PointerEvent) => {
      if (gizmoRef.current?.isDragging) return
      dragging = { x: event.clientX, y: event.clientY, button: event.button }
      moved = 0
      canvas.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      const runtime = runtimeRef.current
      if (!dragging || !runtime || gizmoRef.current?.isDragging) return
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
      if (dragging && moved < 4 && runtime && !gizmoRef.current?.isDragging) {
        const rect = canvas.getBoundingClientRect()
        const hit = runtime.picker.pick(
          event.clientX - rect.left,
          event.clientY - rect.top,
          rect.width,
          rect.height,
          runtime.camera.camera,
          store.getState().doc,
        )
        if (hit) toggleSelection(hit.nodeId, event.ctrlKey || event.metaKey)
        else if (!event.ctrlKey && !event.metaKey) clearSelection()
      }
      dragging = null
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      runtimeRef.current?.camera.dolly(event.deltaY > 0 ? 1.1 : 0.9)
    }
    const contextMenu = (event: Event) => event.preventDefault()

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
    }
  }, [store, toggleSelection, clearSelection])

  return (
    <div className="viewport" ref={hostRef}>
      <canvas className="viewport__canvas" ref={canvasRef} />
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
        <button type="button" className="tbtn" onClick={() => runtimeRef.current?.camera.frameAll()}>
          全览
        </button>
      </div>
    </div>
  )
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
