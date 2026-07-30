import { createGoldenPathDocument } from '@w3/schema'
import { Group, Mesh } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
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
