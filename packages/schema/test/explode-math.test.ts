import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../src/document.js'
import type { Explode } from '../src/explode.js'
import { explodeOffsets } from '../src/explode-math.js'
import type { Node } from '../src/node.js'
import type { Vec3 } from '../src/primitives.js'
import { createGoldenPathDocument } from '../src/samples.js'

/**
 * T-238 · `explodeOffsets` 的完整测试。
 *
 * **断的是几何性质，不是具体数字。** 「任意两件的相对位置变成原来的 1+gain 倍」这句话
 * 对任何质心都成立；而「零件 A 移到 [0.6, 0, 0]」只对某一份 fixture 成立，换个 fixture
 * 就得重算一遍期望值——那种测试改起来的方式是「跑一遍，把输出抄进期望」，也就不再是测试。
 */

const node = (id: string, p: Vec3, over: Partial<Node> = {}): Node =>
  ({
    id,
    name: id,
    parent: 'nd_group0001',
    order: 100,
    assetRef: null,
    primitive: null,
    light: null,
    section: null,
    transform: { p, r: [0, 0, 0, 1], s: [1, 1, 1] },
    visible: true,
    locked: false,
    explode: null,
    explodeOffset: null,
    prefabRef: null,
    overrides: {},
    ...over,
  }) as Node

const RADIAL: Explode = { mode: 'radial', gain: 1.5, axis: [0, 1, 0], spacing: 0.5, easing: 'linear' }
const AXIS: Explode = { mode: 'axis', gain: 1, axis: [1, 0, 0], spacing: 0.4, easing: 'linear' }

function docWith(explode: Explode | null, members: Node[]): SceneDocument {
  const base = createGoldenPathDocument()
  return {
    ...base,
    nodes: [...base.nodes, node('nd_group0001', [0, 0, 0], { parent: null, explode }), ...members],
  } as SceneDocument
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2])

describe('T-238 · radial', () => {
  /**
   * 质心**刻意不在原点**。
   *
   * 把 radial 的质心改成 `[0,0,0]` 是卡面点名的变异②，而在一份质心恰好就是原点的
   * fixture 上那个变异不会红。这四个点的质心是 `[1.5, 0.5, 0]`。
   */
  const members = () => [
    node('nd_a0000001', [1, 0, 0]),
    node('nd_b0000001', [2, 0, 0]),
    node('nd_c0000001', [1, 1, 0]),
    node('nd_d0000001', [2, 1, 0]),
  ]

  it('前提：这份 fixture 的质心不在原点', () => {
    const c = members().reduce((acc, n) => [acc[0] + n.transform.p[0] / 4, acc[1] + n.transform.p[1] / 4, acc[2] + n.transform.p[2] / 4] as Vec3, [0, 0, 0] as Vec3)
    expect(len(c), '质心在原点的话，「质心改成 [0,0,0]」那条变异杀不掉').toBeGreaterThan(0.1)
  })

  it('任意两件的相对位置变成原来的 (1 + gain) 倍', () => {
    const list = members()
    const doc = docWith(RADIAL, list)
    const offsets = explodeOffsets(doc, 'nd_group0001')

    for (const a of list) {
      for (const b of list) {
        if (a.id === b.id) continue
        const before = sub(a.transform.p, b.transform.p)
        const afterA = offsets.get(a.id)!
        const afterB = offsets.get(b.id)!
        const after = sub(
          [a.transform.p[0] + afterA[0], a.transform.p[1] + afterA[1], a.transform.p[2] + afterA[2]],
          [b.transform.p[0] + afterB[0], b.transform.p[1] + afterB[1], b.transform.p[2] + afterB[2]],
        )
        expect(len(after), `${a.id} ↔ ${b.id}`).toBeCloseTo(len(before) * (1 + RADIAL.gain), 6)
      }
    }
  })

  it('整组的位移和为零 —— 散开不移动整体', () => {
    const offsets = explodeOffsets(docWith(RADIAL, members()), 'nd_group0001')
    const sum = [...offsets.values()].reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]] as Vec3, [0, 0, 0] as Vec3)
    expect(len(sum)).toBeCloseTo(0, 9)
  })

  it('锚点全部重合 → 全零，且不抛异常', () => {
    const same = [node('nd_a0000001', [1, 1, 1]), node('nd_b0000001', [1, 1, 1]), node('nd_c0000001', [1, 1, 1])]
    const offsets = explodeOffsets(docWith(RADIAL, same), 'nd_group0001')
    expect(offsets.size).toBe(3)
    for (const v of offsets.values()) expect(len(v)).toBe(0)
  })
})

describe('T-238 · axis', () => {
  /**
   * 五件沿 X 摆开，而**数组顺序、`order`、沿轴投影三者两两不一致**。
   *
   * 三级排序的第二三级只有在第一级打平时才走得到，所以这份 fixture 还要配一份
   * 「投影全相等」的（见下面 tied 那组）。这一份验的是第一级真的按投影排。
   */
  const members = () => [
    node('nd_e0000001', [0.8, 0, 0], { order: 100 }),
    node('nd_a0000001', [0, 0, 0], { order: 500 }),
    node('nd_d0000001', [0.6, 0, 0], { order: 200 }),
    node('nd_b0000001', [0.2, 0, 0], { order: 400 }),
    node('nd_c0000001', [0.4, 0, 0], { order: 300 }),
  ]

  it('名次 0..4：中位件为零，相邻间距恰为 spacing', () => {
    const list = members()
    const offsets = explodeOffsets(docWith(AXIS, list), 'nd_group0001')

    // 按沿轴投影排出来的顺序就是 a,b,c,d,e（0 → 0.8）
    const byRank = ['nd_a0000001', 'nd_b0000001', 'nd_c0000001', 'nd_d0000001', 'nd_e0000001']
    const shifts = byRank.map((id) => offsets.get(id)![0])

    expect(shifts[2], '五件的中位件不动').toBeCloseTo(0, 9)
    for (let i = 1; i < shifts.length; i++) {
      expect(shifts[i]! - shifts[i - 1]!, `第 ${i} 与第 ${i - 1} 件`).toBeCloseTo(AXIS.spacing, 9)
    }
    // 位移全在轴上
    for (const v of offsets.values()) expect(Math.hypot(v[1], v[2])).toBeCloseTo(0, 9)
  })

  it('单件：名次 0，位移为零', () => {
    const offsets = explodeOffsets(docWith(AXIS, [node('nd_only0001', [3, 0, 0])]), 'nd_group0001')
    expect(offsets.size).toBe(1)
    expect(len(offsets.get('nd_only0001')!)).toBeCloseTo(0, 9)
  })

  it('零向量轴兜底成 [0,1,0]，且没有一个分量是 NaN', () => {
    const zero: Explode = { ...AXIS, axis: [0, 0, 0] }
    const list = [node('nd_a0000001', [0, 0, 0]), node('nd_b0000001', [1, 0, 0])]
    const offsets = explodeOffsets(docWith(zero, list), 'nd_group0001')
    const upward = explodeOffsets(docWith({ ...AXIS, axis: [0, 1, 0] }, list), 'nd_group0001')

    for (const v of offsets.values()) {
      // NaN 沿 transform 传下去的表现是整个分组从画面上消失 —— 没有报错，没有日志
      for (const c of v) expect(Number.isFinite(c)).toBe(true)
    }
    expect([...offsets.values()]).toEqual([...upward.values()])
  })
})

describe('T-238 · 排序的确定性', () => {
  /**
   * 锚点全部重合、`order` 乱序 —— 三级排序里第一级打平，全靠第二三级。
   *
   * 这是变异①（「三级排序砍成只按 dot」）唯一会红的那条：投影全相等时，砍掉后两级
   * 就把名次交给了 `Array.prototype.sort` 的实现细节，同一份文档两次调用可以给出
   * 不同答案，而用户看到的是零件每次散开的顺序都不一样。
   */
  const tied = () => [
    node('nd_z0000001', [1, 1, 1], { order: 300 }),
    node('nd_a0000001', [1, 1, 1], { order: 100 }),
    node('nd_m0000001', [1, 1, 1], { order: 200 }),
  ]

  it('两次调用逐位相等', () => {
    const doc = docWith(AXIS, tied())
    const first = [...explodeOffsets(doc, 'nd_group0001').entries()]
    const second = [...explodeOffsets(doc, 'nd_group0001').entries()]
    expect(second).toEqual(first)
  })

  it('打平时按 order 排，不按数组顺序', () => {
    const offsets = explodeOffsets(docWith(AXIS, tied()), 'nd_group0001')
    // order 100 → 名次 0（最负），order 300 → 名次 2（最正）
    expect(offsets.get('nd_a0000001')![0]).toBeLessThan(offsets.get('nd_m0000001')![0])
    expect(offsets.get('nd_m0000001')![0]).toBeLessThan(offsets.get('nd_z0000001')![0])
  })

  it('order 也打平时按 id 字典序 —— 最后一级兜底', () => {
    const same = [
      node('nd_c0000001', [1, 1, 1], { order: 100 }),
      node('nd_a0000001', [1, 1, 1], { order: 100 }),
      node('nd_b0000001', [1, 1, 1], { order: 100 }),
    ]
    const offsets = explodeOffsets(docWith(AXIS, same), 'nd_group0001')
    expect(offsets.get('nd_a0000001')![0]).toBeLessThan(offsets.get('nd_b0000001')![0])
    expect(offsets.get('nd_b0000001')![0]).toBeLessThan(offsets.get('nd_c0000001')![0])
  })
})

describe('T-238 · explodeOffset 覆盖', () => {
  it('钉住的那一件用覆盖值，其余仍是派生值', () => {
    const pinned: Vec3 = [9, 9, 9]
    const list = [
      node('nd_a0000001', [1, 0, 0], { explodeOffset: pinned }),
      node('nd_b0000001', [2, 0, 0]),
      node('nd_c0000001', [3, 0, 0]),
    ]
    const offsets = explodeOffsets(docWith(RADIAL, list), 'nd_group0001')

    expect(offsets.get('nd_a0000001')).toEqual(pinned)
    // 其余两件的派生值不受影响：质心仍按全部三件算
    expect(offsets.get('nd_b0000001')![0]).toBeCloseTo(0, 9)
    expect(len(offsets.get('nd_c0000001')!)).toBeGreaterThan(0)
  })

  it('是整条替换，不是逐分量合并', () => {
    // 用户钉一个零件的位置，钉的是最终位置，不是「在算出来的基础上再挪一点」
    const list = [node('nd_a0000001', [1, 2, 3], { explodeOffset: [0, 0, 0] }), node('nd_b0000001', [5, 5, 5])]
    const offsets = explodeOffsets(docWith(RADIAL, list), 'nd_group0001')
    expect(offsets.get('nd_a0000001')).toEqual([0, 0, 0])
  })
})

describe('T-238 · 边界与纯度', () => {
  it.each([
    ['空组', RADIAL, [] as Node[]],
    ['explode 为 null', null, [node('nd_a0000001', [1, 0, 0])]],
  ])('%s → 空 Map', (_label, explode, members) => {
    expect(explodeOffsets(docWith(explode, members), 'nd_group0001').size).toBe(0)
  })

  it('分组 id 不存在 → 空 Map，不抛', () => {
    expect(explodeOffsets(docWith(RADIAL, [node('nd_a0000001', [1, 0, 0])]), 'nd_nothere1').size).toBe(0)
  })

  it('调 100 次，入参一个字节都没变', () => {
    const doc = docWith(AXIS, [node('nd_a0000001', [1, 0, 0]), node('nd_b0000001', [2, 0, 0])])
    const before = structuredClone(doc)
    for (let i = 0; i < 100; i++) explodeOffsets(doc, 'nd_group0001')
    expect(doc).toEqual(before)
  })

  it('输出不复用入参的数组引用', () => {
    const pinned: Vec3 = [9, 9, 9]
    const doc = docWith(RADIAL, [node('nd_a0000001', [1, 0, 0], { explodeOffset: pinned }), node('nd_b0000001', [2, 0, 0])])
    const offsets = explodeOffsets(doc, 'nd_group0001')
    // 覆盖值这一条是刻意直接返回同一个引用的（整条替换），但派生值必须是新数组
    expect(offsets.get('nd_b0000001')).not.toBe(doc.nodes.find((n) => n.id === 'nd_b0000001')!.transform.p)
  })
})
