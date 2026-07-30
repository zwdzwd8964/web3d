import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION } from '../src/document.js'
import { createGoldenPathDocument } from '../src/samples.js'
import { DocumentValidationError, assertValid, validate } from '../src/validate.js'

const golden = () => createGoldenPathDocument()

/** Deep-clone then mutate, so each case starts from a known-good document. */
function broken(mutate: (doc: Record<string, any>) => void): unknown {
  const doc = structuredClone(golden()) as Record<string, any>
  mutate(doc)
  return doc
}

describe('validate()', () => {
  it('accepts the golden path document', () => {
    const r = validate(golden())
    expect(r.ok).toBe(true)
  })

  it('the golden path document is at the current schema version', () => {
    expect(golden().schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('rejects a non-object', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      expect(validate(bad).ok).toBe(false)
    }
  })

  it('reports the failing path, not just "invalid"', () => {
    const r = validate(broken((d) => (d.nodes[0].transform.p = [1, 2])))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.some((i) => i.path.startsWith('nodes[0].transform.p'))).toBe(true)
  })

  it('rejects unknown keys instead of silently dropping them', () => {
    const r = validate(broken((d) => (d.nodes[0].colour = 'red')))
    expect(r.ok).toBe(false)
  })

  it('rejects NaN and Infinity, which do not survive JSON', () => {
    expect(validate(broken((d) => (d.nodes[0].transform.p[1] = Number.NaN))).ok).toBe(false)
    expect(validate(broken((d) => (d.nodes[0].transform.p[1] = Number.POSITIVE_INFINITY))).ok).toBe(false)
  })

  it('rejects an out-of-range material parameter', () => {
    expect(validate(broken((d) => (d.materials[0].params.roughness = 1.4))).ok).toBe(false)
    expect(validate(broken((d) => (d.materials[0].params.color = 'red'))).ok).toBe(false)
  })

  it('rejects a variable whose default does not match its declared type', () => {
    const r = validate(broken((d) => (d.variables[0].default = 'one')))
    expect(r.ok).toBe(false)
  })

  it('rejects an unregistered action kind (C5: the catalog is the whole vocabulary)', () => {
    const r = validate(broken((d) => (d.rules[0].then[0] = { action: 'launchMissiles', targetId: 'x' })))
    expect(r.ok).toBe(false)
  })

  it('rejects an unregistered event kind', () => {
    expect(validate(broken((d) => (d.rules[0].when = { event: 'pageEnter', pageId: 'pg_000001' }))).ok).toBe(false)
  })

  it('rejects an animation kind outside the closed enum (R03)', () => {
    const r = validate(
      broken((d) => {
        d.animations[0] = { id: d.animations[0].id, name: 'x', kind: 'keyframe', tracks: [] }
      }),
    )
    expect(r.ok).toBe(false)
  })

  it('rejects a rule with an empty action list', () => {
    expect(validate(broken((d) => (d.rules[0].then = []))).ok).toBe(false)
  })

  it('accepts a rule with no conditions (empty means always)', () => {
    expect(validate(broken((d) => (d.rules[0].if = []))).ok).toBe(true)
  })

  it('accepts nested and/or/not conditions', () => {
    const r = validate(
      broken((d) => {
        d.rules[0].if = [
          {
            op: 'or',
            conditions: [
              { op: 'not', condition: { op: 'eq', left: { var: 'step' }, right: { const: 9 } } },
              { op: 'nodeVisible', nodeId: d.nodes[2].id, expected: true },
            ],
          },
        ]
      }),
    )
    expect(r.ok).toBe(true)
  })

  it('rejects a camera whose far plane is not beyond its near plane', () => {
    expect(validate(broken((d) => (d.viewpoints[0].camera.far = 0.05))).ok).toBe(false)
  })

  it('rejects a tween target that changes nothing', () => {
    expect(validate(broken((d) => (d.animations[0].targets[0].to = {}))).ok).toBe(false)
  })

  it('assertValid throws a DocumentValidationError carrying every issue', () => {
    expect(() => assertValid(golden())).not.toThrow()
    try {
      assertValid(broken((d) => (d.nodes[0].name = 42)))
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DocumentValidationError)
      expect((err as DocumentValidationError).issues.length).toBeGreaterThan(0)
    }
  })

  it('survives a JSON round trip unchanged', () => {
    const doc = golden()
    const back = validate(JSON.parse(JSON.stringify(doc)))
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.document).toEqual(doc)
  })
})
