import { LIGHT_KINDS, checkIntegrity, createGoldenPathDocument, createSequentialIdFactory, errorsOf, validate } from '@w3/schema'
import type { LightKind, SceneDocument } from '@w3/schema'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import {
  LIGHT_TEMPLATES,
  addLight,
  castsShadow,
  defaultLight,
  setLightKind,
  setLightParams,
  setLightShadow,
  usingDefaultRig,
} from '../src/lib/light-edit.js'

/**
 * T-137 · creating and editing lights.
 *
 * This card exists because writing T-170's E2E found that core had the entire lighting
 * stack and the editor had no way to make a light at all. So the load-bearing assertion
 * here is the dullest one: `addLight` produces a document that VALIDATES — a light is a
 * discriminated union, and the way to get this wrong is to leave a field of the wrong
 * variant on it, which saves fine and refuses to open.
 */

const ctx = () => ({ newId: createSequentialIdFactory(), now: () => '2026-09-01T00:00:00.000Z' })
const edit = (recipe: (draft: SceneDocument) => void, doc = createGoldenPathDocument()) => produce(doc, recipe)

const templateFor = (kind: LightKind) => LIGHT_TEMPLATES.find((t) => t.kind === kind)!

describe('the five kinds', () => {
  it('offers every kind the schema defines', () => {
    expect(LIGHT_TEMPLATES.map((t) => t.kind)).toEqual([...LIGHT_KINDS])
    expect(LIGHT_TEMPLATES.map((t) => t.label)).toEqual(['环境光', '半球光', '平行光', '点光源', '聚光灯'])
  })

  it('every default parses as the schema’s own shape', () => {
    // A discriminated union gets this wrong quietly: an extra field from another variant
    // is rejected by `.strict()`, so the document saves and then refuses to open — the
    // worst shape a bug takes here.
    for (const kind of LIGHT_KINDS) {
      const doc = edit((draft) => void addLight(draft, templateFor(kind), { ctx: ctx() }))
      expect(validate(doc).ok, `${kind} 的默认值不合 schema`).toBe(true)
      expect(errorsOf(checkIntegrity(doc)), kind).toEqual([])
    }
  })

  it('knows which kinds can cast a shadow', () => {
    expect(castsShadow('directional')).toBe(true)
    expect(castsShadow('point')).toBe(true)
    expect(castsShadow('spot')).toBe(true)
    // Ambient and hemisphere have no direction to cast one FROM.
    expect(castsShadow('ambient')).toBe(false)
    expect(castsShadow('hemisphere')).toBe(false)
  })
})

describe('creating one', () => {
  it('adds a node carrying the light, not a top-level record (D12)', () => {
    const before = createGoldenPathDocument()
    const after = edit((draft) => void addLight(draft, templateFor('spot'), { ctx: ctx() }), before)

    expect(after.nodes).toHaveLength(before.nodes.length + 1)
    const created = after.nodes[after.nodes.length - 1]!
    expect(created.light?.kind).toBe('spot')
    expect(created.name).toBe('聚光灯')
    // A node, so it has everything a node has — that is the whole of D12's payoff.
    expect(created.primitive).toBeNull()
    expect(created.assetRef).toBeNull()
    expect(created.visible).toBe(true)
  })

  it('puts an aiming light ABOVE the point it was created at, not inside the scene', () => {
    // A spotlight created at the ground is inside whatever it was meant to illuminate,
    // which looks exactly like a light that does not work.
    const after = edit((draft) => void addLight(draft, templateFor('spot'), { ctx: ctx() }))
    const created = after.nodes[after.nodes.length - 1]!
    expect(created.transform.p[1]).toBeGreaterThan(0)
  })

  it('tilts a directional or spot light DOWN, so a new one lights something', () => {
    // The identity quaternion points -Z, which is horizontal: a light created that way
    // illuminates nothing on the ground and reads as broken.
    for (const kind of ['directional', 'spot'] as const) {
      const after = edit((draft) => void addLight(draft, templateFor(kind), { ctx: ctx() }))
      const created = after.nodes[after.nodes.length - 1]!
      expect(created.transform.r, `${kind} 应当朝下倾斜`).not.toEqual([0, 0, 0, 1])
    }
  })

  it('leaves ambient and hemisphere unrotated — theirs means nothing', () => {
    for (const kind of ['ambient', 'hemisphere'] as const) {
      const after = edit((draft) => void addLight(draft, templateFor(kind), { ctx: ctx() }))
      expect(after.nodes[after.nodes.length - 1]!.transform.r).toEqual([0, 0, 0, 1])
    }
  })

  it('honours an explicit position', () => {
    const after = edit((draft) => void addLight(draft, templateFor('point'), { position: [1, 5, -2], ctx: ctx() }))
    expect(after.nodes[after.nodes.length - 1]!.transform.p).toEqual([1, 5, -2])
  })
})

describe('editing one', () => {
  const withSpot = () => edit((draft) => void addLight(draft, templateFor('spot'), { ctx: ctx() }))
  const lightId = (doc: SceneDocument) => doc.nodes[doc.nodes.length - 1]!.id

  it('writes one parameter and leaves the rest alone', () => {
    const doc = withSpot()
    const id = lightId(doc)
    const after = edit((draft) => setLightParams(draft, id, { intensity: 8 }), doc)

    const light = after.nodes.find((n) => n.id === id)!.light!
    expect(light.intensity).toBe(8)
    expect(light.kind).toBe('spot')
    expect('angleDeg' in light && light.angleDeg, '没提到的字段不该消失').toBe(30)
    expect(validate(after).ok).toBe(true)
  })

  it('changing kind REBUILDS from that kind’s defaults', () => {
    // A discriminated union cannot be merged field-wise: a spot's `angleDeg` left on a
    // point light is a field `.strict()` rejects, so the document saves and then fails to
    // open. Rebuilding is the only correct move.
    const doc = withSpot()
    const id = lightId(doc)
    const after = edit((draft) => setLightKind(draft, id, 'point'), doc)

    const light = after.nodes.find((n) => n.id === id)!.light!
    expect(light.kind).toBe('point')
    expect('angleDeg' in light, '锥角是聚光灯独有的，换成点光源必须没有它').toBe(false)
    expect('penumbra' in light).toBe(false)
    expect(validate(after).ok, '换类型之后文档必须还能打开').toBe(true)
  })

  it('carries intensity and colour across a kind change', () => {
    // They are what the user was looking at when they switched; resetting them makes the
    // change look like it did something else as well.
    const doc = edit((draft) => {
      const node = addLight(draft, templateFor('spot'), { ctx: ctx() })
      setLightParams(draft, node.id, { intensity: 7, color: '#ff8800' })
    })
    const id = lightId(doc)
    const after = edit((draft) => setLightKind(draft, id, 'directional'), doc)

    const light = after.nodes.find((n) => n.id === id)!.light!
    expect(light.intensity).toBe(7)
    expect('color' in light && light.color).toBe('#ff8800')
  })

  it('switching to hemisphere does not smuggle a `color` field in', () => {
    // Hemisphere has skyColor/groundColor and NO `color`. Carrying the colour across
    // regardless would produce a document zod rejects.
    const doc = withSpot()
    const id = lightId(doc)
    const after = edit((draft) => setLightKind(draft, id, 'hemisphere'), doc)

    const light = after.nodes.find((n) => n.id === id)!.light!
    expect('color' in light).toBe(false)
    expect(validate(after).ok).toBe(true)
  })

  it('writes shadow settings, and refuses for a kind that cannot cast one', () => {
    const doc = withSpot()
    const id = lightId(doc)
    const lit = edit((draft) => setLightShadow(draft, id, { enabled: true, quality: 'high' }), doc)
    const light = lit.nodes.find((n) => n.id === id)!.light!
    expect('shadow' in light && light.shadow).toEqual({ enabled: true, quality: 'high', bias: -0.0005 })

    // An ambient light has no shadow field at all; writing one would break validation.
    const ambient = edit((draft) => {
      const node = addLight(draft, templateFor('ambient'), { ctx: ctx() })
      setLightShadow(draft, node.id, { enabled: true })
    })
    expect(validate(ambient).ok).toBe(true)
    expect('shadow' in ambient.nodes[ambient.nodes.length - 1]!.light!).toBe(false)
  })

  it('ignores a node that is not a light, and one that is gone', () => {
    const doc = withSpot()
    expect(() => edit((draft) => setLightParams(draft, 'nd_r5t8y1u3', { intensity: 9 }), doc)).not.toThrow()
    expect(() => edit((draft) => setLightKind(draft, 'nd_00000000', 'point'), doc)).not.toThrow()

    const after = edit((draft) => setLightParams(draft, 'nd_r5t8y1u3', { intensity: 9 }), doc)
    expect(after.nodes.find((n) => n.id === 'nd_r5t8y1u3')!.light, '泵组 不该长出一盏灯').toBeNull()
  })
})

describe('the default rig (D14)', () => {
  it('is in use for a document with no lights and no environment', () => {
    expect(usingDefaultRig(createGoldenPathDocument())).toBe(true)
  })

  it('retreats as soon as there is one light', () => {
    // The panel says this out loud, because otherwise the FIRST light a user creates
    // appears to make the scene darker — the rig left and one lamp replaced it.
    const after = edit((draft) => void addLight(draft, templateFor('point'), { ctx: ctx() }))
    expect(usingDefaultRig(after)).toBe(false)
  })

  it('retreats for an environment too, with no light at all', () => {
    const after = edit((draft) => {
      draft.meta.environment = { ...draft.meta.environment, hdriAssetId: 'ast_hdr00001' }
    })
    expect(usingDefaultRig(after)).toBe(false)
  })

  it('defaultLight covers every kind with no gaps', () => {
    for (const kind of LIGHT_KINDS) expect(defaultLight(kind).kind).toBe(kind)
  })
})
