import { describe, expect, it } from 'vitest'
import type { Flow } from '../src/flow.js'
import type { SceneDocument } from '../src/document.js'
import type { Node } from '../src/node.js'
import { getCarrier, getLightNodes, getPrimitiveNodes, needsDefaultLightRig, getFlowChain } from '../src/selectors.js'
import { createGoldenPathDocument } from '../src/samples.js'
import goldenPathTwo from './fixtures/v2/golden-path-2.json' with { type: 'json' }

/**
 * T-122 · the v2 carrier selectors.
 *
 * Small functions, but three different consumers switch on their answers (core's scene
 * graph, core's default-rig decision, the editor's tree icons). One place to be wrong is
 * better than three, which is the only reason they exist rather than being inlined.
 */

const v2 = () => structuredClone(goldenPathTwo) as unknown as SceneDocument
const nodeNamed = (doc: SceneDocument, name: string): Node => {
  const node = doc.nodes.find((n) => n.name === name)
  if (!node) throw new Error(`fixture has no node named ${name}`)
  return node
}

describe('getCarrier', () => {
  it('names the carrier each kind of v2 node holds', () => {
    const doc = v2()
    expect(getCarrier(nodeNamed(doc, '泵体'))).toBe('assetRef')
    expect(getCarrier(nodeNamed(doc, '展台'))).toBe('primitive')
    expect(getCarrier(nodeNamed(doc, '聚光灯'))).toBe('light')
  })

  it('returns null for a pure grouping node', () => {
    // The golden path I document's 泵组 is exactly this: a folder in the tree.
    const group = createGoldenPathDocument().nodes.find((n) => n.name === '泵组')!
    expect(getCarrier(group)).toBeNull()
  })

  it('does not throw on an invalid two-carrier node — that is I11’s report to make', () => {
    // A selector that threw would take the editor down before it could show the user what
    // is wrong with the file they just opened.
    const doc = v2()
    const node = nodeNamed(doc, '展台')
    ;(node as { light: unknown }).light = { kind: 'ambient', color: '#ffffff', intensity: 0.6 }
    expect(getCarrier(node)).toBe('primitive')
  })
})

describe('getLightNodes / getPrimitiveNodes', () => {
  it('finds exactly the lights and primitives in the v2 fixture', () => {
    const doc = v2()
    expect(getLightNodes(doc).map((n) => n.name)).toEqual(['聚光灯'])
    expect(getPrimitiveNodes(doc).map((n) => n.name)).toEqual(['展台'])
  })

  it('returns document order, not insertion-into-the-array-later order', () => {
    const doc = v2()
    const spot = nodeNamed(doc, '聚光灯')
    doc.nodes.unshift({ ...spot, id: 'nd_11111111', name: '补光灯' })
    expect(getLightNodes(doc).map((n) => n.name)).toEqual(['补光灯', '聚光灯'])
  })

  it('is empty on a document with neither', () => {
    expect(getLightNodes(createGoldenPathDocument())).toHaveLength(0)
    expect(getPrimitiveNodes(createGoldenPathDocument())).toHaveLength(0)
  })
})

describe('needsDefaultLightRig · D14', () => {
  it('true for a v1-era document: no lights, no environment', () => {
    // The regression this protects is G0.5-6 — an old project must look exactly as it did.
    expect(needsDefaultLightRig(createGoldenPathDocument())).toBe(true)
  })

  it('false once the document has a light of its own', () => {
    expect(needsDefaultLightRig(v2())).toBe(false)
  })

  it('false when an environment map is set even with no light nodes', () => {
    const doc = v2()
    doc.nodes = doc.nodes.filter((n) => n.light === null)
    expect(getLightNodes(doc)).toHaveLength(0)
    expect(needsDefaultLightRig(doc)).toBe(false)
  })

  it('true again after the last light and the environment are both removed', () => {
    // The round trip is the point: delete your only light and the scene must not go black.
    const doc = v2()
    doc.nodes = doc.nodes.filter((n) => n.light === null)
    doc.meta.environment.hdriAssetId = null
    expect(needsDefaultLightRig(doc)).toBe(true)
  })
})

/* ========================================================================== */
/* T-227 · getCarrier 的第四路 · getFlowChain / getStepPrev                     */
/* ========================================================================== */

describe('T-227 · getCarrier 认识 section', () => {
  const bare = () => ({
    id: 'nd_a1b2c3d4',
    name: '裸节点',
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
  }) as unknown as Node

  it('section 节点返回 section', () => {
    expect(getCarrier({ ...bare(), section: { scope: 'scene', size: [4, 4] } } as Node)).toBe('section')
  })

  it('什么都不承载的节点返回 null —— 爆炸分组是这一类', () => {
    expect(getCarrier(bare())).toBe(null)
    expect(
      getCarrier({ ...bare(), explode: { mode: 'radial', gain: 1.5, axis: [0, 1, 0], spacing: 0.5, easing: 'linear' } } as Node),
      'explode 不是承载体，它与承载体正交',
    ).toBe(null)
  })

  it('同时有 assetRef 与 section 时返回 assetRef —— 顺序与 I11 的收集顺序一致', () => {
    // 这是一份 I11 已判非法的文档。两个函数在它上面给出不同答案是**各自正确**：
    // getCarrier 回答「承载的是什么」，typeOf 回答「在动作参数里算哪一类」。
    const node = {
      ...bare(),
      assetRef: { assetId: 'ast_a1b2c3d4', objectPath: 'a', objectName: 'a', missing: false },
      section: { scope: 'scene', size: [4, 4] },
    } as Node
    expect(getCarrier(node)).toBe('assetRef')
  })
})

describe('T-227 · getFlowChain / getStepPrev', () => {
  const flow = (over: Record<string, unknown> = {}) =>
    ({
      id: 'flw_a1b2c3d4',
      name: '拆装',
      variableId: 'step',
      startStepId: 'st_00000001',
      steps: [
        { id: 'st_00000001', name: '一', next: 'st_00000002', onEnter: [] },
        { id: 'st_00000002', name: '二', next: 'st_00000003', onEnter: [] },
        { id: 'st_00000003', name: '三', next: null, onEnter: [] },
      ],
      ...over,
    }) as unknown as Flow

  it('正常链按顺序展平', () => {
    expect(getFlowChain(flow()).map((s) => s.id)).toEqual(['st_00000001', 'st_00000002', 'st_00000003'])
  })

  it('没有入口时返回空数组，不是抛异常', () => {
    expect(getFlowChain(flow({ startStepId: null }))).toEqual([])
  })

  it('成环时截断，且**在有限时间内返回**', () => {
    const cyclic = flow({
      steps: [
        { id: 'st_00000001', name: '一', next: 'st_00000002', onEnter: [] },
        { id: 'st_00000002', name: '二', next: 'st_00000001', onEnter: [] },
      ],
    })
    // 断长度而不是「不抛异常」：删掉 seen 之后的表现是**挂住**，那在 CI 上是超时不是失败。
    // 有了长度断言 + 下面的超时配置，它才会以「红」的形式出现。
    expect(getFlowChain(cyclic).map((s) => s.id)).toEqual(['st_00000001', 'st_00000002'])
  }, 1000)

  it('入口指向一个不存在的步骤时返回空数组', () => {
    expect(getFlowChain(flow({ startStepId: 'st_99999999' }))).toEqual([])
  })

  /**
   * 「上一步」在 v1.0 没有落点（T-300 才用），所以没有 `getStepPrev` 这个导出——
   * 理由写在 `getFlowChain` 的 JSDoc 里。这里断的是**它将来会站在什么之上**：
   * 链有序、可按 id 定位，前一个就是上一步。
   */
  it('链是有序的，「上一步」就是它的前一个元素', () => {
    const chain = getFlowChain(flow())
    const prevOf = (id: string) => {
      const i = chain.findIndex((s) => s.id === id)
      return i > 0 ? chain[i - 1]! : null
    }
    expect(prevOf('st_00000002')?.id).toBe('st_00000001')
    expect(prevOf('st_00000003')?.id).toBe('st_00000002')
    expect(prevOf('st_00000001'), '入口没有上一步').toBe(null)
    expect(prevOf('st_99999999'), '链外的步骤也没有').toBe(null)
  })
})
