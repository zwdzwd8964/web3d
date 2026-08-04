import type { Primitive, SceneDocument } from '@w3/schema'
import { PRIMITIVE_KINDS, createGoldenPathDocument, identityTransform } from '@w3/schema'
import { Box3, Vector3 } from 'three'
import type { Mesh } from 'three'
import { describe, expect, it } from 'vitest'
import { NullHotspotRenderer } from '../../src/runtime/hotspot-layer.js'
import { createMemoryResolver } from '../../src/runtime/loader.js'
import { primitiveFactory } from '../../src/runtime/primitive-factory.js'
import { SceneRuntime } from '../../src/runtime/scene-runtime.js'

/**
 * T-140 · the seven primitives.
 *
 * Geometry needs no GL context, so the load-bearing claim — "the bounding box is exactly
 * the numbers in the document" — is asserted here rather than eyeballed. T-142's drop
 * placement aligns bounding-box bottoms to the surface under the cursor: a primitive whose
 * box disagrees with its numbers puts every model it lands on through the floor.
 */

const NODE_ID = 'nd_prim0001'

/** World-space size of a freshly built primitive. */
function extentOf(primitive: Primitive): Vector3 {
  const object = primitiveFactory.create(primitive)
  object.updateMatrixWorld(true)
  return new Box3().setFromObject(object).getSize(new Vector3())
}

const close = (v: Vector3, expected: [number, number, number], precision = 5) => {
  expect(v.x).toBeCloseTo(expected[0], precision)
  expect(v.y).toBeCloseTo(expected[1], precision)
  expect(v.z).toBeCloseTo(expected[2], precision)
}

describe('the seven primitives, sized as the document says', () => {
  it('box: size is the full extent on each axis', () => {
    close(extentOf({ kind: 'box', size: [2, 0.2, 3] }), [2, 0.2, 3])
  })

  it('sphere: radius 0.5 is a 1-unit ball', () => {
    close(extentOf({ kind: 'sphere', radius: 0.5 }), [1, 1, 1], 2)
  })

  it('cylinder: height is the full height, radius the widest end', () => {
    close(extentOf({ kind: 'cylinder', radiusTop: 0.25, radiusBottom: 0.5, height: 2 }), [1, 2, 1], 2)
  })

  it('cylinder: a zero-radius top is a cone frustum, not an error', () => {
    // Why `radiusTop` is `nonnegative` rather than `positive` in the schema: this is how a
    // truncated cone is expressed, and refusing it would push the user to `cone`, which
    // cannot have a different radius at the other end.
    close(extentOf({ kind: 'cylinder', radiusTop: 0, radiusBottom: 1, height: 1 }), [2, 1, 2], 2)
  })

  it('cone: radius is the base, height the full height', () => {
    close(extentOf({ kind: 'cone', radius: 0.5, height: 1.5 }), [1, 1.5, 1], 2)
  })

  it('torus: the outer diameter is 2 × (radius + tube)', () => {
    close(extentOf({ kind: 'torus', radius: 0.5, tube: 0.15 }), [1.3, 1.3, 0.3], 2)
  })

  it('plane: width × height, standing in XY (ADR-0017)', () => {
    // three's own orientation, deliberately. A user who wants a floor rotates it, and that
    // rotation lands in `transform.r` — visible, undoable, published. A hidden 90° baked
    // into the geometry would show rotation 0 next to an object that is clearly not.
    close(extentOf({ kind: 'plane', width: 4, height: 2 }), [4, 2, 0])
  })

  it('capsule: total height is length + 2 × radius', () => {
    // three's `length` is the cylindrical middle, which is exactly what the field means.
    close(extentOf({ kind: 'capsule', radius: 0.3, length: 0.6 }), [0.6, 1.2, 0.6], 2)
  })

  it('every kind in the schema can actually be built', () => {
    // The gate against a kind being added to the schema and quietly falling through to a
    // default here — the switch is exhaustive by type, and this proves it at runtime too.
    for (const kind of PRIMITIVE_KINDS) {
      const primitive = defaultOf(kind)
      const object = primitiveFactory.create(primitive)
      expect((object as Mesh).isMesh, kind).toBe(true)
      expect((object as Mesh).geometry.getAttribute('position').count, kind).toBeGreaterThan(0)
    }
  })
})

describe('updating a primitive in place', () => {
  it('rebuilds the geometry and frees the old one', () => {
    const object = primitiveFactory.create({ kind: 'box', size: [1, 1, 1] })
    const mesh = object as Mesh
    const before = mesh.geometry
    let disposed = false
    before.addEventListener('dispose', () => {
      disposed = true
    })

    expect(primitiveFactory.update(object, { kind: 'box', size: [2, 2, 2] })).toBe(true)
    expect(mesh.geometry, '几何体应当被换掉').not.toBe(before)
    expect(disposed, '旧几何体必须释放——每次改尺寸泄漏一个 buffer 是最贵的那种慢').toBe(true)
    object.updateMatrixWorld(true)
    close(new Box3().setFromObject(object).getSize(new Vector3()), [2, 2, 2])
  })

  it('keeps the same Object3D, so material overrides and ids survive a resize', () => {
    const object = primitiveFactory.create({ kind: 'sphere', radius: 1 })
    ;(object.userData as Record<string, unknown>).w3NodeId = NODE_ID
    primitiveFactory.update(object, { kind: 'sphere', radius: 2 })
    expect((object.userData as Record<string, unknown>).w3NodeId).toBe(NODE_ID)
  })

  it('refuses a kind change, so the caller replaces the object', () => {
    // A box and a sphere are different geometry classes AND different parameter sets.
    // Returning true here would leave a sphere-shaped object claiming to be a box.
    const object = primitiveFactory.create({ kind: 'box', size: [1, 1, 1] })
    expect(primitiveFactory.update(object, { kind: 'sphere', radius: 1 })).toBe(false)
  })

  it('refuses an object it did not build', () => {
    const object = primitiveFactory.create({ kind: 'box', size: [1, 1, 1] })
    delete (object.userData as Record<string, unknown>).w3PrimitiveKind
    expect(primitiveFactory.update(object, { kind: 'box', size: [2, 2, 2] })).toBe(false)
  })
})

describe('disposal', () => {
  it('frees geometry and material for everything it owns in a subtree', () => {
    const object = primitiveFactory.create({ kind: 'box', size: [1, 1, 1] })
    const mesh = object as Mesh
    let geometryDisposed = false
    let materialDisposed = false
    mesh.geometry.addEventListener('dispose', () => {
      geometryDisposed = true
    })
    ;(mesh.material as { addEventListener(t: string, f: () => void): void }).addEventListener('dispose', () => {
      materialDisposed = true
    })

    primitiveFactory.dispose(object)
    expect(geometryDisposed).toBe(true)
    expect(materialDisposed).toBe(true)
  })

  it('leaves alone anything it did not build', () => {
    // Asset instances share their geometry with the loader's cache. Freeing it here would
    // blank every other instance of the same part and force a re-upload next frame.
    const object = primitiveFactory.create({ kind: 'box', size: [1, 1, 1] })
    delete (object.userData as Record<string, unknown>).w3OwnedGeometry
    let disposed = false
    ;(object as Mesh).geometry.addEventListener('dispose', () => {
      disposed = true
    })
    primitiveFactory.dispose(object)
    expect(disposed).toBe(false)
  })
})

describe('the factory is actually installed in SceneRuntime', () => {
  /**
   * The wiring, asserted directly.
   *
   * T-132 found that the light factory had never been connected: the graph fell back to the
   * placeholder, so every light became an empty Group while both cards' tests stayed green.
   * This is the same shape of failure one file over, so it gets its own assertion rather
   * than being inferred from "the factory works" plus "the dispatch works".
   */
  const docWithPrimitive = (): SceneDocument => {
    const base = createGoldenPathDocument()
    return {
      ...base,
      nodes: [
        ...base.nodes,
        {
          section: null,
          explode: null,
          explodeOffset: null,
          prefabRef: null,
          id: NODE_ID,
          name: '展台',
          parent: null,
          order: 9000,
          assetRef: null,
          primitive: { kind: 'box', size: [2, 0.2, 2] },
          light: null,
          transform: identityTransform(),
          visible: true,
          locked: false,
          overrides: {},
        },
      ],
    }
  }

  function makeRuntime(doc: SceneDocument) {
    const runtime = new SceneRuntime(doc, {
      canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
      resolver: createMemoryResolver(new Map()),
      mode: 'play',
      createRenderer: () =>
        ({
          info: { memory: { geometries: 0, textures: 0 } },
          shadowMap: { enabled: false, type: -1 },
          render: () => undefined,
          setSize: () => undefined,
          setPixelRatio: () => undefined,
          dispose: () => undefined,
          domElement: {} as HTMLCanvasElement,
        }) as never,
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
    })
    runtime.graph.build(doc)
    return runtime
  }

  it('materialises a primitive node as real geometry, not the placeholder group', () => {
    const runtime = makeRuntime(docWithPrimitive())
    const object = runtime.graph.objectFor(NODE_ID)!
    expect((object as Mesh).isMesh, '原始体节点没有变成真的网格').toBe(true)
    object.updateMatrixWorld(true)
    close(new Box3().setFromObject(object).getSize(new Vector3()), [2, 0.2, 2])
    runtime.dispose()
  })

  it('renders a neutral grey when the node points at no material (D15 fallback)', () => {
    // The document is supposed to carry an explicit 「默认材质」 (D15) — the editor puts one
    // there. Core still has to draw something when it does not, and a neutral grey that
    // matches `ensureDefaultMaterial`'s colour means the two paths are indistinguishable
    // on screen rather than subtly different.
    const runtime = makeRuntime(docWithPrimitive())
    const mesh = runtime.graph.objectFor(NODE_ID) as Mesh
    const material = mesh.material as unknown as { color: { getHexString(): string }; type: string }
    expect(material.type).toBe('MeshStandardMaterial')
    expect(material.color.getHexString()).toBe('b8bec4')
    runtime.dispose()
  })

  it('resizes through a patch without a full rebuild', () => {
    const before = docWithPrimitive()
    const after: SceneDocument = {
      ...before,
      nodes: before.nodes.map((n) => (n.id === NODE_ID ? { ...n, primitive: { kind: 'box' as const, size: [4, 0.2, 4] } } : n)),
    }
    const runtime = makeRuntime(before)
    runtime.applyPatch([{ op: 'replace', path: ['nodes', 3, 'primitive', 'size'], value: [4, 0.2, 4] }], after, before)

    const object = runtime.graph.objectFor(NODE_ID)!
    object.updateMatrixWorld(true)
    close(new Box3().setFromObject(object).getSize(new Vector3()), [4, 0.2, 4])
    expect(runtime.fullRebuildCount, '改尺寸不该回落全量重建').toBe(0)
    runtime.dispose()
  })
})

/** A minimal instance of each kind, using the schema's own defaults. */
function defaultOf(kind: (typeof PRIMITIVE_KINDS)[number]): Primitive {
  switch (kind) {
    case 'box':
      return { kind, size: [1, 1, 1] }
    case 'sphere':
      return { kind, radius: 0.5 }
    case 'cylinder':
      return { kind, radiusTop: 0.5, radiusBottom: 0.5, height: 1 }
    case 'cone':
      return { kind, radius: 0.5, height: 1 }
    case 'torus':
      return { kind, radius: 0.5, tube: 0.15 }
    case 'plane':
      return { kind, width: 1, height: 1 }
    case 'capsule':
      return { kind, radius: 0.3, length: 0.6 }
  }
}
