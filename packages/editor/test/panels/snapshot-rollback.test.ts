import { ID_COLLECTION_NAMES, createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { enablePatches, produceWithPatches } from 'immer'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyRollback } from '../../src/panels/SnapshotPanel.js'

/**
 * T-201 · rolling back must restore EVERY collection.
 *
 * The rollback used to be eleven hand-written `replaceInPlace` statements inside a click
 * handler. Two things were wrong with that at once, and only one of them is about style:
 *
 *  1. A twelfth collection is missed silently. TypeScript sees eleven correct statements and
 *     says nothing about the one that is absent. The user-visible symptom — "I rolled back
 *     and my flows are still from today" — reads as a rendering bug, not as data loss.
 *  2. The only way to reach the code was to render the panel and click. Extracting the
 *     function is what makes this file possible, and the card's rule 2 (每一环都要有卡认领)
 *     is the reason it is not left for later.
 *
 * T-225 adds five collections at once, so "missed silently" would be missed five times.
 */

// The store enables this at start-up; a test importing only the rollback function does not
// go through the store, so it has to say so itself.
beforeAll(() => enablePatches())

/**
 * A document with EVERY collection non-empty.
 *
 * The golden path leaves `pages`, `flows` and `media` empty, and building the fixture from
 * it directly is how the first version of this file managed to be green while
 * `applyRollback` skipped `media` entirely: rolling an empty array back to an empty array
 * looks exactly like doing it correctly. Registered by the mutation log as T-201/② class (a).
 */
function populatedDocument(): SceneDocument {
  const doc = createGoldenPathDocument()
  return {
    ...doc,
    pages: [{ id: 'pg_11111111', name: '首页', overlays: [] }],
    flows: [{ id: 'flw_11111111', name: '拆装', variableId: doc.variables[0]!.id, startStepId: null, steps: [] }],
    media: [{ id: 'med_11111111', type: 'audio', assetId: doc.assets[0]!.id, name: '提示音' }],
    // v3 · 集合从 11 变成 13。上面那段注释说的是「每个集合都非空」，而这两个新的一旦留空，
    // `applyRollback` 漏掉它们时的表现就和做对了一模一样 —— 正是这个文件当初写出来要防的那件事。
    dataSources: [
      {
        id: 'ds_11111111',
        name: '产线读数',
        enabled: false,
        mode: 'sample' as const,
        url: '',
        method: 'get' as const,
        body: null,
        auth: { kind: 'none' as const, secretRef: '', headerName: '' },
        intervalMs: 30_000,
        timeoutMs: 10_000,
        startOn: 'sceneReady' as const,
        onError: 'keep' as const,
        map: [],
        sample: [],
      },
    ],
    prefabs: [{ id: 'pfb_11111111', name: '标准泵组', note: '', version: 1, nodes: [], materials: [] }],
  } as SceneDocument
}

/** The rolled-back document: same shape, every collection emptied and the name changed. */
function emptiedDocument(): SceneDocument {
  const out = { ...populatedDocument(), name: '回滚后的名字' } as Record<string, unknown>
  for (const name of ID_COLLECTION_NAMES) out[name] = []
  return out as unknown as SceneDocument
}

describe('快照回滚覆盖每个集合', () => {
  it('restores every registered collection', () => {
    // Every collection starts non-empty, so skipping ANY one of them leaves visible residue.
    const draft = populatedDocument()
    const target = emptiedDocument()

    applyRollback(draft, target)

    for (const name of ID_COLLECTION_NAMES) {
      // Asserted per collection rather than with one `toEqual(target)`: a whole-document
      // comparison reports "objects differ" and leaves you hunting, and it also passes when
      // the loop happens to run over an empty registry.
      expect({ [name]: draft[name] }).toEqual({ [name]: [] })
    }
    expect(draft.name).toBe('回滚后的名字')
  })

  it('restores collections that were empty and became non-empty', () => {
    // The other direction. `replaceInPlace` trims and then assigns; going from 0 to n
    // exercises the assignment half, going from n to 0 exercises the trim half, and a
    // rollback does both at once on different collections.
    const draft = emptiedDocument()
    const target = populatedDocument()

    applyRollback(draft, target)

    for (const name of ID_COLLECTION_NAMES) {
      expect({ [name]: draft[name].map((r) => r.id) }).toEqual({ [name]: target[name].map((r) => r.id) })
    }
  })

  /**
   * The reason `replaceInPlace` exists at all, asserted rather than commented.
   *
   * Assigning whole arrays looks incremental and is not: immer describes it as one
   * `replace /nodes` per collection, `applyPatch` recognises almost none of those, and an
   * ordinary rollback trips 铁律 11's full-rebuild alarm. That alarm is only worth having
   * while it stays at zero for normal operations.
   */
  it('emits element-level patches, not whole-array replacements', () => {
    const target = emptiedDocument()
    const [, patches] = produceWithPatches(populatedDocument(), (draft) => {
      applyRollback(draft as SceneDocument, target)
    })

    const wholeArray = patches.filter((p) => p.path.length === 1 && ID_COLLECTION_NAMES.includes(p.path[0] as never))
    expect(wholeArray).toEqual([])
    // And it did emit something — an empty patch list would satisfy the assertion above
    // while proving the rollback did nothing at all.
    expect(patches.length).toBeGreaterThan(0)
  })
})
