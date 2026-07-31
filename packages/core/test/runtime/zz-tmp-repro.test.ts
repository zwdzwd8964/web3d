import { describe, expect, it } from 'vitest'
import {
  createEmptyDocument,
  createPrimitiveNode,
  createSequentialIdFactory,
  ensureDefaultMaterial,
  checkIntegrity,
  validate,
} from '@w3/schema'
import type { Primitive, SceneDocument } from '@w3/schema'
import { BoxGeometry, Color, Mesh, MeshStandardMaterial, Object3D } from 'three'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { MaterialRegistry } from '../../src/runtime/material-registry.js'
import type { PrimitiveFactory } from '../../src/runtime/carrier-types.js'

const ids = () => ({ newId: createSequentialIdFactory(), now: () => '2026-09-01T00:00:00.000Z' })

function docWithBox(withMaterial: boolean): SceneDocument {
  const doc = createEmptyDocument({ name: '展台', ctx: ids() })
  const materialId = withMaterial ? ensureDefaultMaterial(doc, ids()) : undefined
  doc.nodes.push(
    createPrimitiveNode(doc, {
      name: '盒子',
      primitive: { kind: 'box', size: [1, 1, 1] },
      ...(materialId ? { overrides: { materialId } } : {}),
      ctx: ids(),
    }),
  )
  return doc
}

/** Stands in for T-140, which does not exist yet. Picks a DIFFERENT grey on purpose. */
const FUTURE_FACTORY_DIFFERENT_GREY: PrimitiveFactory = {
  create: (_p: Primitive) => new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: '#cccccc' })),
  update: () => true,
  dispose: (o: Object3D) => void o,
}

function renderedColour(doc: SceneDocument, factory?: PrimitiveFactory): string | null {
  const graph = new SceneGraph(factory ? { primitives: factory } : {})
  graph.build(doc)
  const registry = new MaterialRegistry()
  registry.applyAll(doc, graph)
  const object = graph.objectFor(doc.nodes[0]!.id)!
  const mesh = object as Mesh
  if (!mesh.isMesh) return null
  const mat = mesh.material as MeshStandardMaterial
  return `#${(mat.color as Color).getHexString()}`
}

describe('REPRO · does the #b8bec4 comment cause a visible divergence?', () => {
  it('A · today, with the shipped code, what do the two paths render?', () => {
    const withMat = renderedColour(docWithBox(true))
    const withoutMat = renderedColour(docWithBox(false))
    // eslint-disable-next-line no-console
    console.log('TODAY  with-default-material =', withMat, ' relying-on-core-fallback =', withoutMat)
    expect(withMat).toBe(withoutMat)
  })

  it('B · simulate T-140 picking a different grey', () => {
    const withMat = renderedColour(docWithBox(true), FUTURE_FACTORY_DIFFERENT_GREY)
    const withoutMat = renderedColour(docWithBox(false), FUTURE_FACTORY_DIFFERENT_GREY)
    // eslint-disable-next-line no-console
    console.log('FUTURE with-default-material =', withMat, ' relying-on-core-fallback =', withoutMat)
    expect({ withMat, withoutMat }).toBeTruthy()
  })

  it('C · is a materialless primitive even a legal document?', () => {
    const doc = docWithBox(false)
    const v = validate(doc)
    const issues = checkIntegrity(doc)
    // eslint-disable-next-line no-console
    console.log('VALIDATE ok =', v.ok, ' INTEGRITY issues =', JSON.stringify(issues.map((i) => `${i.rule}/${i.level}`)))
    expect(v.ok).toBe(true)
  })

  it('D · does anything at all pin #b8bec4?', () => {
    const doc = docWithBox(true)
    // eslint-disable-next-line no-console
    console.log('DEFAULT MATERIAL PARAMS =', JSON.stringify(doc.materials[0]!.params))
    expect(doc.materials[0]!.params.color).toBe('#b8bec4')
  })
})
