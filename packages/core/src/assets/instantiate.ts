import type { IdFactory, Node } from '@w3/schema'
import { ORDER_STEP, defaultIdFactory } from '@w3/schema'
import { Matrix4 } from 'three'
import type { Object3D } from 'three'
import { decompose } from './normalize.js'

/**
 * T-052 · SCHEMA_SPEC §5.1 · a glTF scene graph becomes document nodes.
 *
 * Two rules, and the second is the one that goes wrong silently:
 *
 * 1. **Collapse transport-only nodes.** Exporters emit unnamed Groups and single-child
 *    pass-through nodes by the hundred. Surfacing them drowns the hierarchy tree in
 *    noise the user cannot act on. A node is *meaningful* if it has a mesh, or a name
 *    and more than one child, or it is a scene root.
 *
 * 2. **A collapsed node's transform must be absorbed by its children.** Skipping a Group
 *    that carried a translation and dropping that translation is how a model arrives in
 *    pieces scattered around the origin. The walk therefore carries an accumulated
 *    matrix and bakes it into the next node it emits.
 *
 * `objectPath` always records the FULL original path, collapsing or not — it is the
 * remap ladder's tier-1 key (§5.3), and a collapsed path would stop matching after a
 * re-export that happened to keep the same structure.
 */

export interface InstantiateOptions {
  readonly assetId: string
  /** Applied to the emitted roots — unit and up-axis correction (§5.2). */
  readonly rootMatrix?: Matrix4
  readonly newId?: IdFactory
  /** Ids already used in the document, so a fresh node never collides. */
  readonly existingIds?: ReadonlySet<string>
  /** Emit a node for every object, however trivial. For debugging an import. */
  readonly collapse?: boolean
}

export interface InstantiateResult {
  readonly nodes: Node[]
  /** How many transport-only objects were folded away. Shown in the import report. */
  readonly collapsed: number
}

/**
 * SCHEMA_SPEC §5.1's "有意义的对象" test: a Mesh/SkinnedMesh, or a Group that has a
 * name OR more than one child.
 *
 * A name is sufficient on its own. Someone typed it, so it means something to them —
 * "Root", "Assembly", a single-child pivot they rotate around. The things §5.1 asks to
 * collapse are the ones nobody named: unnamed groups and unnamed single-child
 * pass-throughs, which exporters emit by the hundred.
 */
export function isMeaningful(object: Object3D): boolean {
  const asMesh = object as Object3D & { isMesh?: boolean; isSkinnedMesh?: boolean }
  if (asMesh.isMesh || asMesh.isSkinnedMesh) return true
  if (object.name !== '') return true
  return object.children.length > 1
}

export function instantiate(scene: Object3D, options: InstantiateOptions): InstantiateResult {
  const newId = options.newId ?? defaultIdFactory
  const taken = new Set(options.existingIds ?? [])
  const collapse = options.collapse ?? true
  const nodes: Node[] = []
  let collapsed = 0

  const mint = () => {
    const id = newId('node', taken)
    taken.add(id)
    return id
  }

  const orderByParent = new Map<string | null, number>()
  const nextOrder = (parent: string | null) => {
    const order = (orderByParent.get(parent) ?? 0) + ORDER_STEP
    orderByParent.set(parent, order)
    return order
  }

  /**
   * @param carried transform accumulated from ancestors that were collapsed away
   */
  const walk = (object: Object3D, parentId: string | null, pathPrefix: string, carried: Matrix4): void => {
    const name = object.name === '' ? object.type : object.name
    const path = pathPrefix === '' ? name : `${pathPrefix}/${name}`

    object.updateMatrix()
    const local = new Matrix4().multiplyMatrices(carried, object.matrix)

    if (collapse && !isMeaningful(object)) {
      collapsed++
      // Its transform lives on in `local`, which the next emitted descendant absorbs.
      for (const child of object.children) walk(child, parentId, path, local)
      return
    }

    const id = mint()
    nodes.push({
      id,
      name: object.name === '' ? object.type : object.name,
      parent: parentId,
      order: nextOrder(parentId),
      assetRef: {
        assetId: options.assetId,
        // Full original path, never the collapsed one — §5.3 tier 1 depends on it.
        objectPath: path,
        objectName: object.name === '' ? object.type : object.name,
        missing: false,
      },
      transform: decompose(local),
      visible: object.visible,
      locked: false,
      overrides: {},
    })

    const identity = new Matrix4()
    for (const child of object.children) walk(child, id, path, identity)
  }

  const rootMatrix = options.rootMatrix ?? new Matrix4()
  for (const child of scene.children) walk(child, null, '', rootMatrix)

  return { nodes, collapsed }
}
