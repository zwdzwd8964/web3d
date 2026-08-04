import type { Node, SceneDocument } from '@w3/schema'
import { ORDER_STEP, getChildren, getOrderBetween, groupChildren, renumberSiblings, wouldCreateCycle } from '@w3/schema'

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
  /** T-224 · true when this row matched the search itself, rather than being an ancestor. */
  readonly matched?: boolean
}

/**
 * T-224 · which nodes a search keeps visible, or **`null` when there is no search**.
 *
 * `null` is not a convenience — it is the zero-cost path, and it is asserted with `toBe`.
 * Returning an empty `Set` instead would look identical to every caller and would make
 * `flattenTree` do a membership test per node on every render of an unfiltered tree, which
 * is the state it is in essentially all the time.
 *
 * Matching is on the name, case-insensitively, **except** for a query that starts with
 * `nd_`: an id is exact. Typing a node id is what you do when you have one from a log or an
 * integrity report, and substring-matching ids would return a handful of unrelated rows.
 *
 * The returned set contains **matches plus every ancestor of a match**. Without the
 * ancestors a match nested three levels down has no path to it — the tree would show a row
 * whose parents are absent, which is not a tree.
 */
export interface NodeFilter {
  /** Matches plus every ancestor of a match — the rows the tree may draw. */
  readonly visible: ReadonlySet<string>
  /** Only the rows that matched the query themselves. */
  readonly matched: ReadonlySet<string>
}

export function filterNodes(doc: SceneDocument, query: string): NodeFilter | null {
  const trimmed = query.trim()
  if (trimmed === '') return null

  const byId = new Map(doc.nodes.map((node) => [node.id, node]))
  const matches = trimmed.startsWith('nd_')
    ? doc.nodes.filter((node) => node.id === trimmed)
    : doc.nodes.filter((node) => node.name.toLowerCase().includes(trimmed.toLowerCase()))

  const visible = new Set<string>()
  const matchedIds = new Set(matches.map((node) => node.id))
  for (const node of matches) {
    visible.add(node.id)
    // Walk to the root, bounded by the node count: a corrupted parent chain must not hang
    // the panel, exactly as `flattenTree`'s own `seen` guard does.
    let parent = node.parent
    for (let hops = 0; parent !== null && hops <= doc.nodes.length; hops++) {
      if (visible.has(parent)) break
      visible.add(parent)
      parent = byId.get(parent)?.parent ?? null
    }
  }
  return { visible, matched: matchedIds }
}

/**
 * Where the scroll offset has to move to when the row count shrinks.
 *
 * Pure, because it is otherwise unobservable: the editor's tests run in plain Node with no
 * jsdom, so a clamp written inline in the component could be described in a test and never
 * actually exercised (`shortcuts.ts` says the same thing about `handleShortcut`). The
 * symptom it prevents is searching in a long tree and landing on a blank panel — the rows
 * are there, the viewport is scrolled past all of them.
 */
export function clampScrollTop(scrollTop: number, rowCount: number, rowHeight: number, viewportHeight: number): number {
  const max = Math.max(0, rowCount * rowHeight - viewportHeight)
  return Math.min(Math.max(0, scrollTop), max)
}

/**
 * Whether rows may be dragged right now.
 *
 * Dropping while filtered is not a rendering problem, it is a correctness one: the drop
 * target is computed from the row ABOVE and below the pointer, and under a filter those are
 * not the node's real siblings. The reparent would be silently wrong.
 */
export function canDragRows(filter: NodeFilter | null): boolean {
  return filter === null
}

/**
 * Flattens the hierarchy into visible rows, honouring collapsed branches.
 *
 * A flat list is what a virtualised tree needs (T-063 targets 1,000 nodes), and it keeps
 * the row renderer free of recursion.
 */
export function flattenTree(doc: SceneDocument, collapsed: ReadonlySet<string>, filter: NodeFilter | null = null): TreeRow[] {
  // One grouping pass for the whole tree. This used to call `getChildren` twice per node —
  // once to iterate and once just to ask whether the row needs a disclosure triangle — and
  // each of those scans the entire node array. On a 1000-node assembly that was 8.9 ms of
  // the render that follows EVERY document change (T-184), which is over half a frame spent
  // deciding where to draw triangles.
  const children = groupChildren(doc)
  const rows: TreeRow[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      if (seen.has(node.id)) continue // a corrupted parent chain must not hang the panel
      if (filter !== null && !filter.visible.has(node.id)) continue
      seen.add(node.id)
      const hasChildren = (children.get(node.id)?.length ?? 0) > 0
      rows.push(filter === null ? { node, depth, hasChildren } : { node, depth, hasChildren, matched: filter.matched.has(node.id) })
      // **While filtering, `collapsed` is ignored.** A hit inside a folded branch that the
      // user cannot see is the search failing to do the one thing it is for; they searched
      // precisely because they do not know where the thing is. Unfiltered, `collapsed` is
      // authoritative as always.
      if (filter !== null || !collapsed.has(node.id)) walk(node.id, depth + 1)
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
