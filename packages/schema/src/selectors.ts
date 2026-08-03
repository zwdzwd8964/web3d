import { ID_COLLECTIONS, ID_COLLECTION_NAMES } from './document.js'
import type { SceneDocument } from './document.js'
import type { Node } from './node.js'
import { ORDER_STEP } from './primitives.js'

/**
 * Pure queries over the flat `nodes` array. No caching here — a hot path should build a
 * DocIndex (index-builder.ts) once and read Maps; these exist for one-off questions and
 * for code where clarity beats microseconds.
 */

export function getNode(doc: SceneDocument, nodeId: string): Node | undefined {
  return doc.nodes.find((n) => n.id === nodeId)
}

/**
 * Sibling order: `order`, then id as the tie-break so it is total and stable.
 *
 * Exported alongside `groupChildren` because more than one place has to order siblings, and
 * two definitions of sibling order would put the hierarchy tree and the index in different
 * orders for the same document.
 */
export const byOrder = (a: Node, b: Node) => a.order - b.order || a.id.localeCompare(b.id)

/**
 * Every node grouped under its parent id (null key = roots), each bucket sorted.
 *
 * One pass. `getChildren` scans the whole array, so anything that needed the children of
 * MANY nodes — building the index, walking the tree, collecting a subtree — was doing it
 * once per node, which is O(n²). Measured on a 1000-node assembly (T-184): `buildIndex`
 * 6.5 ms, at 2000 nodes 25 ms, at 4000 nodes 103 ms. Four times the work for twice the
 * document, on the path of every structural edit.
 *
 * Every node gets a bucket, including leaves, so `get(id)` returning undefined means "no
 * such node" rather than "no children".
 *
 * A `parent` naming no node keeps the node under the roots: that document is broken and
 * `checkIntegrity` says so, but until someone fixes it the object still has to be reachable
 * in the tree. Dropping it would make a corrupt file quietly lose objects instead.
 */
export function groupChildren(doc: SceneDocument): Map<string | null, Node[]> {
  const out = new Map<string | null, Node[]>()
  out.set(null, [])
  for (const node of doc.nodes) out.set(node.id, [])
  for (const node of doc.nodes) {
    const bucket = node.parent !== null && out.has(node.parent) ? out.get(node.parent) : out.get(null)
    bucket!.push(node)
  }
  for (const bucket of out.values()) if (bucket.length > 1) bucket.sort(byOrder)
  return out
}

/** Direct children, sorted by `order` (SCHEMA_SPEC §4.1-4). */
export function getChildren(doc: SceneDocument, parentId: string | null): Node[] {
  return doc.nodes.filter((n) => n.parent === parentId).sort(byOrder)
}

export function getRootNodes(doc: SceneDocument): Node[] {
  return getChildren(doc, null)
}

/** Descendants, depth-first in `order`, excluding `nodeId` itself. Cycle-safe. */
export function getDescendants(doc: SceneDocument, nodeId: string): Node[] {
  const children = groupChildren(doc)
  const out: Node[] = []
  const seen = new Set<string>([nodeId])
  const walk = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child)
      walk(child.id)
    }
  }
  walk(nodeId)
  return out
}

/** Ancestors, nearest first. Cycle-safe: a corrupted parent chain terminates. */
export function getAncestors(doc: SceneDocument, nodeId: string): Node[] {
  const out: Node[] = []
  const seen = new Set<string>([nodeId])
  let cursor = getNode(doc, nodeId)?.parent ?? null
  while (cursor != null && !seen.has(cursor)) {
    seen.add(cursor)
    const parent = getNode(doc, cursor)
    if (!parent) break
    out.push(parent)
    cursor = parent.parent
  }
  return out
}

/**
 * SCHEMA_SPEC §4.2 · the editor must refuse this move before the drop, not after.
 * Dropping a node into its own subtree is the one drag that turns the hierarchy into a
 * cycle and takes the renderer with it.
 */
export function wouldCreateCycle(doc: SceneDocument, nodeId: string, newParentId: string | null): boolean {
  if (newParentId === null) return false
  if (newParentId === nodeId) return true
  return getAncestors(doc, newParentId).some((a) => a.id === nodeId)
}

/** Depth-first walk from the roots, yielding each node with its depth. */
export function walkTree(doc: SceneDocument, visit: (node: Node, depth: number) => void): void {
  const children = groupChildren(doc)
  const seen = new Set<string>()
  const walk = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      visit(node, depth)
      walk(node.id, depth + 1)
    }
  }
  walk(null, 0)
}

/** A node and its whole subtree — what deleting it actually removes. */
export function getSubtreeIds(doc: SceneDocument, nodeId: string): string[] {
  return [nodeId, ...getDescendants(doc, nodeId).map((n) => n.id)]
}

/** Display path built from names. Display only — never a reference key (C9). */
export function getDisplayPath(doc: SceneDocument, nodeId: string): string {
  const node = getNode(doc, nodeId)
  if (!node) return ''
  return [...getAncestors(doc, nodeId).map((n) => n.name).reverse(), node.name].join('/')
}

/** Every node whose parent chain does not terminate at a root. */
export function getUnreachableNodes(doc: SceneDocument): Node[] {
  const reachable = new Set<string>()
  walkTree(doc, (n) => reachable.add(n.id))
  return doc.nodes.filter((n) => !reachable.has(n.id))
}

/* -------------------------------------------------------------------------- */
/* v2 carriers — SCHEMA_SPEC §4.1-6                                           */
/* -------------------------------------------------------------------------- */

/** Which carrier a node holds. `null` = a pure grouping node. */
export type NodeCarrier = 'assetRef' | 'primitive' | 'light' | null

/**
 * The node's carrier, as one value to switch on.
 *
 * Everything that turns a document node into something renderable needs this answer, and
 * writing the three null-checks at each of those sites is how they drift apart. Core's
 * scene graph dispatches on it; so does the hierarchy tree's icon.
 *
 * On a document that sets two carriers — which integrity check I11 reports as an error —
 * this returns the first in `assetRef, primitive, light` order rather than throwing.
 * `checkIntegrity` is where an invalid document gets reported; a selector that threw would
 * take the editor down before the user could be shown what is wrong with their file.
 */
export function getCarrier(node: Node): NodeCarrier {
  if (node.assetRef !== null) return 'assetRef'
  if (node.primitive !== null) return 'primitive'
  if (node.light !== null) return 'light'
  return null
}

/** Every light node, in document order. The scene's lighting, as the document states it. */
export function getLightNodes(doc: SceneDocument): Node[] {
  return doc.nodes.filter((n) => n.light !== null)
}

/** Every primitive node, in document order. */
export function getPrimitiveNodes(doc: SceneDocument): Node[] {
  return doc.nodes.filter((n) => n.primitive !== null)
}

/**
 * Whether core should install its built-in three-light rig (D14).
 *
 * True only when the document expresses no lighting of its own — no light node AND no
 * environment map. The rig is a display default of the same kind as the default background
 * colour: it is not in the document, and the moment the document says anything about
 * lighting, it stands down.
 *
 * Lives here rather than in core so that the editor (which greys out "add default lights"
 * hints) and the runtime (which installs them) cannot disagree about the condition.
 */
export function needsDefaultLightRig(doc: SceneDocument): boolean {
  return getLightNodes(doc).length === 0 && doc.meta.environment.hdriAssetId === null
}

/* -------------------------------------------------------------------------- */
/* order helpers — SCHEMA_SPEC §4.1-4                                         */
/* -------------------------------------------------------------------------- */

/** `order` for a node appended as the last child of `parentId`. */
export function getAppendOrder(doc: SceneDocument, parentId: string | null): number {
  const siblings = getChildren(doc, parentId)
  const last = siblings[siblings.length - 1]
  return last === undefined ? ORDER_STEP : last.order + ORDER_STEP
}

/**
 * `order` that places a node between two siblings. Returns null when the integer gap is
 * exhausted, which is the caller's signal to renumber the sibling row in one batch.
 */
export function getOrderBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return ORDER_STEP
  if (before === null) return (after as number) - ORDER_STEP
  if (after === null) return before + ORDER_STEP
  if (after - before <= 1) return null
  return Math.floor((before + after) / 2)
}

/** Renumber one sibling row back to clean ORDER_STEP spacing. */
export function renumberSiblings(doc: SceneDocument, parentId: string | null): Map<string, number> {
  const out = new Map<string, number>()
  getChildren(doc, parentId).forEach((node, i) => out.set(node.id, (i + 1) * ORDER_STEP))
  return out
}

/**
 * Every id currently in use across the document — for `newId` collision checks.
 *
 * T-201 · driven by `ID_COLLECTIONS` rather than by eleven hand-written `add()` calls plus
 * one hand-written nested loop. The old shape had a specific way of failing: adding a
 * collection and forgetting this function compiles cleanly, passes every test, and then
 * mints a duplicate id the first time anyone writes into the new collection — because
 * `newId`'s taken-set never contained the ids it was supposed to avoid. Nothing about that
 * failure points back here.
 *
 * `doc[name]` is indexed with `name: IdCollection`, so a registry entry naming a collection
 * the document does not have is a compile error rather than a silently skipped line.
 */
export function collectAllIds(doc: SceneDocument): Set<string> {
  const ids = new Set<string>([doc.projectId])
  for (const name of ID_COLLECTION_NAMES) {
    const spec = ID_COLLECTIONS[name]
    for (const record of doc[name]) {
      ids.add(record.id)
      for (const nested of spec.nested) {
        // The nested arrays are `steps` on a flow and `overlays` on a page. Neither is
        // reachable through `SceneDocument`'s type from a string key, so this is the one
        // place the shape is read structurally — narrowed to "an array of things with a
        // string id" and skipped otherwise, never cast.
        const children: unknown = (record as Record<string, unknown>)[nested]
        if (!Array.isArray(children)) continue
        for (const child of children) {
          if (isIdBearing(child)) ids.add(child.id)
        }
      }
    }
  }
  return ids
}

/** True when `value` is an object carrying a non-empty string `id`. */
function isIdBearing(value: unknown): value is { id: string } {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'
}
