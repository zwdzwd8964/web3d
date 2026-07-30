import type { Transform } from '@w3/schema'
import { Box3, Object3D, Vector3 } from 'three'
import type { Camera } from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { SceneGraph } from './scene-graph.js'

/**
 * T-065 · the transform gizmo.
 *
 * Lives in core because it is pure three.js and ADR-0009 keeps the editor out of three
 * entirely. The editor supplies three callbacks and never touches an Object3D.
 *
 * The callback shape is what makes MVP_V0 D2 work: `onStart` / `onChange` × N / `onEnd`
 * maps exactly onto `previewStart` / `preview` / `previewCommit`, so one drag becomes one
 * undo entry instead of three hundred.
 *
 * Multi-selection drags a proxy object placed at the selection's bounding-box centre, and
 * reports each node's own resulting transform. Anchoring on the first selected node
 * instead would make the pivot jump when the selection order changed.
 */

export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type GizmoSpace = 'world' | 'local'

export interface GizmoCallbacks {
  /** Pointer down on a handle. The editor calls `previewStart()`. */
  readonly onStart?: () => void
  /** Every frame of the drag, with each selected node's new local transform. */
  readonly onChange?: (transforms: ReadonlyMap<string, Transform>) => void
  /** Pointer up. The editor calls `previewCommit(label)`. */
  readonly onEnd?: (transforms: ReadonlyMap<string, Transform>) => void
  /** Orbit controls must stand down while a handle is being dragged. */
  readonly onDraggingChanged?: (dragging: boolean) => void
}

export interface GizmoOptions extends GizmoCallbacks {
  readonly graph: SceneGraph
  readonly camera: Camera
  readonly domElement: HTMLElement
}

export class Gizmo {
  private controls: TransformControls
  /**
   * Since three 0.166 TransformControls is a `Controls`, not an Object3D — the handles
   * live on a separate helper. Visibility therefore has to be set there; setting it on
   * the controls silently does nothing, and the gizmo stays on screen after deselect.
   */
  private controlsHelper: Object3D
  private proxy = new Object3D()
  private selection: string[] = []
  private startWorld = new Map<string, { position: Vector3; quaternion: [number, number, number, number]; scale: Vector3 }>()
  private readonly graph: SceneGraph
  private readonly callbacks: GizmoCallbacks

  constructor(options: GizmoOptions) {
    this.graph = options.graph
    this.callbacks = options
    this.proxy.name = 'w3:gizmo-proxy'

    this.controls = new TransformControls(options.camera, options.domElement)
    this.controlsHelper = this.controls.getHelper() as unknown as Object3D
    this.controlsHelper.visible = false
    this.controls.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean((event as unknown as { value: boolean }).value)
      options.onDraggingChanged?.(dragging)
      if (dragging) this.beginDrag()
      else this.endDrag()
    })
    this.controls.addEventListener('objectChange', () => {
      if (this.selection.length === 0) return
      this.callbacks.onChange?.(this.readTransforms())
    })
  }

  /** The helper object that must be added to the scene for the handles to render. */
  get helper(): Object3D {
    return this.controlsHelper
  }

  get proxyObject(): Object3D {
    return this.proxy
  }

  get isDragging(): boolean {
    return this.controls.dragging
  }

  setMode(mode: GizmoMode): void {
    this.controls.setMode(mode)
  }

  setSpace(space: GizmoSpace): void {
    this.controls.setSpace(space)
  }

  setEnabled(enabled: boolean): void {
    this.controls.enabled = enabled
    this.controlsHelper.visible = enabled && this.selection.length > 0
  }

  /**
   * Points the gizmo at a selection.
   *
   * A single selection attaches directly to its object, so the handles sit on the object's
   * own pivot. Several attach to a proxy at the bounding-box centre — the only pivot that
   * does not depend on which node happened to be picked first.
   */
  attach(nodeIds: readonly string[]): void {
    this.selection = [...nodeIds]

    if (this.selection.length === 0) {
      this.controls.detach()
      this.controlsHelper.visible = false
      return
    }

    if (this.selection.length === 1) {
      const object = this.graph.objectFor(this.selection[0]!)
      if (!object) {
        this.controls.detach()
        this.controlsHelper.visible = false
        return
      }
      this.controls.attach(object)
      this.controlsHelper.visible = this.controls.enabled
      return
    }

    const box = new Box3()
    for (const id of this.selection) {
      const object = this.graph.objectFor(id)
      if (object) box.expandByObject(object)
    }
    if (box.isEmpty()) {
      this.controls.detach()
      return
    }
    this.proxy.position.copy(box.getCenter(new Vector3()))
    this.proxy.rotation.set(0, 0, 0)
    this.proxy.scale.set(1, 1, 1)
    this.proxy.updateMatrixWorld(true)
    this.controls.attach(this.proxy)
    this.controlsHelper.visible = this.controls.enabled
  }

  detach(): void {
    this.selection = []
    this.controls.detach()
    this.controlsHelper.visible = false
  }

  private beginDrag(): void {
    this.startWorld.clear()
    for (const id of this.selection) {
      const object = this.graph.objectFor(id)
      if (!object) continue
      this.startWorld.set(id, {
        position: object.position.clone(),
        quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
        scale: object.scale.clone(),
      })
    }
    this.callbacks.onStart?.()
  }

  private endDrag(): void {
    if (this.selection.length === 0) return
    this.callbacks.onEnd?.(this.readTransforms())
    this.startWorld.clear()
  }

  /** Each selected node's CURRENT local transform, in document shape. */
  private readTransforms(): Map<string, Transform> {
    const out = new Map<string, Transform>()

    if (this.selection.length > 1) {
      // The proxy carries the delta; apply it to each node's own recorded start state.
      this.proxy.updateMatrixWorld(true)
      for (const id of this.selection) {
        const object = this.graph.objectFor(id)
        const start = this.startWorld.get(id)
        if (!object || !start) continue
        object.position.copy(start.position).add(this.proxy.position)
        object.scale.copy(start.scale).multiply(this.proxy.scale)
        object.updateMatrix()
        out.set(id, toTransform(object))
      }
      return out
    }

    for (const id of this.selection) {
      const object = this.graph.objectFor(id)
      if (object) out.set(id, toTransform(object))
    }
    return out
  }

  dispose(): void {
    this.controls.detach()
    this.controls.dispose()
  }
}

function toTransform(object: Object3D): Transform {
  return {
    p: [round(object.position.x), round(object.position.y), round(object.position.z)],
    r: [round(object.quaternion.x), round(object.quaternion.y), round(object.quaternion.z), round(object.quaternion.w)],
    s: [round(object.scale.x), round(object.scale.y), round(object.scale.z)],
  }
}

const round = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6
  return Object.is(r, -0) ? 0 : r
}
