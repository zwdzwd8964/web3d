import type { SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LightFactory, PrimitiveFactory } from '../../src/runtime/carrier-types.js'
import { SceneGraph, disposeSubtree } from '../../src/runtime/scene-graph.js'
import { IDS } from '../helpers.js'
import { createPumpAsset } from './fixtures.js'

/** T-033. three's scene graph needs no GL context, so all of this runs in plain Node. */

let graph: SceneGraph
let pump: ReturnType<typeof createPumpAsset>

beforeEach(() => {
  pump = createPumpAsset()
  graph = new SceneGraph({ assets: pump.source })
})

describe('build()', () => {
  it('mirrors the document hierarchy', () => {
    graph.build(createGoldenPathDocument())

    expect(graph.size).toBe(3)
    const root = graph.objectFor(IDS.pump)!
    expect(root.parent).toBe(graph.root)
    expect(graph.objectFor(IDS.body)!.parent).toBe(root)
    expect(graph.objectFor(IDS.cover)!.parent).toBe(root)
  })

  it('orders siblings by `order`, not by array position', () => {
    const d = createGoldenPathDocument()
    // 阀盖 (order 2000) listed before 泵体 (order 1000).
    const shuffled = { ...d, nodes: [d.nodes[0]!, d.nodes[2]!, d.nodes[1]!] }
    graph.build(shuffled)
    expect(graph.objectFor(IDS.pump)!.children.map((c) => c.name)).toEqual(['泵体', '阀盖'])
  })

  it('applies the DOCUMENT transform, not the asset’s', () => {
    pump.coverMesh.position.set(99, 99, 99)
    const d = createGoldenPathDocument()
    const moved = {
      ...d,
      nodes: d.nodes.map((n) => (n.id === IDS.cover ? { ...n, transform: { p: [0, 0.35, 0] as [number, number, number], r: n.transform.r, s: n.transform.s } } : n)),
    }
    graph.build(moved)
    // Import bakes the source transform into the node; re-applying it here would double it.
    expect(graph.objectFor(IDS.cover)!.position.toArray()).toEqual([0, 0.35, 0])
  })

  it('materialises a mesh without dragging the source object’s children along', () => {
    graph.build(createGoldenPathDocument())
    const pumpGroup = pump.asset.objects.get('Root/Pump')!
    expect(pumpGroup.children).toHaveLength(2)

    // 泵组 has assetRef null, so it is a plain group; 泵体 maps to a leaf mesh.
    const body = graph.objectFor(IDS.body)!
    expect((body as Mesh).isMesh).toBe(true)
    expect(body.children, 'the asset object’s children are separate document nodes').toHaveLength(0)
  })

  it('shares geometry between the asset and the instance', () => {
    graph.build(createGoldenPathDocument())
    // A 128k-triangle buffer must not be copied per instance.
    expect((graph.objectFor(IDS.body) as Mesh).geometry).toBe(pump.bodyMesh.geometry)
  })

  it('creates a plain group for a node with no assetRef', () => {
    graph.build(createGoldenPathDocument())
    const object = graph.objectFor(IDS.pump)!
    expect(object).toBeInstanceOf(Group)
    expect(graph.isPlaceholder(IDS.pump)).toBe(false)
  })

  it('D5 · keeps a node whose asset object is missing, as a marked placeholder', () => {
    const d = createGoldenPathDocument()
    const orphaned = {
      ...d,
      nodes: d.nodes.map((n) => (n.id === IDS.cover ? { ...n, assetRef: { ...n.assetRef!, missing: true } } : n)),
    }
    graph.build(orphaned)

    expect(graph.objectFor(IDS.cover), 'the node must survive — its rules and hotspots depend on it').toBeDefined()
    expect(graph.isPlaceholder(IDS.cover)).toBe(true)
    expect(graph.objectFor(IDS.cover)!.userData.w3Placeholder).toBe(true)
  })

  it('builds even with nothing loaded, so the tree exists before the GLB arrives', () => {
    const empty = new SceneGraph()
    empty.build(createGoldenPathDocument())
    expect(empty.size).toBe(3)
    expect(empty.isPlaceholder(IDS.body)).toBe(true)
  })

  it('carries visibility through from the document', () => {
    const d = createGoldenPathDocument()
    const hidden = { ...d, nodes: d.nodes.map((n) => (n.id === IDS.body ? { ...n, visible: false } : n)) }
    graph.build(hidden)
    expect(graph.objectFor(IDS.body)!.visible).toBe(false)
    expect(graph.objectFor(IDS.cover)!.visible).toBe(true)
  })

  it('does not hang on a corrupted parent chain', () => {
    const d = createGoldenPathDocument()
    const looped = { ...d, nodes: d.nodes.map((n) => (n.id === IDS.pump ? { ...n, parent: IDS.cover } : n)) }
    expect(() => graph.build(looped)).not.toThrow()
    // The cycle is unreachable from the roots, so nothing from it is built.
    expect(graph.size).toBe(0)
  })

  it('rebuilding replaces rather than accumulates', () => {
    graph.build(createGoldenPathDocument())
    graph.build(createGoldenPathDocument())
    expect(graph.size).toBe(3)
    expect(graph.root.children).toHaveLength(1)
  })
})

describe('nodeIdFor()', () => {
  it('walks up from a hit object to the owning node', () => {
    graph.build(createGoldenPathDocument())
    const body = graph.objectFor(IDS.body)!
    expect(graph.nodeIdFor(body)).toBe(IDS.body)

    // A raycast can land on geometry nested below what the node materialised.
    const nested = new Mesh(pump.bodyMesh.geometry, pump.sharedMaterial)
    body.add(nested)
    expect(graph.nodeIdFor(nested)).toBe(IDS.body)
  })

  it('returns null for something the graph does not own', () => {
    graph.build(createGoldenPathDocument())
    expect(graph.nodeIdFor(new Group())).toBeNull()
    expect(graph.nodeIdFor(null)).toBeNull()
  })
})

describe('incremental mutations', () => {
  beforeEach(() => graph.build(createGoldenPathDocument()))

  it('setTransform / setVisible / setName touch only their node', () => {
    const d = createGoldenPathDocument()
    const node = { ...d.nodes[1]!, transform: { p: [1, 2, 3] as [number, number, number], r: [0, 0, 0, 1] as [number, number, number, number], s: [2, 2, 2] as [number, number, number] } }
    expect(graph.setTransform(IDS.body, node)).toBe(true)
    expect(graph.objectFor(IDS.body)!.position.toArray()).toEqual([1, 2, 3])
    expect(graph.objectFor(IDS.cover)!.position.toArray()).toEqual([0, 0, 0])

    expect(graph.setVisible(IDS.body, false)).toBe(true)
    expect(graph.objectFor(IDS.body)!.visible).toBe(false)

    expect(graph.setName(IDS.body, '新名字')).toBe(true)
    expect(graph.objectFor(IDS.body)!.name).toBe('新名字')
  })

  it('reports false for an unknown node rather than throwing', () => {
    expect(graph.setVisible('nd_99999999', false)).toBe(false)
    expect(graph.setName('nd_99999999', 'x')).toBe(false)
    expect(graph.setParent('nd_99999999', null)).toBe(false)
  })

  it('setParent re-parents and detaches from the old parent', () => {
    expect(graph.setParent(IDS.body, IDS.cover)).toBe(true)
    expect(graph.objectFor(IDS.body)!.parent).toBe(graph.objectFor(IDS.cover))
    expect(graph.objectFor(IDS.pump)!.children).toHaveLength(1)

    expect(graph.setParent(IDS.body, null)).toBe(true)
    expect(graph.objectFor(IDS.body)!.parent).toBe(graph.root)
  })

  it('SCHEMA_SPEC §4.2 · setParent refuses a move into the node’s own subtree', () => {
    expect(graph.setParent(IDS.pump, IDS.body)).toBe(false)
    expect(graph.setParent(IDS.body, IDS.body)).toBe(false)
    expect(graph.objectFor(IDS.pump)!.parent).toBe(graph.root)
  })

  it('addNode inserts under an existing parent', () => {
    const added = {
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
    expect(graph.addNode(added)).not.toBeNull()
    expect(graph.size).toBe(4)
    expect(graph.objectFor('nd_11111111')!.parent).toBe(graph.objectFor(IDS.pump))

    expect(graph.addNode(added), 'adding twice must not duplicate').toBeNull()
    expect(graph.addNode({ ...added, id: 'nd_22222222', parent: 'nd_99999999' })).toBeNull()
  })

  it('removeNode drops the whole subtree', () => {
    expect(graph.removeNode(IDS.pump)).toBe(true)
    expect(graph.size).toBe(0)
    expect(graph.root.children).toHaveLength(0)
    expect(graph.removeNode(IDS.pump)).toBe(false)
  })

  it('clear() empties the graph', () => {
    graph.clear()
    expect(graph.size).toBe(0)
    expect(graph.root.children).toHaveLength(0)
  })
})

/* ========================================================================== */
/* T-130 · carrier dispatch                                                   */
/* ========================================================================== */

/** A document with one node per carrier, plus a plain grouping node. */
function carrierDoc(): SceneDocument {
  const base = createGoldenPathDocument()
  const node = (over: Partial<SceneDocument['nodes'][number]>): SceneDocument['nodes'][number] => ({
    id: 'nd_00000000',
    name: 'x',
    parent: null,
    order: 1000,
    assetRef: null,
    primitive: null,
    light: null,
    transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    visible: true,
    locked: false,
    overrides: {},
    ...over,
  })
  return {
    ...base,
    nodes: [
      node({ id: 'nd_gr000000', name: '分组' }),
      node({ id: 'nd_pr000000', name: '展台', order: 2000, primitive: { kind: 'box', size: [2, 0.2, 2] } }),
      node({ id: 'nd_li000000', name: '聚光灯', order: 3000, light: { kind: 'ambient', color: '#ffffff', intensity: 0.6 } }),
    ],
  }
}

/** Records what the graph asked of it, so the dispatch itself can be asserted. */
function spyFactories() {
  const calls: string[] = []
  let updateAnswer = true
  const primitives: PrimitiveFactory = {
    create: (spec) => {
      calls.push(`primitive.create:${spec.kind}`)
      const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
      ;(mesh.userData as Record<string, unknown>).w3OwnedGeometry = true
      return mesh
    },
    update: (_o, spec) => {
      calls.push(`primitive.update:${spec.kind}`)
      return updateAnswer
    },
    dispose: () => calls.push('primitive.dispose'),
  }
  const lights: LightFactory = {
    create: (spec) => {
      calls.push(`light.create:${spec.kind}`)
      return new Group()
    },
    update: (_o, spec) => {
      calls.push(`light.update:${spec.kind}`)
      return updateAnswer
    },
    dispose: () => calls.push('light.dispose'),
  }
  return {
    calls,
    primitives,
    lights,
    setUpdateAnswer(value: boolean) {
      updateAnswer = value
    },
  }
}

describe('carrier dispatch (T-130)', () => {
  it('routes each node to the factory its carrier names, and nothing else', () => {
    const spy = spyFactories()
    const g = new SceneGraph({ assets: pump.source, primitives: spy.primitives, lights: spy.lights })
    g.build(carrierDoc())

    expect(spy.calls).toEqual(['primitive.create:box', 'light.create:ambient'])
    expect(g.size).toBe(3)
    // The grouping node still gets a plain Group, and the asset path is untouched.
    expect(g.objectFor('nd_gr000000')).toBeInstanceOf(Group)
  })

  it('a carrier node is materialised, not a placeholder', () => {
    // `isPlaceholder` means "an assetRef that did not resolve". A light reported as a
    // placeholder would make SceneRuntime tell the user their asset has not loaded, about
    // a node that has no asset at all.
    const g = new SceneGraph({ assets: pump.source })
    g.build(carrierDoc())
    expect(g.isPlaceholder('nd_pr000000')).toBe(false)
    expect(g.isPlaceholder('nd_li000000')).toBe(false)
    expect(g.isPlaceholder('nd_gr000000')).toBe(false)
  })

  it('without factories a carrier node still exists, keeps its transform and is findable', () => {
    // A host that installs no factories must not lose nodes: a vanished object looks
    // exactly like a bug in the user's document.
    const doc = carrierDoc()
    doc.nodes[1]!.transform.p = [1, 2, 3]
    const g = new SceneGraph({ assets: pump.source })
    g.build(doc)
    expect(g.objectFor('nd_pr000000')!.position.toArray()).toEqual([1, 2, 3])
  })

  it('setPrimitive updates in place when the factory can, and replaces when it cannot', () => {
    const spy = spyFactories()
    const g = new SceneGraph({ assets: pump.source, primitives: spy.primitives, lights: spy.lights })
    const doc = carrierDoc()
    g.build(doc)
    const before = g.objectFor('nd_pr000000')

    doc.nodes[1]!.primitive = { kind: 'box', size: [3, 3, 3] }
    expect(g.setPrimitive('nd_pr000000', doc.nodes[1]!)).toBe(true)
    expect(g.objectFor('nd_pr000000'), 'a resize must not swap the object').toBe(before)

    spy.setUpdateAnswer(false)
    doc.nodes[1]!.primitive = { kind: 'sphere', radius: 1 }
    expect(g.setPrimitive('nd_pr000000', doc.nodes[1]!)).toBe(true)
    expect(g.objectFor('nd_pr000000'), 'box to sphere is a different object').not.toBe(before)
    expect(spy.calls).toContain('primitive.dispose')
  })

  it('a structural replacement keeps the children — they are other document nodes', () => {
    const spy = spyFactories()
    spy.setUpdateAnswer(false)
    const g = new SceneGraph({ assets: pump.source, primitives: spy.primitives, lights: spy.lights })
    const doc = carrierDoc()
    doc.nodes.push({ ...doc.nodes[0]!, id: 'nd_ch000000', name: '子件', parent: 'nd_pr000000', order: 1000 })
    g.build(doc)

    doc.nodes[1]!.primitive = { kind: 'sphere', radius: 1 }
    g.setPrimitive('nd_pr000000', doc.nodes[1]!)
    expect(g.objectFor('nd_ch000000')!.parent).toBe(g.objectFor('nd_pr000000'))
  })

  it('setLight goes to the light factory, and a kind change replaces', () => {
    const spy = spyFactories()
    const g = new SceneGraph({ assets: pump.source, primitives: spy.primitives, lights: spy.lights })
    const doc = carrierDoc()
    g.build(doc)

    doc.nodes[2]!.light = { kind: 'ambient', color: '#ff0000', intensity: 1 }
    expect(g.setLight('nd_li000000', doc.nodes[2]!)).toBe(true)
    expect(spy.calls).toContain('light.update:ambient')

    spy.setUpdateAnswer(false)
    doc.nodes[2]!.light = { kind: 'point', color: '#ffffff', intensity: 1, range: 0, decay: 2, shadow: { enabled: false, quality: 'medium', bias: -0.0005 } }
    g.setLight('nd_li000000', doc.nodes[2]!)
    expect(spy.calls).toContain('light.create:point')
    expect(spy.calls).toContain('light.dispose')
  })

  it('setPrimitive / setLight report false for a node the graph does not have', () => {
    const g = new SceneGraph({ assets: pump.source })
    g.build(carrierDoc())
    expect(g.setPrimitive('nd_99999999', carrierDoc().nodes[1]!)).toBe(false)
    expect(g.setLight('nd_99999999', carrierDoc().nodes[2]!)).toBe(false)
  })
})

describe('resource ownership on removal (T-130)', () => {
  it('disposes the geometry a primitive factory made', () => {
    const spy = spyFactories()
    const g = new SceneGraph({ assets: pump.source, primitives: spy.primitives, lights: spy.lights })
    g.build(carrierDoc())
    const geometry = (g.objectFor('nd_pr000000') as Mesh).geometry
    let disposed = false
    geometry.addEventListener('dispose', () => (disposed = true))

    g.removeNode('nd_pr000000')
    expect(disposed).toBe(true)
  })

  it('does NOT dispose an asset instance’s geometry — the asset cache still owns it', () => {
    // Every instance of a part shares one BufferGeometry (see `materialise`). Disposing it
    // when one node is deleted blanks the others until the next upload, and the asset
    // loader disposes it properly when the asset itself goes.
    const g = new SceneGraph({ assets: pump.source })
    g.build(createGoldenPathDocument())
    let disposed = false
    pump.bodyMesh.geometry.addEventListener('dispose', () => (disposed = true))

    g.removeNode(IDS.body)
    expect(disposed).toBe(false)
  })

  it('forgets a removed node’s placeholder flag', () => {
    const g = new SceneGraph()
    g.build(createGoldenPathDocument())
    expect(g.isPlaceholder(IDS.body), 'no asset source, so it is a placeholder').toBe(true)
    g.removeNode(IDS.body)
    expect(g.isPlaceholder(IDS.body), 'the id outlived the node').toBe(false)
  })

  it('disposeSubtree leaves unowned geometry alone and frees owned geometry', () => {
    const owned = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
    ;(owned.userData as Record<string, unknown>).w3OwnedGeometry = true
    const borrowed = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
    const root = new Group()
    root.add(owned, borrowed)

    let ownedDisposed = false
    let borrowedDisposed = false
    owned.geometry.addEventListener('dispose', () => (ownedDisposed = true))
    borrowed.geometry.addEventListener('dispose', () => (borrowedDisposed = true))

    disposeSubtree(root)
    expect(ownedDisposed).toBe(true)
    expect(borrowedDisposed).toBe(false)
  })
})
