import type { Node, SceneDocument } from '@w3/schema'
import { Group, Mesh, Object3D, Quaternion, Vector3 } from 'three'
import type { AssetSource, NodeUserData } from './types.js'
import { EMPTY_ASSET_SOURCE } from './types.js'

/**
 * T-033 · document nodes -> a three scene graph, with a two-way map between them.
 *
 * Two rules make everything downstream work:
 *
 *  1. **One document node materialises exactly one Object3D, without the source
 *     object's children.** The importer (T-052) already flattened the asset into one
 *     document node per meaningful object, so pulling a GLB object's children along
 *     would duplicate every mesh — once as a child of its own node, once as its own.
 *
 *  2. **The document's transform is the authority, not the asset's.** Import bakes the
 *     source transform into `node.transform`; re-applying the asset's own here would
 *     double it. This is also why swapping the source asset keeps the user's layout.
 */

export interface SceneGraphOptions {
  readonly assets?: AssetSource
}

export class SceneGraph {
  /** Everything the document owns hangs off this. Lights and helpers do not. */
  readonly root = new Group()

  private objects = new Map<string, Object3D>()
  private assets: AssetSource
  private materialised = new Map<string, boolean>()

  constructor(options: SceneGraphOptions = {}) {
    this.root.name = 'w3:document-root'
    this.assets = options.assets ?? EMPTY_ASSET_SOURCE
  }

  setAssetSource(source: AssetSource): void {
    this.assets = source
  }

  /** The Object3D representing a document node. */
  objectFor(nodeId: string): Object3D | undefined {
    return this.objects.get(nodeId)
  }

  /** True when this node is a stand-in because its asset is missing or still loading. */
  isPlaceholder(nodeId: string): boolean {
    return this.materialised.get(nodeId) === false
  }

  get size(): number {
    return this.objects.size
  }

  /**
   * Walks up from a hit object to the document node that owns it.
   *
   * A raycast lands on whatever geometry it hit, which may be nested inside the object
   * a node materialised. Returning null rather than guessing keeps a stray helper or
   * gizmo from being reported as a scene node.
   */
  nodeIdFor(object: Object3D | null): string | null {
    let cursor: Object3D | null = object
    while (cursor) {
      const id = (cursor.userData as NodeUserData).w3NodeId
      if (typeof id === 'string') return id
      cursor = cursor.parent
    }
    return null
  }

  /** Rebuilds the whole graph. The fallback path — normal edits go through applyPatch. */
  build(doc: SceneDocument): void {
    this.clear()
    // Depth-first from the roots so a parent always exists before its children.
    const byParent = new Map<string | null, Node[]>()
    for (const node of doc.nodes) {
      const list = byParent.get(node.parent) ?? []
      list.push(node)
      byParent.set(node.parent, list)
    }
    for (const list of byParent.values()) list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

    const visited = new Set<string>()
    const walk = (parentId: string | null, parentObject: Object3D) => {
      for (const node of byParent.get(parentId) ?? []) {
        if (visited.has(node.id)) continue // a corrupted parent chain must not hang the build
        visited.add(node.id)
        const object = this.createObject(node)
        parentObject.add(object)
        this.objects.set(node.id, object)
        walk(node.id, object)
      }
    }
    walk(null, this.root)
  }

  private createObject(node: Node): Object3D {
    const source = this.sourceObjectFor(node)
    const object = source ? materialise(source) : new Group()

    // Two different empty groups, and conflating them would be a bug the user sees:
    //  - `assetRef === null`  the user made a grouping node. Nothing is wrong.
    //  - `assetRef` set but unresolved: the asset is still loading, or the object is
    //    gone after a re-import (D5). The hierarchy tree must flag this one.
    const isPlaceholder = node.assetRef !== null && source === null
    this.materialised.set(node.id, !isPlaceholder)

    object.name = node.name
    ;(object.userData as NodeUserData).w3NodeId = node.id
    if (isPlaceholder) (object.userData as NodeUserData).w3Placeholder = true

    applyTransformTo(object, node)
    object.visible = node.visible
    return object
  }

  private sourceObjectFor(node: Node): Object3D | null {
    const ref = node.assetRef
    // An orphaned ref keeps the node in the tree as an empty group — D5's "mark, never
    // delete" has to hold in the renderer too, or the warning icon would point at nothing.
    if (!ref || ref.missing) return null
    return this.assets.get(ref.assetId)?.objects.get(ref.objectPath) ?? null
  }

  /* --- incremental mutations, used by applyPatch ------------------------- */

  setTransform(nodeId: string, node: Node): boolean {
    const object = this.objects.get(nodeId)
    if (!object) return false
    applyTransformTo(object, node)
    return true
  }

  setVisible(nodeId: string, visible: boolean): boolean {
    const object = this.objects.get(nodeId)
    if (!object) return false
    object.visible = visible
    return true
  }

  setName(nodeId: string, name: string): boolean {
    const object = this.objects.get(nodeId)
    if (!object) return false
    object.name = name
    return true
  }

  /**
   * Re-parents without rebuilding. Refuses a move into the node's own subtree —
   * the editor blocks it at the drop (SCHEMA_SPEC §4.2), and this is the second line.
   */
  setParent(nodeId: string, parentId: string | null): boolean {
    const object = this.objects.get(nodeId)
    if (!object) return false
    const target = parentId === null ? this.root : this.objects.get(parentId)
    if (!target) return false
    for (let cursor: Object3D | null = target; cursor; cursor = cursor.parent) {
      if (cursor === object) return false
    }
    target.add(object) // three detaches from the previous parent
    return true
  }

  /** Adds one node without touching the rest of the tree. */
  addNode(node: Node): Object3D | null {
    if (this.objects.has(node.id)) return null
    const parent = node.parent === null ? this.root : this.objects.get(node.parent)
    if (!parent) return null
    const object = this.createObject(node)
    parent.add(object)
    this.objects.set(node.id, object)
    return object
  }

  /** Removes a node and everything under it, disposing geometry it owns. */
  removeNode(nodeId: string): boolean {
    const object = this.objects.get(nodeId)
    if (!object) return false
    for (const id of this.subtreeIds(nodeId)) this.objects.delete(id)
    object.parent?.remove(object)
    disposeSubtree(object)
    return true
  }

  private subtreeIds(nodeId: string): string[] {
    const object = this.objects.get(nodeId)
    if (!object) return []
    const out: string[] = []
    object.traverse((child) => {
      const id = (child.userData as NodeUserData).w3NodeId
      if (typeof id === 'string') out.push(id)
    })
    return out
  }

  clear(): void {
    for (const child of [...this.root.children]) {
      this.root.remove(child)
      disposeSubtree(child)
    }
    this.objects.clear()
    this.materialised.clear()
  }

  dispose(): void {
    this.clear()
  }
}

const _position = new Vector3()
const _quaternion = new Quaternion()
const _scale = new Vector3()

function applyTransformTo(object: Object3D, node: Node): void {
  const { p, r, s } = node.transform
  _position.set(p[0], p[1], p[2])
  _quaternion.set(r[0], r[1], r[2], r[3])
  _scale.set(s[0], s[1], s[2])
  object.position.copy(_position)
  object.quaternion.copy(_quaternion)
  object.scale.copy(_scale)
  object.updateMatrix()
}

/**
 * Makes an instance of one asset object: its geometry and material, none of its
 * children, and none of its transform. See the two rules in the class doc.
 */
function materialise(source: Object3D): Object3D {
  if ((source as Mesh).isMesh) {
    const mesh = source as Mesh
    // Geometry is shared on purpose: instances of the same part must not each carry
    // their own copy of a 128k-triangle buffer. Materials are handled separately by
    // MaterialRegistry, which clones only when a node actually overrides one (D3).
    return new Mesh(mesh.geometry, mesh.material)
  }
  return new Group()
}

/** Frees GPU-side resources for a detached subtree. Materials belong to the registry. */
export function disposeSubtree(root: Object3D): void {
  root.traverse((child) => {
    const mesh = child as Mesh
    if (mesh.isMesh) mesh.geometry?.dispose()
  })
}
