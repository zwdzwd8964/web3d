import type { Node, SceneDocument } from '@w3/schema'
import { ORDER_STEP, getChildren, getOrderBetween, renumberSiblings, wouldCreateCycle } from '@w3/schema'

/**
 * T-063 · hierarchy drag-and-drop.
 *
 * Pure functions, deliberately: the rule that matters most here — never drop a node into
 * its own subtree — has to be enforced BEFORE the drop, and a rule that only exists
 * inside a React event handler cannot be tested or reused by the keyboard path.
 *
 * A cycle in `parent` makes the affected nodes unreachable from the roots, so they stop
 * rendering entirely (SCHEMA_SPEC §4.2, and `checkIntegrity` I10 reports the aftermath).
 * Catching it here is the difference between "the editor refused" and "my model vanished".
 */

export type DropPosition = 'before' | 'after' | 'inside'

export interface DropTarget {
  readonly nodeId: string
  readonly position: DropPosition
}

export interface DropPlan {
  readonly nodeId: string
  readonly parent: string | null
  readonly order: number
  /** Set when the sibling row ran out of integer gaps and must be renumbered first. */
  readonly renumber?: ReadonlyMap<string, number>
}

export type DropRejection =
  | { readonly ok: false; readonly reason: 'self'; readonly message: string }
  | { readonly ok: false; readonly reason: 'cycle'; readonly message: string }
  | { readonly ok: false; readonly reason: 'missing'; readonly message: string }
  | { readonly ok: false; readonly reason: 'locked'; readonly message: string }

export type DropResult = { readonly ok: true; readonly plan: DropPlan } | DropRejection

/** Can this drop happen at all? Called on dragover to drive the cursor and the drop line. */
export function canDrop(doc: SceneDocument, draggedId: string, target: DropTarget): DropResult {
  const dragged = doc.nodes.find((n) => n.id === draggedId)
  const targetNode = doc.nodes.find((n) => n.id === target.nodeId)
  if (!dragged || !targetNode) {
    return { ok: false, reason: 'missing', message: '拖拽的对象或目标已不存在' }
  }
  if (dragged.locked) {
    return { ok: false, reason: 'locked', message: `「${dragged.name}」已锁定，无法移动` }
  }
  if (draggedId === target.nodeId) {
    return { ok: false, reason: 'self', message: '不能拖到自己上' }
  }

  const newParent = target.position === 'inside' ? target.nodeId : targetNode.parent

  if (wouldCreateCycle(doc, draggedId, newParent)) {
    return { ok: false, reason: 'cycle', message: `不能把「${dragged.name}」拖进它自己的子树` }
  }

  return { ok: true, plan: planDrop(doc, dragged, targetNode, target.position, newParent) }
}

function planDrop(
  doc: SceneDocument,
  dragged: Node,
  targetNode: Node,
  position: DropPosition,
  newParent: string | null,
): DropPlan {
  if (position === 'inside') {
    // Appended last, so dropping onto a group does not reshuffle its existing children.
    const siblings = getChildren(doc, newParent).filter((n) => n.id !== dragged.id)
    const last = siblings[siblings.length - 1]
    return { nodeId: dragged.id, parent: newParent, order: last ? last.order + ORDER_STEP : ORDER_STEP }
  }

  const siblings = getChildren(doc, newParent).filter((n) => n.id !== dragged.id)
  const index = siblings.findIndex((n) => n.id === targetNode.id)
  const before = position === 'before' ? (siblings[index - 1]?.order ?? null) : (siblings[index]?.order ?? null)
  const after = position === 'before' ? (siblings[index]?.order ?? null) : (siblings[index + 1]?.order ?? null)

  const order = getOrderBetween(before, after)
  if (order !== null) return { nodeId: dragged.id, parent: newParent, order }

  // SCHEMA_SPEC §4.1-4: the integer gap is exhausted. Renumber the row, then re-plan
  // against the clean spacing rather than inventing a fractional order.
  const renumber = renumberSiblings(doc, newParent)
  const renumbered: SceneDocument = {
    ...doc,
    nodes: doc.nodes.map((n) => (renumber.has(n.id) ? { ...n, order: renumber.get(n.id)! } : n)),
  }
  const retried = planDrop(renumbered, dragged, targetNode, position, newParent)
  return { ...retried, renumber }
}

/**
 * Applies a plan to a document draft. Kept separate from `canDrop` so the caller wraps
 * it in exactly one `commit` — one drag, one undo entry.
 */
export function applyDropPlan(draft: SceneDocument, plan: DropPlan): void {
  if (plan.renumber) {
    for (const node of draft.nodes) {
      const order = plan.renumber.get(node.id)
      if (order !== undefined) node.order = order
    }
  }
  const node = draft.nodes.find((n) => n.id === plan.nodeId)
  if (!node) return
  node.parent = plan.parent
  node.order = plan.order
}

/** Where a pointer lands within a row, in the tree's usual thirds. */
export function dropPositionFor(offsetY: number, rowHeight: number, allowInside: boolean): DropPosition {
  if (!allowInside) return offsetY < rowHeight / 2 ? 'before' : 'after'
  if (offsetY < rowHeight * 0.25) return 'before'
  if (offsetY > rowHeight * 0.75) return 'after'
  return 'inside'
}

export interface TreeRow {
  readonly node: Node
  readonly depth: number
  readonly hasChildren: boolean
}

/**
 * Flattens the hierarchy into visible rows, honouring collapsed branches.
 *
 * A flat list is what a virtualised tree needs (T-063 targets 1,000 nodes), and it keeps
 * the row renderer free of recursion.
 */
export function flattenTree(doc: SceneDocument, collapsed: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, depth: number) => {
    for (const node of getChildren(doc, parent)) {
      if (seen.has(node.id)) continue // a corrupted parent chain must not hang the panel
      seen.add(node.id)
      const children = getChildren(doc, node.id)
      rows.push({ node, depth, hasChildren: children.length > 0 })
      if (!collapsed.has(node.id)) walk(node.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

/** Shift-click range selection over the visible rows. */
export function rangeBetween(rows: readonly TreeRow[], fromId: string, toId: string): string[] {
  const a = rows.findIndex((r) => r.node.id === fromId)
  const b = rows.findIndex((r) => r.node.id === toId)
  if (a === -1 || b === -1) return [toId]
  const [start, end] = a <= b ? [a, b] : [b, a]
  return rows.slice(start, end + 1).map((r) => r.node.id)
}
