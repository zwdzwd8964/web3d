# ADR-0018 · `withCurrentEvent` 改用 Proxy 委托

- **状态**：Accepted（人工裁决，2026-08-01）
- **背景卡**：T-163（`playMedia` / `stopMedia` 与 MediaBus）
- **相关**：ADR-0011、[IMPL_NOTES §4 · T-135 登记的一条](../IMPL_NOTES.md)、宪法 C5

## 背景

`engine.ts` 的 `withCurrentEvent(ctx, event)` 给动作执行期包一层「带当前事件的
`RuntimeContext`」。原实现是**手写的逐方法委托**：一个对象字面量，把 `RuntimeContext`
的每个方法都抄一遍。

于是每新增一个 `RuntimeContext` 方法，都必须改 `engine.ts` 一行——哪怕这个方法与
任何动作类型都无关。这与两条既有纪律**字面冲突**：

- 宪法 C5 / 铁律 5：加交互能力靠注册表，**不改 `engine.ts`**；
- v0.5 每卡纪律第 2 条：涉及 ECA 动作的卡，`engine.ts` 的 diff 必须为空。

而进化规划 §4.3 强制新增四个 `RuntimeContext` 媒体方法。两边不可能同时满足。

这条在 T-135（`setLight`）时就撞过一次，当时只加了一行、把矛盾登记进 IMPL_NOTES 等人工
裁决；T-163 再撞，且这次是四个方法。

## 问题的严重性不在"要改一行"

漏掉一行的**后果是静默的**：包出来的 ctx 上那个方法是 `undefined`，而动作单测直接拿
`HeadlessRuntime` 当 ctx（那上面方法是齐的），所以**测试全绿**。只有真实规则经引擎触发时
才炸，且炸在最少被覆盖的那条路径上。这不是"容易忘"，是"忘了也看不见"。

## 决定

`withCurrentEvent` 改用 `Proxy`：

```ts
return new Proxy(ctx, {
  get(target, property, receiver) {
    if (property === 'currentEvent') return () => event
    const value = Reflect.get(target, property, receiver) as unknown
    return typeof value === 'function' ? value.bind(target) : value
  },
})
```

`engine.ts` 因此**改这一次，以后不再改**。

`bind(target)` 是有意的：`this` 必须是真实例。今天两个运行时都没有 `#private` 字段，所以
不 bind 也能跑——但 `#private` 是现在写类的常规做法，将来任何一个用了它的
`RuntimeContext` 实现都会在被规则调用的那一刻抛 `TypeError`，且只在那里。
`scoped-context.test.ts` 里用一个带 `#private` 字段的类把这条钉死，**否则这个 bind 就是
一段没人能证伪的防御代码**。

## 代价

- `engine.ts` 被改了一次。这是本 ADR 的全部代价，也是它要换掉的东西：**从此不会再有第二次**。
- Proxy 的属性读取比字面量成员访问慢。量级：每条规则每个动作一次属性读 + 一次 `bind`
  分配。相对于动作本身要做的事（改材质、播动画、等时间），可忽略；真成瓶颈时的做法是
  缓存绑定结果，不是退回手写列表。
- 类型上 `Proxy` 返回 `RuntimeContext`，编译器不再逐方法核对包装层是否完整——**这正是
  目的**：完整性由语言保证，不由人核对。

## 撤销条件

出现下面任一情况，退回**显式委托 + 一条枚举全部方法的契约测试**（即保留手写，但让漏写
在测试层可见）：

1. Proxy 在目标浏览器上出现行为差异或不可接受的开销（有 bench 数据，不是感觉）；
2. `RuntimeContext` 出现必须被包装层**改写而非透传**的方法多于一个——那时 Proxy handler
   里的 `if` 会开始堆积，手写列表反而更诚实。

## 为什么不是别的做法

- **只加四行**：能跑，但矛盾原样留着，第五个方法照撞。且这次撞的是四个，说明它只会更频繁。
- **把 `currentEvent` 塞进 ctx 本身、执行前后赋值**：省掉包装层，但引入可变全局状态——
  嵌套规则链（规则里触发规则）会互相覆盖当前事件，这是比漏方法更难查的一类 bug。
- **让动作从参数拿事件而不是从 ctx**：要改 `ECA_SPEC` 的动作签名，属于必须停下来问人的
  第 1 类改动，代价远大于本 ADR。
