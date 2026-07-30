import type { SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { ActionRegistry, registerBuiltinActions } from '../../src/eca/actions/index.js'
import { describeCondition, describeTrigger, generateTestCases, renderTestCasesMarkdown } from '../../src/eca/testgen.js'
import { IDS, clickOn, docWithRules, makeRule } from '../helpers.js'

/** T-087 · ECA_SPEC §8 · technical assessment R14. */

const registry = registerBuiltinActions(new ActionRegistry())
const gen = (doc: SceneDocument) => generateTestCases(doc, { registry })

describe('generateTestCases()', () => {
  it('turns the golden path rule into a case a tester can execute verbatim', () => {
    const cases = gen(createGoldenPathDocument())
    expect(cases).toHaveLength(1)
    const tc = cases[0]!
    expect(tc.id).toBe('TC-RL-001')
    expect(tc.title).toBe('点击阀盖执行第一步')
    expect(tc.precondition).toBe('变量「当前步骤」 等于 1')
    expect(tc.steps).toEqual(['在场景中点击「阀盖」'])
    expect(tc.expected).toEqual([
      '1. 播放动画「阀盖抬起」（等待播完）',
      '2. 高亮对象「阀盖」',
      '3. 打开热点「拆卸提示」的面板',
      '4. 设置变量「当前步骤」为 2',
    ])
    expect(tc.ruleId).toBe(IDS.rule)
  })

  it('numbers cases sequentially', () => {
    const rules = [1, 2, 3].map((i) =>
      makeRule({ name: `规则${i}`, when: clickOn(IDS.cover), then: [{ action: 'resetScene', params: {} }] }),
    )
    expect(gen(docWithRules(rules)).map((c) => c.id)).toEqual(['TC-RL-001', 'TC-RL-002', 'TC-RL-003'])
  })

  it('excludes disabled rules by default — they cannot be demonstrated', () => {
    const off = makeRule({ enabled: false, when: clickOn(IDS.cover), then: [{ action: 'resetScene', params: {} }] })
    expect(gen(docWithRules([off]))).toHaveLength(0)
    expect(generateTestCases(docWithRules([off]), { registry, includeDisabled: true })).toHaveLength(1)
  })

  it('says "no precondition" rather than leaving the cell blank', () => {
    const rule = makeRule({ when: clickOn(IDS.cover), then: [{ action: 'resetScene', params: {} }] })
    expect(gen(docWithRules([rule]))[0]!.precondition).toBe('无（任何情况下都应触发）')
  })

  it('renders if / ifAny groups distinctly', () => {
    const rule = makeRule({
      when: clickOn(IDS.cover),
      if: [{ op: 'eq', left: { var: 'step' }, right: { const: 1 } }],
      ifAny: [
        { op: 'isVisible', nodeId: IDS.body, value: true },
        { op: 'isPanelOpen', hotspotId: IDS.hotspot, value: false },
      ],
      then: [{ action: 'resetScene', params: {} }],
    })
    const precondition = gen(docWithRules([rule]))[0]!.precondition
    expect(precondition).toContain('变量「当前步骤」 等于 1')
    expect(precondition).toContain('满足其一')
    expect(precondition).toContain('对象「泵体」可见')
  })

  it('marks parallel rules as simultaneous rather than numbering them', () => {
    const rule = makeRule({
      mode: 'parallel',
      when: clickOn(IDS.cover),
      then: [
        { action: 'highlight', params: { nodeId: IDS.cover, preset: 'outline_red' } },
        { action: 'openPanel', params: { hotspotId: IDS.hotspot } },
      ],
    })
    expect(gen(docWithRules([rule]))[0]!.expected[0]).toContain('同时发生')
  })

  it('says so plainly when an action is unregistered, instead of inventing an expectation', () => {
    const rule = makeRule({ when: clickOn(IDS.cover), then: [{ action: 'notRegistered', params: {} }] })
    expect(gen(docWithRules([rule]))[0]!.expected[0]).toContain('未注册的动作')
  })
})

describe('describeTrigger()', () => {
  const doc = createGoldenPathDocument()

  it('phrases every v0 event as an instruction to a human tester', () => {
    expect(describeTrigger({ event: 'sceneReady' }, doc)).toContain('打开场景')
    expect(describeTrigger(clickOn(IDS.cover), doc)).toBe('在场景中点击「阀盖」')
    expect(describeTrigger({ event: 'click', target: { any: true } }, doc)).toContain('任意对象')
    expect(describeTrigger({ event: 'click', target: { nodeId: IDS.pump, includeDescendants: true } }, doc)).toContain(
      '或其任意子对象',
    )
    expect(describeTrigger({ event: 'hoverEnter', target: { nodeId: IDS.cover } }, doc)).toContain('移入')
    expect(describeTrigger({ event: 'hoverLeave', target: { nodeId: IDS.cover } }, doc)).toContain('移出')
    expect(describeTrigger({ event: 'hotspotClick', hotspotId: IDS.hotspot }, doc)).toContain('拆卸提示')
    expect(describeTrigger({ event: 'animationEnd', animationId: IDS.animation }, doc)).toContain('自然播放结束')
    expect(describeTrigger({ event: 'variableChange', variableId: 'step' }, doc)).toContain('当前步骤')
    expect(describeTrigger({ event: 'timer', delay: 500, repeat: true, startOn: 'sceneReady' }, doc)).toContain('500 毫秒')
  })
})

describe('describeCondition()', () => {
  const doc = createGoldenPathDocument()

  it('covers every operator in readable Chinese', () => {
    expect(describeCondition({ op: 'gte', left: { var: 'step' }, right: { const: 2 } }, doc)).toBe(
      '变量「当前步骤」 不小于 2',
    )
    expect(describeCondition({ op: 'in', left: { var: 'step' }, right: [1, 2] }, doc)).toContain('属于 [1, 2]')
    expect(describeCondition({ op: 'isVisible', nodeId: IDS.body, value: false }, doc)).toBe('对象「泵体」不可见')
    expect(describeCondition({ op: 'isPlaying', animationId: IDS.animation, value: true }, doc)).toContain('正在播放')
    expect(describeCondition({ op: 'isPanelOpen', hotspotId: IDS.hotspot, value: true }, doc)).toContain('已打开')
    expect(
      describeCondition({ op: 'eq', left: { prop: { nodeId: IDS.cover, key: 'positionY' } }, right: { const: 0 } }, doc),
    ).toContain('positionY')
    expect(describeCondition({ op: 'eq', left: { event: 'nodeId' }, right: { const: 'x' } }, doc)).toContain('本次事件')
  })
})

describe('renderTestCasesMarkdown()', () => {
  it('produces the Appendix C table skeleton', () => {
    const markdown = renderTestCasesMarkdown(gen(createGoldenPathDocument()))
    expect(markdown).toContain('# 附件C 验收测试用例')
    expect(markdown).toContain('| 用例编号 | 名称 | 前置条件 | 操作步骤 | 预期结果 |')
    expect(markdown).toContain('| TC-RL-001 | 点击阀盖执行第一步 |')
    expect(markdown).toContain('播放动画「阀盖抬起」')
  })

  it('escapes pipes and newlines so one bad label cannot break the table', () => {
    const rule = makeRule({ name: 'a|b', when: clickOn(IDS.cover), then: [{ action: 'resetScene', params: {} }] })
    const markdown = renderTestCasesMarkdown(gen(docWithRules([rule])))
    expect(markdown).toContain('a\\|b')
    expect(markdown.split('\n').filter((l) => l.startsWith('|'))).toHaveLength(3)
  })

  it('renders an honest placeholder row when there is nothing to generate', () => {
    expect(renderTestCasesMarkdown([])).toContain('没有启用的规则')
  })
})
