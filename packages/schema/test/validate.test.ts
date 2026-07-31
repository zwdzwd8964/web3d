import { describe, expect, it } from 'vitest'
import { CURRENT_VERSION } from '../src/document.js'
import { createGoldenPathDocument } from '../src/samples.js'
import { DocumentValidationError, assertValid, validate } from '../src/validate.js'

/** T-012 · SCHEMA_SPEC §9 structural validation. */

/** Deep-clone the known-good document, then break one thing. */
function broken(mutate: (doc: Record<string, any>) => void): unknown {
  const doc = structuredClone(createGoldenPathDocument()) as Record<string, any>
  mutate(doc)
  return doc
}

const pathsOf = (input: unknown): string[] => {
  const r = validate(input)
  return r.ok ? [] : r.error.map((e) => e.path)
}

describe('validate()', () => {
  it('accepts the golden path document', () => {
    expect(validate(createGoldenPathDocument()).ok).toBe(true)
  })

  it('pins schemaVersion to the literal current version', () => {
    expect(createGoldenPathDocument().schemaVersion).toBe(CURRENT_VERSION)
    // Written against CURRENT_VERSION rather than against literals, so the next bump does
    // not turn this into "rejects version 2" on a build where 2 is the current one.
    // A previous version is rejected HERE on purpose: reading old documents is `migrate`'s
    // job (C4), and `validate` accepting them would let a v1 document through unmigrated.
    expect(validate(broken((d) => (d.schemaVersion = CURRENT_VERSION + 1))).ok).toBe(false)
    expect(validate(broken((d) => (d.schemaVersion = CURRENT_VERSION - 1))).ok).toBe(false)
    expect(validate(broken((d) => (d.schemaVersion = 0))).ok).toBe(false)
  })

  it('rejects anything that is not an object', () => {
    for (const bad of [null, undefined, 42, 'x', []]) expect(validate(bad).ok).toBe(false)
  })

  it('reports a locatable path rather than just "invalid"', () => {
    expect(pathsOf(broken((d) => (d.nodes[0].transform.p = [1, 2])))).toContainEqual(
      expect.stringContaining('nodes[0].transform.p'),
    )
    expect(pathsOf(broken((d) => (d.rules[0].then = [])))).toContainEqual(expect.stringContaining('rules[0].then'))
  })

  it('rejects unknown keys instead of silently dropping them', () => {
    expect(validate(broken((d) => (d.nodes[0].colour = 'red'))).ok).toBe(false)
    expect(validate(broken((d) => (d.somethingNew = 1))).ok).toBe(false)
  })

  it('rejects a `constraints` collection — SCHEMA_SPEC §7 deliberately does not define one', () => {
    expect(validate(broken((d) => (d.constraints = []))).ok).toBe(false)
  })

  it('rejects NaN and Infinity, which do not survive JSON', () => {
    expect(validate(broken((d) => (d.nodes[0].transform.p[1] = Number.NaN))).ok).toBe(false)
    expect(validate(broken((d) => (d.nodes[0].transform.p[1] = Number.POSITIVE_INFINITY))).ok).toBe(false)
  })

  it('enforces id format on every reference field', () => {
    expect(validate(broken((d) => (d.nodes[1].parent = 'pump'))).ok).toBe(false)
    expect(validate(broken((d) => (d.nodes[2].overrides.materialId = 'nd_r5t8y1u3'))).ok).toBe(false)
    expect(validate(broken((d) => (d.hotspots[0].anchor.nodeId = 'nd_TOOLONGXX'))).ok).toBe(false)
  })

  it('enforces material parameter ranges and colour format', () => {
    expect(validate(broken((d) => (d.materials[0].params.roughness = 1.4))).ok).toBe(false)
    expect(validate(broken((d) => (d.meta.background.color = 'red'))).ok).toBe(false)
  })

  it('rejects an animation kind outside the closed union (R03 defence line)', () => {
    const r = validate(
      broken((d) => {
        d.animations[0] = { kind: 'keyframe', id: 'anm_j2l4n6p8', name: 'x', tracks: [] }
      }),
    )
    expect(r.ok).toBe(false)
  })

  it('rejects an event type v0 cannot fire', () => {
    expect(validate(broken((d) => (d.rules[0].when = { event: 'pageEnter', pageId: 'pg_a1b2c3d4' }))).ok).toBe(false)
    expect(validate(broken((d) => (d.rules[0].when = { event: 'flowStepEnter' }))).ok).toBe(false)
  })

  it('accepts every valid node target shape', () => {
    const cover = createGoldenPathDocument().nodes[2]!.id
    for (const target of [{ nodeId: cover }, { nodeId: cover, includeDescendants: true }, { any: true }]) {
      expect(validate(broken((d) => (d.rules[0].when = { event: 'click', target }))).ok, JSON.stringify(target)).toBe(
        true,
      )
    }
    expect(validate(broken((d) => (d.rules[0].when = { event: 'click', target: { any: false } }))).ok).toBe(false)
    expect(
      validate(broken((d) => (d.rules[0].when = { event: 'click', target: { nodeId: cover, includeDescendants: false } })))
        .ok,
    ).toBe(false)
  })

  it('accepts an action envelope without inspecting its params — that is the registry’s job', () => {
    // C5: adding an action must not require a schema change, so `params` is opaque here.
    expect(
      validate(broken((d) => (d.rules[0].then = [{ action: 'somethingBrandNew', params: { whatever: [1, 2, 3] } }]))).ok,
    ).toBe(true)
    expect(validate(broken((d) => (d.rules[0].then = [{ action: '', params: {} }]))).ok).toBe(false)
    expect(validate(broken((d) => (d.rules[0].then = [{ params: {} }]))).ok).toBe(false)
  })

  it('accepts flat if / ifAny and rejects a nested boolean tree (SCHEMA_SPEC §6.6)', () => {
    expect(validate(broken((d) => (d.rules[0].ifAny = d.rules[0].if))).ok).toBe(true)
    expect(validate(broken((d) => (d.rules[0].if = [{ op: 'and', conditions: [] }]))).ok).toBe(false)
    expect(validate(broken((d) => (d.rules[0].if = [{ op: 'not', condition: {} }]))).ok).toBe(false)
  })

  it('accepts every condition operator shape', () => {
    const doc = createGoldenPathDocument()
    const cover = doc.nodes[2]!.id
    const conditions = [
      { op: 'eq', left: { var: 'step' }, right: { const: 1 } },
      { op: 'in', left: { var: 'step' }, right: [1, 2, 3] },
      { op: 'isVisible', nodeId: cover, value: true },
      { op: 'isPlaying', animationId: doc.animations[0]!.id, value: false },
      { op: 'isPanelOpen', hotspotId: doc.hotspots[0]!.id, value: true },
      { op: 'gte', left: { prop: { nodeId: cover, key: 'positionY' } }, right: { const: 0.3 } },
      { op: 'eq', left: { event: 'nodeId' }, right: { const: cover } },
    ]
    for (const cond of conditions) {
      expect(validate(broken((d) => (d.rules[0].if = [cond]))).ok, JSON.stringify(cond)).toBe(true)
    }
    expect(validate(broken((d) => (d.rules[0].if = [{ op: 'matches', left: { var: 'step' }, right: { const: 1 } }]))).ok).toBe(
      false,
    )
    expect(
      validate(broken((d) => (d.rules[0].if = [{ op: 'gte', left: { prop: { nodeId: cover, key: 'rotation' } }, right: { const: 1 } }])))
        .ok,
    ).toBe(false)
  })

  it('rejects a camera whose far plane is not beyond its near plane is out of range', () => {
    expect(validate(broken((d) => (d.viewpoints[0].camera.fov = 200))).ok).toBe(false)
    expect(validate(broken((d) => (d.viewpoints[0].camera.near = 0))).ok).toBe(false)
  })

  it('rejects a tween with no targets and a non-positive duration', () => {
    expect(validate(broken((d) => (d.animations[0].targets = []))).ok).toBe(false)
    expect(validate(broken((d) => (d.animations[0].duration = 0))).ok).toBe(false)
  })

  it('rejects a variable id that is a reserved word', () => {
    expect(validate(broken((d) => (d.variables[0].id = 'event'))).ok).toBe(false)
  })

  it('SCHEMA_SPEC §0.5 · survives a JSON round trip unchanged', () => {
    const doc = createGoldenPathDocument()
    const back = validate(JSON.parse(JSON.stringify(doc)))
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.value).toEqual(doc)
  })

  it('fills declared defaults when optional fields are absent', () => {
    const doc = structuredClone(createGoldenPathDocument()) as Record<string, any>
    delete doc.pages
    delete doc.flows
    delete doc.media
    delete doc.rules[0].enabled
    delete doc.rules[0].reentry
    delete doc.nodes[0].visible
    const r = validate(doc)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.pages).toEqual([])
    expect(r.value.rules[0]!.enabled).toBe(true)
    expect(r.value.rules[0]!.reentry).toBe('restart')
    expect(r.value.nodes[0]!.visible).toBe(true)
  })

  it('assertValid throws a DocumentValidationError carrying every issue', () => {
    expect(() => assertValid(createGoldenPathDocument())).not.toThrow()
    try {
      assertValid(broken((d) => (d.nodes[0].name = 42)))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentValidationError)
      expect((error as DocumentValidationError).errors.length).toBeGreaterThan(0)
      expect((error as DocumentValidationError).message).toContain('nodes[0].name')
    }
  })
})
