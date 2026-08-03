import { ID_COLLECTIONS, ID_COLLECTION_NAMES, createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { PatchApplier } from '../../src/runtime/apply-patch.js'
import type { DocumentPatch } from '../../src/runtime/apply-patch.js'
import { MaterialRegistry } from '../../src/runtime/material-registry.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { createPumpAsset } from './fixtures.js'

/**
 * T-201 · every registered collection has a patch path `applyPatch` recognises.
 *
 * Driven by the registry rather than by a list of collection names, which is the whole
 * point: when T-225 adds `dataSources` and `prefabs`, this test fails on the day they are
 * registered instead of on the day someone notices the viewport not updating.
 *
 * What "not recognised" actually costs: `applyOne` returns false, the batch is declared
 * unhandled, and `applyPatch` falls back to rebuilding the entire scene graph. 铁律 11 says
 * that path is a backstop with a warning and a counter, and the E2E suite asserts the
 * counter is zero. A collection nobody added a `case` for turns an ordinary edit into a full
 * rebuild — measured at 97 ms on a 1000-node document (IMPL_NOTES T-176), on every keystroke.
 */

function makeApplier() {
  const pump = createPumpAsset()
  const graph = new SceneGraph({ assets: pump.source })
  graph.build(createGoldenPathDocument())
  const warnings: string[] = []
  const applier = new PatchApplier({
    graph,
    materials: new MaterialRegistry(),
    rebuild: (doc) => graph.build(doc),
    log: (level, message) => {
      if (level === 'warn') warnings.push(message)
    },
  })
  return { applier, warnings }
}

/**
 * Collections whose WHOLESALE patch deliberately falls back to a full rebuild.
 *
 * `/materials` is the only one, and it is a decision rather than a gap: dropping a material
 * record means every node that referenced it has to go back to its own material, and
 * rebuilding is literally what that does (T-176 记录了这条「故意回落」). It is listed here
 * instead of being silently absent, so that the day it stops being deliberate — T-257 gives
 * the editor a material-delete entry — this table is what has to change.
 *
 * **This table may shrink, never grow.** A new name appearing here is a regression wearing
 * an exemption's clothes.
 */
const DELIBERATE_FULL_REBUILD: Readonly<Record<string, string>> = {
  materials: 'T-257 · 删材质要让引用它的节点回落自带材质，全量重建本来就是干这个的',
}

describe('集合补丁路径覆盖', () => {
  it.each(ID_COLLECTION_NAMES)('recognises a whole-collection patch on /%s', (name) => {
    const { applier } = makeApplier()
    const doc = createGoldenPathDocument()

    // The coarsest patch a collection can receive: immer emits this whenever the array is
    // REPLACED rather than mutated, which is what `draft.x = draft.x.filter(...)` produces —
    // the ordinary way to write a delete.
    const patch: DocumentPatch = { op: 'replace', path: [ID_COLLECTIONS[name].key], value: doc[name] }
    const result = applier.apply([patch], doc, doc)

    if (name in DELIBERATE_FULL_REBUILD) {
      expect(result.rebuilt).toBe(true)
      return
    }
    expect(result.unhandled).toEqual([])
    expect(result.rebuilt).toBe(false)
    expect(applier.fullRebuildCount).toBe(0)
  })

  it('keeps the deliberate-fallback table to the one entry it has today', () => {
    // A ratchet, not a decoration: without it, "add the collection to the exemption table"
    // is the cheapest way to make the test above pass, and the table stops meaning anything.
    expect(Object.keys(DELIBERATE_FULL_REBUILD)).toEqual(['materials'])
  })

  it.each(ID_COLLECTION_NAMES)('recognises an element patch on /%s/0', (name) => {
    const { applier } = makeApplier()
    const doc = createGoldenPathDocument()
    const patch: DocumentPatch = { op: 'replace', path: [ID_COLLECTIONS[name].key, 0], value: doc[name][0] ?? null }

    const result = applier.apply([patch], doc, doc)

    expect(result.unhandled).toEqual([])
    expect(applier.fullRebuildCount).toBe(0)
  })

  /**
   * The negative half. Without it the two tests above pass on an `applyOne` that returns
   * true for everything — which is not a hypothetical: 黄金路径 III 步 11's noted false-green
   * is exactly "a new collection treated as handled, so the picture never updates while the
   * counter stays at zero".
   */
  it('still falls back for a path nobody registered', () => {
    const { applier, warnings } = makeApplier()
    const doc = createGoldenPathDocument()
    const patch = { op: 'replace', path: ['foos'], value: [] } as unknown as DocumentPatch

    const result = applier.apply([patch], doc, doc)

    expect(result.rebuilt).toBe(true)
    expect(applier.fullRebuildCount).toBe(1)
    expect(warnings.join('\n')).toContain('回落到全量重建')
  })
})
