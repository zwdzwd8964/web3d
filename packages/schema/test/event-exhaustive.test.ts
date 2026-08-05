import { describe, expect, it } from 'vitest'
import { eventDescriptorRefs } from '../src/index-builder.js'
import type { RefTarget } from '../src/index-builder.js'
import type { EventDescriptor, EventType, Rule } from '../src/rule.js'
import { EVENT_TYPES } from '../src/rule.js'

/**
 * T-227 · **加一种事件而忘了改 `eventDescriptorRefs`，必须当场红。**
 *
 * 那个 switch 有一支 `default: return []`，所以漏掉一个 case 的症状是：规则配得出、
 * 存得进、发布得出，而反向索引对它完全失明——删掉被它引用的对象时，删除确认说
 * 「没有人引用」。所有既有单测都是绿的。
 *
 * ## 为什么锁必须是运行时的
 *
 * 最自然的写法是让期望表是 `Record<EventType, …>`，靠 TypeScript 的穷尽性报错。
 * **那把锁在本卡的自测命令里恒绿**：vitest 不做类型检查（`packages/schema/vitest.config.ts`
 * 里没有 typecheck 配置），它只在 `pnpm -r typecheck` 时才响。而 T-305 与 T-317 都把
 * 这把锁当成后面两级台阶的防线在引用。
 *
 * 所以真正的锁是下面第一条断言：`Object.keys(EXPECTED)` 与 `EVENT_TYPES` **连顺序一起**
 * 全等。类型只是第二道。
 *
 * ## 它锁的是哪一份
 *
 * **只锁 `index-builder.ts` 的 `eventDescriptorRefs`。** 同一个 switch 在仓库里有第二份
 * 手抄——`integrity.ts` 的 `checkRuleRefs`，它也有自己的 `default: break`。那一份由
 * T-226 的「三个新事件的引用真的被查」覆盖。两份各锁各的，不要读成「事件遗漏已被
 * 机械拦住」。
 */

const NODE = 'nd_a1b2c3d4'
const HOTSPOT = 'hs_a1b2c3d4'
const ANIMATION = 'anm_a1b2c3d4'
const VARIABLE = 'step'
const PAGE = 'pg_a1b2c3d4'
const FLOW = 'flw_a1b2c3d4'
const STEP = 'st_a1b2c3d4'
const OVERLAY = 'ov_a1b2c3d4'

/** 每种事件：一个合法的描述符，与它应当登记的引用。 */
const EXPECTED: Record<EventType, { when: EventDescriptor; refs: RefTarget[] }> = {
  sceneReady: { when: { event: 'sceneReady' }, refs: [] },
  click: { when: { event: 'click', target: { nodeId: NODE } }, refs: [{ kind: 'node', id: NODE }] },
  hoverEnter: { when: { event: 'hoverEnter', target: { nodeId: NODE } }, refs: [{ kind: 'node', id: NODE }] },
  hoverLeave: { when: { event: 'hoverLeave', target: { nodeId: NODE } }, refs: [{ kind: 'node', id: NODE }] },
  hotspotClick: { when: { event: 'hotspotClick', hotspotId: HOTSPOT }, refs: [{ kind: 'hotspot', id: HOTSPOT }] },
  animationEnd: { when: { event: 'animationEnd', animationId: ANIMATION }, refs: [{ kind: 'animation', id: ANIMATION }] },
  variableChange: { when: { event: 'variableChange', variableId: VARIABLE }, refs: [{ kind: 'variable', id: VARIABLE }] },
  timer: { when: { event: 'timer', delay: 1000, repeat: false, startOn: 'sceneReady' }, refs: [] },
  pageEnter: { when: { event: 'pageEnter', pageId: PAGE }, refs: [{ kind: 'page', id: PAGE }] },
  flowStepEnter: {
    when: { event: 'flowStepEnter', flowId: FLOW, stepId: STEP },
    // **两条。** 删掉一个步骤，指着它的 flowStepEnter 规则也失效，删除确认要说得出。
    refs: [
      { kind: 'flow', id: FLOW },
      { kind: 'step', id: STEP },
    ],
  },
  overlayClick: { when: { event: 'overlayClick', overlayId: OVERLAY }, refs: [{ kind: 'overlay', id: OVERLAY }] },
}

const ruleWith = (when: EventDescriptor): Rule =>
  ({
    id: 'rl_a1b2c3d4',
    name: '探针',
    enabled: true,
    when,
    if: [],
    ifAny: [],
    then: [],
    mode: 'sequence',
    onError: 'abort',
    reentry: 'restart',
  }) as Rule

describe('T-227 · 事件枚举的穷尽锁', () => {
  it('期望表的键与 EVENT_TYPES 连顺序一起全等 —— 这就是锁本身', () => {
    // 加一种事件而不改本文件，这一条当场红。**运行时断言，不靠类型**：
    // vitest 不做类型检查，`Record<EventType, …>` 的穷尽性在自测命令里不响。
    expect(Object.keys(EXPECTED)).toEqual([...EVENT_TYPES])
    expect(EVENT_TYPES.length, '事件数塌了，本文件每一条都成了空转').toBe(11)
  })

  it.each([...EVENT_TYPES])('%s 的引用登记与期望逐字相同', (event) => {
    const { when, refs } = EXPECTED[event]
    // toEqual 全等数组，**不是 toContain**：少登记一条与多登记一条都要红。
    expect(eventDescriptorRefs(ruleWith(when))).toEqual(refs)
  })

  it('没有一种事件是靠 default 兜住的', () => {
    // `default: return []` 存在是为了「有人加了第 12 种事件」，不是为了给已知事件兜底。
    // 反过来说：如果某个已知事件的正确答案恰好是 []，它必须**显式**写在 switch 里。
    // 这条断言证明的是「期望里说没有引用的那两支，确实是被点名的两支」。
    const empty = [...EVENT_TYPES].filter((e) => EXPECTED[e].refs.length === 0)
    expect(empty.sort()).toEqual(['sceneReady', 'timer'])
  })
})
