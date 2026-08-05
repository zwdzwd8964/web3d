import type { FactoryContext, Node, SceneDocument, Vec3 } from '@w3/schema'
import { ORDER_STEP, collectAllIds, defaultFactoryContext, getAppendOrder } from '@w3/schema'

/**
 * T-144 · copy, paste and duplicate.
 *
 * Four decisions, each of which has a wrong answer that looks reasonable:
 *
 * **The whole subtree, never a lone node.** Copying 泵组 and getting an empty group is not
 * a copy of anything. Selecting a parent and one of its children copies the parent once,
 * not the child twice.
 *
 * **Every node gets a new id, and parent links are remapped INSIDE the copy.** A pasted
 * subtree that still points at the original's children would hand two nodes the same child
 * — three would silently reparent it, and the original would lose a limb.
 *
 * **Material references are shared, not cloned** (铁律 9 is about WRITES, not about
 * copies). Duplicating a chair should give you a second chair made of the same material;
 * cloning the record would mean editing 「拉丝金属」 afterwards changes one chair and not
 * the other, which is not what anybody means by duplicate.
 *
 * **Rules and hotspots are NOT copied** (v0.5 灰区裁决). A rule says "when 阀盖 is clicked";
 * after a duplicate there is no unambiguous answer to which 阀盖 it means, and guessing
 * either way produces a scene that behaves differently from how it reads.
 *
 * The clipboard is memory-only. Cross-project paste would need the assets and materials to
 * travel with it, which is a feature (and a schema question), not a side effect of Ctrl+C.
 */

export interface ClipboardPayload {
  /** The copied nodes with their ORIGINAL ids, ordered parents-before-children. */
  readonly nodes: readonly Node[]
  /** Which of them were the roots of the copied selection. */
  readonly rootIds: readonly string[]
}

/** Where a pasted copy lands relative to its original. Far enough to see, near enough to find. */
export const PASTE_OFFSET: Vec3 = [0.2, 0, 0.2]

let clipboard: ClipboardPayload | null = null

export const getClipboard = (): ClipboardPayload | null => clipboard
export const setClipboard = (payload: ClipboardPayload | null): void => void (clipboard = payload)
/** Test seam; production has no reason to forget a clipboard. */
export const clearClipboard = (): void => void (clipboard = null)

/**
 * Collects the subtrees rooted at `nodeIds`.
 *
 * Returns null for an empty or unresolvable selection rather than an empty payload, so
 * "nothing was copied" and "an empty thing was copied" stay distinguishable — pasting the
 * latter would clear the user's clipboard for no reason.
 */
export function copyNodes(doc: SceneDocument, nodeIds: readonly string[]): ClipboardPayload | null {
  const selected = new Set(nodeIds.filter((id) => doc.nodes.some((n) => n.id === id)))
  if (selected.size === 0) return null

  const byParent = new Map<string | null, Node[]>()
  for (const node of doc.nodes) {
    const list = byParent.get(node.parent) ?? []
    list.push(node)
    byParent.set(node.parent, list)
  }

  // A selected node that is already inside another selected node's subtree is dropped:
  // selecting 泵组 and 阀盖 together must not paste 阀盖 twice.
  const ancestorSelected = (node: Node): boolean => {
    let cursor = node.parent
    const guard = new Set<string>()
    while (cursor !== null && !guard.has(cursor)) {
      guard.add(cursor)
      if (selected.has(cursor)) return true
      cursor = doc.nodes.find((n) => n.id === cursor)?.parent ?? null
    }
    return false
  }

  const rootIds = doc.nodes.filter((n) => selected.has(n.id) && !ancestorSelected(n)).map((n) => n.id)

  // Depth-first from each root, so the output is already parents-before-children and the
  // paste can remap parents in one pass.
  const nodes: Node[] = []
  const visit = (id: string) => {
    const node = doc.nodes.find((n) => n.id === id)
    if (!node) return
    nodes.push(node)
    for (const child of (byParent.get(id) ?? []).slice().sort((a, b) => a.order - b.order)) visit(child.id)
  }
  for (const id of rootIds) visit(id)

  return { nodes, rootIds }
}

export interface PasteOptions {
  readonly ctx?: FactoryContext
  /** Offset applied to the pasted ROOTS only; children keep their local transforms. */
  readonly offset?: Vec3
}

/**
 * Pastes a payload into `draft`, returning the new nodes.
 *
 * Mutates a draft — call it inside one `commit`, so the whole paste is one undo entry and
 * Ctrl+Z removes the entire subtree rather than one node of it.
 */
export function pasteNodes(draft: SceneDocument, payload: ClipboardPayload, options: PasteOptions = {}): Node[] {
  const ctx = options.ctx ?? defaultFactoryContext
  const offset = options.offset ?? PASTE_OFFSET
  const roots = new Set(payload.rootIds)

  // Minted against the ids already in the document AND the ones minted so far, so a paste
  // of a 40-node subtree cannot collide with itself.
  const taken = collectAllIds(draft)
  const idMap = new Map<string, string>()
  for (const node of payload.nodes) {
    const id = ctx.newId('node', taken)
    taken.add(id)
    idMap.set(node.id, id)
  }

  // A clipboard is a SNAPSHOT. Between Ctrl+C and Ctrl+V the material or asset it points at
  // can stop existing, and pasting the reference anyway produces a document `checkIntegrity`
  // rejects (I3) for something the user cannot see or repair. Neither record can be deleted
  // from the v0.5 UI yet, so this is a guard rather than a fix — but 「粘贴后零 error」 is
  // unconditional, and T-154's material presets are what will make it reachable.
  const materials = new Set(draft.materials.map((m) => m.id))
  const assets = new Set(draft.assets.map((a) => a.id))

  const created: Node[] = []
  const prefabs = new Set(draft.prefabs.map((p) => p.id))

  for (const node of payload.nodes) {
    const isRoot = roots.has(node.id)
    // A root keeps its original parent (the copy lands beside the original); everything
    // else points at its copied parent. A root whose parent has since been deleted lands
    // at the top level rather than dangling — I2 would reject the alternative.
    const parent = isRoot
      ? (node.parent !== null && draft.nodes.some((n) => n.id === node.parent) ? node.parent : null)
      : (idMap.get(node.parent ?? '') ?? null)

    const copy: Node = {
      ...node,
      id: idMap.get(node.id)!,
      parent,
      // Roots are appended after their new siblings; children keep the spacing they had, so
      // the copied subtree reads in the same order as the original.
      order: isRoot ? getAppendOrder(draft, parent) + created.length * ORDER_STEP : node.order,
      transform: {
        ...node.transform,
        p: isRoot
          ? [node.transform.p[0] + offset[0], node.transform.p[1] + offset[1], node.transform.p[2] + offset[2]]
          : [...node.transform.p],
        r: [...node.transform.r],
        s: [...node.transform.s],
      },
      // Shared, not cloned: a duplicate should be made of the same material.
      overrides: dropMissingMaterial(node.overrides, materials),
      ...(node.assetRef ? { assetRef: assets.has(node.assetRef.assetId) ? { ...node.assetRef } : null } : {}),
      ...(node.primitive ? { primitive: { ...node.primitive } } : {}),
      ...(node.light ? { light: { ...node.light } } : {}),
      // v3 的四个承载体字段（T-232）。
      //
      // 卡面只点名 `prefabRef`，但 `...node` 对另外三个同样是**按引用共享**——
      // 改副本的剖切尺寸会连原件一起改，而 `explodeOffset` 是个数组，共享得最彻底。
      // 四个一起处理，不是三个加一个例外。
      ...(node.section ? { section: { ...node.section, size: [...node.section.size] as [number, number] } } : {}),
      ...(node.explode ? { explode: { ...node.explode, axis: [...node.explode.axis] as [number, number, number] } } : {}),
      ...(node.explodeOffset ? { explodeOffset: [...node.explodeOffset] as [number, number, number] } : {}),
      prefabRef: dropMissingPrefab(node.prefabRef, prefabs),
    }
    draft.nodes.push(copy)
    created.push(copy)
  }
  return created
}

/**
 * Strips a material override the target document can no longer resolve.
 *
 * The node then renders with its asset's own material, which is what it would have done had
 * the override never been set — the one outcome that is not a lie.
 */
function dropMissingMaterial(overrides: Node['overrides'], materials: ReadonlySet<string>): Node['overrides'] {
  const copy = { ...overrides }
  if (copy.materialId !== undefined && copy.materialId !== null && !materials.has(copy.materialId)) {
    delete copy.materialId
  }
  return copy
}

/**
 * Strips a prefab reference the target document does not have.
 *
 * 形状照 `dropMissingMaterial`：粘进一个没有这个 prefab 的文档时，节点退化成一个普通
 * 节点，而不是一条指向不存在 prefab 的悬空引用（I42 会把后者判成 error，于是「粘一下
 * 就发布不了」）。
 *
 * `overridden` 是数组，必须换新引用——否则改副本的覆盖列表会连原件一起改。
 */
function dropMissingPrefab(ref: Node['prefabRef'], prefabs: ReadonlySet<string>): Node['prefabRef'] {
  if (ref === null) return null
  if (!prefabs.has(ref.prefabId)) return null
  return { ...ref, overridden: [...ref.overridden] }
}

/** Copy + paste in one step, for Ctrl+D. Returns the new nodes, or an empty array. */
export function duplicateNodes(draft: SceneDocument, nodeIds: readonly string[], options: PasteOptions = {}): Node[] {
  const payload = copyNodes(draft, nodeIds)
  return payload ? pasteNodes(draft, payload, options) : []
}
