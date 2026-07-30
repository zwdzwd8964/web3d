import type { SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import type { Patch } from 'immer'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDocumentStore } from '../src/store/document-store.js'
import type { DocumentStore } from '../src/store/document-store.js'
import { History, MERGE_WINDOW_MS, compactInversePatches, compactPatches } from '../src/store/history.js'

/** T-061 · SCHEMA_SPEC §11 · and T-070's stacks underneath it. */

const COVER = 'nd_b3n5m7k9'
const BODY = 'nd_v7w9x2z4'

let clock: number
let patchLog: { patches: Patch[]; next: SceneDocument }[]
let warnings: string[]
let store: DocumentStore

const tick = (ms: number) => {
  clock += ms
}
const coverY = (doc: SceneDocument) => doc.nodes.find((n) => n.id === COVER)!.transform.p[1]

function moveCover(y: number) {
  return (draft: SceneDocument) => {
    draft.nodes.find((n) => n.id === COVER)!.transform.p[1] = y
  }
}

beforeEach(() => {
  clock = 0
  patchLog = []
  warnings = []
  store = createDocumentStore(createGoldenPathDocument(), {
    now: () => clock,
    onPatch: (patches, next) => patchLog.push({ patches, next }),
    onLog: (level, message) => {
      if (level === 'warn') warnings.push(message)
    },
  })
})

describe('commit', () => {
  it('writes the document and leaves exactly one undo entry', () => {
    expect(store.getState().commit('移动 阀盖', moveCover(0.35))).toBe(true)

    expect(coverY(store.getState().doc)).toBe(0.35)
    expect(store.getState().historyDepth).toBe(1)
    expect(store.getState().canUndo).toBe(true)
    expect(store.getState().history.peek()?.label).toBe('移动 阀盖')
  })

  it('forwards patches so the runtime can apply them incrementally (D1)', () => {
    store.getState().commit('移动 阀盖', moveCover(0.35))
    expect(patchLog).toHaveLength(1)
    expect(patchLog[0]!.patches[0]).toMatchObject({ op: 'replace', path: ['nodes', 2, 'transform', 'p', 1] })
  })

  it('is a no-op when the recipe changes nothing', () => {
    expect(store.getState().commit('无变化', (d) => void d.nodes[0]!.name)).toBe(false)
    expect(store.getState().historyDepth).toBe(0)
    expect(patchLog).toHaveLength(0)
  })

  it('never mutates the previous document object', () => {
    const before = store.getState().doc
    const snapshot = JSON.stringify(before)
    store.getState().commit('移动 阀盖', moveCover(0.35))
    expect(JSON.stringify(before)).toBe(snapshot)
    expect(store.getState().doc).not.toBe(before)
  })

  it('bumps a revision counter so subscribers can detect a change cheaply', () => {
    const before = store.getState().revision
    store.getState().commit('移动 阀盖', moveCover(0.35))
    expect(store.getState().revision).toBe(before + 1)
  })
})

describe('the 500 ms merge window (SCHEMA_SPEC §11)', () => {
  it('merges consecutive commits with the same label', () => {
    store.getState().commit('调整 粗糙度', moveCover(0.1))
    tick(100)
    store.getState().commit('调整 粗糙度', moveCover(0.2))
    tick(100)
    store.getState().commit('调整 粗糙度', moveCover(0.3))

    // Typing "0.3" into a number field is one action, not three.
    expect(store.getState().historyDepth).toBe(1)
    expect(coverY(store.getState().doc)).toBe(0.3)

    store.getState().undo()
    expect(coverY(store.getState().doc), '一次撤销回到全部编辑之前').toBe(0)
  })

  it('does not merge once the window has passed', () => {
    store.getState().commit('调整 粗糙度', moveCover(0.1))
    tick(MERGE_WINDOW_MS + 1)
    store.getState().commit('调整 粗糙度', moveCover(0.2))
    expect(store.getState().historyDepth).toBe(2)
  })

  it('does not merge different labels, however close together', () => {
    store.getState().commit('移动 阀盖', moveCover(0.1))
    tick(1)
    store.getState().commit('重命名 阀盖', (d) => {
      d.nodes.find((n) => n.id === COVER)!.name = '阀盖A'
    })
    expect(store.getState().historyDepth).toBe(2)
  })
})

describe('D2 · preview / commit dual channel', () => {
  it('preview writes the document but leaves no undo entry', () => {
    expect(store.getState().preview(moveCover(0.2))).toBe(true)
    expect(coverY(store.getState().doc)).toBe(0.2)
    expect(store.getState().historyDepth).toBe(0)
    expect(store.getState().canUndo).toBe(false)
    // The runtime still gets the patch — the viewport must follow the drag.
    expect(patchLog).toHaveLength(1)
  })

  it('T-065 验收 · one drag leaves exactly one entry on the stack', () => {
    store.getState().previewStart()
    for (let frame = 1; frame <= 60; frame++) {
      store.getState().preview(moveCover(frame / 100))
      tick(16)
    }
    expect(store.getState().historyDepth, '拖拽过程中不落栈').toBe(0)

    expect(store.getState().previewCommit('移动 阀盖')).toBe(true)

    expect(store.getState().historyDepth).toBe(1)
    expect(coverY(store.getState().doc)).toBeCloseTo(0.6, 6)
  })

  it('the single entry undoes back to the drag’s STARTING point, not the last frame', () => {
    store.getState().commit('初始位置', moveCover(0.1))
    store.getState().previewStart()
    for (let frame = 1; frame <= 30; frame++) store.getState().preview(moveCover(0.1 + frame / 100))
    store.getState().previewCommit('移动 阀盖')

    expect(coverY(store.getState().doc)).toBeCloseTo(0.4, 6)
    store.getState().undo()
    expect(coverY(store.getState().doc), '回到拖拽起点').toBeCloseTo(0.1, 6)
  })

  it('compacts the drag into one patch pair rather than sixty', () => {
    store.getState().previewStart()
    for (let frame = 1; frame <= 60; frame++) store.getState().preview(moveCover(frame / 100))
    store.getState().previewCommit('移动 阀盖')

    const entry = store.getState().history.peek()!
    expect(entry.patches).toHaveLength(1)
    expect(entry.inversePatches).toHaveLength(1)
    expect(entry.inversePatches[0]!.value, '逆向 patch 保留的是最初的值').toBe(0)
  })

  it('previewAbort rolls back to the starting point and leaves no entry', () => {
    store.getState().previewStart()
    store.getState().preview(moveCover(0.5))
    expect(coverY(store.getState().doc)).toBe(0.5)

    store.getState().previewAbort()

    expect(coverY(store.getState().doc)).toBe(0)
    expect(store.getState().historyDepth).toBe(0)
    expect(store.getState().previewing).toBe(false)
  })

  it('a preview that changed nothing commits to nothing', () => {
    store.getState().previewStart()
    expect(store.getState().previewCommit('移动 阀盖')).toBe(false)
    expect(store.getState().historyDepth).toBe(0)
  })

  it('refuses a commit mid-drag rather than interleaving two entries', () => {
    store.getState().previewStart()
    store.getState().preview(moveCover(0.3))
    expect(store.getState().commit('别的操作', moveCover(0.9))).toBe(false)
    expect(warnings.some((w) => w.includes('预览进行中'))).toBe(true)
    expect(coverY(store.getState().doc)).toBe(0.3)
  })

  it('refuses undo mid-drag', () => {
    store.getState().commit('先来一步', moveCover(0.1))
    store.getState().previewStart()
    expect(store.getState().undo()).toBe(false)
    expect(warnings.some((w) => w.includes('预览进行中'))).toBe(true)
  })

  it('previewCommit without previewStart is refused, not silently accepted', () => {
    expect(store.getState().previewCommit('移动 阀盖')).toBe(false)
    expect(warnings.some((w) => w.includes('没有 previewStart'))).toBe(true)
  })

  it('previewStart twice does not lose the original baseline', () => {
    store.getState().previewStart()
    store.getState().preview(moveCover(0.2))
    store.getState().previewStart() // ignored
    store.getState().preview(moveCover(0.4))
    store.getState().previewCommit('移动 阀盖')

    store.getState().undo()
    expect(coverY(store.getState().doc), '仍然回到最初的起点').toBe(0)
  })
})

describe('undo / redo', () => {
  it('round-trips the document exactly', () => {
    const original = JSON.stringify(store.getState().doc)
    store.getState().commit('移动 阀盖', moveCover(0.35))
    const edited = JSON.stringify(store.getState().doc)

    expect(store.getState().undo()).toBe(true)
    expect(JSON.stringify(store.getState().doc)).toBe(original)

    expect(store.getState().redo()).toBe(true)
    expect(JSON.stringify(store.getState().doc)).toBe(edited)
  })

  it('forwards patches on undo, so the viewport follows', () => {
    store.getState().commit('移动 阀盖', moveCover(0.35))
    patchLog = []
    store.getState().undo()
    expect(patchLog).toHaveLength(1)
    expect(patchLog[0]!.patches[0]).toMatchObject({ op: 'replace', value: 0 })
  })

  it('walks multiple steps back and forward in order', () => {
    for (const y of [0.1, 0.2, 0.3]) {
      store.getState().commit(`移动到 ${y}`, moveCover(y))
      tick(MERGE_WINDOW_MS + 1)
    }
    expect(store.getState().historyDepth).toBe(3)

    store.getState().undo()
    expect(coverY(store.getState().doc)).toBe(0.2)
    store.getState().undo()
    expect(coverY(store.getState().doc)).toBe(0.1)
    store.getState().redo()
    expect(coverY(store.getState().doc)).toBe(0.2)
  })

  it('a new edit discards the redo branch', () => {
    store.getState().commit('第一步', moveCover(0.1))
    tick(MERGE_WINDOW_MS + 1)
    store.getState().commit('第二步', moveCover(0.2))
    store.getState().undo()
    expect(store.getState().canRedo).toBe(true)

    tick(MERGE_WINDOW_MS + 1)
    store.getState().commit('走了别的路', moveCover(0.9))

    expect(store.getState().canRedo).toBe(false)
    expect(store.getState().historyDepth).toBe(2)
  })

  it('reports false rather than throwing on an empty stack', () => {
    expect(store.getState().undo()).toBe(false)
    expect(store.getState().redo()).toBe(false)
  })

  it('survives a hundred edits followed by a hundred undos', () => {
    const original = JSON.stringify(store.getState().doc)
    for (let i = 1; i <= 100; i++) {
      store.getState().commit(`步骤 ${i}`, moveCover(i / 100))
      tick(MERGE_WINDOW_MS + 1)
    }
    for (let i = 0; i < 100; i++) store.getState().undo()
    expect(JSON.stringify(store.getState().doc)).toBe(original)
  })
})

describe('selection', () => {
  it('is a set from the start — retrofitting multi-select means rewriting every panel', () => {
    store.getState().select([COVER, BODY])
    expect(store.getState().selection).toEqual([COVER, BODY])

    store.getState().select([COVER, COVER])
    expect(store.getState().selection).toEqual([COVER])
  })

  it('toggles single and additive', () => {
    store.getState().toggleSelection(COVER)
    expect(store.getState().selection).toEqual([COVER])

    store.getState().toggleSelection(COVER)
    expect(store.getState().selection, '再点一次取消选中').toEqual([])

    store.getState().toggleSelection(COVER)
    store.getState().toggleSelection(BODY, true)
    expect(store.getState().selection).toEqual([COVER, BODY])

    store.getState().toggleSelection(COVER, true)
    expect(store.getState().selection).toEqual([BODY])
  })

  it('clears when a different document is loaded — ids mean nothing across documents', () => {
    store.getState().select([COVER])
    store.getState().replaceDocument(createGoldenPathDocument())
    expect(store.getState().selection).toEqual([])
    expect(store.getState().historyDepth).toBe(0)
  })
})

describe('History (T-070)', () => {
  it('drops the oldest entry beyond its limit', () => {
    const history = new History(3)
    for (let i = 0; i < 5; i++) {
      history.push({ label: `第 ${i} 步`, patches: [], inversePatches: [], at: i * 1000 })
    }
    expect(history.depth).toBe(3)
    expect(history.entries[0]!.label).toBe('第 2 步')
  })

  it('clear() empties both stacks', () => {
    const history = new History()
    history.push({ label: 'a', patches: [], inversePatches: [], at: 0 })
    history.undo()
    history.clear()
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
  })
})

describe('patch compaction', () => {
  const replace = (path: (string | number)[], value: unknown): Patch => ({ op: 'replace', path, value })

  it('keeps only the last write per path for a run of replaces', () => {
    const compacted = compactPatches([
      replace(['nodes', 0, 'p', 1], 1),
      replace(['nodes', 0, 'p', 1], 2),
      replace(['nodes', 0, 'p', 1], 3),
    ])
    expect(compacted).toHaveLength(1)
    expect(compacted[0]!.value).toBe(3)
  })

  it('keeps the ORIGINAL value on the inverse side', () => {
    // Inverse arrays are newest-first, so the oldest entry is the one that restores.
    const compacted = compactInversePatches([
      replace(['nodes', 0, 'p', 1], 2),
      replace(['nodes', 0, 'p', 1], 1),
      replace(['nodes', 0, 'p', 1], 0),
    ])
    expect(compacted).toHaveLength(1)
    expect(compacted[0]!.value).toBe(0)
  })

  it('refuses to compact when add or remove is involved', () => {
    // Later paths depend on earlier ones having shifted array indices; dropping any of
    // them changes the result.
    const mixed: Patch[] = [
      { op: 'add', path: ['nodes', 3], value: {} },
      replace(['nodes', 3, 'name'], 'x'),
      { op: 'remove', path: ['nodes', 3] },
    ]
    expect(compactPatches(mixed)).toHaveLength(3)
  })

  it('leaves separate paths alone', () => {
    const compacted = compactPatches([replace(['a'], 1), replace(['b'], 2)])
    expect(compacted).toHaveLength(2)
  })
})
