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

  it('falls back when the whole nodes array is replaced, e.g. after an import', () => {
    const [next, prev] = edit((d) => d)
    applier.apply([{ op: 'replace', path: ['nodes'], value: next.nodes }], next, prev)
    expect(applier.fullRebuildCount).toBe(1)
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
