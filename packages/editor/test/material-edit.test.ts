import { checkIntegrity, createGoldenPathDocument, errorsOf, validate } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import {
  IDENTITY_UV,
  PHYSICAL_FIELDS,
  TEXTURE_SLOTS,
  clearUv,
  setBase,
  setMap,
  setPhysical,
  setUv,
  textureAssets,
  usersOfMaterial,
} from '../src/lib/material-edit.js'

/**
 * T-152 · the material panel's decisions.
 *
 * They live outside the JSX so they can be run at all: the editor's tests have no DOM, and
 * M10's review found two features that had been "implemented" entirely inside event
 * handlers no test could reach.
 */

const MATERIAL = 'mat_c4d6f8h1'

const edit = (recipe: (draft: SceneDocument) => void, doc = createGoldenPathDocument()) => produce(doc, recipe)

describe('texture slots', () => {
  it('covers every slot the schema defines, in a fixed order', () => {
    expect(TEXTURE_SLOTS.map((s) => s.slot)).toEqual([
      'map',
      'normalMap',
      'roughnessMap',
      'metalnessMap',
      'aoMap',
      'emissiveMap',
    ])
  })

  it('points a slot at an asset, and the document still validates', () => {
    const before = createGoldenPathDocument()
    const withTexture: SceneDocument = {
      ...before,
      assets: [...before.assets, { ...before.assets[0]!, id: 'ast_tex00001', type: 'texture', name: '砖墙.png' }],
    }
    const after = edit((draft) => setMap(draft, MATERIAL, 'normalMap', 'ast_tex00001'), withTexture)

    expect(after.materials[0]!.params.maps.normalMap).toBe('ast_tex00001')
    expect(validate(after).ok).toBe(true)
    expect(errorsOf(checkIntegrity(after))).toEqual([])
  })

  it('DELETES the key when a slot is cleared, rather than writing undefined', () => {
    // `maps` is a strict object. An explicit `undefined` survives a JSON round-trip as a
    // key with no value, and the document then fails validation on reload — it saves fine
    // and cannot be opened, which is the worst shape a bug can take here.
    const before = createGoldenPathDocument()
    const withTexture: SceneDocument = {
      ...before,
      assets: [...before.assets, { ...before.assets[0]!, id: 'ast_tex00001', type: 'texture', name: '砖墙.png' }],
    }
    const set = edit((draft) => setMap(draft, MATERIAL, 'map', 'ast_tex00001'), withTexture)
    const cleared = edit((draft) => setMap(draft, MATERIAL, 'map', null), set)

    expect('map' in cleared.materials[0]!.params.maps).toBe(false)
    expect(JSON.parse(JSON.stringify(cleared)).materials[0].params.maps).toEqual({})
    expect(validate(cleared).ok).toBe(true)
  })

  it('offers only texture assets — an HDRI is an environment, not a surface map', () => {
    const before = createGoldenPathDocument()
    const mixed: SceneDocument = {
      ...before,
      assets: [
        ...before.assets,
        { ...before.assets[0]!, id: 'ast_tex00001', type: 'texture', name: '砖墙.png' },
        { ...before.assets[0]!, id: 'ast_hdr00001', type: 'hdri', name: '天空.hdr' },
      ],
    }
    expect(textureAssets(mixed).map((a) => a.id)).toEqual(['ast_tex00001'])
  })
})

describe('the uv block', () => {
  it('materialises the whole block from the identity when the material has none', () => {
    // `uv` is optional. Patching one field into an absent object throws, and the panel would
    // die the first time anyone touched a tiling control on an untouched material.
    const before = createGoldenPathDocument()
    expect(before.materials[0]!.params.uv).toBeUndefined()

    const after = edit((draft) => setUv(draft, MATERIAL, { repeat: [4, 4] }))

    expect(after.materials[0]!.params.uv).toEqual({ repeat: [4, 4], offset: [0, 0], rotationDeg: 0 })
    expect(validate(after).ok).toBe(true)
  })

  it('keeps the fields the patch does not name', () => {
    const tiled = edit((draft) => setUv(draft, MATERIAL, { repeat: [2, 2], rotationDeg: 45 }))
    const moved = edit((draft) => setUv(draft, MATERIAL, { offset: [0.5, 0] }), tiled)

    expect(moved.materials[0]!.params.uv).toEqual({ repeat: [2, 2], offset: [0.5, 0], rotationDeg: 45 })
  })

  it('resets by dropping the block, not by writing the identity', () => {
    // Absent and identity render the same, and absent is the smaller document. It also
    // keeps 「从没动过」 distinguishable from 「调过又调回来了」 in a diff.
    const tiled = edit((draft) => setUv(draft, MATERIAL, { repeat: [8, 8] }))
    const reset = edit((draft) => clearUv(draft, MATERIAL), tiled)

    expect(reset.materials[0]!.params.uv).toBeUndefined()
    expect(IDENTITY_UV).toEqual({ repeat: [1, 1], offset: [0, 0], rotationDeg: 0 })
  })
})

describe('base and the physical parameters', () => {
  it('offers exactly the five physical-only parameters', () => {
    expect(PHYSICAL_FIELDS.map((f) => f.key)).toEqual([
      'transmission',
      'ior',
      'thickness',
      'clearcoat',
      'clearcoatRoughness',
    ])
  })

  it('每个 physical 控件的范围与 schema 一致', () => {
    // A slider that lets the user type 3.0 into `ior` produces a document zod rejects on
    // save — the edit appears to work and the project stops loading.
    const ior = PHYSICAL_FIELDS.find((f) => f.key === 'ior')!
    expect([ior.min, ior.max]).toEqual([1, 2.5])
    for (const field of PHYSICAL_FIELDS.filter((f) => f.key !== 'ior' && f.key !== 'thickness')) {
      expect([field.min, field.max], field.key).toEqual([0, 1])
    }
  })

  it('drops the physical parameters when leaving physical', () => {
    // Keeping them leaves a document I15 warns about for as long as it exists, describing a
    // state the user cannot see (the fields are hidden) and did not ask for. Undo is how
    // you get them back.
    const glass = edit((draft) => {
      setBase(draft, MATERIAL, 'physical')
      setPhysical(draft, MATERIAL, 'transmission', 0.9)
      setPhysical(draft, MATERIAL, 'ior', 1.5)
    })
    expect(glass.materials[0]!.params.transmission).toBe(0.9)

    // Proof that the assertion below can fail: keeping them IS an I15 warning.
    const kept = produce(glass, (draft) => void (draft.materials[0]!.base = 'standard'))
    expect(checkIntegrity(kept).filter((f) => f.code === 'I15').length).toBeGreaterThan(0)

    const back = edit((draft) => setBase(draft, MATERIAL, 'standard'), glass)

    expect(back.materials[0]!.params.transmission).toBeUndefined()
    expect(back.materials[0]!.params.ior).toBeUndefined()
    expect(back.materials[0]!.base).toBe('standard')
    expect(validate(back).ok).toBe(true)
    // …and no I15 warning survives, which is the point of dropping them.
    expect(checkIntegrity(back).filter((f) => f.code === 'I15')).toEqual([])
  })

  it('keeps everything else across a base change', () => {
    const glass = edit((draft) => setBase(draft, MATERIAL, 'physical'))
    expect(glass.materials[0]!.params.roughness).toBe(createGoldenPathDocument().materials[0]!.params.roughness)
    expect(glass.materials[0]!.name).toBe(createGoldenPathDocument().materials[0]!.name)
  })

  it('ignores a material that is no longer in the document', () => {
    // The panel can lag one commit behind a delete; throwing here would take the editor down
    // for a race the user cannot even perceive.
    const doc = createGoldenPathDocument()
    expect(() => edit((draft) => setMap(draft, 'mat_00000000', 'map', 'ast_1'), doc)).not.toThrow()
    expect(() => edit((draft) => setUv(draft, 'mat_00000000', { repeat: [2, 2] }), doc)).not.toThrow()
    expect(() => edit((draft) => setBase(draft, 'mat_00000000', 'physical'), doc)).not.toThrow()
  })
})

describe('how many objects share this material', () => {
  it('counts the nodes overriding it', () => {
    // The runtime's clone-on-write makes 「改一个螺栓整台泵都变了」 impossible, but the count
    // is what tells the user which case they are in BEFORE they drag a slider.
    const doc = createGoldenPathDocument()
    expect(usersOfMaterial(doc, MATERIAL)).toBe(1)

    const both = produce(doc, (draft) => {
      for (const node of draft.nodes) node.overrides.materialId = MATERIAL
    })
    expect(usersOfMaterial(both, MATERIAL)).toBe(3)
  })
})
