import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../src/document.js'
import type { Node } from '../src/node.js'
import { getCarrier, getLightNodes, getPrimitiveNodes, needsDefaultLightRig } from '../src/selectors.js'
import { createGoldenPathDocument } from '../src/samples.js'
import goldenPathTwo from './fixtures/v2/golden-path-2.json' with { type: 'json' }

/**
 * T-122 · the v2 carrier selectors.
 *
 * Small functions, but three different consumers switch on their answers (core's scene
 * graph, core's default-rig decision, the editor's tree icons). One place to be wrong is
 * better than three, which is the only reason they exist rather than being inlined.
 */

const v2 = () => structuredClone(goldenPathTwo) as unknown as SceneDocument
const nodeNamed = (doc: SceneDocument, name: string): Node => {
  const node = doc.nodes.find((n) => n.name === name)
  if (!node) throw new Error(`fixture has no node named ${name}`)
  return node
}

describe('getCarrier', () => {
  it('names the carrier each kind of v2 node holds', () => {
    const doc = v2()
    expect(getCarrier(nodeNamed(doc, '泵体'))).toBe('assetRef')
    expect(getCarrier(nodeNamed(doc, '展台'))).toBe('primitive')
    expect(getCarrier(nodeNamed(doc, '聚光灯'))).toBe('light')
  })

  it('returns null for a pure grouping node', () => {
    // The golden path I document's 泵组 is exactly this: a folder in the tree.
    const group = createGoldenPathDocument().nodes.find((n) => n.name === '泵组')!
    expect(getCarrier(group)).toBeNull()
  })

  it('does not throw on an invalid two-carrier node — that is I11’s report to make', () => {
    // A selector that threw would take the editor down before it could show the user what
    // is wrong with the file they just opened.
    const doc = v2()
    const node = nodeNamed(doc, '展台')
    ;(node as { light: unknown }).light = { kind: 'ambient', color: '#ffffff', intensity: 0.6 }
    expect(getCarrier(node)).toBe('primitive')
  })
})

describe('getLightNodes / getPrimitiveNodes', () => {
  it('finds exactly the lights and primitives in the v2 fixture', () => {
    const doc = v2()
    expect(getLightNodes(doc).map((n) => n.name)).toEqual(['聚光灯'])
    expect(getPrimitiveNodes(doc).map((n) => n.name)).toEqual(['展台'])
  })

  it('returns document order, not insertion-into-the-array-later order', () => {
    const doc = v2()
    const spot = nodeNamed(doc, '聚光灯')
    doc.nodes.unshift({ ...spot, id: 'nd_11111111', name: '补光灯' })
    expect(getLightNodes(doc).map((n) => n.name)).toEqual(['补光灯', '聚光灯'])
  })

  it('is empty on a document with neither', () => {
    expect(getLightNodes(createGoldenPathDocument())).toHaveLength(0)
    expect(getPrimitiveNodes(createGoldenPathDocument())).toHaveLength(0)
  })
})

describe('needsDefaultLightRig · D14', () => {
  it('true for a v1-era document: no lights, no environment', () => {
    // The regression this protects is G0.5-6 — an old project must look exactly as it did.
    expect(needsDefaultLightRig(createGoldenPathDocument())).toBe(true)
  })

  it('false once the document has a light of its own', () => {
    expect(needsDefaultLightRig(v2())).toBe(false)
  })

  it('false when an environment map is set even with no light nodes', () => {
    const doc = v2()
    doc.nodes = doc.nodes.filter((n) => n.light === null)
    expect(getLightNodes(doc)).toHaveLength(0)
    expect(needsDefaultLightRig(doc)).toBe(false)
  })

  it('true again after the last light and the environment are both removed', () => {
    // The round trip is the point: delete your only light and the scene must not go black.
    const doc = v2()
    doc.nodes = doc.nodes.filter((n) => n.light === null)
    doc.meta.environment.hdriAssetId = null
    expect(needsDefaultLightRig(doc)).toBe(true)
  })
})
