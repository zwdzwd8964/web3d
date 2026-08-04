import type { SceneDocument } from '@w3/schema'
import { buildIndex, describeReferences, getSubtreeIds } from '@w3/schema'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { setUi, useUi } from '../store/ui-store.js'
import { applyDropPlan, canDrop, canDragRows, clampScrollTop, dropPositionFor, filterNodes, flattenTree, rangeBetween } from './tree-dnd.js'
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

  const { search, renaming, pendingDelete } = useUi()

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<(DropTarget & { ok: boolean }) | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const lastClicked = useRef<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const filter = useMemo(() => filterNodes(doc, search), [doc, search])
  const rows = useMemo(() => flattenTree(doc, collapsed, filter), [doc, collapsed, filter])
  const draggable = canDragRows(filter)
  const confirming = useMemo(() => (pendingDelete ? describeRemoval(doc, pendingDelete) : null), [doc, pendingDelete])

  // T-224 · the list gets shorter as you type, and the browser does NOT pull the offset
  // back on its own — you land on a blank panel with the rows scrolled off above. Written
  // against `clampScrollTop` rather than inline so it is testable at all (the editor's
  // tests run in plain Node with no jsdom).
  useEffect(() => {
    const clamped = clampScrollTop(scrollTop, rows.length, ROW_HEIGHT, height)
    if (clamped === scrollTop) return
    setScrollTop(clamped)
    if (bodyRef.current) bodyRef.current.scrollTop = clamped
  }, [rows.length, scrollTop, height])

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

  const doRemove = (request: RemoveRequest) => {
    setUi({ pendingDelete: null })
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
        <span className="num">{filter ? `${filter.matched.size} / ${doc.nodes.length}` : doc.nodes.length}</span>
      </div>
      <div className="tree-search">
        <input
          className="tree-search__input"
          type="search"
          value={search}
          placeholder="搜索名称，或粘贴 nd_ 开头的 ID"
          aria-label="搜索对象"
          onChange={(event) => setUi({ search: event.currentTarget.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setUi({ search: '' })
          }}
        />
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
          // Two different nothings. "The scene is empty" and "the search matched nothing"
          // want opposite actions from the user, and one shared sentence sends half of them
          // looking for a file to drag when what they need is to clear the box.
          doc.nodes.length === 0 ? (
            <p className="panel__empty">拖入 GLB 文件开始</p>
          ) : (
            <p className="panel__empty">
              没有匹配「{search.trim()}」的对象
              <button type="button" className="tbtn" onClick={() => setUi({ search: '' })}>
                清空搜索
              </button>
            </p>
          )
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
                  data-matched={row.matched}
                  data-drop={isDropTarget ? dropTarget.position : undefined}
                  data-drop-ok={isDropTarget ? dropTarget.ok : undefined}
                  style={{
                    position: 'absolute',
                    top: index * ROW_HEIGHT,
                    height: ROW_HEIGHT,
                    paddingLeft: 6 + row.depth * 14,
                  }}
                  // Filtered rows are not siblings of what they appear next to, so a drop
                  // computed from the row above would silently reparent to the wrong place.
                  draggable={draggable}
                  onDragStart={() => setDragging(row.node.id)}
                  onDragEnd={() => {
                    setDragging(null)
                    setDropTarget(null)
                  }}
                  onDragOver={(event) => {
                    if (!dragging || !draggable) return
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
                  onDoubleClick={() => setUi({ renaming: row.node.id })}
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
                        setUi({ renaming: null })
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
                      setUi({ pendingDelete: row.node.id })
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
          onCancel={() => setUi({ pendingDelete: null })}
          onConfirm={() => doRemove(confirming)}
        />
      )}
    </aside>
  )
}

/**
 * The sentence shown before a delete, and the subtree the delete will take with it.
 *
 * A function of `(doc, nodeId)` rather than a snapshot taken when the ✕ was clicked: the
 * pending id now lives in `ui-store` while the document lives in the document store, and
 * re-deriving is what keeps the question honest if the document changes underneath the
 * open dialog. T-290 lifts this out as `describeRemoval` for the Delete shortcut to share.
 */
function describeRemoval(doc: SceneDocument, nodeId: string): RemoveRequest | null {
  const name = doc.nodes.find((n) => n.id === nodeId)?.name
  if (name === undefined) return null
  const affected = describeReferences(buildIndex(doc), nodeId)
  const subtree = getSubtreeIds(doc, nodeId)
  // T-092 · the reverse index answers "what breaks if I delete this" BEFORE the delete,
  // not as a broken rule discovered at acceptance.
  const question = affected
    ? `「${name}」被 ${affected} 引用，删除后这些引用会失效。确认删除？`
    : subtree.length > 1
      ? `将同时删除「${name}」及其 ${subtree.length - 1} 个子对象。确认？`
      : `确认删除「${name}」？`
  return { nodeId, name, question, subtree }
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
