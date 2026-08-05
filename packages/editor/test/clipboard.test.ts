import { checkIntegrity, createGoldenPathDocument, createSequentialIdFactory, errorsOf, validate } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { produce } from 'immer'
import { createDocumentStore } from '../src/store/document-store.js'
import { handleShortcut } from '../src/shortcuts.js'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PASTE_OFFSET,
  clearClipboard,
  copyNodes,
  duplicateNodes,
  getClipboard,
  pasteNodes,
  setClipboard,
} from '../src/store/clipboard.js'
/** The golden path's node ids (SCHEMA_SPEC §12). */
const IDS = { pump: 'nd_r5t8y1u3', body: 'nd_v7w9x2z4', cover: 'nd_b3n5m7k9', material: 'mat_c4d6f8h1' } as const

/**
 * T-144 · copy, paste, Ctrl+D.
 *
 * The golden-path document is a real three-node tree (泵组 → 泵体 / 阀盖), which is what
 * makes the subtree rules testable at all: a flat document would let "copies the whole
 * subtree" and "copies one node" pass the same assertions.
 */

afterEach(() => clearClipboard())

/** Deterministic ids, so a paste can be asserted rather than described. */
const ctx = () => ({ newId: createSequentialIdFactory(), now: () => '2026-09-01T00:00:00.000Z' })

const paste = (doc: SceneDocument, nodeIds: readonly string[]) =>
  produce(doc, (draft) => {
    const payload = copyNodes(doc, nodeIds)
    if (payload) pasteNodes(draft, payload, { ctx: ctx() })
  })

describe('copyNodes', () => {
  it('takes the whole subtree, not just the selected node', () => {
    // Copying 泵组 and getting an empty group is not a copy of anything.
    const payload = copyNodes(createGoldenPathDocument(), [IDS.pump])!
    expect(payload.nodes.map((n) => n.id)).toEqual([IDS.pump, IDS.body, IDS.cover])
    expect(payload.rootIds).toEqual([IDS.pump])
  })

  it('does not copy a node twice when it and its parent are both selected', () => {
    const payload = copyNodes(createGoldenPathDocument(), [IDS.pump, IDS.cover])!
    expect(payload.nodes.filter((n) => n.id === IDS.cover)).toHaveLength(1)
    expect(payload.rootIds, '阀盖 已经在 泵组 的子树里，不该再当一个根').toEqual([IDS.pump])
  })

  it('orders parents before children, so a paste can remap in one pass', () => {
    const payload = copyNodes(createGoldenPathDocument(), [IDS.pump])!
    const at = (id: string) => payload.nodes.findIndex((n) => n.id === id)
    expect(at(IDS.pump)).toBeLessThan(at(IDS.body))
    expect(at(IDS.pump)).toBeLessThan(at(IDS.cover))
  })

  it('returns null for an empty or unresolvable selection', () => {
    // Distinguishable from "an empty thing was copied": pasting that would clear a
    // clipboard the user filled a minute ago.
    expect(copyNodes(createGoldenPathDocument(), [])).toBeNull()
    expect(copyNodes(createGoldenPathDocument(), ['nd_00000000'])).toBeNull()
  })
})

describe('pasteNodes', () => {
  it('produces a document that still validates and has no dangling references', () => {
    const doc = paste(createGoldenPathDocument(), [IDS.pump])
    expect(validate(doc).ok).toBe(true)
    expect(errorsOf(checkIntegrity(doc))).toEqual([])
  })

  it('gives every copied node a new id', () => {
    const before = createGoldenPathDocument()
    const after = paste(before, [IDS.pump])
    expect(after.nodes).toHaveLength(before.nodes.length + 3)
    const ids = after.nodes.map((n) => n.id)
    expect(new Set(ids).size, 'id 必须全新且互不重复').toBe(ids.length)
  })

  it('remaps parent links INSIDE the copy, never back to the original', () => {
    // The failure this prevents: a pasted subtree still pointing at the original's children
    // hands one node two parents. three silently reparents it and the original loses a limb.
    const after = paste(createGoldenPathDocument(), [IDS.pump])
    const copies = after.nodes.slice(3)
    const copiedRoot = copies.find((n) => n.parent === null)!
    for (const child of copies.filter((n) => n !== copiedRoot)) {
      expect(child.parent).toBe(copiedRoot.id)
    }
    // …and the originals are untouched.
    expect(after.nodes.filter((n) => n.parent === IDS.pump)).toHaveLength(2)
  })

  it('offsets the roots only, so the subtree keeps its shape', () => {
    const before = createGoldenPathDocument()
    const after = paste(before, [IDS.pump])
    const copies = after.nodes.slice(3)
    const root = copies.find((n) => n.parent === null)!
    expect(root.transform.p).toEqual([PASTE_OFFSET[0], PASTE_OFFSET[1], PASTE_OFFSET[2]])
    // Children are positioned relative to their parent; offsetting them too would move
    // them twice and pull the copy apart.
    for (const child of copies.filter((n) => n !== root)) {
      const original = before.nodes.find((n) => n.name === child.name)!
      expect(child.transform.p).toEqual(original.transform.p)
    }
  })

  it('shares the material record rather than cloning it (a duplicate is the same material)', () => {
    // 铁律 9 is about WRITES. Cloning here would mean editing 「拉丝不锈钢」 afterwards
    // changes one copy and not the other, which is not what anyone means by duplicate.
    const before = createGoldenPathDocument()
    const after = paste(before, [IDS.cover])
    expect(after.materials).toHaveLength(before.materials.length)
    const copy = after.nodes[after.nodes.length - 1]!
    expect(copy.overrides.materialId).toBe(IDS.material)
  })

  it('copies neither rules nor hotspots (灰区裁决)', () => {
    // A rule says "when 阀盖 is clicked". After a duplicate there is no unambiguous answer
    // to which 阀盖 that is, and guessing either way makes the scene behave differently
    // from how it reads.
    const before = createGoldenPathDocument()
    const after = paste(before, [IDS.cover])
    expect(after.rules).toHaveLength(before.rules.length)
    expect(after.hotspots).toHaveLength(before.hotspots.length)
    // The originals still point at the original node, not at the copy.
    expect(after.hotspots[0]!.anchor.nodeId).toBe(IDS.cover)
  })

  it('keeps the carrier — a copied light is still a light', () => {
    const base = createGoldenPathDocument()
    const withLight: SceneDocument = {
      ...base,
      nodes: [
        ...base.nodes,
        {
          section: null,
          explode: null,
          explodeOffset: null,
          prefabRef: null,
          id: 'nd_light001',
          name: '聚光灯',
          parent: null,
          order: 9000,
          assetRef: null,
          primitive: null,
          light: { kind: 'ambient', color: '#ffffff', intensity: 0.6 },
          transform: { p: [0, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
          visible: true,
          locked: false,
          overrides: {},
        },
      ],
    }
    const after = paste(withLight, ['nd_light001'])
    const copy = after.nodes[after.nodes.length - 1]!
    expect(copy.light).toEqual({ kind: 'ambient', color: '#ffffff', intensity: 0.6 })
    expect(copy.light, '必须是副本，不能与原件共享同一个对象').not.toBe(withLight.nodes[3]!.light)
  })

  it('a root whose parent has since been deleted lands at the top level', () => {
    // Keeping the dangling parent would produce a document `checkIntegrity` rejects (I2),
    // for a paste the user would have no way to understand.
    const before = createGoldenPathDocument()
    const payload = copyNodes(before, [IDS.cover])!
    const orphaned = produce(before, (draft) => {
      // The realistic sequence: copy a node, then delete the subtree it lived in (which
      // takes the original with it), then paste.
      draft.nodes = draft.nodes.filter((n) => n.id !== IDS.pump && n.id !== IDS.body && n.id !== IDS.cover)
      draft.hotspots = []
      draft.animations = []
      draft.rules = []
      pasteNodes(draft, payload, { ctx: ctx() })
    })
    const copy = orphaned.nodes[orphaned.nodes.length - 1]!
    expect(copy.parent).toBeNull()
    expect(errorsOf(checkIntegrity(orphaned))).toEqual([])
  })

  it('feeds each minted id back into the set the factory checks', () => {
    // The real id factory is RANDOM, and `collectAllIds` is read once before the loop. If the
    // ids minted during a paste are not added to that set, nothing stops the factory handing
    // out the same id twice — and this is not reachable with a sequential factory, which
    // keeps its own counter and cannot repeat whatever it is told.
    let handedOut = 0
    const colliding = (_kind: string, existing?: Iterable<string>) => {
      const taken = new Set(existing ?? [])
      // Proposes the same id every time; only moves on when told that one is taken.
      let n = 0
      let candidate: string
      do {
        n += 1
        candidate = `nd_x${String(n).padStart(7, '0')}`
      } while (taken.has(candidate))
      handedOut += 1
      return candidate
    }
    const before = createGoldenPathDocument()
    const after = produce(before, (draft) => {
      const payload = copyNodes(draft, [IDS.pump])!
      pasteNodes(draft, payload, { ctx: { newId: colliding as never, now: () => '' } })
    })
    expect(handedOut).toBe(3)
    const ids = after.nodes.map((n) => n.id)
    expect(new Set(ids).size, '三个新节点必须拿到三个不同的 id').toBe(ids.length)
  })

  it('drops a reference the document can no longer resolve (M10 审查所得)', () => {
    // A clipboard is a snapshot. Between Ctrl+C and Ctrl+V the material or the asset it
    // points at can stop existing; pasting the reference anyway lands an I3 error in the
    // user's 体检 panel for something they cannot see, cannot select and cannot repair.
    const before = createGoldenPathDocument()
    const payload = copyNodes(before, [IDS.body, IDS.cover])!

    const after = produce(before, (draft) => {
      draft.materials = draft.materials.filter((m) => m.id !== IDS.material)
      draft.assets = []
      for (const node of draft.nodes) {
        if (node.overrides.materialId === IDS.material) delete node.overrides.materialId
        node.assetRef = null
      }
      pasteNodes(draft, payload, { ctx: ctx() })
    })

    expect(errorsOf(checkIntegrity(after)), '粘贴不得引入文档解析不了的引用').toEqual([])
    const copies = after.nodes.slice(-2)
    expect(copies.map((n) => n.overrides.materialId)).toEqual([undefined, undefined])
    expect(copies.map((n) => n.assetRef)).toEqual([null, null])
    // …and the nodes themselves still arrive: dropping them would make Ctrl+V do nothing at
    // all, which is worse than an empty placeholder the user can see and delete.
    expect(copies.map((n) => n.name)).toEqual(['泵体', '阀盖'])
  })

  it('pastes twice without colliding with itself', () => {
    const before = createGoldenPathDocument()
    const payload = copyNodes(before, [IDS.pump])!
    const after = produce(before, (draft) => {
      pasteNodes(draft, payload, { ctx: ctx() })
      pasteNodes(draft, payload, { ctx: ctx() })
    })
    const ids = after.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(errorsOf(checkIntegrity(after))).toEqual([])
  })
})

describe('duplicateNodes', () => {
  it('copies and pastes in one step', () => {
    const before = createGoldenPathDocument()
    const after = produce(before, (draft) => void duplicateNodes(draft, [IDS.cover], { ctx: ctx() }))
    expect(after.nodes).toHaveLength(before.nodes.length + 1)
    expect(errorsOf(checkIntegrity(after))).toEqual([])
  })

  it('does nothing at all for an empty selection', () => {
    const before = createGoldenPathDocument()
    const after = produce(before, (draft) => void duplicateNodes(draft, [], { ctx: ctx() }))
    expect(after.nodes).toHaveLength(before.nodes.length)
  })
})

describe('the clipboard itself', () => {
  it('is memory-only and starts empty', () => {
    expect(getClipboard()).toBeNull()
    setClipboard(copyNodes(createGoldenPathDocument(), [IDS.cover]))
    expect(getClipboard()?.rootIds).toEqual([IDS.cover])
    // Cross-project paste would need the assets and materials to travel with it. That is a
    // feature with a schema question behind it, not a side effect of Ctrl+C.
    expect(Object.keys(globalThis.localStorage ?? {})).toEqual([])
  })
})

describe('the shortcuts themselves', () => {
  /** A keydown, as `handleShortcut` sees it. */
  const key = (k: string, extra: { shift?: boolean; target?: { tagName?: string; isContentEditable?: boolean } } = {}) => {
    let prevented = false
    return {
      event: {
        key: k,
        ctrlKey: true,
        metaKey: false,
        shiftKey: extra.shift ?? false,
        target: extra.target ?? null,
        preventDefault: () => void (prevented = true),
      },
      wasPrevented: () => prevented,
    }
  }

  const wire = (doc = createGoldenPathDocument()) => {
    // A zustand store: the actions live on the state, which is also what the real hook reads.
    const batches: number[] = []
    const store = createDocumentStore(doc, { onPatch: (patches) => void batches.push(patches.length) })
    return {
      store,
      batches,
      deps: {
        undo: () => void store.getState().undo(),
        redo: () => void store.getState().redo(),
        commit: (label: string, recipe: (draft: SceneDocument) => void) =>
          void store.getState().commit(label, recipe),
        select: (ids: readonly string[]) => store.getState().select(ids),
        getState: () => ({ doc: store.getState().doc, selection: store.getState().selection }),
      },
    }
  }

  it('一次粘贴一条 commit：undo 让整棵子树一起消失', () => {
    // The failure this rules out: pasting node-by-node, where Ctrl+Z peels one leaf off a
    // three-node copy and leaves the user pressing it repeatedly to get back where they were.
    const { store, deps, batches } = wire()
    const before = store.getState().doc.nodes.length
    store.getState().select([IDS.pump])
    handleShortcut(key('c').event, deps)
    handleShortcut(key('v').event, deps)
    expect(store.getState().doc.nodes).toHaveLength(before + 3)

    // One batch, not three. Undo alone cannot see the difference — the history merges
    // same-label commits inside a 500 ms window, so a per-node paste would undo in one step
    // too, right up until a big paste crosses the window or the labels differ. The patch
    // count is the property that actually holds (铁律 11: one user action, one applyPatch).
    expect(batches).toHaveLength(1)
    expect(store.getState().historyDepth).toBe(1)

    store.getState().undo()
    expect(store.getState().doc.nodes).toHaveLength(before)
    expect(store.getState().canRedo).toBe(true)
  })

  it('粘贴后选中的是副本，Ctrl+D 然后拖一下才成立', () => {
    const { store, deps } = wire()
    store.getState().select([IDS.cover])
    handleShortcut(key('d').event, deps)
    const selection = store.getState().selection
    expect(selection).toHaveLength(1)
    expect(selection[0]).not.toBe(IDS.cover)
    expect(store.getState().doc.nodes.some((n) => n.id === selection[0])).toBe(true)
  })

  it('输入框聚焦时一律不触发（沿 T-071 语义）', () => {
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { isContentEditable: true }]) {
      const { store, deps } = wire()
      const before = store.getState().doc.nodes.length
      store.getState().select([IDS.cover])
      for (const k of ['c', 'v', 'd', 'z', 'y']) {
        const { event, wasPrevented } = key(k, { target })
        handleShortcut(event, deps)
        expect(wasPrevented(), `${target.tagName ?? 'contentEditable'} 上的 Ctrl+${k} 不该被拦截`).toBe(false)
      }
      expect(store.getState().doc.nodes).toHaveLength(before)
      expect(getClipboard()).toBeNull()
    }
  })

  it('空剪贴板的 Ctrl+V 与空选区的 Ctrl+D 什么都不做，也不吞事件', () => {
    const { store, deps } = wire()
    const stamp = store.getState().doc
    for (const k of ['v', 'd']) {
      const { event, wasPrevented } = key(k)
      handleShortcut(event, deps)
      expect(wasPrevented()).toBe(false)
    }
    expect(store.getState().doc, '文档对象都不该被换掉').toBe(stamp)
    expect(store.getState().canUndo).toBe(false)
  })
})

/* ========================================================================== */
/* T-232 · 粘贴带 v3 承载体字段的节点                                          */
/* ========================================================================== */

describe('T-232 · prefabRef 与另外三个 v3 字段', () => {
  const PREFAB = { id: 'pfb_11111111', name: '标准泵组', note: '', version: 1, nodes: [], materials: [] }

  const withPrefabNode = (doc: SceneDocument, hasPrefab: boolean) =>
    produce(doc, (draft: SceneDocument) => {
      if (hasPrefab) draft.prefabs.push(PREFAB as never)
      const node = draft.nodes[1]!
      node.prefabRef = { prefabId: PREFAB.id, overridden: ['transform'] }
      node.explodeOffset = [1, 2, 3]
      // section 挂在**另一个**节点上：它是第四种承载体，和 assetRef 互斥（I11），
      // 挂在同一个节点上会让下面那条「粘完零 error」红在一个与本卡无关的地方。
      const plane = draft.nodes[2]!
      plane.assetRef = null
      plane.section = { scope: 'scene', size: [4, 4] }
    })

  it('目标文档有这个 prefab：引用保留，且 overridden 是新数组', () => {
    const doc = withPrefabNode(createGoldenPathDocument(), true)
    const payload = copyNodes(doc, [doc.nodes[1]!.id, doc.nodes[2]!.id])!
    let created: SceneDocument['nodes'] = []
    const next = produce(doc, (draft: SceneDocument) => {
      created = pasteNodes(draft, payload)
    })

    expect(created[0]!.prefabRef?.prefabId).toBe(PREFAB.id)
    expect(created[0]!.prefabRef?.overridden).toEqual(['transform'])
    // 数组必须换新引用：共享的话，改副本的覆盖列表会连原件一起改
    expect(created[0]!.prefabRef?.overridden).not.toBe(doc.nodes[1]!.prefabRef?.overridden)
    expect(created[0]!.explodeOffset).not.toBe(doc.nodes[1]!.explodeOffset)
    expect(created[1]!.section, 'section 也必须换新对象').not.toBe(doc.nodes[2]!.section)
    expect(next.nodes.length).toBeGreaterThan(doc.nodes.length)
  })

  it('目标文档没有这个 prefab：引用被丢掉，粘完仍然零 error', () => {
    // 保留一条悬空 prefabRef 会让 I42 判 error —— 于是「粘一下就发布不了」。
    const source = withPrefabNode(createGoldenPathDocument(), true)
    const payload = copyNodes(source, [source.nodes[1]!.id, source.nodes[2]!.id])!

    const target = createGoldenPathDocument() // 没有 prefabs
    let created: SceneDocument['nodes'] = []
    const next = produce(target, (draft: SceneDocument) => {
      created = pasteNodes(draft, payload)
    })

    expect(created[0]!.prefabRef, '悬空引用必须被丢掉').toBeNull()
    expect(errorsOf(checkIntegrity(next))).toEqual([])
  })
})
