import { createGoldenPathDocument, identityTransform } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { Gizmo, NullHotspotRenderer, SceneRuntime, createMemoryResolver } from '@w3/core'
import { afterEach, describe, expect, it } from 'vitest'
import { placePrimitiveAt } from '../src/viewport/place.js'
import { ANGLE_STEP_DEG, GRID_STEPS, getSnap, onSnapChange, resetSnap, setSnap, snapPosition, snapValue } from '../src/viewport/snap.js'

/**
 * T-143 · D18 · snapping.
 *
 * Two claims worth testing separately: the arithmetic (what a snapped coordinate is), and
 * the wiring (that the gizmo and the drop path both apply it, and that turning it off
 * leaves v0's behaviour byte for byte).
 */

afterEach(() => resetSnap())

describe('the arithmetic', () => {
  it('rounds to the NEAREST grid point, not down', () => {
    // Flooring would make every dragged object drift towards negative infinity, slowly
    // enough to read as "the gizmo is imprecise" rather than as a bug.
    expect(snapValue(0.74, 0.5)).toBe(0.5)
    expect(snapValue(0.76, 0.5)).toBe(1)
    expect(snapValue(-0.76, 0.5)).toBe(-1)
    expect(snapValue(-0.24, 0.5)).toBe(-0)
  })

  it('is the identity when snapping is off', () => {
    // "Off" must mean untouched, not "rounded to something very small".
    expect(snapValue(0.123456789, null)).toBe(0.123456789)
    expect(snapValue(0.123456789, 0)).toBe(0.123456789)
  })

  it('snaps X and Z but never Y', () => {
    // Y is where the object RESTS — it came out of a ray hitting a surface. Rounding it
    // would lift a box off the table it was just dropped on, or sink it into the floor.
    expect(snapPosition([0.74, 0.213, -1.26], { translate: 0.5, rotate: false })).toEqual([0.5, 0.213, -1.5])
  })

  it('offers the three grid steps the card names', () => {
    expect([...GRID_STEPS]).toEqual([0.1, 0.5, 1])
    expect(ANGLE_STEP_DEG).toBe(15)
  })
})

describe('the session store', () => {
  it('starts off, so nothing changes for a user who never touches it', () => {
    expect(getSnap()).toEqual({ translate: null, rotate: false })
  })

  it('notifies subscribers, which is how the non-React gizmo hears about it', () => {
    const seen: unknown[] = []
    const off = onSnapChange((s) => seen.push(s))
    setSnap({ translate: 0.5 })
    setSnap({ rotate: true })
    off()
    setSnap({ translate: 1 })
    expect(seen).toEqual([
      { translate: 0.5, rotate: false },
      { translate: 0.5, rotate: true },
    ])
  })

  it('is not persisted anywhere', () => {
    // D18 · a tool setting, not scene state. In the document it would travel to the player,
    // land in the undo stack and get published; in localStorage it would be a C7 violation
    // for something nobody would miss across a reload.
    setSnap({ translate: 1, rotate: true })
    expect(Object.keys(globalThis.localStorage ?? {})).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */

const canvas = () => ({ clientWidth: 800, clientHeight: 600 }) as HTMLCanvasElement

function makeRuntime(doc: SceneDocument) {
  const runtime = new SceneRuntime(doc, {
    canvas: canvas(),
    resolver: createMemoryResolver(new Map()),
    mode: 'edit',
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
  runtime.camera.camera.position.set(0, 10, 0.001)
  runtime.camera.camera.lookAt(0, 0, 0)
  runtime.camera.camera.updateMatrixWorld(true)
  return runtime
}

describe('the gizmo', () => {
  /**
   * A DOM element stub with the two methods `TransformControls` binds to.
   *
   * The editor's tests run in plain Node (no jsdom), and pulling in a DOM just to construct
   * a gizmo would be a heavy dependency for two event listeners. What is under test here is
   * the snap conversion, which touches no events at all.
   */
  const element = () =>
    ({
      clientWidth: 800,
      clientHeight: 600,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      style: {},
    }) as unknown as HTMLElement

  const gizmoFor = (runtime: SceneRuntime) =>
    new Gizmo({ graph: runtime.graph, camera: runtime.camera.camera, domElement: element() })

  it('converts the angle step to radians at the boundary', () => {
    // Every angle the user types in this product is degrees (SCHEMA_SPEC §4.4); three wants
    // radians. Converting anywhere but the boundary means somebody has to remember which
    // side of it they are on.
    const runtime = makeRuntime(createGoldenPathDocument())
    const gizmo = gizmoFor(runtime)
    gizmo.setSnap({ rotateDeg: ANGLE_STEP_DEG })
    expect(gizmo.snap.rotate).toBeCloseTo((15 * Math.PI) / 180, 9)
    gizmo.dispose()
    runtime.dispose()
  })

  it('treats null as OFF, and never lets zero through', () => {
    // three reads `translationSnap: 0` as "snap to multiples of zero" and the handle stops
    // moving at all — an off switch that freezes the gizmo is worse than no off switch.
    const runtime = makeRuntime(createGoldenPathDocument())
    const gizmo = gizmoFor(runtime)
    gizmo.setSnap({ translate: 0.5, rotateDeg: 15 })
    gizmo.setSnap({ translate: null, rotateDeg: null })
    expect(gizmo.snap).toEqual({ translate: null, rotate: null })
    gizmo.setSnap({ translate: 0, rotateDeg: 0 })
    expect(gizmo.snap, '0 必须被当成关，不是"吸附到 0 的倍数"').toEqual({ translate: null, rotate: null })
    gizmo.dispose()
    runtime.dispose()
  })

  it('leaves the other axis alone when only one is set', () => {
    const runtime = makeRuntime(createGoldenPathDocument())
    const gizmo = gizmoFor(runtime)
    gizmo.setSnap({ translate: 0.5 })
    gizmo.setSnap({ rotateDeg: 15 })
    expect(gizmo.snap.translate).toBe(0.5)
    gizmo.dispose()
    runtime.dispose()
  })
})

describe('placement', () => {
  /** The golden path plus a 2 × 0.2 × 2 stage resting on the ground. */
  function docWithStage(): SceneDocument {
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
          id: 'nd_stage001',
          name: '展台',
          parent: null,
          order: 9000,
          assetRef: null,
          primitive: { kind: 'box', size: [2, 0.2, 2] },
          light: null,
          transform: { ...identityTransform(), p: [0, 0.1, 0] },
          visible: true,
          locked: false,
          overrides: {},
        },
      ],
    }
  }

  it('snapping a drop moves it onto a grid point in X/Z and leaves the rest on the surface', () => {
    const doc = docWithStage()
    const runtime = makeRuntime(doc)
    // Slightly off-centre, so the raw drop is not already on a grid point.
    const raw = placePrimitiveAt(runtime, doc, { kind: 'box', size: [0.4, 0.4, 0.4] }, {
      x: 460,
      y: 300,
      width: 800,
      height: 600,
    })
    expect(raw.position[0]).not.toBeCloseTo(Math.round(raw.position[0] / 0.5) * 0.5, 6)

    const snapped = snapPosition(raw.position, { translate: 0.5, rotate: false })
    expect(snapped[0] % 0.5).toBeCloseTo(0, 9)
    expect(snapped[2] % 0.5).toBeCloseTo(0, 9)
    // Still resting exactly on the stage: 0.2 top + 0.2 half-height.
    expect(snapped[1]).toBeCloseTo(0.4, 5)
    runtime.dispose()
  })

  it('with snapping off the placement is untouched — v0 behaviour, exactly', () => {
    const doc = docWithStage()
    const runtime = makeRuntime(doc)
    const raw = placePrimitiveAt(runtime, doc, { kind: 'box', size: [0.4, 0.4, 0.4] }, {
      x: 437,
      y: 289,
      width: 800,
      height: 600,
    })
    expect(snapPosition(raw.position, getSnap())).toEqual(raw.position)
    runtime.dispose()
  })
})
