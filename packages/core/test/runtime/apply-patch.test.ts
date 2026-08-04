import type { SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import type { Mesh, MeshStandardMaterial } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
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
