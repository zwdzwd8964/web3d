import { createGoldenPathDocument, validate } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { applySuggestedFogRange, setFogEnabled, setFogParams, setFogType } from '../src/lib/effects-edit.js'

/**
 * T-239 · 雾的 commit 构造器。
 *
 * 这些函数很薄，但它们守着两条**具体**的用户可见行为：关掉再打开要回到原来的参数；
 * 切 linear ↔ exp2 不许清空另一组数值。两者都是「调参时来回切」这个最常见动作的
 * 直接后果，而两者的失效都不会报错——只会让用户调好的数字消失。
 */

const edit = (fn: (d: SceneDocument) => void, base = createGoldenPathDocument()) => produce(base, fn)

describe('T-239 · setFogEnabled', () => {
  it('只动 enabled，其余六个字段一个不碰', () => {
    const before = createGoldenPathDocument()
    const after = edit((d) => setFogEnabled(d, true), before)
    expect(after.meta.fog).toEqual({ ...before.meta.fog, enabled: true })
  })

  it('关掉再打开，参数原样回来', () => {
    const tuned = edit((d) => setFogParams(d, { near: 33, far: 77, color: '#abcdef' }))
    const off = edit((d) => setFogEnabled(d, false), tuned)
    const on = edit((d) => setFogEnabled(d, true), off)
    expect(on.meta.fog.near).toBe(33)
    expect(on.meta.fog.far).toBe(77)
    expect(on.meta.fog.color).toBe('#abcdef')
  })
})

describe('T-239 · setFogType', () => {
  it('**切类型不清空另一组数值**', () => {
    // linear 用 near/far、exp2 用 density，而调参时在两者之间来回切是最常见的动作。
    // 清空的话，切过去再切回来，用户调好的 near/far 就没了。
    const tuned = edit((d) => setFogParams(d, { near: 5, far: 50, density: 0.09 }))
    const toExp2 = edit((d) => setFogType(d, 'exp2'), tuned)

    expect(toExp2.meta.fog.type).toBe('exp2')
    expect(toExp2.meta.fog.near, 'near 被切类型顺手清掉了').toBe(5)
    expect(toExp2.meta.fog.far).toBe(50)

    const back = edit((d) => setFogType(d, 'linear'), toExp2)
    expect(back.meta.fog.density, 'density 也一样').toBe(0.09)
  })
})

describe('T-239 · applySuggestedFogRange', () => {
  it('写 near / far，并把类型切成 linear', () => {
    // 「按场景大小估算」只对 linear 有意义（exp2 没有 near/far）。估完停在 exp2 上，
    // 用户会以为按钮没生效。
    const exp2 = edit((d) => setFogType(d, 'exp2'))
    const after = edit((d) => applySuggestedFogRange(d, { near: 4, far: 20 }), exp2)

    expect(after.meta.fog.type).toBe('linear')
    expect(after.meta.fog.near).toBe(4)
    expect(after.meta.fog.far).toBe(20)
  })

  it('不动颜色与开关', () => {
    const before = edit((d) => setFogParams(d, { color: '#123456' }))
    const after = edit((d) => applySuggestedFogRange(d, { near: 1, far: 9 }), before)
    expect(after.meta.fog.color).toBe('#123456')
    expect(after.meta.fog.enabled).toBe(before.meta.fog.enabled)
  })
})

describe('T-239 · 改完仍然是一份合法文档', () => {
  it.each([
    ['开雾', (d: SceneDocument) => setFogEnabled(d, true)],
    ['切 exp2', (d: SceneDocument) => setFogType(d, 'exp2')],
    ['调参数', (d: SceneDocument) => setFogParams(d, { near: 2, far: 8, density: 0.5, color: '#000000' })],
    ['套用估算', (d: SceneDocument) => applySuggestedFogRange(d, { near: 3, far: 30 })],
  ])('%s 之后 validate 通过', (_label, fn) => {
    // 这四个函数直接写 `meta.fog`，而它是 `.strict()` 的——多写一个键、写错一个类型，
    // 症状都是「编辑器里看着好好的，发布时被拒」。
    expect(validate(edit(fn)).ok).toBe(true)
  })
})
