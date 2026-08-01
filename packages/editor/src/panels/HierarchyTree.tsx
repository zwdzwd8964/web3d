import type { SceneDocument } from '@w3/schema'
import { buildIndex, describeReferences, getSubtreeIds } from '@w3/schema'
import { useMemo, useRef, useState } from 'react'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { applyDropPlan, canDrop, dropPositionFor, flattenTree, rangeBetween } from './tree-dnd.js'
import type { DropTarget } from './tree-dnd.js'

/**
 * T-063 · the hierarchy tree.
 *
 * Rows are windowed rather than all rendered: the acceptance bar is 1,000 nodes staying
 * responsive, and a thousand DOM rows with drag handlers is not.
 *
 * The two rules that matter are enforced in `tree-dnd.ts`, not here — dropping into a
 * node's own subtree is refused before the drop, and re-parenting plus reordering land as
 * exactly one undo entry.
 */

const ROW_HEIGHT = 24
const OVERSCAN = 8

export function HierarchyTree() {
  const doc = useDocumentSelector((s) => s.doc)
  const selection = useDocumentSelector((s) => s.selection)
  const { commit, select, toggleSelection } = useDocumentActions()

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<RemoveRequest | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<(DropTarget & { ok: boolean }) | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const lastClicked = useRef<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => flattenTree(doc, collapsed), [doc, collapsed])
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visible = rows.slice(first, first + Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2)

  const toggleCollapse = (nodeId: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const onRowClick = (nodeId: string, event: React.MouseEvent) => {
    if (event.shiftKey && lastClicked.current) {
      select(rangeBetween(rows, lastClicked.current, nodeId))
      return
    }
    lastClicked.current = nodeId
    toggleSelection(nodeId, event.ctrlKey || event.metaKey)
  }

  const onDrop = () => {
    if (!dragging || !dropTarget) return
    const result = canDrop(doc, dragging, dropTarget)
    if (result.ok) {
      commit(`移动 ${doc.nodes.find((n) => n.id === dragging)?.name ?? '对象'}`, (draft) =>
        applyDropPlan(draft, result.plan),
      )
    }
    setDragging(null)
    setDropTarget(null)
  }

  const rename = (nodeId: string, name: string) => {
    if (name.trim() === '') return
    commit(`重命名 ${name}`, (draft) => {
      const node = draft.nodes.find((n) => n.id === nodeId)
      if (node) node.name = name.trim()
    })
  }

  const askRemove = (nodeId: string) => {
    const index = buildIndex(doc)
    const affected = describeReferences(index, nodeId)
    const subtree = getSubtreeIds(doc, nodeId)
    const name = doc.nodes.find((n) => n.id === nodeId)?.name ?? '对象'
    // T-092 · the reverse index answers "what breaks if I delete this" BEFORE the delete,
    // not as a broken rule discovered at acceptance.
    const question = affected
      ? `「${name}」被 ${affected} 引用，删除后这些引用会失效。确认删除？`
      : subtree.length > 1
        ? `将同时删除「${name}」及其 ${subtree.length - 1} 个子对象。确认？`
        : `确认删除「${name}」？`
    setConfirming({ nodeId, name, question, subtree })
  }

  const doRemove = (request: RemoveRequest) => {
    setConfirming(null)
    commit(`删除 ${request.name}`, (draft) => {
      // Spliced in place rather than `draft.nodes = filter(...)`. Immer describes a
      // reassignment as one patch replacing the WHOLE array, which the renderer then has
      // to diff — D1's `fullRebuildCount` used to go up by one on every delete because of
      // this line. Removing by index emits one `remove` patch per node, which the patch
      // applier maps straight onto `graph.removeNode`.
      for (let i = draft.nodes.length - 1; i >= 0; i--) {
        if (request.subtree.includes(draft.nodes[i]!.id)) draft.nodes.splice(i, 1)
      }
    })
  }

  return (
    <aside className="panel panel--left">
      <div className="panel__head">
        层级树
        <span className="num">{doc.nodes.length}</span>
      </div>
      <div
        className="panel__body panel__body--tight"
        ref={bodyRef}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop)
          setHeight(event.currentTarget.clientHeight)
        }}
      >
        {rows.length === 0 ? (
          <p className="panel__empty">拖入 GLB 文件开始</p>
        ) : (
          <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
            {visible.map((row, i) => {
              const index = first + i
              const isDropTarget = dropTarget?.nodeId === row.node.id
              return (
                <div
                  key={row.node.id}
                  className="tree-row"
                  // Read by the golden-path E2E to locate a node in 3D. Cheap, stable,
                  // and it makes "click 阀盖" mean the object rather than a guessed pixel.
                  data-node-id={row.node.id}
                  data-selected={selection.includes(row.node.id)}
                  data-drop={isDropTarget ? dropTarget.position : undefined}
                  data-drop-ok={isDropTarget ? dropTarget.ok : undefined}
                  style={{
                    position: 'absolute',
                    top: index * ROW_HEIGHT,
                    height: ROW_HEIGHT,
                    paddingLeft: 6 + row.depth * 14,
                  }}
                  draggable
                  onDragStart={() => setDragging(row.node.id)}
                  onDragEnd={() => {
                    setDragging(null)
                    setDropTarget(null)
                  }}
                  onDragOver={(event) => {
                    if (!dragging) return
                    event.preventDefault()
                    const rect = event.currentTarget.getBoundingClientRect()
                    const position = dropPositionFor(event.clientY - rect.top, ROW_HEIGHT, row.hasChildren || !row.node.assetRef)
                    const target = { nodeId: row.node.id, position }
                    setDropTarget({ ...target, ok: canDrop(doc, dragging, target).ok })
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    onDrop()
                  }}
                  onClick={(event) => onRowClick(row.node.id, event)}
                  onDoubleClick={() => setRenaming(row.node.id)}
                >
                  <button
                    type="button"
                    className="tree-row__twisty"
                    aria-label={collapsed.has(row.node.id) ? '展开' : '折叠'}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleCollapse(row.node.id)
                    }}
                  >
                    {row.hasChildren ? (collapsed.has(row.node.id) ? '▸' : '▾') : ''}
                  </button>

                  {/* D5 · an orphaned reference is marked here, never deleted. */}
                  {row.node.assetRef?.missing && (
                    <span className="tree-row__flag" title="资产映射已失效，需人工重新指定">
                      ⚠
                    </span>
                  )}

                  {/* T-137 · a light has no mesh, so without a glyph it looks exactly like
                      an empty group in the tree. A light IS a node (D12), which is what
                      makes it free — and also what makes it invisible without this. */}
                  {row.node.light !== null && (
                    <span className="tree-row__icon" aria-label="灯光" title="灯光">
                      ☀
                    </span>
                  )}
                  {row.node.primitive !== null && (
                    <span className="tree-row__icon" aria-label="原始体" title="原始体">
                      ◇
                    </span>
                  )}
                  {/* T-063 asks for INLINE rename. A native prompt() blocks the main
                      thread, cannot be styled, and drops a Windows dialog into the middle
                      of a dark self-drawn UI. */}
                  {renaming === row.node.id ? (
                    <input
                      className="tree-row__rename"
                      defaultValue={row.node.name}
                      autoFocus
                      onClick={(event) => event.stopPropagation()}
                      onBlur={(event) => {
                        rename(row.node.id, event.currentTarget.value)
                        setRenaming(null)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                        else if (event.key === 'Escape') {
                          // Reset first so the blur handler writes the original back.
                          event.currentTarget.value = row.node.name
                          event.currentTarget.blur()
                        }
                      }}
                    />
                  ) : (
                    <span className="tree-row__name">{row.node.name}</span>
                  )}

                  <button
                    type="button"
                    className="tree-row__lock"
                    aria-pressed={row.node.locked}
                    title={row.node.locked ? '解锁' : '锁定'}
                    onClick={(event) => {
                      event.stopPropagation()
                      commit(row.node.locked ? '解锁对象' : '锁定对象', (draft) => {
                        const node = draft.nodes.find((n) => n.id === row.node.id)
                        if (node) node.locked = !node.locked
                      })
                    }}
                  >
                    {row.node.locked ? '🔒' : '·'}
                  </button>
                  <button
                    type="button"
                    className="tree-row__eye"
                    aria-pressed={row.node.visible}
                    title={row.node.visible ? '隐藏' : '显示'}
                    onClick={(event) => {
                      event.stopPropagation()
                      commit(row.node.visible ? '隐藏对象' : '显示对象', (draft) => {
                        const node = draft.nodes.find((n) => n.id === row.node.id)
                        if (node) node.visible = !node.visible
                      })
                    }}
                  >
                    {row.node.visible ? '◉' : '○'}
                  </button>
                  <button
                    type="button"
                    className="tree-row__del"
                    title="删除"
                    onClick={(event) => {
                      event.stopPropagation()
                      askRemove(row.node.id)
                    }}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {dropTarget && !dropTarget.ok && (
        <div className="panel__note panel__note--warn">{describeRejection(doc, dragging, dropTarget)}</div>
      )}

      {confirming && (
        <ConfirmDialog
          question={confirming.question}
          onCancel={() => setConfirming(null)}
          onConfirm={() => doRemove(confirming)}
        />
      )}
    </aside>
  )
}

interface RemoveRequest {
  readonly nodeId: string
  readonly name: string
  readonly question: string
  readonly subtree: readonly string[]
}

/**
 * The in-app replacement for `confirm()`.
 *
 * The sentence it shows — 「阀盖」被 1 个动画、1 个热点、1 条规则 引用，删除后这些引用会
 * 失效 — is the most useful thing the editor says, and it deserves better than a native
 * dialog that blocks the main thread, cannot be styled to match, and needs special
 * handling to drive from an E2E run.
 */
function ConfirmDialog({
  question,
  onConfirm,
  onCancel,
}: {
  question: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal__body" onClick={(event) => event.stopPropagation()}>
        <p>{question}</p>
        <div className="modal__actions">
          <button type="button" className="tbtn" onClick={onCancel} autoFocus>
            取消
          </button>
          <button type="button" className="tbtn tbtn--danger" onClick={onConfirm}>
            删除
          </button>
        </div>
      </div>
    </div>
  )
}

function describeRejection(doc: SceneDocument, dragging: string | null, target: DropTarget): string {
  if (!dragging) return ''
  const result = canDrop(doc, dragging, target)
  return result.ok ? '' : result.message
}
