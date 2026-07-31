import { describe, expect, it } from 'vitest'
import { LightSchema, SHADOW_QUALITIES } from '../src/light.js'
import { MEDIA_ASSET_TYPES, MEDIA_TYPES, MediaSchema } from '../src/media.js'
import { PRIMITIVE_KINDS, PrimitiveSchema } from '../src/primitive.js'
import { MaterialParamsSchema, PHYSICAL_ONLY_PARAMS } from '../src/material.js'
import { EnvironmentSchema } from '../src/document.js'

/**
 * The frozen v2 field contract (MVP_V0_5 §4.1), asserted value by value.
 *
 * This file exists because of an accident. While M8's adversarial review was running, its
 * agents edited the schema to test their suspicions — `groundColor` default, `angleDeg`
 * range, `radiusTop` constraint, two `.strict()` calls, and the whole `MEDIA_ASSET_TYPES`
 * table went to obviously wrong values — and the entire test suite stayed green. Eight
 * changes to numbers that a product decision froze, and nothing noticed.
 *
 * Every other test in this package asserts BEHAVIOUR, which is right: they would catch a
 * broken migration or a check that stops checking. But a default value has no behaviour of
 * its own — it is a decision, and the only way to protect a decision is to write it down
 * twice and compare. That is what this file is, and it is deliberately boring.
 *
 * Rule for changing anything here: the numbers come from §4.1, which is frozen. A diff in
 * this file that is not accompanied by a schemaVersion bump and an ADR is a bug report.
 */

/** Parses the minimum a variant needs and returns the fully-defaulted object. */
const defaultsOf = <T>(schema: { parse: (input: unknown) => T }, seed: Record<string, unknown>): T =>
  schema.parse(seed)

describe('§4.1.2 · primitives', () => {
  it('has exactly the seven kinds, in the order the library panel shows them', () => {
    expect([...PRIMITIVE_KINDS]).toEqual(['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule'])
  })

  it.each([
    [{ kind: 'box' }, { kind: 'box', size: [1, 1, 1] }],
    [{ kind: 'sphere' }, { kind: 'sphere', radius: 0.5 }],
    [{ kind: 'cylinder' }, { kind: 'cylinder', radiusTop: 0.5, radiusBottom: 0.5, height: 1 }],
    [{ kind: 'cone' }, { kind: 'cone', radius: 0.5, height: 1 }],
    [{ kind: 'torus' }, { kind: 'torus', radius: 0.5, tube: 0.15 }],
    [{ kind: 'plane' }, { kind: 'plane', width: 1, height: 1 }],
    [{ kind: 'capsule' }, { kind: 'capsule', radius: 0.3, length: 0.6 }],
  ])('%o defaults to the frozen dimensions', (seed, expected) => {
    expect(defaultsOf(PrimitiveSchema, seed)).toEqual(expected)
  })

  it('a cylinder may have a zero radius at one end — that is how a frustum is expressed', () => {
    expect(PrimitiveSchema.safeParse({ kind: 'cylinder', radiusTop: 0, radiusBottom: 0.5, height: 1 }).success).toBe(true)
    expect(PrimitiveSchema.safeParse({ kind: 'cylinder', radiusTop: -1, radiusBottom: 0.5, height: 1 }).success).toBe(false)
  })

  it('rejects an unknown field on every variant — a typo must not be stored as data', () => {
    for (const kind of PRIMITIVE_KINDS) {
      expect(PrimitiveSchema.safeParse({ kind, nonsense: 1 }).success, kind).toBe(false)
    }
  })
})

describe('§4.1.3 · lights', () => {
  it('ambient carries colour and intensity, and no shadow it could not cast', () => {
    expect(defaultsOf(LightSchema, { kind: 'ambient' })).toEqual({ kind: 'ambient', color: '#ffffff', intensity: 0.6 })
  })

  it('hemisphere carries a sky colour, a ground colour and an intensity', () => {
    expect(defaultsOf(LightSchema, { kind: 'hemisphere' })).toEqual({
      kind: 'hemisphere',
      skyColor: '#ffffff',
      groundColor: '#444444',
      intensity: 0.6,
    })
  })

  it('directional defaults to 1.5 with shadows off', () => {
    expect(defaultsOf(LightSchema, { kind: 'directional' })).toEqual({
      kind: 'directional',
      color: '#ffffff',
      intensity: 1.5,
      shadow: { enabled: false, quality: 'medium', bias: -0.0005 },
    })
  })

  it('point defaults to unlimited range and physical decay', () => {
    expect(defaultsOf(LightSchema, { kind: 'point' })).toEqual({
      kind: 'point',
      color: '#ffffff',
      intensity: 1,
      range: 0,
      decay: 2,
      shadow: { enabled: false, quality: 'medium', bias: -0.0005 },
    })
  })

  it('spot defaults to a 30° cone', () => {
    expect(defaultsOf(LightSchema, { kind: 'spot' })).toEqual({
      kind: 'spot',
      color: '#ffffff',
      intensity: 2,
      range: 0,
      decay: 2,
      angleDeg: 30,
      penumbra: 0.2,
      shadow: { enabled: false, quality: 'medium', bias: -0.0005 },
    })
  })

  it('holds the frozen ranges: intensity ceilings, cone limits, bias clamp', () => {
    const ok = (input: unknown) => LightSchema.safeParse(input).success
    // Ambient / hemisphere cap at 10, the directional family at 20 (§4.1.3).
    expect(ok({ kind: 'ambient', intensity: 10 })).toBe(true)
    expect(ok({ kind: 'ambient', intensity: 10.1 })).toBe(false)
    expect(ok({ kind: 'directional', intensity: 20 })).toBe(true)
    expect(ok({ kind: 'directional', intensity: 20.1 })).toBe(false)
    // A cone is 1°–89°: 0 lights nothing and 90+ is no longer a cone.
    expect(ok({ kind: 'spot', angleDeg: 1 })).toBe(true)
    expect(ok({ kind: 'spot', angleDeg: 89 })).toBe(true)
    expect(ok({ kind: 'spot', angleDeg: 0 })).toBe(false)
    expect(ok({ kind: 'spot', angleDeg: 90 })).toBe(false)
    // Bias outside ±0.01 erases the shadow instead of degrading it.
    expect(ok({ kind: 'spot', shadow: { bias: -0.01 } })).toBe(true)
    expect(ok({ kind: 'spot', shadow: { bias: -0.011 } })).toBe(false)
    expect(ok({ kind: 'point', decay: 4 })).toBe(true)
    expect(ok({ kind: 'point', decay: 4.1 })).toBe(false)
    expect(ok({ kind: 'point', range: -1 })).toBe(false)
  })

  it('has three shadow quality buckets and rejects a fourth', () => {
    expect([...SHADOW_QUALITIES]).toEqual(['low', 'medium', 'high'])
    expect(LightSchema.safeParse({ kind: 'spot', shadow: { quality: 'ultra' } }).success).toBe(false)
  })

  it('rejects an unknown field on every variant', () => {
    for (const kind of ['ambient', 'hemisphere', 'directional', 'point', 'spot']) {
      expect(LightSchema.safeParse({ kind, nonsense: 1 }).success, kind).toBe(false)
    }
  })
})

describe('§4.1.4 · environment', () => {
  it('defaults to no IBL, neutral intensity and neutral exposure', () => {
    expect(EnvironmentSchema.parse({})).toEqual({ hdriAssetId: null, intensity: 1, exposure: 1 })
  })

  it('holds the frozen ranges', () => {
    const ok = (input: unknown) => EnvironmentSchema.safeParse(input).success
    expect(ok({ intensity: 4 })).toBe(true)
    expect(ok({ intensity: 4.1 })).toBe(false)
    // Exposure floors at 0.1: zero is a black frame with no error anywhere.
    expect(ok({ exposure: 0.1 })).toBe(true)
    expect(ok({ exposure: 0 })).toBe(false)
    expect(ok({ exposure: 4.1 })).toBe(false)
  })
})

describe('§4.1.5 · material increments', () => {
  it('names exactly the five physical-only parameters I15 warns about', () => {
    expect([...PHYSICAL_ONLY_PARAMS]).toEqual(['transmission', 'ior', 'thickness', 'clearcoat', 'clearcoatRoughness'])
  })

  it('holds the frozen physical ranges', () => {
    const ok = (params: Record<string, unknown>) => MaterialParamsSchema.safeParse(params).success
    expect(ok({ transmission: 1 })).toBe(true)
    expect(ok({ transmission: 1.1 })).toBe(false)
    // IOR below 1 is not a material, it is a typo.
    expect(ok({ ior: 1 })).toBe(true)
    expect(ok({ ior: 0.9 })).toBe(false)
    expect(ok({ ior: 2.5 })).toBe(true)
    expect(ok({ ior: 2.6 })).toBe(false)
    expect(ok({ thickness: 0 })).toBe(true)
    expect(ok({ thickness: -1 })).toBe(false)
    expect(ok({ clearcoat: 1 })).toBe(true)
    expect(ok({ clearcoatRoughness: 1.1 })).toBe(false)
  })

  it('defaults the uv block to an identity transform when present', () => {
    expect(MaterialParamsSchema.parse({ uv: {} }).uv).toEqual({ repeat: [1, 1], offset: [0, 0], rotationDeg: 0 })
    expect(MaterialParamsSchema.parse({}).uv, 'absent means "inherit", not "identity"').toBeUndefined()
  })

  it('clamps uv rotation to one turn either way', () => {
    expect(MaterialParamsSchema.safeParse({ uv: { rotationDeg: 360 } }).success).toBe(true)
    expect(MaterialParamsSchema.safeParse({ uv: { rotationDeg: 361 } }).success).toBe(false)
    expect(MaterialParamsSchema.safeParse({ uv: { rotationDeg: -361 } }).success).toBe(false)
  })
})

describe('§4.1.6 · media', () => {
  it('has three media types', () => {
    expect([...MEDIA_TYPES]).toEqual(['image', 'video', 'audio'])
  })

  it('each media type requires the asset type of the same name', () => {
    // This table was silently corrupted to image→texture / video→hdri / audio→model and
    // every test stayed green, which is why it is now written down twice.
    expect(MEDIA_ASSET_TYPES).toEqual({ image: 'image', video: 'video', audio: 'audio' })
  })

  it('requires a name and treats durationS as genuinely optional', () => {
    const seed = { id: 'med_a1b2c3d4', type: 'audio', assetId: 'ast_a1b2c3d4' }
    expect(MediaSchema.safeParse(seed).success, 'name has no default and cannot have one').toBe(false)
    expect(MediaSchema.safeParse({ ...seed, name: '' }).success).toBe(false)
    expect(MediaSchema.parse({ ...seed, name: 'alarm.wav' })).toEqual({ ...seed, name: 'alarm.wav' })
    expect(MediaSchema.safeParse({ ...seed, name: 'a.wav', durationS: 0 }).success, 'a zero-length clip is a bug').toBe(false)
  })
})
