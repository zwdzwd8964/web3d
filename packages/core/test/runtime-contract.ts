import type { SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { expect, it } from 'vitest'
import type { RuntimeContext } from '../src/eca/types.js'
import { IDS } from './helpers.js'

/**
 * T-084 · the shared RuntimeContext contract.
 *
 * ECA_SPEC §6: HeadlessRuntime and SceneRuntime MUST both run this suite. The quiet
 * failure mode of this whole architecture is a headless runtime that slowly drifts away
 * from the real one — every test green, the product broken. This file is the thing that
 * makes that drift a test failure instead of an acceptance-day discovery.
 *
 * SceneRuntime does not exist yet (T-031); when it lands it calls this same function.
 */
export interface ContractHarness {
  readonly ctx: RuntimeContext
  /** Moves whatever clock this runtime uses forward by `ms`, settling side effects. */
  advance(ms: number): Promise<void>
  /**
   * v0.5 · the light's live parameters, however this runtime stores them.
   *
   * Supplied by the harness rather than added to `RuntimeContext` on purpose. The frozen
   * increment (进化规划 §4.3) is `setLight` and three media methods — no reader — and
   * widening a frozen list for the convenience of a test is how frozen lists stop meaning
   * anything. Each side exposes its own state, and the SAME assertions run against both,
   * which is what the contract is for.
   */
  lightOf(nodeId: string): { intensity: number; color: string } | null
}

/** A spot light node, so the light half of the contract has something to point at. */
const LIGHT_ID = 'nd_light001'

function litDocument(): SceneDocument {
  const doc = createGoldenPathDocument()
  return {
    ...doc,
    nodes: [
      ...doc.nodes,
      {
        id: LIGHT_ID,
        name: '聚光灯',
        parent: null,
        order: 9000,
        assetRef: null,
        primitive: null,
        light: {
          kind: 'spot',
          color: '#ffd9a0',
          intensity: 3,
          range: 0,
          decay: 2,
          angleDeg: 30,
          penumbra: 0.2,
          shadow: { enabled: false, quality: 'medium', bias: -0.0005 },
        },
        transform: { p: [0, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
        visible: true,
        locked: false,
        overrides: {},
      },
    ],
  }
}

export function describeRuntimeContract(label: string, makeCtx: (doc: SceneDocument) => ContractHarness) {
  const setup = () => makeCtx(createGoldenPathDocument())
  const setupLit = () => makeCtx(litDocument())

  it(`${label}: variables start at their document defaults`, () => {
    expect(setup().ctx.getVar('step')).toBe(1)
  })

  it(`${label}: setVar emits variableChange only on an actual change`, () => {
    const { ctx } = setup()
    const seen: unknown[] = []
    const original = ctx.emit.bind(ctx)
    void original
    // Runtimes expose their event stream differently; observe through a rule-free probe.
    const probe = (ctx as unknown as { onEvent?: (fn: (e: unknown) => void) => void }).onEvent
    probe?.call(ctx, (e: unknown) => seen.push(e))

    ctx.setVar('step', 1)
    expect(seen, 'writing the same value must not fire an event').toHaveLength(0)
    ctx.setVar('step', 2)
    expect(seen).toHaveLength(1)
  })

  it(`${label}: visibility starts from the document and is settable per node`, () => {
    const { ctx } = setup()
    expect(ctx.isVisible(IDS.cover)).toBe(true)
    ctx.setVisible(IDS.cover, false)
    expect(ctx.isVisible(IDS.cover)).toBe(false)
    expect(ctx.isVisible(IDS.body), 'siblings must be untouched').toBe(true)
  })

  it(`${label}: setVisible with includeDescendants reaches the subtree`, () => {
    const { ctx } = setup()
    ctx.setVisible(IDS.pump, false, { includeDescendants: true })
    expect(ctx.isVisible(IDS.body)).toBe(false)
    expect(ctx.isVisible(IDS.cover)).toBe(false)
  })

  it(`${label}: panels open and close, individually and all at once`, () => {
    const { ctx } = setup()
    expect(ctx.isPanelOpen(IDS.hotspot)).toBe(false)
    ctx.openPanel(IDS.hotspot)
    expect(ctx.isPanelOpen(IDS.hotspot)).toBe(true)
    ctx.closePanel(IDS.hotspot)
    expect(ctx.isPanelOpen(IDS.hotspot)).toBe(false)
    ctx.openPanel(IDS.hotspot)
    ctx.closePanel('all')
    expect(ctx.isPanelOpen(IDS.hotspot)).toBe(false)
  })

  it(`${label}: a non-looping animation resolves only when it finishes`, async () => {
    const h = setup()
    let done = false
    void h.ctx.playAnimation(IDS.animation, {}).then(() => {
      done = true
    })
    await h.advance(1199)
    expect(done).toBe(false)
    await h.advance(1)
    expect(done).toBe(true)
  })

  it(`${label}: D6 · playAnimation is reported as playing while it runs`, async () => {
    const h = setup()
    void h.ctx.playAnimation(IDS.animation, {}).catch(() => undefined)
    await h.advance(100)
    expect(h.ctx.isAnimationPlaying(IDS.animation)).toBe(true)
    await h.advance(1200)
    expect(h.ctx.isAnimationPlaying(IDS.animation)).toBe(false)
  })

  it(`${label}: an aborted animation rejects rather than resolving`, async () => {
    const h = setup()
    const controller = new AbortController()
    const promise = h.ctx.playAnimation(IDS.animation, { signal: controller.signal })
    const settled = promise.then(
      () => 'resolved',
      () => 'rejected',
    )
    await h.advance(100)
    controller.abort()
    expect(await settled).toBe('rejected')
  })

  it(`${label}: wait resolves on the injected clock, never the wall clock`, async () => {
    const h = setup()
    const before = h.ctx.now()
    let done = false
    void h.ctx.wait(500).then(() => {
      done = true
    })
    await h.advance(499)
    expect(done).toBe(false)
    await h.advance(1)
    expect(done).toBe(true)
    expect(h.ctx.now() - before).toBeGreaterThanOrEqual(500)
  })

  it(`${label}: wait is cancellable`, async () => {
    const h = setup()
    const controller = new AbortController()
    const settled = h.ctx.wait(1000, controller.signal).then(
      () => 'resolved',
      () => 'rejected',
    )
    controller.abort()
    expect(await settled).toBe('rejected')
  })

  it(`${label}: moveCamera resolves on arrival`, async () => {
    const h = setup()
    let done = false
    void h.ctx.moveCamera(IDS.viewpoint, { duration: 1 }).then(() => {
      done = true
    })
    await h.advance(999)
    expect(done).toBe(false)
    await h.advance(1)
    expect(done).toBe(true)
  })

  it(`${label}: getNodeProp reads visibility and position`, () => {
    const { ctx } = setup()
    expect(ctx.getNodeProp(IDS.cover, 'visible')).toBe(true)
    expect(typeof ctx.getNodeProp(IDS.cover, 'positionY')).toBe('number')
  })

  it(`${label}: resetScene returns everything to the document`, () => {
    const { ctx } = setup()
    ctx.setVar('step', 7)
    ctx.setVisible(IDS.cover, false)
    ctx.highlight(IDS.cover, 'outline_red')
    ctx.openPanel(IDS.hotspot)

    ctx.resetScene()

    expect(ctx.getVar('step')).toBe(1)
    expect(ctx.isVisible(IDS.cover)).toBe(true)
    expect(ctx.isPanelOpen(IDS.hotspot)).toBe(false)
  })

  it(`${label}: now() is monotonic`, async () => {
    const h = setup()
    const t0 = h.ctx.now()
    await h.advance(100)
    expect(h.ctx.now()).toBeGreaterThanOrEqual(t0)
  })

  it(`${label}: currentEvent() is null outside a dispatch`, () => {
    expect(setup().ctx.currentEvent()).toBeNull()
  })

  it(`${label}: reading an undeclared variable warns instead of throwing`, () => {
    const { ctx } = setup()
    expect(() => ctx.getVar('nope')).not.toThrow()
  })

  /* --- v0.5 · setLight (进化规划 §4.3) ------------------------------------ */

  it(`${label}: a light starts at the parameters the document gave it`, () => {
    expect(setupLit().lightOf(LIGHT_ID)).toEqual({ intensity: 3, color: '#ffd9a0' })
  })

  it(`${label}: setLight moves intensity and colour`, () => {
    const h = setupLit()
    h.ctx.setLight(LIGHT_ID, { intensity: 6, color: '#ff0000' })
    expect(h.lightOf(LIGHT_ID)).toEqual({ intensity: 6, color: '#ff0000' })
  })

  it(`${label}: setLight leaves the parameter it was not given alone`, () => {
    const h = setupLit()
    h.ctx.setLight(LIGHT_ID, { intensity: 6 })
    expect(h.lightOf(LIGHT_ID)).toEqual({ intensity: 6, color: '#ffd9a0' })
  })

  it(`${label}: setLight on a node that is not a light is skipped, not thrown (B9)`, () => {
    // The divergence this catches is the expensive kind: one runtime throwing where the
    // other skips means the editor's preview and the player disagree about whether the
    // rest of the sequence ran at all.
    //
    // BOTH parameters are passed on purpose. With intensity alone this assertion does not
    // discriminate: writing a number onto the wrong Object3D silently succeeds in
    // JavaScript, so a runtime that had lost its "is this a light" guard entirely would
    // still pass. Colour is the one that needs a real `Color` on the other end.
    const h = setupLit()
    expect(() => h.ctx.setLight(IDS.cover, { intensity: 6, color: '#ff0000' })).not.toThrow()
    expect(h.lightOf(IDS.cover)).toBeNull()
  })

  it(`${label}: resetScene puts the light back (B13, extended to lights)`, () => {
    const h = setupLit()
    h.ctx.setLight(LIGHT_ID, { intensity: 6, color: '#ff0000' })
    h.ctx.resetScene()
    expect(h.lightOf(LIGHT_ID)).toEqual({ intensity: 3, color: '#ffd9a0' })
  })
}
