import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../src/index.js'
import {
  composeMatrix,
  decomposeMatrix,
  identityMatrix,
  invertMatrix,
  multiplyMatrices,
  reparentPreservingWorld,
  worldMatrixOf,
} from '../src/transform-math.js'
import type { Mat4 } from '../src/transform-math.js'
import type { Node } from '../src/node.js'
import type { Quat, Transform, Vec3 } from '../src/primitives.js'

/**
 * T-258 · 改父保持世界位姿的数学。
 *
 * 这份测试要回答的是一个数值问题，所以它的形状是**随机 200 组 + 逐元素比对**，而不是
 * 三个手挑的例子。手挑的例子在矩阵代码里几乎没有诊断力：下标错位、乘法顺序反了、
 * 四元数分支写漏一个——这些都能让「一个平移 + 一个 90° 旋转」照样通过。
 *
 * 随机序列是**确定性的**（自带 LCG），不用 `Math.random()`：一条只在千分之一种子下红的
 * 断言，等于一条没人能复现的缺陷报告。
 */

/** 确定性伪随机。种子固定，失败可复现。 */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomQuat(rand: () => number): Quat {
  // 均匀采样单位四元数（Shoemake）。归一化一个高斯样本也行，但这个不需要 Box-Muller。
  const u1 = rand()
  const u2 = rand() * Math.PI * 2
  const u3 = rand() * Math.PI * 2
  const a = Math.sqrt(1 - u1)
  const b = Math.sqrt(u1)
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)]
}

function node(id: string, parent: string | null, transform: Transform): Node {
  return {
    id,
    name: id,
    parent,
    order: 0,
    transform,
    visible: true,
    locked: false,
    explode: null,
    explodeOffset: null,
    prefabRef: null,
    overrides: {},
  } as Node
}

function docOf(nodes: Node[]): SceneDocument {
  return { nodes } as SceneDocument
}

function expectMatrixClose(actual: Mat4, expected: Mat4, tolerance = 1e-6, label = ''): void {
  // `forEach` 而不是 `for (let i…)` + 下标：`noUncheckedIndexedAccess` 下算术下标的类型是
  // `number | undefined`。缺项兜底成 NaN 而不是 0——NaN 会让这条断言红，0 可能碰巧通过。
  const other = [...expected]
  actual.forEach((value, i) => {
    const want = other[i] ?? Number.NaN
    expect(Math.abs(value - want), `${label} m[${i}]: ${value} vs ${want}`).toBeLessThan(tolerance)
  })
}

describe('T-258 · compose / decompose 的往返', () => {
  it('单位 transform 就是单位矩阵', () => {
    expectMatrixClose(composeMatrix({ p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }), identityMatrix())
  })

  it('200 组随机 TRS 分解回去还是原来那一组', () => {
    const rand = lcg(20260805)
    for (let i = 0; i < 200; i++) {
      const t: Transform = {
        p: [rand() * 20 - 10, rand() * 20 - 10, rand() * 20 - 10],
        r: randomQuat(rand),
        s: [rand() * 3 + 0.2, rand() * 3 + 0.2, rand() * 3 + 0.2],
      }
      const back = decomposeMatrix(composeMatrix(t))
      expect(back.sheared, `第 ${i} 组：单个 TRS 永远分解得回去`).toBe(false)
      // 比矩阵而不是比 transform：q 与 −q 是同一个旋转，直接比四元数会有一半假红。
      expectMatrixClose(composeMatrix(back.transform), composeMatrix(t), 1e-9, `第 ${i} 组`)
    }
  })

  it('镜像（负缩放）不是剪切 —— 它能被 {p,r,s} 精确表达', () => {
    const mirrored: Transform = { p: [1, 2, 3], r: [0, 0.3826834, 0, 0.9238795], s: [-1, 1, 1] }
    const back = decomposeMatrix(composeMatrix(mirrored))
    expect(back.sheared).toBe(false)
    expectMatrixClose(composeMatrix(back.transform), composeMatrix(mirrored), 1e-9)
  })

  it('缩放为 0 的轴判为 sheared，且缩放照实报', () => {
    // 用户真的把 scale 拖到了 0。旋转已经无从恢复，但不能假装分解成功了。
    const flat = decomposeMatrix(composeMatrix({ p: [1, 0, 0], r: [0, 0, 0, 1], s: [1, 0, 1] }))
    expect(flat.sheared).toBe(true)
    expect(flat.transform.s[1]).toBe(0)
    expect(flat.transform.p).toEqual([1, 0, 0])
  })
})

describe('T-258 · invert / multiply', () => {
  it('M · M⁻¹ = I，200 组随机', () => {
    const rand = lcg(7)
    for (let i = 0; i < 200; i++) {
      const m = composeMatrix({
        p: [rand() * 20 - 10, rand() * 20 - 10, rand() * 20 - 10],
        r: randomQuat(rand),
        s: [rand() * 3 + 0.2, rand() * 3 + 0.2, rand() * 3 + 0.2],
      })
      const inv = invertMatrix(m)
      expect(inv, `第 ${i} 组不该奇异`).not.toBeNull()
      expectMatrixClose(multiplyMatrices(m, inv as Mat4), identityMatrix(), 1e-9, `第 ${i} 组`)
    }
  })

  it('奇异矩阵返回 null，不返回单位矩阵', () => {
    // 返回单位矩阵会把子节点弹到世界原点，而那看起来像「改父把东西弄丢了」。
    expect(invertMatrix(composeMatrix({ p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 0, 1] }))).toBeNull()
  })

  it('乘法不可交换 —— 顺序写反了这条会红', () => {
    const a = composeMatrix({ p: [1, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] })
    const b = composeMatrix({ p: [0, 0, 0], r: [0, 0.7071068, 0, 0.7071068], s: [1, 1, 1] })
    expect(multiplyMatrices(a, b)[12]).not.toBeCloseTo(multiplyMatrices(b, a)[12], 6)
  })
})

describe('T-258 · worldMatrixOf', () => {
  it('三级链的世界矩阵 = 根 · 中 · 叶', () => {
    const root: Transform = { p: [1, 2, 3], r: [0, 0.3826834, 0, 0.9238795], s: [2, 2, 2] }
    const mid: Transform = { p: [0, 1, 0], r: [0.3826834, 0, 0, 0.9238795], s: [1, 1, 1] }
    const leaf: Transform = { p: [0.5, 0, 0], r: [0, 0, 0, 1], s: [0.5, 0.5, 0.5] }
    const doc = docOf([node('nd_root0001', null, root), node('nd_mid00001', 'nd_root0001', mid), node('nd_leaf0001', 'nd_mid00001', leaf)])

    const expected = multiplyMatrices(multiplyMatrices(composeMatrix(root), composeMatrix(mid)), composeMatrix(leaf))
    expectMatrixClose(worldMatrixOf(doc, 'nd_leaf0001'), expected, 1e-9)
  })

  it('parent 为 null 的节点，世界矩阵就是它自己的局部矩阵', () => {
    const t: Transform = { p: [4, 5, 6], r: [0, 0, 0, 1], s: [1, 1, 1] }
    expectMatrixClose(worldMatrixOf(docOf([node('nd_solo0001', null, t)]), 'nd_solo0001'), composeMatrix(t), 1e-9)
  })

  it('nodeId 为 null → 单位矩阵（挂到根下的那条路径）', () => {
    expectMatrixClose(worldMatrixOf(docOf([]), null), identityMatrix())
  })

  it('父指向一个不存在的 id → 链在那里断掉，已经乘上的部分照样算', () => {
    // 悬空 parent 是 checkIntegrity 会报 error 的形状，但编辑器里改到一半随时是这样。
    const t: Transform = { p: [2, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }
    const doc = docOf([node('nd_orph0001', 'nd_gone0001', t)])
    expectMatrixClose(worldMatrixOf(doc, 'nd_orph0001'), composeMatrix(t), 1e-9)
  })

  it('父子成环时不死循环', () => {
    // 一份坏文档不应该让层级树挂掉——拖拽过程里这个函数是高频调用的。
    const t: Transform = { p: [1, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }
    const doc = docOf([node('nd_aaaa0001', 'nd_bbbb0001', t), node('nd_bbbb0001', 'nd_aaaa0001', t)])
    expect(() => worldMatrixOf(doc, 'nd_aaaa0001')).not.toThrow()
  })
})

describe('T-258 · reparentPreservingWorld', () => {
  /** 一棵有偏移 + 旋转 + 缩放的两分组场景，叶子挂在 A 下面。 */
  function scene(scaleB: Vec3): SceneDocument {
    return docOf([
      node('nd_grpA0001', null, { p: [1, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }),
      node('nd_grpB0001', null, { p: [-3, 4, 2], r: [0, 0.3826834, 0, 0.9238795], s: scaleB }),
      node('nd_part0001', 'nd_grpA0001', { p: [0, 0.5, 0], r: [0.3826834, 0, 0, 0.9238795], s: [1, 1, 1] }),
    ])
  }

  it('**200 组随机链，改父之后世界矩阵逐元素不变**', () => {
    const rand = lcg(99)
    let preserved = 0
    for (let i = 0; i < 200; i++) {
      // 均匀缩放：非均匀缩放 + 旋转会产生剪切，那时候世界位姿本来就保不住（见下一条）。
      const uni = () => {
        const k = rand() * 2 + 0.3
        return [k, k, k] as Vec3
      }
      const trs = (): Transform => ({ p: [rand() * 10 - 5, rand() * 10 - 5, rand() * 10 - 5], r: randomQuat(rand), s: uni() })
      const doc = docOf([
        node('nd_oldp0001', null, trs()),
        node('nd_newp0001', null, trs()),
        node('nd_part0001', 'nd_oldp0001', trs()),
      ])

      const before = worldMatrixOf(doc, 'nd_part0001')
      const result = reparentPreservingWorld(doc, 'nd_part0001', 'nd_newp0001')
      expect(result, `第 ${i} 组`).not.toBeNull()
      expect(result?.sheared, `第 ${i} 组：均匀缩放不该剪切`).toBe(false)

      const moved = docOf(doc.nodes.map((n) => (n.id === 'nd_part0001' ? { ...n, parent: 'nd_newp0001', transform: result!.transform } : n)))
      expectMatrixClose(worldMatrixOf(moved, 'nd_part0001'), before, 1e-6, `第 ${i} 组`)
      preserved++
    }
    // 断言不是空跑的：200 组全都真的走完了比对。
    expect(preserved).toBe(200)
  })

  it('非均匀缩放的父 + 有旋转的子 → sheared === true', () => {
    const result = reparentPreservingWorld(scene([2, 0.5, 1]), 'nd_part0001', 'nd_grpB0001')
    expect(result?.sheared).toBe(true)
  })

  it('同一棵树、父改成均匀缩放 → sheared === false（证明上一条是缩放引起的，不是恒真）', () => {
    const result = reparentPreservingWorld(scene([2, 2, 2]), 'nd_part0001', 'nd_grpB0001')
    expect(result?.sheared).toBe(false)
  })

  it('挂到根下（newParent = null）也保持世界位姿', () => {
    const doc = scene([1, 1, 1])
    const before = worldMatrixOf(doc, 'nd_part0001')
    const result = reparentPreservingWorld(doc, 'nd_part0001', null)
    expect(result).not.toBeNull()
    // 挂到根下时，新的局部矩阵就是世界矩阵本身。
    expectMatrixClose(composeMatrix(result!.transform), before, 1e-9)
  })

  it('新父的缩放里有 0 → 返回 null，调用方自己决定怎么办', () => {
    const doc = docOf([
      node('nd_flat0001', null, { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 0, 1] }),
      node('nd_part0001', null, { p: [1, 1, 1], r: [0, 0, 0, 1], s: [1, 1, 1] }),
    ])
    expect(reparentPreservingWorld(doc, 'nd_part0001', 'nd_flat0001')).toBeNull()
  })

  it('节点不存在 → null，不抛', () => {
    expect(reparentPreservingWorld(scene([1, 1, 1]), 'nd_none0001', null)).toBeNull()
  })

  it('改到原来的父下面 = 什么都不变', () => {
    const doc = scene([1, 1, 1])
    const part = doc.nodes.find((n) => n.id === 'nd_part0001')!
    const result = reparentPreservingWorld(doc, 'nd_part0001', 'nd_grpA0001')
    expectMatrixClose(composeMatrix(result!.transform), composeMatrix(part.transform), 1e-9)
  })
})
