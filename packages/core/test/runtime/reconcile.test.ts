import { createGoldenPathDocument } from '@w3/schema'
import type { Node, SceneDocument } from '@w3/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { PatchApplier } from '../../src/runtime/apply-patch.js'
import type { DocumentPatch } from '../../src/runtime/apply-patch.js'
import { MaterialRegistry } from '../../src/runtime/material-registry.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { IDS } from '../helpers.js'
import { createPumpAsset } from './fixtures.js'

/**
 * P1-1 · `fullRebuildCount` must stay at zero on ordinary operations.
 *
 * The independent evaluation caught it going up on three of them — importing an asset,
 * saving a viewpoint, deleting a node — which makes it useless as D1's alarm: a counter
 * that is already non-zero cannot tell you when a real regression lands. Each case below
 * is one of the paths it fired on.
 */

let graph: SceneGraph
let applier: PatchApplier
let rebuilds: number

const setup = (doc: SceneDocument) => {
  const pump = createPumpAsset()
  graph = new SceneGraph({ assets: pump.source })
  graph.build(doc)
  rebuilds = 0
  applier = new PatchApplier({
    graph,
    materials: new MaterialRegistry(),
    rebuild: () => {
      rebuilds++
    },
  })
}

beforeEach(() => setup(createGoldenPathDocument()))

const apply = (patches: DocumentPatch[], next: SceneDocument, prev: SceneDocument) =>
  applier.apply(patches, next, prev)

describe('saving a viewpoint', () => {
  it('does not fall back to a full rebuild', () => {
    const prev = createGoldenPathDocument()
    const next: SceneDocument = {
      ...prev,
      viewpoints: [...prev.viewpoints, { ...prev.viewpoints[0]!, id: 'vpt_99999999', name: '视点 2' }],
    }
    const result = apply([{ op: 'add', path: ['viewpoints', prev.viewpoints.length], value: next.viewpoints.at(-1) }], next, prev)
    expect(result.rebuilt).toBe(false)
    expect(applier.fullRebuildCount).toBe(0)
  })
})

describe('deleting a node written as a whole-array replacement', () => {
  it('reconciles instead of rebuilding, and actually removes the object', () => {
    const prev = createGoldenPathDocument()
    const next: SceneDocument = { ...prev, nodes: prev.nodes.filter((n) => n.id !== IDS.cover) }

    // This is the patch Immer emits for `draft.nodes = draft.nodes.filter(...)`.
    const result = apply([{ op: 'replace', path: ['nodes'], value: next.nodes }], next, prev)

    expect(result.rebuilt).toBe(false)
    expect(applier.fullRebuildCount).toBe(0)
    expect(rebuilds).toBe(0)
    expect(graph.objectFor(IDS.cover)).toBeUndefined()
    expect(graph.objectFor(IDS.body)).toBeDefined()
  })

  it('drops the whole subtree when a parent goes', () => {
    const prev = createGoldenPathDocument()
    const gone = new Set<string>([IDS.pump, IDS.body, IDS.cover])
    const next: SceneDocument = { ...prev, nodes: prev.nodes.filter((n) => !gone.has(n.id)) }

    apply([{ op: 'replace', path: ['nodes'], value: next.nodes }], next, prev)

    expect(applier.fullRebuildCount).toBe(0)
    for (const id of gone) expect(graph.objectFor(id)).toBeUndefined()
  })
})

describe('an import, which appends a whole subtree at once', () => {
  it('adds parents before children even when the array order does not', () => {
    const prev = createGoldenPathDocument()
    const parent: Node = { ...prev.nodes[0]!, id: 'nod_aaaaaaaa', name: '新根', parent: null, assetRef: null }
    const child: Node = { ...prev.nodes[0]!, id: 'nod_bbbbbbbb', name: '新子', parent: parent.id, assetRef: null }
    const grandchild: Node = { ...prev.nodes[0]!, id: 'nod_cccccccc', name: '新孙', parent: child.id, assetRef: null }

    // Deliberately reversed: `graph.addNode` refuses a node whose parent is absent, so a
    // single pass in array order would drop two of these three on the floor.
    const next: SceneDocument = { ...prev, nodes: [...prev.nodes, grandchild, child, parent] }
    const result = apply([{ op: 'replace', path: ['nodes'], value: next.nodes }], next, prev)

    expect(result.rebuilt).toBe(false)
    expect(applier.fullRebuildCount).toBe(0)
    expect(graph.objectFor(parent.id)).toBeDefined()
    expect(graph.objectFor(child.id)?.parent).toBe(graph.objectFor(parent.id))
    expect(graph.objectFor(grandchild.id)?.parent).toBe(graph.objectFor(child.id))
  })

  it('reports honestly when a parent chain points at a node that does not exist', () => {
    const prev = createGoldenPathDocument()
    const orphan: Node = { ...prev.nodes[0]!, id: 'nod_dddddddd', name: '孤儿', parent: 'nod_zzzzzzzz', assetRef: null }
    const next: SceneDocument = { ...prev, nodes: [...prev.nodes, orphan] }

    // A rebuild here is CORRECT: we genuinely cannot place this node incrementally, and
    // saying so is the whole point of the counter.
    const result = apply([{ op: 'replace', path: ['nodes'], value: next.nodes }], next, prev)
    expect(result.rebuilt).toBe(true)
    expect(applier.fullRebuildCount).toBe(1)
  })
})

describe('the collections the renderer does not mirror', () => {
  it.each([['animations'], ['hotspots'], ['variables'], ['rules'], ['meta'], ['assets'], ['viewpoints']])(
    'treats a /%s patch as handled rather than as unrecognised',
    (collection) => {
      const doc = createGoldenPathDocument()
      const result = apply([{ op: 'replace', path: [collection, 0], value: {} }], doc, doc)
      expect(result.rebuilt).toBe(false)
      expect(applier.fullRebuildCount).toBe(0)
    },
  )

  it('still falls back on a path it genuinely does not know', () => {
    const doc = createGoldenPathDocument()
    const result = apply([{ op: 'replace', path: ['somethingNew', 0], value: 1 }], doc, doc)
    expect(result.rebuilt).toBe(true)
    expect(result.unhandled).toEqual(['replace /somethingNew/0'])
  })
})
