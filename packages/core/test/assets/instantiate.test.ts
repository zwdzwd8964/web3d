import { NODE_NAME_MAX, clampNodeName, createGoldenPathDocument, createSequentialIdFactory, validate } from '@w3/schema'
import { BoxGeometry, Group, Mesh } from 'three'
import { describe, expect, it } from 'vitest'
import { instantiate } from '../../src/assets/instantiate.js'

/**
 * T-180 · names that arrive from outside the product.
 *
 * `NodeSchema.name` is capped at 120 characters and a GLB's object names are not, so this
 * is the one field where a file someone else exported decides whether the document is legal.
 */

describe('外部来的物体名必须能进文档（T-180）', () => {
  it('超长物体名被夹到 schema 的上限内', () => {
    // 一个 120 字符以上的物体名会造出 NodeSchema 拒绝的节点，而导入路径上没人重新校验：
    // 工程**存得下**，下次打开 migrate 失败 → 编辑器回退到样例场景 → 用户看到自己的工程
    // 消失了。每一步都是静默的（T-176 审查所得）。
    const long = 'Assembly_Rev3_'.repeat(20) + 'Bolt_M6x20'
    expect(long.length).toBeGreaterThan(NODE_NAME_MAX)

    const root = new Group()
    const mesh = new Mesh(new BoxGeometry(1, 1, 1))
    mesh.name = long
    root.add(mesh)

    const base0 = createGoldenPathDocument()
    const { nodes } = instantiate(root, { assetId: base0.assets[0]!.id, newId: createSequentialIdFactory() })

    expect(nodes.length).toBeGreaterThan(0)
    for (const node of nodes) expect(node.name.length).toBeLessThanOrEqual(NODE_NAME_MAX)

    const base = createGoldenPathDocument()
    const doc = { ...base, nodes: [...base.nodes, ...nodes.map((n) => ({ ...n, parent: null }))] }
    expect(validate(doc as never).ok, '导入之后文档必须还打得开').toBe(true)
  })

  it('保留名字的尾巴，因为区分度在后面', () => {
    // 导出器给的名字长这样：Assembly_Rev3_SubAssembly_…_Bolt_M6x20，
    // 能把两个零件区分开的信息全在末尾。从右边截等于把一层结构变成四十行一模一样的东西。
    const long = 'A'.repeat(200) + 'Bolt_M6x20'
    expect(clampNodeName(long).endsWith('Bolt_M6x20')).toBe(true)
    expect(clampNodeName(long).startsWith('…')).toBe(true)
  })

  it('空名字有个能读的兜底', () => {
    expect(clampNodeName('   ')).toBe('对象')
  })

  it('正常长度的名字原样通过', () => {
    expect(clampNodeName('阀盖')).toBe('阀盖')
  })
})
