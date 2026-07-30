import type { SceneDocument } from './document.js'
import type { SceneNode } from './nodes.js'

/**
 * Hierarchy helpers over the flat `nodes` array.
 *
 * The document stores nodes flat with a `parent` pointer rather than nested, for two
 * reasons: an Immer patch path stays short and stable (`/nodes/3/transform/p`, which
 * D1's incremental applier depends on), and re-parenting is a single field write
 * instead of a subtree move.
 */

export function findNode(doc: SceneDocument, nodeId: string): SceneNode | undefined {
  return doc.nodes.find((n) => n.id === nodeId)
}

export function nodeIndex(doc: SceneDocument, nodeId: string): number {
  return doc.nodes.findIndex((n) => n.id === nodeId)
}

/** Direct children, in document order (which is the authoring order). */
export function childrenOf(doc: SceneDocument, parentId: string | null): SceneNode[] {
  return doc.nodes.filter((n) => n.parent === parentId)
}

export function rootNodes(doc: SceneDocument): SceneNode[] {
  return childrenOf(doc, null)
}

/** All descendants, depth-first, excluding `nodeId` itself. */
export function descendantsOf(doc: SceneDocument, nodeId: string): SceneNode[] {
  const out: SceneNode[] = []
  const walk = (id: string) => {
    for (const child of childrenOf(doc, id)) {
      out.push(child)
      walk(child.id)
    }
  }
  walk(nodeId)
  return out
}

export function ancestorsOf(doc: SceneDocument, nodeId: string): SceneNode[] {
  const out: SceneNode[] = []
  const seen = new Set<string>([nodeId])
  let cur = findNode(doc, nodeId)?.parent ?? null
  while (cur != null && !seen.has(cur)) {
    seen.add(cur)
    const parent = findNode(doc, cur)
    if (!parent) break
    out.push(parent)
    cur = parent.parent
  }
  return out
}

/**
 * True when `candidateParent` is `nodeId` itself or one of its descendants.
 * The editor must refuse such a re-parent — it is the one drag-and-drop move that
 * turns the hierarchy into a cycle and takes the renderer with it.
 */
export function wouldCreateCycle(doc: SceneDocument, nodeId: string, candidateParent: string | null): boolean {
  if (candidateParent === null) return false
  if (candidateParent === nodeId) return true
  return ancestorsOf(doc, candidateParent).some((a) => a.id === nodeId) || candidateParent === nodeId
}

/** Depth-first walk from the roots, yielding [node, depth]. */
export function walkTree(doc: SceneDocument, visit: (node: SceneNode, depth: number) => void): void {
  const walk = (parentId: string | null, depth: number) => {
    for (const node of childrenOf(doc, parentId)) {
      visit(node, depth)
      walk(node.id, depth + 1)
    }
  }
  walk(null, 0)
}

/** Display path built from node names, e.g. `泵组/阀体/阀盖`. Display only — never a key (C9). */
export function displayPathOf(doc: SceneDocument, nodeId: string): string {
  const node = findNode(doc, nodeId)
  if (!node) return ''
  const names = ancestorsOf(doc, nodeId)
    .map((n) => n.name)
    .reverse()
  return [...names, node.name].join('/')
}

/** Removing a node removes its whole subtree; returns the ids that would go. */
export function subtreeIds(doc: SceneDocument, nodeId: string): string[] {
  return [nodeId, ...descendantsOf(doc, nodeId).map((n) => n.id)]
}
