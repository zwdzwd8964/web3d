import { checkIntegrity, createGoldenPathDocument, errorsOf, validate } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { applyHdri, assignToBaseColour, clearHdri, hdriAssets } from '../src/lib/environment-edit.js'

/**
 * T-155 · the environment and texture tabs' document changes.
 *
 * The card's acceptance is 「撤销一步环境整体还原」, which only holds if the three fields that
 * move together are written together.
 */

const IDS = { pump: 'nd_r5t8y1u3', body: 'nd_v7w9x2z4', cover: 'nd_b3n5m7k9', material: 'mat_c4d6f8h1' }

const withAssets = (): SceneDocument => {
  const base = createGoldenPathDocument()
  return {
    ...base,
    assets: [
      ...base.assets,
      { ...base.assets[0]!, id: 'ast_hdr00001', type: 'hdri', name: '黄昏.hdr' },
      { ...base.assets[0]!, id: 'ast_tex00001', type: 'texture', name: '砖墙.png' },
    ],
  } as SceneDocument
}

const edit = (recipe: (draft: SceneDocument) => void, doc = withAssets()) => produce(doc, recipe)

describe('applying an HDRI', () => {
  it('sets the environment AND the backdrop together', () => {
    // Leaving the background on `color` gives the half-state where objects are lit by a sky
    // nobody can see, which reads as "the HDRI did not work" — so the user applies another.
    const after = edit((draft) => applyHdri(draft, 'ast_hdr00001'))

    expect(after.meta.environment.hdriAssetId).toBe('ast_hdr00001')
    expect(after.meta.background.type).toBe('hdri')
    expect(validate(after).ok).toBe(true)
    expect(errorsOf(checkIntegrity(after))).toEqual([])
  })

  it('keeps the intensity and exposure the user had set', () => {
    // Applying a different sky is not a reason to reset how bright it is.
    const tuned = edit((draft) => {
      draft.meta.environment = { ...draft.meta.environment, intensity: 2, exposure: 1.4 }
    })
    const after = edit((draft) => applyHdri(draft, 'ast_hdr00001'), tuned)

    expect(after.meta.environment.intensity).toBe(2)
    expect(after.meta.environment.exposure).toBe(1.4)
  })

  it('clearing leaves a document that still renders', () => {
    // `background.type: 'hdri'` with no HDRI is a scene with no backdrop at all — so
    // clearing has to put the backdrop back, not just drop the map.
    const lit = edit((draft) => applyHdri(draft, 'ast_hdr00001'))
    const cleared = edit((draft) => clearHdri(draft), lit)

    expect(cleared.meta.environment.hdriAssetId).toBeNull()
    expect(cleared.meta.background.type).toBe('color')
    expect(validate(cleared).ok).toBe(true)
    expect(errorsOf(checkIntegrity(cleared))).toEqual([])
  })

  it('offers HDRIs only — a surface texture is not a sky', () => {
    expect(hdriAssets(withAssets()).map((a) => a.id)).toEqual(['ast_hdr00001'])
  })
})

describe('hanging a texture on the base colour', () => {
  it('points the selected node’s material at the asset', () => {
    const after = edit((draft) => void assignToBaseColour(draft, IDS.cover, 'ast_tex00001'))
    expect(after.materials.find((m) => m.id === IDS.material)!.params.maps.map).toBe('ast_tex00001')
    expect(validate(after).ok).toBe(true)
  })

  it('says no when the node has no material of its own', () => {
    // Silently importing an asset nobody can see is the failure mode: the panel says
    // 「已引入」 and the object looks exactly the same.
    let assigned: boolean | null = null
    edit((draft) => void (assigned = assignToBaseColour(draft, IDS.pump, 'ast_tex00001')))
    expect(assigned).toBe(false)
  })

  it('says no for a node that is not in the document', () => {
    let assigned: boolean | null = null
    edit((draft) => void (assigned = assignToBaseColour(draft, 'nd_00000000', 'ast_tex00001')))
    expect(assigned).toBe(false)
  })
})
