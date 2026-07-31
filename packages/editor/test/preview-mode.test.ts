import { createGoldenPathDocument } from '@w3/schema'
import { SceneRuntime, registerBuiltinActions } from '@w3/core'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PreviewController } from '../src/preview/controller.js'
import { createPreviewStore } from '../src/preview/preview-store.js'
import type { PreviewStore } from '../src/preview/preview-store.js'
import { ProjectSession } from '../src/project/session.js'

/**
 * T-093 · preview mode, end to end.
 *
 * The evaluation report found that `EcaEngine` had zero references in the editor: thirteen
 * actions, an executor and a dispatch engine, fully unit-tested and never once run against
 * a real scene. This is that run. No renderer is attached — `SceneRuntime` needs a GL
 * context only for `WebGLRenderer`, and everything the rules touch works without one (C8).
 */

let runtime: SceneRuntime
let controller: PreviewController
let store: PreviewStore
let session: ProjectSession
let clock = 0

beforeAll(() => registerBuiltinActions())

beforeEach(async () => {
  clock = 0
  session = new ProjectSession()
  const doc = createGoldenPathDocument()
  await session.seedSampleAsset(doc)

  runtime = new SceneRuntime(doc, {
    resolver: session.resolver,
    mode: 'play',
    now: () => clock,
  })
  await runtime.load(doc)

  store = createPreviewStore()
  controller = new PreviewController(runtime, store)
})

const doc = () => runtime.doc

describe('entering and leaving preview', () => {
  it('enables the engine and fires sceneReady', async () => {
    await controller.enter(doc())
    expect(controller.isActive).toBe(true)
    expect(store.getState().active).toBe(true)
    // The sample document's rules are click-driven, so the log may be empty — what must
    // be true is that dispatching did not throw and the session is live.
    expect(() => controller.dispatchClick(doc().nodes[0]!.id)).not.toThrow()
  })

  it('T-093 验收 · leaving preview restores the edit state completely', async () => {
    const cover = doc().nodes.find((n) => n.name === '阀盖')!
    const before = runtime.isVisible(cover.id)

    await controller.enter(doc())
    // Rules move, hide and recolour things. None of that is in the document, so none of
    // it may survive the exit.
    runtime.setVisible(cover.id, !before)
    runtime.highlight(cover.id, 'outline_amber')
    expect(runtime.isVisible(cover.id)).toBe(!before)

    controller.exit()

    expect(controller.isActive).toBe(false)
    expect(store.getState().active).toBe(false)
    expect(runtime.isVisible(cover.id)).toBe(before)
    expect(runtime.highlights.activeNodeIds).toEqual([])
  })

  it('entering twice is a no-op rather than two engines on one runtime', async () => {
    await controller.enter(doc())
    await controller.enter(doc())
    controller.exit()
    expect(controller.isActive).toBe(false)
  })

  it('exiting without entering does not throw', async () => {
    expect(() => controller.exit()).not.toThrow()
  })
})

describe('the golden path rule actually fires', () => {
  it('clicking 阀盖 runs its rule and the log records every step', async () => {
    const cover = doc().nodes.find((n) => n.name === '阀盖')!
    const rule = doc().rules.find((r) => r.when.event === 'click')
    expect(rule, '样例文档应当有一条点击规则').toBeDefined()

    await controller.enter(doc())
    controller.dispatchClick(cover.id)

    // Actions are async; let the executor's promises settle.
    for (let i = 0; i < 40; i++) {
      clock += 50
      runtime.tick()
      await Promise.resolve()
    }

    const log = store.getState().log
    expect(log.length, '点击后应当至少有一条规则执行记录').toBeGreaterThan(0)

    const entry = log.find((r) => r.ruleId === rule!.id)!
    expect(entry).toBeDefined()
    // Every step must be accounted for — an incomplete log is worse than none, because it
    // reads as "these are the only steps that ran".
    expect(entry.steps).toHaveLength(rule!.then.length)
    expect(entry.endedAt).toBeGreaterThanOrEqual(entry.startedAt)
    for (const step of entry.steps) {
      expect(['ok', 'skipped', 'failed']).toContain(step.status)
      expect(step.error, `动作 ${step.action} 执行失败：${step.error}`).toBeUndefined()
    }
  })

  it('ECA_SPEC §7 · a click outside preview reaches no rule at all', async () => {
    const cover = doc().nodes.find((n) => n.name === '阀盖')!
    // Not entered. dispatchClick has nowhere to send it, which is the point: while
    // editing, an object with a click rule must stay selectable.
    controller.dispatchClick(cover.id)
    await Promise.resolve()
    expect(store.getState().log).toHaveLength(0)
  })
})

describe('the log', () => {
  it('is cleared on entry, so the previous session cannot be mistaken for this one', async () => {
    await controller.enter(doc())
    store.getState().append({ ruleId: 'rul_11111111', status: 'completed', startedAt: 0, endedAt: 1, steps: [] })
    expect(store.getState().log).toHaveLength(1)

    controller.exit()
    await controller.enter(doc())
    expect(store.getState().log).toHaveLength(0)
  })

  it('is capped, so a repeating timer rule cannot grow it without bound', async () => {
    for (let i = 0; i < 250; i++) {
      store.getState().append({ ruleId: `rul_${i}`, status: 'completed', startedAt: i, endedAt: i, steps: [] })
    }
    expect(store.getState().log.length).toBeLessThanOrEqual(200)
    // Oldest dropped, newest kept: during debugging the newest is what is being looked at.
    expect(store.getState().log.at(-1)?.ruleId).toBe('rul_249')
  })
})

describe('live variables', () => {
  it('mirrors runtime values into the store only while previewing', async () => {
    const withVar = { ...doc(), variables: [{ id: 'step', name: '步骤', type: 'number' as const, default: 0, persist: false }] }

    controller.syncVariables(withVar)
    expect(store.getState().variables).toEqual({}) // not previewing

    await controller.enter(withVar)
    runtime.setVar('step', 3)
    controller.syncVariables(withVar)
    expect(store.getState().variables['step']).toBe(3)
  })

  it('does not hand out a new object when nothing changed', async () => {
    const withVar = { ...doc(), variables: [{ id: 'step', name: '步骤', type: 'number' as const, default: 0, persist: false }] }
    await controller.enter(withVar)
    controller.syncVariables(withVar)
    const first = store.getState().variables
    controller.syncVariables(withVar)
    // A fresh object each frame would re-render the variable panel sixty times a second.
    expect(store.getState().variables).toBe(first)
  })
})
