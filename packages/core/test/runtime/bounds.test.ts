import { createGoldenPathDocument, createPrimitiveNode } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { SceneRuntime } from '../../src/runtime/scene-runtime.js'
import { NullHotspotRenderer } from '../../src/runtime/hotspot-layer.js'
import { createMemoryResolver } from '../../src/runtime/loader.js'

/** Local doubles, matching `scene-runtime.test.ts`: no GL, and a shadowMap a real renderer always has. */
const canvas = () => ({ clientWidth: 800, clientHeight: 600 }) as HTMLCanvasElement
const fakeRenderer = () =>
  ({
    info: { memory: { geometries: 0, textures: 0 } },
    shadowMap: { enabled: false, type: -1 },
    render: () => {},
    setSize: () => {},
    setPixelRatio: () => {},
    dispose: () => {},
    domElement: {} as HTMLCanvasElement,
  }) as never

/**
 * T-146 · `SceneRuntime.boundsOf`.
 *
 * The measurement a dropped library model needs and could not have: a primitive's size is
 * known before it exists, an imported model's is only knowable once it has been built.
 */

const makeRuntime = (doc: SceneDocument) =>
  new SceneRuntime(doc, {
    canvas: canvas(),
    resolver: createMemoryResolver(new Map()),
    mode: 'edit',
    createRenderer: () => fakeRenderer(),
    hotspotRenderer: new NullHotspotRenderer(),
  })

/** A document with one 2×2×2 box at the origin, and a second one two metres up. */
function withBoxes(): { doc: SceneDocument; ids: string[] } {
  const doc = createGoldenPathDocument()
  const ids: string[] = []
  for (const [i, y] of [0, 2].entries()) {
    const node = createPrimitiveNode(doc, {
      name: `盒 ${i}`,
      primitive: { kind: 'box', size: [2, 2, 2] },
      transform: { p: [0, y, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    })
    doc.nodes.push(node)
    ids.push(node.id)
  }
  return { doc, ids }
}

describe('boundsOf', () => {
  it('measures a built primitive in world space', async () => {
    const { doc, ids } = withBoxes()
    const runtime = makeRuntime(doc)
    await runtime.load(doc)

    const bounds = runtime.boundsOf([ids[0]!])!
    expect(bounds.min).toEqual([-1, -1, -1])
    expect(bounds.max).toEqual([1, 1, 1])
    runtime.dispose()
  })

  it('spans every id it is given', async () => {
    const { doc, ids } = withBoxes()
    const runtime = makeRuntime(doc)
    await runtime.load(doc)

    const bounds = runtime.boundsOf(ids)!
    expect(bounds.min[1]).toBe(-1)
    expect(bounds.max[1]).toBe(3)
    runtime.dispose()
  })

  it('reads the CURRENT position, not the last rendered one', async () => {
    // The trap `Picker.roots()` fell into (M10/T-142): Box3.setFromObject reads matrixWorld
    // and never refreshes it, so between a document change and the next frame it measures
    // where the object used to be. A drop resolved against that lands nowhere near the
    // cursor, and only when the scene was edited without rendering in between.
    const { doc, ids } = withBoxes()
    const runtime = makeRuntime(doc)
    await runtime.load(doc)
    runtime.boundsOf(ids)  // prime every matrixWorld at the original position

    const object = runtime.graph.objectFor(ids[0]!)!
    object.position.set(100, 0, 0)

    const bounds = runtime.boundsOf([ids[0]!])!
    expect(bounds.min[0]).toBe(99)
    expect(bounds.max[0]).toBe(101)
    runtime.dispose()
  })

  it('returns null for nothing measurable', async () => {
    // Distinguishable from a zero-size box at the origin: the caller must be able to tell
    // "I could not measure this" from "this is a point", or every unresolvable drop lands
    // at 0,0,0 and looks deliberate.
    const { doc } = withBoxes()
    const runtime = makeRuntime(doc)
    await runtime.load(doc)

    expect(runtime.boundsOf([])).toBeNull()
    expect(runtime.boundsOf(['nd_00000000'])).toBeNull()
    runtime.dispose()
  })
})

describe('stale matrices', () => {
  it('measures through an ANCESTOR that moved since the last frame', async () => {
    // Box3.expandByObject calls updateWorldMatrix(false, true) — it refreshes the object and
    // its children, never its ancestors. Without a refresh from the root, a node whose
    // PARENT just moved reports where it used to be: measured at ±1 around the origin while
    // the parent sat 50 m away. A drop resolved against that lands nowhere near the cursor,
    // and only when the scene was edited without rendering in between.
    const doc = createGoldenPathDocument()
    const parent = createPrimitiveNode(doc, {
      name: '父',
      primitive: { kind: 'box', size: [2, 2, 2] },
      transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    })
    doc.nodes.push(parent)
    const child = createPrimitiveNode(doc, {
      name: '子',
      primitive: { kind: 'box', size: [2, 2, 2] },
      transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    })
    doc.nodes.push({ ...child, parent: parent.id })

    const runtime = makeRuntime(doc)
    await runtime.load(doc)
    runtime.boundsOf([child.id])  // prime every matrix at the original position
    runtime.graph.objectFor(parent.id)!.position.set(50, 0, 0)

    const bounds = runtime.boundsOf([child.id])!
    expect(bounds.min[0]).toBe(49)
    expect(bounds.max[0]).toBe(51)
    runtime.dispose()
  })
})
