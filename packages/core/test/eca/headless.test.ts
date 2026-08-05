import { createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { FakeClock, HeadlessRuntime } from '../../src/eca/headless.js'
import type { RuntimeEvent } from '../../src/eca/types.js'
import { describeRuntimeContract } from '../runtime-contract.js'

/** T-084. */

describe('HeadlessRuntime', () => {
  describeRuntimeContract('headless', (doc) => {
    const ctx = new HeadlessRuntime(doc)
    // T-216 · the contract's event-sequence assertions read this.
    const seen: RuntimeEvent[] = []
    ctx.onEvent((event) => void seen.push(event))
    return {
      ctx,
      async advance(ms) {
        await ctx.clock.advance(ms)
        for (let i = 0; i < 4; i++) await Promise.resolve()
      },
      lightOf: (nodeId) => ctx.lightOf(nodeId),
      events: () => seen,
      explodeOf: (groupNodeId) => ctx.explodeOf(groupNodeId),
      logs: () => ctx.logs,
    }
  })
})

describe('FakeClock', () => {
  it('starts at zero and only moves when told to', async () => {
    const clock = new FakeClock()
    expect(clock.now()).toBe(0)
    await clock.advance(250)
    expect(clock.now()).toBe(250)
  })

  it('fires scheduled entries in chronological order, not scheduling order', async () => {
    const clock = new FakeClock()
    const order: string[] = []
    void clock.schedule(300).promise.then(() => order.push('late'))
    void clock.schedule(100).promise.then(() => order.push('early'))
    await clock.advance(500)
    expect(order).toEqual(['early', 'late'])
  })

  it('sets the clock to each entry’s own time as it fires, not to the target', async () => {
    const clock = new FakeClock()
    const seen: number[] = []
    void clock.schedule(100).promise.then(() => seen.push(clock.now()))
    void clock.schedule(200).promise.then(() => seen.push(clock.now()))
    await clock.advance(1000)
    expect(seen).toEqual([100, 200])
    expect(clock.now()).toBe(1000)
  })

  it('does not fire an entry that is still in the future', async () => {
    const clock = new FakeClock()
    let fired = false
    void clock.schedule(500).promise.then(() => {
      fired = true
    })
    await clock.advance(499)
    expect(fired).toBe(false)
  })

  it('cancelling rejects and removes the entry', async () => {
    const clock = new FakeClock()
    const { promise, cancel } = clock.schedule(100)
    const settled = promise.then(
      () => 'resolved',
      () => 'rejected',
    )
    cancel()
    expect(await settled).toBe('rejected')
    expect(clock.pendingCount).toBe(0)
    await clock.advance(1000)
  })

  it('cancelling twice is harmless', () => {
    const clock = new FakeClock()
    const { promise, cancel } = clock.schedule(100)
    void promise.catch(() => undefined)
    cancel()
    expect(() => cancel()).not.toThrow()
  })

  it('nextAt reports the earliest pending instant', () => {
    const clock = new FakeClock()
    expect(clock.nextAt()).toBeNull()
    void clock.schedule(300).promise.catch(() => undefined)
    void clock.schedule(100).promise.catch(() => undefined)
    expect(clock.nextAt()).toBe(100)
  })

  it('settle drains chained work one instant at a time', async () => {
    const clock = new FakeClock()
    const order: number[] = []
    const chain = async () => {
      for (let i = 0; i < 3; i++) {
        await clock.schedule(100).promise
        order.push(clock.now())
      }
    }
    void chain()
    await clock.settle()
    expect(order).toEqual([100, 200, 300])
  })

  it('settle refuses to spin forever on a runaway schedule', async () => {
    const clock = new FakeClock()
    const loop = async () => {
      for (;;) await clock.schedule(1).promise
    }
    void loop().catch(() => undefined)
    await expect(clock.settle(20)).rejects.toThrow(/still busy/)
    clock.cancelAll()
  })

  it('cancelAll rejects everything pending', async () => {
    const clock = new FakeClock()
    const a = clock.schedule(100).promise.then(
      () => 'resolved',
      () => 'rejected',
    )
    clock.cancelAll()
    expect(await a).toBe('rejected')
    expect(clock.pendingCount).toBe(0)
  })
})

describe('HeadlessRuntime specifics', () => {
  it('records opened links instead of navigating', () => {
    const ctx = new HeadlessRuntime(createGoldenPathDocument())
    ctx.openLink('https://example.test/a', '_blank')
    expect(ctx.openedLinks).toEqual([{ url: 'https://example.test/a', target: '_blank' }])
  })

  it('separates warnings from errors in its log', () => {
    const ctx = new HeadlessRuntime(createGoldenPathDocument())
    ctx.log('warn', 'w')
    ctx.log('error', 'e')
    ctx.log('debug', 'd')
    expect(ctx.warnings()).toHaveLength(1)
    expect(ctx.errors()).toHaveLength(1)
    expect(ctx.logs).toHaveLength(3)
  })

  it('refuses to write an undeclared variable rather than inventing one', () => {
    const ctx = new HeadlessRuntime(createGoldenPathDocument())
    ctx.setVar('ghost', 1)
    expect(ctx.errors().some((e) => e.message.includes('未声明'))).toBe(true)
  })

  it('reports an unknown animation as an error and resolves rather than hanging', async () => {
    const ctx = new HeadlessRuntime(createGoldenPathDocument())
    await expect(ctx.playAnimation('anm_99999999', {})).resolves.toBeUndefined()
    expect(ctx.errors()).toHaveLength(1)
  })

  it('uses the configured imported-clip duration', async () => {
    const doc = createGoldenPathDocument()
    const withImported = {
      ...doc,
      animations: [
        ...doc.animations,
        {
          startS: 0,
          endS: null,
          kind: 'imported' as const,
          id: 'anm_22222222',
          name: '拆解',
          assetId: doc.assets[0]!.id,
          clipName: 'Disassemble',
          speed: 1,
          loop: false,
          clampWhenFinished: true,
        },
      ],
    }
    const ctx = new HeadlessRuntime(withImported, { importedDurationMs: 400 })
    let done = false
    void ctx.playAnimation('anm_22222222', {}).then(() => {
      done = true
    })
    await ctx.clock.advance(399)
    expect(done).toBe(false)
    await ctx.clock.advance(1)
    await Promise.resolve()
    expect(done).toBe(true)
  })
})
