import type { SceneDocument } from '@w3/schema'
import { createGoldenPathDocument, createPumpDemoDocument, getSubtreeIds } from '@w3/schema'
import type { Mesh, MeshStandardMaterial } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentPatch } from '../../src/runtime/apply-patch.js'
import { PatchApplier } from '../../src/runtime/apply-patch.js'
import { MaterialRegistry } from '../../src/runtime/material-registry.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { IDS } from '../helpers.js'
import { createPumpAsset } from './fixtures.js'

/** T-034 · MVP_V0 D1. The acceptance bar is `fullRebuildCount === 0` on normal edits. */

let graph: SceneGraph
let registry: MaterialRegistry
let applier: PatchApplier
let rebuilds: number
let warnings: string[]

const materialOf = (nodeId: string) => (graph.objectFor(nodeId) as Mesh).material as MeshStandardMaterial

beforeEach(() => {
  const pump = createPumpAsset()
  graph = new SceneGraph({ assets: pump.source })
  registry = new MaterialRegistry()
  rebuilds = 0
  warnings = []
  graph.build(createGoldenPathDocument())
  applier = new PatchApplier({
    graph,
    materials: registry,
    rebuild: (doc) => {
      rebuilds++
      graph.build(doc)
    },
    log: (level, message) => {
      if (level === 'warn') warnings.push(message)
    },
  })
})

/** Applies a mutation to the document and returns [next, prev]. */
function edit(mutate: (d: SceneDocument) => SceneDocument): [SceneDocument, SceneDocument] {
  const prev = createGoldenPathDocument()
  return [mutate(createGoldenPathDocument()), prev]
}

/**
 * D-02 · 删一个**有子节点**的节点，不许回落到全量重建（铁律 11）。
 *
 * ## 这条为什么以前测不到
 *
 * 冷启动文档在 T-283 之前是 3 个节点的黄金路径样例，而那里的「阀盖」是**最后一个且是
 * 叶子**——`splice(2,1)` 只发一条 `remove /nodes/2`，`prev.nodes[2]` 就是阀盖本人、
 * 对象还在图里，`removeNode` 返回 true。这条路径上什么都不会错。
 *
 * 泵组样板换上来之后，「阀盖」在 index 9 且**有 4 颗盖螺栓**。immer 对这次 splice 发的
 * 补丁形状是（实测抓的，不是推的）：
 *
 * ```
 * replace /nodes/9  → 泵轴        （位移）
 * replace /nodes/10 → 电机
 * replace /nodes/11 → 水平剖切面
 * remove  /nodes/16 · 15 · 14 · 13 · 12        （尾部五条）
 * ```
 *
 * 而 prev 的 12 / 13 正是**盖螺栓 3 / 4**——它们的 three 对象在更早的
 * `replace /nodes/9` 触发的 `reconcileNodes` 里，已经随阀盖一起被抹掉了。于是这两条
 * `remove` 走到逐 index 那条路时 `removeNode` 找不到对象、返回 false，被记成 unhandled，
 * `fullRebuildCount++`。
 *
 * **最刺眼的是 `reconcileNodes` 对这件事是知情且宽容的**（它的注释逐字写着「a child
 * removed alongside its parent is already gone by the time we reach it — not an error」
 * 并丢弃返回值），逐 index 那条路却把同一件事当成失败。两条路径对同一个事实给出了
 * 两种判断。
 */
describe('D-02 · 删带子节点的节点不许全量重建', () => {
  /** 实测抓的那八条补丁。**顺序与 immer 发的一致**，改顺序等于测另一件事。 */
  const PATCHES: DocumentPatch[] = [
    { op: 'replace', path: ['nodes', 9], value: null },
    { op: 'replace', path: ['nodes', 10], value: null },
    { op: 'replace', path: ['nodes', 11], value: null },
    { op: 'remove', path: ['nodes', 16] },
    { op: 'remove', path: ['nodes', 15] },
    { op: 'remove', path: ['nodes', 14] },
    { op: 'remove', path: ['nodes', 13] },
    { op: 'remove', path: ['nodes', 12] },
  ]

  it('删掉阀盖及其 4 颗螺栓，fullRebuildCount 仍是 0', () => {
    const prev = createPumpDemoDocument()
    const cover = prev.nodes.find((n) => n.name === '阀盖')!
    const doomed = new Set(getSubtreeIds(prev, cover.id))
    expect(doomed.size, '前提变了：阀盖不再有 4 个子节点，这条测试测的已经不是同一件事').toBe(5)

    const next: SceneDocument = { ...prev, nodes: prev.nodes.filter((n) => !doomed.has(n.id)) }

    graph.build(prev)
    const result = applier.apply(PATCHES, next, prev)

    // 三条断言缺一不可：没回落 · 计数没涨 · **东西真的删掉了**。
    // 少了第三条，一个「什么都不做就返回 true」的实现也能让前两条绿。
    expect(applier.fullRebuildCount, warnings.join(' / ')).toBe(0)
    expect(result.rebuilt).toBe(false)
    for (const id of doomed) {
      expect(graph.objectFor(id), `${id} 还在图里`).toBeUndefined()
    }
    expect(graph.objectFor(prev.nodes[14]!.id), '泵轴被误删了').toBeDefined()
  })

  /**
   * **报警器本身不许被吞掉。**
   *
   * 上一条的修法是「已经随祖先一起消失了就算处理过」。这一条盯的是它没有顺手把
   * 「图与文档本来就不同步」也一起放行——那正是 `fullRebuildCount` 存在的全部理由。
   */
  it('删一个祖先还活着、却已经不在图里的节点 → 仍然回落，报警器还响', () => {
    const prev = createPumpDemoDocument()
    const shaft = prev.nodes[14]!
    expect(shaft.name).toBe('泵轴')

    graph.build(prev)
    // 制造「图与文档不同步」：把泵轴从图里偷偷抹掉，而它的父节点一个都没动。
    graph.removeNode(shaft.id)

    const next: SceneDocument = { ...prev, nodes: prev.nodes.filter((n) => n.id !== shaft.id) }
    const result = applier.apply([{ op: 'remove', path: ['nodes', 14] }], next, prev)

    expect(result.rebuilt, '祖先都活着却已经不在图里，这是真的不同步，必须回落').toBe(true)
    expect(applier.fullRebuildCount).toBe(1)
  })

  /**
   * `parent` 成环的文档不许把这里转死。
   *
   * ⚠ **超时设成 2 秒是这条断言的一部分，不是排版。** 少了它，父链上界那道防线被拆掉时
   * 这条测试**不是转红，是挂住**——而一个挂住的测试与一个慢的测试在 CI 上分辨不出来，
   * 通常要等到有人去看为什么这一轮跑了二十分钟。
   *
   * 成环的文档本身是非法的（`checkIntegrity` 会单独报它），但**报错比卡死好查得多**，
   * 所以运行时这一层要能走出来。
   */
  it('parent 成环时走得出来，不会转死', { timeout: 2000 }, () => {
    const base = createPumpDemoDocument()
    const [a, b, victim] = [base.nodes[10]!, base.nodes[11]!, base.nodes[14]!]

    // A→B→A 的环，**而且 A 与 B 都还活着**——这一点是关键：环上任何一个祖先只要
    // 从 next 里消失了，父链第一步就短路返回了，根本走不进环里。
    const prev: SceneDocument = {
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === a.id ? { ...n, parent: b.id } : n.id === b.id ? { ...n, parent: a.id } : n.id === victim.id ? { ...n, parent: a.id } : n,
      ),
    }
    // 只删 victim，它的父链是 victim → A → B → A → …，全程活着。
    const next: SceneDocument = { ...prev, nodes: prev.nodes.filter((n) => n.id !== victim.id) }

    graph.build(prev)
    // 让它已经不在图里，这样才会走到父链那一段（而不是 removeNode 直接成功）。
    graph.removeNode(victim.id)

    // 只要它返回了就算过——返回 true 还是 false 都是合理答案，**转不出来才是缺陷**。
    expect(() => applier.apply([{ op: 'remove', path: ['nodes', 14] }], next, prev)).not.toThrow()
  })
})

describe('incremental paths (D1)', () => {
  it('/nodes/i/transform/p updates only that Object3D', () => {
    const [next, prev] = edit((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === IDS.cover ? { ...n, transform: { ...n.transform, p: [0, 0.35, 0] } } : n)),
    }))
    const patches: DocumentPatch[] = [{ op: 'replace', path: ['nodes', 2, 'transform', 'p'], value: [0, 0.35, 0] }]

    const result = applier.apply(patches, next, prev)

    expect(result.rebuilt).toBe(false)
    expect(applier.fullRebuildCount).toBe(0)
    expect(graph.objectFor(IDS.cover)!.position.toArray()).toEqual([0, 0.35, 0])
    expect(graph.objectFor(IDS.body)!.position.toArray()).toEqual([0, 0, 0])
  })

  it('handles visible / name / parent / order / locked without a rebuild', () => {
    const [next, prev] = edit((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === IDS.body ? { ...n, visible: false, name: '泵体（改）', order: 5000 } : n)),
    }))
    const patches: DocumentPatch[] = [
      { op: 'replace', path: ['nodes', 1, 'visible'], value: false },
      { op: 'replace', path: ['nodes', 1, 'name'], value: '泵体（改）' },
      { op: 'replace', path: ['nodes', 1, 'order'], value: 5000 },
      { op: 'replace', path: ['nodes', 1, 'locked'], value: true },
    ]

    const result = applier.apply(patches, next, prev)

    expect(result.rebuilt).toBe(false)
    expect(result.handled).toBe(4)
    expect(graph.objectFor(IDS.body)!.visible).toBe(false)
    expect(graph.objectFor(IDS.body)!.name).toBe('泵体（改）')
  })

  it('re-parents incrementally', () => {
    const [next, prev] = edit((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === IDS.body ? { ...n, parent: IDS.cover } : n)),
    }))
    applier.apply([{ op: 'replace', path: ['nodes', 1, 'parent'], value: IDS.cover }], next, prev)

    expect(applier.fullRebuildCount).toBe(0)
    expect(graph.objectFor(IDS.body)!.parent).toBe(graph.objectFor(IDS.cover))
  })

  it('applies a material override through the clone-on-write path', () => {
    const [next, prev] = edit((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === IDS.body ? { ...n, overrides: { materialId: d.materials[0]!.id } } : n)),
    }))
    applier.apply(
      [{ op: 'replace', path: ['nodes', 1, 'overrides', 'materialId'], value: next.materials[0]!.id }],
      next,
      prev,
    )

    expect(applier.fullRebuildCount).toBe(0)
    expect(materialOf(IDS.body).roughness).toBe(0.4)
    expect(registry.isCloned(IDS.body)).toBe(true)
  })

  it('applies a material parameter edit to every node using that definition', () => {
    const [next, prev] = edit((d) => ({
      ...d,
      materials: d.materials.map((m) => ({ ...m, params: { ...m.params, roughness: 0.15 } })),
    }))
    registry.applyAll(prev, graph)
    applier.apply([{ op: 'replace', path: ['materials', 0, 'params', 'roughness'], value: 0.15 }], next, prev)

    expect(applier.fullRebuildCount).toBe(0)
    expect(materialOf(IDS.cover).roughness).toBe(0.15)
  })

  it('adds and removes nodes without rebuilding', () => {
    const added = {
      section: null,
      explode: null,
      explodeOffset: null,
      prefabRef: null,
      id: 'nd_11111111',
      name: '新增件',
      parent: IDS.pump,
      order: 3000,
      assetRef: null,
      primitive: null,
      light: null,
      transform: { p: [0, 0, 0] as [number, number, number], r: [0, 0, 0, 1] as [number, number, number, number], s: [1, 1, 1] as [number, number, number] },
      visible: true,
      locked: false,
      overrides: {},
    }
    const [withNode, prev] = edit((d) => ({ ...d, nodes: [...d.nodes, added] }))
    applier.apply([{ op: 'add', path: ['nodes', 3], value: added }], withNode, prev)
    expect(graph.size).toBe(4)
    expect(applier.fullRebuildCount).toBe(0)

    const removed = { ...withNode, nodes: withNode.nodes.filter((n) => n.id !== 'nd_11111111') }
    applier.apply([{ op: 'remove', path: ['nodes', 3] }], removed, withNode)
    expect(graph.size).toBe(3)
    expect(applier.fullRebuildCount).toBe(0)
  })

  it('treats document-only collections as handled — they have no renderer state', () => {
    const [next, prev] = edit((d) => d)
    const result = applier.apply(
      [
        { op: 'replace', path: ['rules', 0, 'enabled'], value: false },
        { op: 'replace', path: ['variables', 0, 'default'], value: 3 },
        { op: 'replace', path: ['name'], value: '改名' },
      ],
      next,
      prev,
    )
    expect(result.rebuilt).toBe(false)
    expect(applier.fullRebuildCount).toBe(0)
  })

  it('a gizmo drag — 60 transform patches — never triggers a rebuild', () => {
    const prev = createGoldenPathDocument()
    for (let frame = 0; frame < 60; frame++) {
      const y = frame / 100
      const next = {
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === IDS.cover ? { ...n, transform: { ...n.transform, p: [0, y, 0] as [number, number, number] } } : n)),
      }
      applier.apply([{ op: 'replace', path: ['nodes', 2, 'transform', 'p'], value: [0, y, 0] }], next, prev)
    }
    // D1's whole point: this is the path that would drop frames.
    expect(applier.fullRebuildCount).toBe(0)
    expect(graph.objectFor(IDS.cover)!.position.y).toBeCloseTo(0.59)
  })
})

describe('the fallback is loud, counted, and rare', () => {
  it('falls back for an unrecognised path, warns, and counts', () => {
    const [next, prev] = edit((d) => d)
    const result = applier.apply([{ op: 'replace', path: ['something', 'unknown'], value: 1 }], next, prev)

    expect(result.rebuilt).toBe(true)
    expect(result.unhandled).toEqual(['replace /something/unknown'])
    expect(applier.fullRebuildCount).toBe(1)
    expect(rebuilds).toBe(1)
    expect(warnings[0]).toMatch(/回落到全量重建/)
  })

  it('falls back when a node’s assetRef changes — its geometry must be re-materialised', () => {
    const [next, prev] = edit((d) => d)
    applier.apply([{ op: 'replace', path: ['nodes', 1, 'assetRef'], value: null }], next, prev)
    expect(applier.fullRebuildCount).toBe(1)
  })

  it('reconciles a wholesale nodes replacement instead of falling back', () => {
    // This used to assert `fullRebuildCount === 1`, and it was green for a reason that
    // had nothing to do with the path being unrecognised: `edit()` builds prev and next
    // from two separate `createGoldenPathDocument()` calls, so every node is a fresh
    // reference and `resyncNode` ran for all of them — including 泵组, a grouping node
    // with no mesh, for which `applyToNode` answers false. `resyncNode` treated that
    // false as "unrecognised" and asked for a rebuild.
    //
    // The practical size of that bug: from the first light a document contains, EVERY
    // wholesale `/nodes` change would have fallen back, because a light has no mesh
    // either. reconcile.test.ts asserts the opposite for the same operation — the two
    // files disagreed and the artifact happened to be the one nobody read.
    const [next, prev] = edit((d) => d)
    const result = applier.apply([{ op: 'replace', path: ['nodes'], value: next.nodes }], next, prev)
    expect(result.rebuilt).toBe(false)
    expect(applier.fullRebuildCount).toBe(0)
    expect(graph.size).toBe(next.nodes.length)
  })

  it('still applies the patches it understood before falling back', () => {
    const [next, prev] = edit((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === IDS.body ? { ...n, visible: false } : n)),
    }))
    const result = applier.apply(
      [
        { op: 'replace', path: ['nodes', 1, 'visible'], value: false },
        { op: 'replace', path: ['mystery'], value: 1 },
      ],
      next,
      prev,
    )
    expect(result.handled).toBe(1)
    expect(result.rebuilt).toBe(true)
  })
})

/* ========================================================================== */
/* T-130 · v2 patch paths                                                     */
/* ========================================================================== */

describe('v2 paths never fall back (T-130)', () => {
  /** Adds a primitive node and a light node to the golden path document. */
  function withCarriers(d: SceneDocument): SceneDocument {
    const template = d.nodes[0]!
    return {
      ...d,
      nodes: [
        ...d.nodes,
        { ...template, id: 'nd_pr000000', name: '展台', parent: null, order: 9000, assetRef: null, primitive: { kind: 'box', size: [2, 0.2, 2] }, light: null },
        { ...template, id: 'nd_li000000', name: '聚光灯', parent: null, order: 10000, assetRef: null, primitive: null, light: { kind: 'ambient', color: '#ffffff', intensity: 0.6 } },
      ],
    }
  }

  it.each([
    ['/nodes/i/primitive', ['nodes', 3, 'primitive']],
    ['/nodes/i/primitive/size/1', ['nodes', 3, 'primitive', 'size', 1]],
    ['/nodes/i/light', ['nodes', 4, 'light']],
    ['/nodes/i/light/intensity', ['nodes', 4, 'light', 'intensity']],
    ['/nodes/i/overrides/castShadow', ['nodes', 3, 'overrides', 'castShadow']],
    ['/nodes/i/overrides/receiveShadow', ['nodes', 3, 'overrides', 'receiveShadow']],
    ['/meta/environment', ['meta', 'environment']],
    ['/meta/environment/intensity', ['meta', 'environment', 'intensity']],
    ['/meta/background/type', ['meta', 'background', 'type']],
    ['/media', ['media']],
    ['/media/0/name', ['media', 0, 'name']],
  ])('%s is handled incrementally', (_label, path) => {
    const prev = withCarriers(createGoldenPathDocument())
    const next = withCarriers(createGoldenPathDocument())
    graph.build(prev)
    const result = applier.apply([{ op: 'replace', path, value: 1 }], next, prev)
    expect(result.unhandled).toEqual([])
    expect(result.rebuilt).toBe(false)
    expect(applier.fullRebuildCount).toBe(0)
  })

  it('calls the environment hook for /meta/environment and not for a background colour', () => {
    const seen: string[] = []
    const local = new PatchApplier({
      graph,
      materials: registry,
      rebuild: () => seen.push('rebuild'),
      applyMeta: () => seen.push('meta'),
      applyEnvironment: () => seen.push('environment'),
    })
    const doc = createGoldenPathDocument()
    local.apply([{ op: 'replace', path: ['meta', 'environment', 'intensity'], value: 2 }], doc, doc)
    expect(seen).toEqual(['environment', 'meta'])

    seen.length = 0
    local.apply([{ op: 'replace', path: ['meta', 'background', 'color'], value: '#000000' }], doc, doc)
    expect(seen).toEqual(['meta'])
  })

  it('an unknown key under meta is still handled — adding a meta field must not start rebuilding', () => {
    const doc = createGoldenPathDocument()
    const result = applier.apply([{ op: 'replace', path: ['meta', 'unit'], value: 'cm' }], doc, doc)
    expect(result.rebuilt).toBe(false)
    expect(applier.fullRebuildCount).toBe(0)
  })

  it('names the node whose shadow overrides changed', () => {
    const seen: string[] = []
    const local = new PatchApplier({
      graph,
      materials: registry,
      rebuild: () => seen.push('rebuild'),
      applyNodeShadow: (_doc, nodeId) => seen.push(nodeId),
    })
    const doc = createGoldenPathDocument()
    local.apply([{ op: 'replace', path: ['nodes', 1, 'overrides', 'castShadow'], value: false }], doc, doc)
    expect(seen).toEqual([IDS.body])
  })

  it('a light parameter patch reaches the graph rather than being waved through', () => {
    const prev = withCarriers(createGoldenPathDocument())
    graph.build(prev)
    const next = withCarriers(createGoldenPathDocument())
    const light = next.nodes[4]!
    next.nodes[4] = { ...light, light: { kind: 'ambient', color: '#ff0000', intensity: 2 } }

    const before = graph.objectFor('nd_li000000')
    const result = applier.apply([{ op: 'replace', path: ['nodes', 4, 'light', 'intensity'], value: 2 }], next, prev)
    expect(result.handled).toBe(1)
    // The placeholder factory updates in place, so the object survives — which is also the
    // assertion that `setLight` was actually called rather than the path being ignored.
    expect(graph.objectFor('nd_li000000')).toBe(before)
  })
})

describe('a splice does not fall back (T-130 · the golden path’s missing zero)', () => {
  it('applies the three patches immer emits for one deletion, with no rebuild', () => {
    // `nodes.splice(2, 1)` on a three-element array is described by immer as
    // `replace /nodes/2`, `remove /nodes/3` — index shifts, not "a different node here".
    // Reading them literally removed a LIVE node and then failed to re-add it, which
    // reported the batch as unhandled and rebuilt. That is the `fullRebuildCount === 1`
    // recorded against the golden path in IMPL_NOTES §4.
    const prev = createGoldenPathDocument()
    graph.build(prev)
    const next = { ...prev, nodes: [prev.nodes[0]!, prev.nodes[2]!] }

    const result = applier.apply(
      [
        { op: 'replace', path: ['nodes', 1], value: next.nodes[1] },
        { op: 'remove', path: ['nodes', 2] },
      ],
      next,
      prev,
    )

    expect(result.unhandled).toEqual([])
    expect(applier.fullRebuildCount).toBe(0)
    expect(graph.size).toBe(2)
    expect(graph.objectFor(IDS.body), '泵体 was deleted').toBeUndefined()
    expect(graph.objectFor(IDS.cover), '阀盖 only shifted index — it must still be here').toBeDefined()
  })

  it('still removes a node when the trailing remove is the only patch', () => {
    const prev = createGoldenPathDocument()
    graph.build(prev)
    const next = { ...prev, nodes: [prev.nodes[0]!, prev.nodes[1]!] }
    const result = applier.apply([{ op: 'remove', path: ['nodes', 2] }], next, prev)
    expect(result.unhandled).toEqual([])
    expect(graph.objectFor(IDS.cover)).toBeUndefined()
    expect(applier.fullRebuildCount).toBe(0)
  })
})

describe('cancelling a drag does not fall back (T-146)', () => {
  it('ignores a field patch about a node the same batch removes', () => {
    // The inverse of a ghost preview, exactly as immer emits it: restore the position the
    // ghost had a moment ago, then delete the ghost. Read literally, the first patch names
    // an index that no longer exists — the batch came back unhandled and rebuilt the entire
    // scene, every single time a drag was cancelled. D1's alarm firing on 「改主意了」 is
    // how an alarm stops meaning anything.
    const prev = createGoldenPathDocument()
    graph.build(prev)
    const next = { ...prev, nodes: prev.nodes.slice(0, 2) }

    const result = applier.apply(
      [
        { op: 'replace', path: ['nodes', 2, 'transform', 'p'], value: [1, 0, 1] },
        { op: 'remove', path: ['nodes', 2] },
      ],
      next,
      prev,
    )

    expect(result.unhandled).toEqual([])
    expect(applier.fullRebuildCount).toBe(0)
    expect(graph.objectFor(IDS.cover)).toBeUndefined()
  })

  it('still falls back for a field patch about a node nobody removed', () => {
    // The narrowness is the point: an index that simply is not there is still a surprise,
    // and a surprise must stay loud. Only "was there before, gone by id now" is a no-op.
    const prev = createGoldenPathDocument()
    graph.build(prev)
    const result = applier.apply(
      [{ op: 'replace', path: ['nodes', 9, 'transform', 'p'], value: [1, 0, 1] }],
      prev,
      prev,
    )
    expect(result.unhandled).toHaveLength(1)
    expect(applier.fullRebuildCount).toBe(1)
  })
})

describe('removing a material does not fall back (T-146)', () => {
  it('the real case: undoing the first placement removes node AND material together', () => {
    // Placing the first primitive in a project creates the 默认材质 record alongside it, so
    // undoing that placement removes both. Rebuilding the entire scene for it is correct
    // and expensive — and it fires on an action people take constantly.
    const prev = createGoldenPathDocument()
    graph.build(prev)
    const next = { ...prev, materials: [], nodes: prev.nodes.slice(0, 2) }

    const result = applier.apply(
      [
        { op: 'remove', path: ['nodes', 2] },
        { op: 'remove', path: ['materials', 0] },
      ],
      next,
      prev,
    )

    expect(result.unhandled).toEqual([])
    expect(applier.fullRebuildCount).toBe(0)
    expect(graph.objectFor(IDS.cover)).toBeUndefined()
  })

  it('a node left pointing at the removed material falls back to its own', () => {
    // The defensive half: v0.5 has no delete-material UI, so a dangling override is not
    // reachable today. When one arrives (T-154's presets), the node has to end up showing
    // the mesh's own material rather than keeping a colour whose record no longer exists.
    const prev = createGoldenPathDocument()
    graph.build(prev)
    registry.applyAll(prev, graph)
    const overridden = materialOf(IDS.cover)

    const next = { ...prev, materials: [] }
    const result = applier.apply([{ op: 'remove', path: ['materials', 0] }], next, prev)

    expect(result.unhandled).toEqual([])
    expect(applier.fullRebuildCount).toBe(0)
    // Asserting only the counter would let a `return true` that does nothing at all pass.
    expect(materialOf(IDS.cover)).not.toBe(overridden)
  })

  it('treats a remove as an index shift when the material is still there', () => {
    // `materials.splice` on a longer list emits a trailing remove whose index names a
    // material that is still in the document. Reading it as a deletion would strip the
    // override off every node using it — the material vanishing from objects the user
    // never touched, in response to deleting a DIFFERENT one.
    const prev = createGoldenPathDocument()
    graph.build(prev)
    registry.applyAll(prev, graph)
    const overridden = materialOf(IDS.cover)

    const result = applier.apply([{ op: 'remove', path: ['materials', 0] }], prev, prev)

    expect(result.unhandled).toEqual([])
    expect(applier.fullRebuildCount).toBe(0)
    expect(materialOf(IDS.cover), '材质还在文档里，节点就不该被还原').toBe(overridden)
  })
})

describe('a re-uploaded asset forces a rebuild (T-176 审查所得)', () => {
  it('falls back when a node keeps its id but points at a different asset', () => {
    // §5.3's remap ladder keeps every node id and replaces `doc.nodes` wholesale, so this
    // arrives as ONE `/nodes` patch with identical id sets on both sides. Reconciled
    // node-by-node it all "succeeds", the batch counts as handled, and the viewport keeps
    // drawing the old model while the tree and the 「已迁移 N 项」 dialog show the new one.
    const prev = createGoldenPathDocument()
    graph.build(prev)
    const next = {
      ...prev,
      nodes: prev.nodes.map((n) => (n.assetRef ? { ...n, assetRef: { ...n.assetRef, assetId: 'ast_11112222' } } : n)),
    }

    const result = applier.apply([{ op: 'replace', path: ['nodes'], value: next.nodes }], next, prev)

    expect(result.rebuilt, '换了资产就必须重建，这是唯一知道怎么重新长出几何的路径').toBe(true)
    expect(applier.fullRebuildCount, '而且要如实报警，不是悄悄换').toBe(1)
  })

  it('does NOT fall back when the asset is the same', () => {
    // The guard has to be narrow, or every ordinary wholesale edit (a delete, an import)
    // starts rebuilding and the counter stops meaning anything.
    const prev = createGoldenPathDocument()
    graph.build(prev)
    const next = { ...prev, nodes: prev.nodes.map((n) => ({ ...n, name: `${n.name} ` })) }

    const result = applier.apply([{ op: 'replace', path: ['nodes'], value: next.nodes }], next, prev)

    expect(result.rebuilt).toBe(false)
    expect(applier.fullRebuildCount).toBe(0)
  })
})

/* ========================================================================== */
/* T-230 · v3 集合的四个钩子与两个顶层标量                                      */
/* ========================================================================== */

describe('T-230 · v3 集合钩子与顶层标量', () => {
  const HOOKS = ['applyPages', 'applyFlows', 'applyDataSources', 'applyPrefabs'] as const

  /** 四个钩子全装上，返回 applier 与那四个 spy。 */
  function withHooks() {
    // 复用 beforeEach 装好的 graph / registry，形状照 :278 那条既有用例。
    const spies = {
      applyPages: vi.fn(),
      applyFlows: vi.fn(),
      applyDataSources: vi.fn(),
      applyPrefabs: vi.fn(),
    }
    const applier = new PatchApplier({ graph, materials: registry, rebuild: () => {}, ...spies })
    return { applier, spies }
  }

  it.each([
    [['pages'], 'applyPages'],
    [['pages', 0, 'name'], 'applyPages'],
    [['flows'], 'applyFlows'],
    [['flows', 0, 'startStepId'], 'applyFlows'],
    [['dataSources'], 'applyDataSources'],
    [['dataSources', 0, 'intervalMs'], 'applyDataSources'],
    [['prefabs'], 'applyPrefabs'],
    [['prefabs', 0, 'name'], 'applyPrefabs'],
  ] as const)('/%s 调对应的钩子，且**只**调它', (path, expected) => {
    const { applier, spies } = withHooks()
    const doc = createGoldenPathDocument()
    const result = applier.apply([{ op: 'replace', path: [...path], value: [] }], doc, doc)

    expect(result.rebuilt, '认领了就不该回落整图重建').toBe(false)
    expect(spies[expected]).toHaveBeenCalledTimes(1)
    expect(spies[expected]).toHaveBeenCalledWith(doc)
    // 另外三个必须没被调 —— 「四个一起调」的实现在只断一个的测试下照样绿
    for (const other of HOOKS) {
      if (other === expected) continue
      expect(spies[other], `${other} 不该为 /${path[0]} 开火`).not.toHaveBeenCalled()
    }
  })

  it('钩子缺席时路径仍然算 handled —— 这是「认领但不做事」的全部含义', () => {
    // **注意它与上面那条的分工**：这一条只看 fullRebuildCount，把 applyPages 的调用整个
    // 删掉它照样绿。上面那条才是钩子的看守。两条都要有。
    const doc = createGoldenPathDocument()
    for (const collection of ['pages', 'flows', 'dataSources', 'prefabs']) {
      const result = applier.apply([{ op: 'replace', path: [collection], value: [] }], doc, doc)
      expect(result.rebuilt, collection).toBe(false)
    }
    expect(applier.fullRebuildCount).toBe(0)
  })

  it.each([['projectId'], ['sceneId']])('/%s 是顶层标量，认领而不重建', (key) => {
    const doc = createGoldenPathDocument()
    const result = applier.apply([{ op: 'replace', path: [key], value: 'x' }], doc, doc)
    expect(result.handled).toBe(1)
    expect(result.unhandled).toEqual([])
    expect(result.rebuilt).toBe(false)
    expect(applier.fullRebuildCount).toBe(0)
  })

  it('/id 现在会回落整图重建 —— SceneDocument 根本没有这个字段', () => {
    // 没有这一条，「删掉那支不可达的 case 'id'」这个改动在测试上完全不可观测。
    const doc = createGoldenPathDocument()
    const result = applier.apply([{ op: 'replace', path: ['id'], value: 'x' }], doc, doc)
    expect(result.rebuilt).toBe(true)
    expect(applier.fullRebuildCount).toBe(1)
  })
})
