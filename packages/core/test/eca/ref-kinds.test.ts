import { buildIndex, createGoldenPathDocument } from '@w3/schema'
import type { DocIndex, SceneDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { REF_KINDS, refExists, refOptions, refTypeOk } from '../../src/eca/ref-kinds.js'
import type { RefKind } from '../../src/eca/types.js'

/**
 * T-203 · the reference registry.
 *
 * What this file has to prove is not that `REF_KINDS` is correct in the abstract — it is that
 * it behaves **exactly** as the two `switch (kind)` statements it replaced did, in
 * `executor.ts` and in the rule editor. A refactor that changes behaviour while every test
 * passes is worse than the duplication it removed.
 *
 * See ADR-0028 for why the duplication had to go: adding a reference kind lit up both of the
 * files ECA_SPEC §10 forbids touching, making a two-line change a 分诊 Q4. v1.2's T-302 adds
 * four kinds.
 */

/** A document with one record of every referenceable kind. */
function fullDocument(): SceneDocument {
  const doc = createGoldenPathDocument()
  return {
    ...doc,
    media: [{ id: 'med_11111111', type: 'audio', assetId: doc.assets[0]!.id, name: '提示音' }],
  } as SceneDocument
}

const ALL_KINDS = Object.keys(REF_KINDS) as RefKind[]

/**
 * The exhaustiveness pin, checked by `tsc` rather than by vitest.
 *
 * `REF_KINDS` is `Record<RefKind, RefKindSpec>`, so leaving a kind out does not compile.
 * This line asserts that that is still true: if someone widens the annotation to
 * `Partial<Record<…>>`, the assignment below becomes legal, the `@ts-expect-error` has
 * nothing to suppress, and **TypeScript reports the unused directive** — the guard failing
 * turns into a compile error instead of a green test. Same shape as v0.5's T-185 H2.
 */
// @ts-expect-error — an incomplete registry must not satisfy REF_KINDS' type
const INCOMPLETE_REGISTRY: typeof REF_KINDS = { node: REF_KINDS.node }
void INCOMPLETE_REGISTRY

/** The one existing id of each kind in `fullDocument()`. */
function existingIdOf(doc: SceneDocument, kind: RefKind): string {
  const first = refOptions(doc, kind)[0]
  if (!first) throw new Error(`fixture has no ${kind}`)
  return first.id
}

describe('REF_KINDS 覆盖每一种引用', () => {
  it('registers exactly the kinds `RefKind` declares', () => {
    // The `Record<RefKind, …>` annotation already makes a missing kind a compile error. This
    // is the run-time half: an EXTRA key would compile fine and would be a kind nothing else
    // in the system knows about.
    expect(ALL_KINDS.sort()).toEqual(['animation', 'hotspot', 'material', 'media', 'node', 'variable', 'viewpoint'])
  })

  it('gives every kind a Chinese label', () => {
    for (const kind of ALL_KINDS) {
      // It goes verbatim into 「引用了已不存在的对象」 messages the customer reads.
      expect({ [kind]: REF_KINDS[kind].label }).toEqual({ [kind]: expect.stringMatching(/^[一-龥]+$/) })
    }
  })

  /**
   * Seven kinds × exists / does-not-exist. The card asks for fourteen rows because the
   * refactor's entire risk is a copy error in one row — and a spot check of two kinds would
   * pass on five wrong ones.
   */
  describe('refExists 逐项与改动前一致', () => {
    let index: DocIndex
    let doc: SceneDocument
    const setup = () => {
      doc = fullDocument()
      index = buildIndex(doc)
    }

    it.each(ALL_KINDS)('resolves an existing %s', (kind) => {
      setup()
      expect(refExists(index, kind, existingIdOf(doc, kind))) .toBe(true)
    })

    it.each(ALL_KINDS)('rejects a missing %s', (kind) => {
      setup()
      expect(refExists(index, kind, 'zz_deadbeef')).toBe(false)
    })
  })

  describe('refOptions 逐项与改动前一致', () => {
    it.each(ALL_KINDS)('lists the document\'s %s records', (kind) => {
      const doc = fullDocument()
      const options = refOptions(doc, kind)
      expect(options.length).toBeGreaterThan(0)
      for (const option of options) {
        expect(typeof option.id).toBe('string')
        expect(option.name.length).toBeGreaterThan(0)
      }
    })

    it('shows a variable id alongside its name', () => {
      // Two variables can share a name, and the id is what every condition expression names.
      const doc = fullDocument()
      const variable = doc.variables[0]!
      expect(refOptions(doc, 'variable')[0]?.name).toBe(`${variable.name}（${variable.id}）`)
    })

    it('shows a media record\'s own name, not its asset\'s', () => {
      const doc = fullDocument()
      expect(refOptions(doc, 'media')[0]?.name).toBe('提示音')
    })
  })
})

describe('refTypeOk · I14 的闸门', () => {
  it('accepts a media reference whose type matches', () => {
    const doc = fullDocument()
    const index = buildIndex(doc)
    expect(refTypeOk(index, { kind: 'media', id: 'med_11111111', expectType: 'audio' })).toBe(true)
  })

  it('rejects a media reference whose type does not', () => {
    // The gate `playMedia` depends on: a rule aimed at a video resolves — the id exists — and
    // then plays silence, which sends the user to check their speakers.
    const doc = { ...fullDocument() }
    doc.media = [{ ...doc.media[0]!, type: 'video' }]
    expect(refTypeOk(buildIndex(doc), { kind: 'media', id: 'med_11111111', expectType: 'audio' })).toBe(false)
  })

  it('accepts any kind that has no sub-type of its own', () => {
    const doc = fullDocument()
    const index = buildIndex(doc)
    // Pre-T-203 this was `if (ref.kind !== 'media') return true`. Now it is "the kind has no
    // expectTypeOf hook", which is the same answer arrived at from the registry instead of
    // from a hard-coded kind name.
    expect(refTypeOk(index, { kind: 'node', id: existingIdOf(doc, 'node'), expectType: 'whatever' })).toBe(true)
  })

  it('accepts a reference that asked for no type at all', () => {
    const doc = fullDocument()
    expect(refTypeOk(buildIndex(doc), { kind: 'media', id: 'med_11111111' })).toBe(true)
  })
})
