import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../src/document.js'
import type { Explode } from '../src/explode.js'
import type { Node } from '../src/node.js'
import { checkIntegrity } from '../src/integrity.js'
import { createGoldenPathDocument } from '../src/samples.js'

/**
 * T-226 · I21 – I28 · 爆炸分组与剖切平面。
 *
 * 单独成文件是因为这八条共用一套「造一个分组 + 几个子件」的脚手架，而
 * `integrity.test.ts` 里那套 `mutated()` 是为「改golden path 的一个字段」设计的。
 *
 * **每条一正一反**：正例断的是「干净文档不报这一条」，反例断的是「这一处坏了就报出来，
 * 且级别对」。级别单独断——`expect(codes).toContain('I23')` 对 warn 和 error 一样为真，
 * 而 I23 是 error（零向量轴会产生 NaN 让整组消失）而 I21 是 warn，两者不能互换。
 */

const base = () => structuredClone(createGoldenPathDocument()) as SceneDocument

/** 一个最小节点。承载体全空——I11 的四选一在这里必须让路给「什么都不承载的分组」。 */
function node(id: string, over: Partial<Node> = {}): Node {
  return {
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
    ...over,
  } as Node
}

const EXPLODE: Explode = { mode: 'radial', gain: 1.5, axis: [0, 1, 0], spacing: 0.5, easing: 'easeInOutCubic' }

/** 造一个爆炸分组 + n 个子件，子件位置由 `at` 给。 */
function withGroup(childPositions: [number, number, number][], explode: Partial<Explode> = {}): SceneDocument {
  const doc = base()
  const nodes: Node[] = [
    node('nd_group0001', { explode: { ...EXPLODE, ...explode } }),
    ...childPositions.map((p, i) =>
      node(`nd_child000${i + 1}`, { parent: 'nd_group0001', order: (i + 1) * 100, transform: { p, r: [0, 0, 0, 1], s: [1, 1, 1] } }),
    ),
  ]
  return { ...doc, nodes: [...doc.nodes, ...nodes] }
}

const issuesOf = (doc: SceneDocument, code: string) => checkIntegrity(doc).filter((i) => i.code === code)
const codes = (doc: SceneDocument) => checkIntegrity(doc).map((i) => i.code)

describe('I21 · 分组里没有可散开的东西', () => {
  it('正例：三个子件的分组不报', () => {
    expect(codes(withGroup([[1, 0, 0], [0, 1, 0], [0, 0, 1]]))).not.toContain('I21')
  })

  it('反例：只有 1 个子件 → warn', () => {
    const found = issuesOf(withGroup([[1, 0, 0]]), 'I21')
    expect(found).toHaveLength(1)
    expect(found[0]!.level, 'I21 是 warn：散不开是配置没意义，不是文档坏了').toBe('warn')
  })

  it('反例：一个子件都没有 → 同样 warn', () => {
    expect(issuesOf(withGroup([]), 'I21')).toHaveLength(1)
  })
})

describe('I22 · 径向模式下全部锚点重合', () => {
  it('正例：子件散布在不同位置时不报', () => {
    expect(codes(withGroup([[1, 0, 0], [0, 1, 0], [0, 0, 1]]))).not.toContain('I22')
  })

  it('反例：三个子件锚点完全重合 → warn，且消息给出路', () => {
    const found = issuesOf(withGroup([[0, 0, 0], [0, 0, 0], [0, 0, 0]]), 'I22')
    expect(found).toHaveLength(1)
    expect(found[0]!.level).toBe('warn')
    // 只说「散不开」是告诉用户他错了却不告诉他怎么办
    expect(found[0]!.message).toContain('轴向')
    expect(found[0]!.message).toContain('爆炸偏移')
  })

  it('反例的边界：只有一根轴上有差异就不算重合', () => {
    expect(codes(withGroup([[0, 0, 0], [0, 0, 0], [1e-3, 0, 0]]))).not.toContain('I22')
  })

  it('轴向模式下锚点重合不报 I22 —— 这一条只管径向', () => {
    expect(codes(withGroup([[0, 0, 0], [0, 0, 0]], { mode: 'axis', axis: [1, 0, 0] }))).not.toContain('I22')
  })
})

describe('I23 · 轴向模式的零向量轴', () => {
  it('正例：单位轴不报', () => {
    expect(codes(withGroup([[1, 0, 0], [2, 0, 0]], { mode: 'axis', axis: [1, 0, 0] }))).not.toContain('I23')
  })

  it('反例：零向量 → error', () => {
    const found = issuesOf(withGroup([[1, 0, 0], [2, 0, 0]], { mode: 'axis', axis: [0, 0, 0] }), 'I23')
    expect(found).toHaveLength(1)
    expect(found[0]!.level, 'I23 是 error：归一化零向量得到 NaN，整个分组会从画面上消失').toBe('error')
  })

  it('径向模式下零向量轴不报 —— radial 不读 axis', () => {
    expect(codes(withGroup([[1, 0, 0], [2, 0, 0]], { mode: 'radial', axis: [0, 0, 0] }))).not.toContain('I23')
  })
})

describe('I24 · 爆炸偏移挂错了地方', () => {
  it('正例：偏移挂在分组子件上不报', () => {
    const doc = withGroup([[1, 0, 0], [2, 0, 0]])
    const withOffset = {
      ...doc,
      nodes: doc.nodes.map((n) => (n.id === 'nd_child0001' ? { ...n, explodeOffset: [0.3, 0, 0] as [number, number, number] } : n)),
    }
    expect(codes(withOffset)).not.toContain('I24')
  })

  it('反例：偏移挂在一个根节点上 → info', () => {
    const doc = base()
    const orphan = { ...doc, nodes: [...doc.nodes, node('nd_orphan001', { explodeOffset: [1, 0, 0] })] }
    const found = issuesOf(orphan, 'I24')
    expect(found).toHaveLength(1)
    expect(found[0]!.level).toBe('info')
  })

  it('反例：父级存在但不是爆炸分组 → 同样 info', () => {
    const doc = base()
    const nodes = [
      ...doc.nodes,
      node('nd_plain0001'),
      node('nd_kid000001', { parent: 'nd_plain0001', explodeOffset: [1, 0, 0] }),
    ]
    expect(issuesOf({ ...doc, nodes }, 'I24')).toHaveLength(1)
  })
})

describe('I25 / I26 / I27 · 剖切平面', () => {
  const sectionNode = (id: string, over: Partial<Node> = {}) =>
    node(id, { section: { scope: 'scene', size: [4, 4] }, ...over })

  it('I25 正例：三个剖切面不报', () => {
    const doc = base()
    const nodes = [...doc.nodes, sectionNode('nd_sect0001'), sectionNode('nd_sect0002'), sectionNode('nd_sect0003')]
    expect(codes({ ...doc, nodes })).not.toContain('I25')
  })

  it('I25 反例：四个启用的剖切面 → warn，且说清取前 3 条', () => {
    const doc = base()
    const nodes = [
      ...doc.nodes,
      sectionNode('nd_sect0001'),
      sectionNode('nd_sect0002'),
      sectionNode('nd_sect0003'),
      sectionNode('nd_sect0004'),
    ]
    const found = issuesOf({ ...doc, nodes }, 'I25')
    expect(found).toHaveLength(1)
    expect(found[0]!.level).toBe('warn')
    expect(found[0]!.message).toContain('3')
  })

  it('I25 只数启用的 —— 第四个 visible:false 时不报', () => {
    const doc = base()
    const nodes = [
      ...doc.nodes,
      sectionNode('nd_sect0001'),
      sectionNode('nd_sect0002'),
      sectionNode('nd_sect0003'),
      sectionNode('nd_sect0004', { visible: false }),
    ]
    expect(codes({ ...doc, nodes })).not.toContain('I25')
  })

  it('I26 正例：单位缩放不报', () => {
    const doc = base()
    expect(codes({ ...doc, nodes: [...doc.nodes, sectionNode('nd_sect0001')] })).not.toContain('I26')
  })

  it('I26 反例：被缩放过 → info', () => {
    const doc = base()
    const scaled = sectionNode('nd_sect0001', { transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [2, 1, 1] } })
    const found = issuesOf({ ...doc, nodes: [...doc.nodes, scaled] }, 'I26')
    expect(found).toHaveLength(1)
    expect(found[0]!.level, 'I26 是 info：缩放只影响指示矩形，剖切结果不受影响').toBe('info')
  })

  it('I27 正例：只有剖切面、没有投影灯时不报', () => {
    const doc = base()
    expect(codes({ ...doc, nodes: [...doc.nodes, sectionNode('nd_sect0001')] })).not.toContain('I27')
  })

  it('I27 反例：剖切面 + 投影灯 → warn', () => {
    const doc = base()
    const light = node('nd_light0001', {
      light: {
        kind: 'directional',
        color: '#ffffff',
        intensity: 1,
        shadow: { enabled: true, quality: 'medium', bias: -0.0005 },
      } as Node['light'],
    })
    const found = issuesOf({ ...doc, nodes: [...doc.nodes, sectionNode('nd_sect0001'), light] }, 'I27')
    expect(found).toHaveLength(1)
    expect(found[0]!.level).toBe('warn')
  })

  it('I27 不报：有投影灯但没有剖切面', () => {
    const doc = base()
    const light = node('nd_light0001', {
      light: {
        kind: 'directional',
        color: '#ffffff',
        intensity: 1,
        shadow: { enabled: true, quality: 'medium', bias: -0.0005 },
      } as Node['light'],
    })
    expect(codes({ ...doc, nodes: [...doc.nodes, light] })).not.toContain('I27')
  })
})

describe('I28 · explode 动作指向一个不是爆炸分组的节点', () => {
  /**
   * 走 `RefTarget.expectType` + `typeOf` 阶梯。
   *
   * 这里注入一个只认 `explode` 动作的解析器，形状与 core 的真解析器一致
   * （`action-refs-gate.test.ts` 用的是**生产解析器**，那一条才是覆盖率断言）。
   */
  const explodeRefs = (action: { action: string; params: Record<string, unknown> }) =>
    action.action === 'explode' && typeof action.params.nodeId === 'string'
      ? [{ kind: 'node', id: action.params.nodeId, expectType: 'explodeGroup' }]
      : []

  const withRule = (nodeId: string, extraNodes: Node[]) => {
    const doc = base()
    return {
      ...doc,
      nodes: [...doc.nodes, ...extraNodes],
      rules: [
        ...doc.rules,
        {
          id: 'rl_explode1',
          name: '散开',
          enabled: true,
          when: { event: 'sceneReady' },
          if: [],
          ifAny: [],
          then: [{ action: 'explode', params: { nodeId, factor: 1 } }],
          mode: 'sequence',
          onError: 'abort',
          reentry: 'restart',
        },
      ],
    } as SceneDocument
  }

  it('正例：指向真正的爆炸分组不报', () => {
    const group = node('nd_group0001', { explode: EXPLODE })
    const doc = withRule('nd_group0001', [group, node('nd_c1', { parent: 'nd_group0001' }), node('nd_c2', { parent: 'nd_group0001' })])
    const found = checkIntegrity(doc, { actionRefs: explodeRefs }).filter((i) => i.code === 'I14')
    expect(found).toHaveLength(0)
  })

  it('反例：指向一个普通节点 → 报出来，且消息说清期望的是什么', () => {
    const doc = withRule('nd_plain0001', [node('nd_plain0001')])
    const found = checkIntegrity(doc, { actionRefs: explodeRefs }).filter((i) => i.code === 'I14')
    expect(found).toHaveLength(1)
    expect(found[0]!.level).toBe('error')
    expect(found[0]!.message).toContain('explodeGroup')
  })

  it('typeOf 的阶梯真的分得清四种节点', () => {
    // 把 typeOf 改成永远返回 'node'，上面那条反例就死了 —— 这条把阶梯每一级都钉住
    const probe = (n: Node) => {
      const doc = withRule(n.id, [n])
      return checkIntegrity(doc, { actionRefs: explodeRefs }).filter((i) => i.code === 'I14').length
    }
    expect(probe(node('nd_group0001', { explode: EXPLODE })), 'explodeGroup 应当被接受').toBe(0)
    expect(probe(node('nd_sect0001', { section: { scope: 'scene', size: [4, 4] } })), 'section 不是 explodeGroup').toBe(1)
    expect(
      probe(
        node('nd_light0001', {
          light: { kind: 'ambient', color: '#ffffff', intensity: 1 } as Node['light'],
        }),
      ),
      'light 不是 explodeGroup',
    ).toBe(1)
    expect(probe(node('nd_plain0001')), '普通节点不是 explodeGroup').toBe(1)
  })

  it('section 优先于 explode —— 阶梯顺序不是随便排的', () => {
    const both = node('nd_both0001', {
      section: { scope: 'scene', size: [4, 4] },
      explode: EXPLODE,
    })
    const doc = withRule('nd_both0001', [both])
    // section > explodeGroup，所以它被判成 section，不满足 expectType
    expect(checkIntegrity(doc, { actionRefs: explodeRefs }).filter((i) => i.code === 'I14')).toHaveLength(1)
  })
})
