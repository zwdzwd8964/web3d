import { checkIntegrity, createGoldenPathDocument, createSequentialIdFactory, errorsOf, validate } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import {
  MATERIAL_PRESETS,
  applyPreset,
  nodesUsing,
  presetById,
  separateMaterial,
} from '../src/lib/material-presets.js'
import { setMap, setUv } from '../src/lib/material-edit.js'

/**
 * T-154 · D16 · presets are fillers, not references.
 *
 * The load-bearing test is 「删掉整个预设库，文档照常渲染」 — expressed here as: nothing in
 * the document points at a preset for its VALUES, only for its name.
 */

const MATERIAL = 'mat_c4d6f8h1'
const IDS = { pump: 'nd_r5t8y1u3', body: 'nd_v7w9x2z4', cover: 'nd_b3n5m7k9' }

const edit = (recipe: (draft: SceneDocument) => void, doc = createGoldenPathDocument()) => produce(doc, recipe)
const ctx = () => ({ newId: createSequentialIdFactory(), now: () => '2026-09-01T00:00:00.000Z' })

describe('the preset set', () => {
  it('covers the ten materials the card names', () => {
    expect(MATERIAL_PRESETS).toHaveLength(10)
    expect(MATERIAL_PRESETS.map((p) => p.label)).toEqual([
      '拉丝金属',
      '抛光金属',
      '哑光塑料',
      '亮面塑料',
      '橡胶',
      '玻璃',
      '磨砂玻璃',
      '木',
      '陶瓷',
      '亚克力',
    ])
  })

  it('every preset carries a FULL parameter set', () => {
    // A half-specified preset inherits the rest from whatever the material happened to be,
    // so 「玻璃」 would look different depending on what you applied it to — the one thing a
    // preset exists to prevent.
    for (const preset of MATERIAL_PRESETS) {
      const p = preset.params
      expect(p.color, preset.id).toBeDefined()
      expect(p.roughness, preset.id).toBeDefined()
      expect(p.metalness, preset.id).toBeDefined()
      expect(p.opacity, preset.id).toBeDefined()
      expect(p.transparent, preset.id).toBeDefined()
      expect(p.maps, preset.id).toEqual({})
    }
  })

  it('only physical presets carry physical parameters', () => {
    // On a standard material they are dead weight the renderer ignores and I15 warns about.
    for (const preset of MATERIAL_PRESETS) {
      if (preset.base === 'physical') continue
      expect(preset.params.transmission, preset.id).toBeUndefined()
      expect(preset.params.ior, preset.id).toBeUndefined()
      expect(preset.params.clearcoat, preset.id).toBeUndefined()
    }
    expect(presetById('glass')!.params.transmission).toBe(1)
  })

  it('every glass-like preset is transparent, or three renders it as a solid lump', () => {
    for (const preset of MATERIAL_PRESETS) {
      if ((preset.params.transmission ?? 0) <= 0) continue
      expect(preset.params.transparent, preset.id).toBe(true)
    }
  })
})

describe('applying one (D16)', () => {
  it('writes the whole parameter set into the document', () => {
    const glass = presetById('glass')!
    const after = edit((draft) => applyPreset(draft, MATERIAL, glass))

    expect(after.materials[0]!.params.transmission).toBe(1)
    expect(after.materials[0]!.params.ior).toBe(1.52)
    expect(after.materials[0]!.base).toBe('physical')
    expect(validate(after).ok).toBe(true)
    expect(errorsOf(checkIntegrity(after))).toEqual([])
  })

  it('leaves the document self-contained — nothing looks the preset up again', () => {
    // D16's actual acceptance: 「应用预设后删除整个库目录，发布包照常渲染」. Expressed as a
    // test: every value the renderer needs is IN the record, and `preset` is only a name.
    const wood = presetById('wood')!
    const after = edit((draft) => applyPreset(draft, MATERIAL, wood))
    const record = after.materials[0]!

    expect(record.preset).toBe('wood')
    expect(record.params.color).toBe(wood.params.color)
    expect(record.params.roughness).toBe(wood.params.roughness)
    // The parameters are a COPY: editing the preset table afterwards must not reach into
    // documents that were saved before.
    expect(record.params).not.toBe(wood.params)
  })

  it('keeps the texture slots and the uv block', () => {
    // A preset describes how a surface responds to light, not what is printed on it.
    // Someone who set a wood grain map and then picks 「木」 wants the roughness.
    const before = createGoldenPathDocument()
    const withTexture: SceneDocument = {
      ...before,
      assets: [...before.assets, { ...before.assets[0]!, id: 'ast_tex00001', type: 'texture', name: '木纹.png' }],
    }
    const dressed = edit((draft) => {
      setMap(draft, MATERIAL, 'map', 'ast_tex00001')
      setUv(draft, MATERIAL, { repeat: [3, 3] })
    }, withTexture)

    const after = edit((draft) => applyPreset(draft, MATERIAL, presetById('wood')!), dressed)

    expect(after.materials[0]!.params.maps.map).toBe('ast_tex00001')
    expect(after.materials[0]!.params.uv).toEqual({ repeat: [3, 3], offset: [0, 0], rotationDeg: 0 })
    expect(after.materials[0]!.params.roughness).toBe(presetById('wood')!.params.roughness)
  })

  it('replaces the previous preset rather than merging with it', () => {
    // Glass → 拉丝金属 must not leave `transmission: 1` behind, or the metal renders
    // see-through and the panel shows nothing that explains it.
    const glassy = edit((draft) => applyPreset(draft, MATERIAL, presetById('glass')!))
    const metal = edit((draft) => applyPreset(draft, MATERIAL, presetById('brushed-metal')!), glassy)

    expect(metal.materials[0]!.params.transmission).toBeUndefined()
    expect(metal.materials[0]!.base).toBe('standard')
    expect(checkIntegrity(metal).filter((f) => f.code === 'I15')).toEqual([])
  })
})

describe('separating a shared material', () => {
  /** The golden path with all three nodes pointing at the one material. */
  const shared = () =>
    produce(createGoldenPathDocument(), (draft) => {
      for (const node of draft.nodes) node.overrides.materialId = MATERIAL
    })

  it('gives one node its own record and leaves the others alone', () => {
    const before = shared()
    expect(nodesUsing(before, MATERIAL)).toHaveLength(3)

    const after = edit((draft) => void separateMaterial(draft, IDS.cover, { ctx: ctx() }), before)

    expect(after.materials).toHaveLength(before.materials.length + 1)
    expect(nodesUsing(after, MATERIAL), '另外两个还在原来那份上').toEqual([IDS.pump, IDS.body])
    const copyId = after.nodes.find((n) => n.id === IDS.cover)!.overrides.materialId!
    expect(copyId).not.toBe(MATERIAL)
    expect(errorsOf(checkIntegrity(after))).toEqual([])
  })

  it('the copy is independent — editing it does not touch the original', () => {
    const after = edit((draft) => {
      const copyId = separateMaterial(draft, IDS.cover, { ctx: ctx() })!
      const copy = draft.materials.find((m) => m.id === copyId)!
      copy.params.roughness = 0.01
    }, shared())

    expect(after.materials.find((m) => m.id === MATERIAL)!.params.roughness).not.toBe(0.01)
  })

  it('copies the nested params rather than sharing them', () => {
    // Sharing `maps` or `uv` would reintroduce exactly the coupling separating exists to
    // break, and it would do it invisibly: the panel shows two materials.
    const before = createGoldenPathDocument()
    const withTexture: SceneDocument = {
      ...before,
      assets: [...before.assets, { ...before.assets[0]!, id: 'ast_tex00001', type: 'texture', name: '木纹.png' }],
      nodes: before.nodes.map((n) => ({ ...n, overrides: { ...n.overrides, materialId: MATERIAL } })),
    }
    const dressed = edit((draft) => setMap(draft, MATERIAL, 'map', 'ast_tex00001'), withTexture)

    const after = edit((draft) => {
      const copyId = separateMaterial(draft, IDS.cover, { ctx: ctx() })!
      setMap(draft, copyId, 'map', null)
    }, dressed)

    expect(after.materials.find((m) => m.id === MATERIAL)!.params.maps.map, '原件的贴图不能被连带清掉').toBe(
      'ast_tex00001',
    )
  })

  it('mints an id that does not collide with anything already in the document', () => {
    // `createMaterial` does not check, and a collision would silently repoint another node.
    const after = edit((draft) => {
      separateMaterial(draft, IDS.cover, { ctx: ctx() })
      separateMaterial(draft, IDS.body, { ctx: ctx() })
    }, shared())

    const ids = after.materials.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(errorsOf(checkIntegrity(after))).toEqual([])
  })

  it('does nothing for a node with no material of its own', () => {
    const doc = createGoldenPathDocument()
    const after = edit((draft) => void separateMaterial(draft, IDS.pump, { ctx: ctx() }), doc)
    expect(after.materials).toHaveLength(doc.materials.length)
  })
})
