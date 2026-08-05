import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../src/document.js'
import { checkIntegrity } from '../src/integrity.js'
import { createGoldenPathDocument } from '../src/samples.js'
import { collectAllIds } from '../src/selectors.js'

/**
 * T-232 · prefab 占位在五个遍历面上的行为。
 *
 * prefab 在 v1.0 **没有运行时**——它是 v2 才通电的形状。但它的 id 与文档主集合共用一个
 * 命名空间（I42），而 id 命名空间的错误是最难回滚的一类：等到 v2 真的去实例化时，
 * 客户盘上已经躺着一批 id 撞车的文档了。
 *
 * ⚠ **卡面点名的第一条与第一条变异今天就已经是绿的。** T-201 把 `collectAllIds` 改成
 * 注册表驱动之后，`prefabs` 自动进了 taken-set；T-226 又实现了 I42 的两半（组内唯一 +
 * 不与主集合撞车）。本文件因此不是「把它们做出来」，是把它们**钉住**，并如实记下这一点。
 */

const base = () => structuredClone(createGoldenPathDocument()) as SceneDocument

const node = (id: string) =>
  ({
    id,
    name: id,
    parent: null,
    order: 100,
    assetRef: null,
    primitive: null,
    light: null,
    section: null,
    transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    visible: true,
    locked: false,
    explode: null,
    explodeOffset: null,
    prefabRef: null,
    overrides: {},
  }) as SceneDocument['nodes'][number]

const material = (id: string) =>
  ({ id, name: id, base: 'standard', preset: null, params: {} }) as unknown as SceneDocument['materials'][number]

const prefab = (id: string, over: Partial<SceneDocument['prefabs'][number]> = {}) =>
  ({ id, name: id, note: '', version: 1, nodes: [], materials: [], ...over }) as SceneDocument['prefabs'][number]

const errorsOfCode = (doc: SceneDocument, code: string) =>
  checkIntegrity(doc).filter((i) => i.code === code && i.level === 'error')

describe('T-232 · prefab body 的 id 进 taken-set', () => {
  it('加一个 prefab（1 节点 1 材质），collectAllIds 恰好多 3', () => {
    // 恰好，不是「大于」——`prefabs: ['nodes', 'materials']` 漏登记时一个都不会多。
    const doc = base()
    const before = collectAllIds(doc).size
    const grown = { ...doc, prefabs: [prefab('pfb_11111111', { nodes: [node('nd_inpfb001')], materials: [material('mat_inpfb01')] })] }
    expect(collectAllIds(grown).size - before).toBe(3)
  })

  it('prefab body 里的 id 与文档主集合撞车 → I42 error', () => {
    const doc = base()
    const clash = { ...doc, prefabs: [prefab('pfb_11111111', { nodes: [{ ...doc.nodes[1]!, parent: null }] })] }
    expect(errorsOfCode(clash, 'I42')).toHaveLength(1)
  })
})

describe('T-232 · 组内唯一是「组内」，不是「全局」', () => {
  it('同一个 prefab 里两个同 id 节点 → error', () => {
    const doc = base()
    const bad = { ...doc, prefabs: [prefab('pfb_11111111', { nodes: [node('nd_dup00001'), node('nd_dup00001')] })] }
    expect(errorsOfCode(bad, 'I42')).toHaveLength(1)
  })

  it('同一个 prefab 里两个同 id 材质 → error', () => {
    const doc = base()
    const bad = { ...doc, prefabs: [prefab('pfb_11111111', { materials: [material('mat_dup0001'), material('mat_dup0001')] })] }
    expect(errorsOfCode(bad, 'I42')).toHaveLength(1)
  })

  it('**两个不同 prefab 各有一个同名 id → 不报**', () => {
    // 这一条是本组的重点：把 I42 写成「全局唯一」的实现在上面两条下照样绿，
    // 只有这一条能把它和「组内唯一」分开。两个 prefab 各自独立实例化，
    // 组间同名不构成冲突。
    const doc = base()
    const twins = {
      ...doc,
      prefabs: [
        prefab('pfb_11111111', { nodes: [node('nd_same0001')] }),
        prefab('pfb_22222222', { nodes: [node('nd_same0001')] }),
      ],
    }
    expect(errorsOfCode(twins, 'I42')).toHaveLength(0)
  })
})

describe('T-232 · prefabRef 的悬空引用', () => {
  it('指向一个不存在的 prefab → error', () => {
    const doc = base()
    const dangling = {
      ...doc,
      nodes: doc.nodes.map((n, i) => (i === 1 ? { ...n, prefabRef: { prefabId: 'pfb_nothere1', overridden: [] } } : n)),
    }
    expect(errorsOfCode(dangling, 'I42')).toHaveLength(1)
  })

  it('指向存在的 prefab → 零 error', () => {
    const doc = base()
    const ok = {
      ...doc,
      prefabs: [prefab('pfb_11111111')],
      nodes: doc.nodes.map((n, i) => (i === 1 ? { ...n, prefabRef: { prefabId: 'pfb_11111111', overridden: [] } } : n)),
    }
    expect(errorsOfCode(ok, 'I42')).toHaveLength(0)
  })
})
