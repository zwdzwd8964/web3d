import { createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { withCurrentEvent } from '../../src/eca/engine.js'
import { HeadlessRuntime } from '../../src/eca/headless.js'
import type { RuntimeContext } from '../../src/eca/types.js'

/**
 * The scoped context an action sees while a rule runs.
 *
 * This file exists because the previous implementation was a hand-written per-method
 * delegation, and the failure it produced was invisible to every action test: those pass a
 * `HeadlessRuntime` straight in, so a method missing from the delegation is `undefined`
 * only once a real rule fires through the engine. The guard below is therefore GENERIC —
 * it enumerates the runtime's own surface rather than listing method names, so a method
 * added tomorrow is covered without anybody remembering to come back here.
 */

const runtimeOf = () => new HeadlessRuntime(createGoldenPathDocument())

/** Every function on the runtime's prototype chain, which is its RuntimeContext surface. */
function methodNames(ctx: RuntimeContext): string[] {
  const names = new Set<string>()
  for (let object: object | null = ctx; object && object !== Object.prototype; object = Object.getPrototypeOf(object)) {
    for (const name of Object.getOwnPropertyNames(object)) {
      if (name === 'constructor') continue
      if (typeof (ctx as unknown as Record<string, unknown>)[name] === 'function') names.add(name)
    }
  }
  return [...names]
}

describe('withCurrentEvent', () => {
  it('forwards EVERY method the runtime has, not a list somebody maintains', () => {
    const ctx = runtimeOf()
    const scoped = withCurrentEvent(ctx, null)
    const names = methodNames(ctx)

    expect(names.length, '前提：运行时确实有一堆方法').toBeGreaterThan(15)
    for (const name of names) {
      expect(typeof (scoped as unknown as Record<string, unknown>)[name], `${name} 没透传`).toBe('function')
    }
  })

  it('keeps `this` bound to the real runtime', () => {
    // Without `bind`, every method that touches `this` breaks the moment it is called
    // through the wrapper — and `SceneRuntime`'s all do.
    const ctx = runtimeOf()
    const scoped = withCurrentEvent(ctx, null)

    scoped.setVar('step', 7)

    expect(ctx.getVar('step'), '写进去的值要落在真运行时上').toBe(7)
    expect(scoped.getVar('step')).toBe(7)
  })

  it('works for a context that uses真 private fields', () => {
    // This is what `bind(target)` is for, and it is worth stating because neither runtime
    // uses `#private` today — so without this test the bind is unobservable, and an
    // unobservable guard is indistinguishable from dead code (the lesson T-153 wrote down).
    //
    // A `#private` field can only be read when `this` is the real instance. Hand a proxy in
    // as `this` and the read throws `TypeError: Cannot read private member`. Any future
    // RuntimeContext implementation that uses one — which is the normal way to write a class
    // now — would break the moment a rule called it, and nowhere else.
    class PrivateRuntime {
      #calls = 0
      bump(): number {
        this.#calls += 1
        return this.#calls
      }
      currentEvent(): null {
        return null
      }
    }

    const instance = new PrivateRuntime()
    const scoped = withCurrentEvent(instance as unknown as RuntimeContext, null) as unknown as PrivateRuntime

    expect(() => scoped.bump(), 'this 必须是真实例，不能是代理').not.toThrow()
    expect(scoped.bump()).toBe(2)
  })

  it('overrides currentEvent and leaves the runtime’s own alone', () => {
    const ctx = runtimeOf()
    const event = { event: 'click', nodeId: 'nd_r5t8y1u3' } as const
    const scoped = withCurrentEvent(ctx, event)

    expect(scoped.currentEvent()).toEqual(event)
    expect(ctx.currentEvent(), '外层运行时不该被这次作用域污染').toBeNull()
  })

  it('passes non-function members through untouched', () => {
    const ctx = runtimeOf()
    const scoped = withCurrentEvent(ctx, null)
    expect(scoped.doc).toBe(ctx.doc)
  })

  it('two scopes do not see each other’s event', () => {
    // Nested rule chains each get their own scope; sharing one would make a rule triggered
    // inside another rule read the outer trigger.
    const ctx = runtimeOf()
    const outer = withCurrentEvent(ctx, { event: 'click', nodeId: 'nd_r5t8y1u3' })
    const inner = withCurrentEvent(ctx, { event: 'hotspotClick', hotspotId: 'hs_p2q4r6s8' })

    expect(outer.currentEvent()).toMatchObject({ event: 'click' })
    expect(inner.currentEvent()).toMatchObject({ event: 'hotspotClick' })
  })
})
