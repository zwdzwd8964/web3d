import { createGoldenPathDocument } from '@w3/schema'
import type { Node, SceneDocument } from '@w3/schema'
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { SectionHelperLayer } from '../../src/runtime/section-helpers.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { sectionFactory } from '../../src/runtime/section-layer.js'

/**
 * T-251 · 剖切面的法线箭头。
 *
 * 这一层里最值钱的一条是 **M9 那个形状**：three 的辅助物持有对象**引用**，图重建换掉
 * 那个对象之后，辅助物会静默冻结——继续画在它曾经在的地方。`light-helpers.test.ts`
 * 的注释里写着那条缺陷当年就是这么活下来的（每帧从 graph 重定位的实现让「删掉 sync」
 * 这条变异恒绿）。所以这里**同时**测两件事：重建后要重建，以及重建后位置要对。
 */

const SECTION = 'nd_sec00001'

const base = {
  explode: null,
  explodeOffset: null,
  prefabRef: null,
  assetRef: null,
  primitive: null,
  light: null,
  visible: true,
  locked: false,
  overrides: {},
  parent: null as string | null,
}

const sectionNode = (id: string, overrides: Partial<Node> = {}): Node =>
  ({
    ...base,
    section: { scope: 'scene', size: [4, 4] },
    id,
    name: '剖切面',
    order: 100,
    transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    ...overrides,
  }) as Node

function docWith(...nodes: Node[]): SceneDocument {
  const doc = createGoldenPathDocument()
  return { ...doc, nodes: [...doc.nodes, ...nodes] }
}

function setup(doc: SceneDocument) {
  const graph = new SceneGraph({ sections: sectionFactory })
  graph.build(doc)
  const layer = new SectionHelperLayer(graph)
  layer.sync(doc)
  return { graph, layer, doc }
}

const arrowOf = (layer: SectionHelperLayer, nodeId: string) =>
  layer.root.children.find((c) => c.name === `w3:section-normal:${nodeId}`)

describe('T-251 · 建与拆', () => {
  it('每个剖切面一支箭头', () => {
    const { layer } = setup(docWith(sectionNode(SECTION), sectionNode('nd_sec00002')))
    expect(layer.size).toBe(2)
    expect(arrowOf(layer, SECTION)).toBeDefined()
  })

  it('不是剖切面的节点没有箭头', () => {
    const { layer } = setup(createGoldenPathDocument())
    expect(layer.size).toBe(0)
  })

  it('节点被删掉后箭头也拆掉', () => {
    const doc = docWith(sectionNode(SECTION))
    const { layer } = setup(doc)
    expect(layer.size).toBe(1)

    layer.sync(createGoldenPathDocument())

    expect(layer.size).toBe(0)
    expect(layer.root.children).toHaveLength(0)
  })

  it('dispose 清空并把 root 摘出去', () => {
    const { layer } = setup(docWith(sectionNode(SECTION)))
    layer.dispose()
    expect(layer.size).toBe(0)
  })
})

describe('T-251 · M9：图重建之后不许留幽灵', () => {
  it('**重建换了 Object3D → 箭头也要重建**', () => {
    const doc = docWith(sectionNode(SECTION))
    const { graph, layer } = setup(doc)
    const first = arrowOf(layer, SECTION)
    const firstSource = graph.objectFor(SECTION)

    graph.build(doc) // 整图重建：每个 Object3D 都是新的
    expect(graph.objectFor(SECTION), '前提：重建真的换了对象').not.toBe(firstSource)
    layer.sync(doc)

    expect(arrowOf(layer, SECTION), '还指着被丢弃的那个对象 —— M9 的形状').not.toBe(first)
    expect(layer.size).toBe(1)
  })

  it('**重建之后位置仍然对** —— 只测「重建了」是不够的', () => {
    // 只断「箭头是新的」的话，一个「重建但摆错位置」的实现照样绿。
    const doc = docWith(sectionNode(SECTION, { transform: { p: [1, 2, 3], r: [0, 0, 0, 1], s: [1, 1, 1] } }))
    const { graph, layer } = setup(doc)

    graph.build(doc)
    layer.sync(doc)

    const arrow = arrowOf(layer, SECTION)!
    // 位置 = 世界位置 + 法线 × 1mm；法线无旋转时是 +Z
    expect(arrow.position.x).toBeCloseTo(1, 6)
    expect(arrow.position.y).toBeCloseTo(2, 6)
    expect(arrow.position.z).toBeCloseTo(3 + 0.001, 6)
  })
})

describe('T-251 · 摆位', () => {
  it('**沿 +n 偏移 1mm** —— 不偏的话箭头被自己的裁剪面切掉一半', () => {
    const { layer } = setup(docWith(sectionNode(SECTION, { transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] } })))
    const arrow = arrowOf(layer, SECTION)!
    expect(arrow.position.z).toBeCloseTo(0.001, 9)
    expect(arrow.position.z, '偏移是 0 —— 箭头落在裁剪面上').not.toBe(0)
  })

  it('跟着旋转走：绕 Y 转 90° 后法线朝 +X，偏移也跟着转', () => {
    const yaw90: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2]
    const { layer } = setup(docWith(sectionNode(SECTION, { transform: { p: [0, 0, 0], r: yaw90, s: [1, 1, 1] } })))
    const arrow = arrowOf(layer, SECTION)!

    expect(arrow.position.x).toBeCloseTo(0.001, 9)
    expect(arrow.position.z).toBeCloseTo(0, 9)
    // ArrowHelper 的朝向存在自身四元数上；用它转 +Y（箭头的局部朝向）看落到哪
    const direction = new Vector3(0, 1, 0).applyQuaternion(arrow.quaternion)
    expect(direction.x).toBeCloseTo(1, 6)
  })

  it('跟着父节点走', () => {
    const parent: Node = { ...base, section: null, id: 'nd_grp00001', name: '组', order: 90, transform: { p: [0, 5, 0], r: [0, 0, 0, 1], s: [1, 1, 1] } } as Node
    const child = sectionNode(SECTION, { parent: 'nd_grp00001' })
    const { graph, layer } = setup(docWith(parent, child))

    graph.objectFor('nd_grp00001')!.position.set(0, 9, 0)
    layer.update()

    expect(arrowOf(layer, SECTION)!.position.y).toBeCloseTo(9, 6)
  })

  it('节点隐藏时箭头也隐藏（世界可见性，与 SectionLayer 同一判据）', () => {
    const parent: Node = { ...base, section: null, id: 'nd_grp00001', name: '组', order: 90, visible: false, transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] } } as Node
    const child = sectionNode(SECTION, { parent: 'nd_grp00001' })
    const { layer } = setup(docWith(parent, child))
    expect(arrowOf(layer, SECTION)!.visible).toBe(false)
  })

  it('前提：父节点可见时箭头是可见的', () => {
    const parent: Node = { ...base, section: null, id: 'nd_grp00001', name: '组', order: 90, transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] } } as Node
    const child = sectionNode(SECTION, { parent: 'nd_grp00001' })
    const { layer } = setup(docWith(parent, child))
    expect(arrowOf(layer, SECTION)!.visible).toBe(true)
  })
})
