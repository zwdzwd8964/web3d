# ECA 规则引擎规范 · 事件-条件-动作

**包**：`@w3/core`（`src/eca/`）
**上位文档**：[NORTH_STAR.md](NORTH_STAR.md)（C5 / C8）· [SCHEMA_SPEC.md](SCHEMA_SPEC.md) §6.6
**性质**：**实现规范，逐字实现。**

> 技术方案 §1.3：模型交互 / 动画交互 / 流程管理 / 交互管理 四个功能项（合计预算 24,858）在这里统一收口。这个引擎是整份合同里工程价值密度最高的一块，也是产品化复用的核心资产。

---

## 0. 三条设计约束

**约束一：引擎不认识具体动作。**
执行器只知道"从注册表里查一个函数，喂参数，await 它"。执行器里**永远不许出现** `if (action.type === 'playAnimation')`（反模式 A3）。新增一种交互能力 = 注册表加一项 + 一段 UI 表单描述，引擎零改动（宪法 C5）。

**约束二：引擎不认识 GPU。**
引擎只依赖 `RuntimeContext` 接口。生产环境注入 `SceneRuntime`（有 three），测试环境注入 `HeadlessRuntime`（纯 JS）。这不只是为了测试方便——技术方案 §1.3 指出它有双重价值：**它是保证质量的唯一现实手段，同时直接产出合同要求的验收测试用例文档**（技术方案 R14）。

**约束三：时间可注入。**
引擎内部禁止 `Date.now()` / `performance.now()` / `setTimeout` / `requestAnimationFrame`。一律走 `ctx.now()` 与 `ctx.wait()`。测试用可手动推进的假时钟，跑得快且不 flaky。

---

## 1. 模块结构

```
packages/core/src/eca/
├── types.ts        RuntimeContext / ActionHandler / 各类描述符
├── events.ts       事件类型表 + EventBus
├── conditions.ts   条件求值器
├── actions/
│   ├── registry.ts 注册表 + register() + 参数 schema 收集
│   ├── animation.ts  play / stop / seek
│   ├── scene.ts      setVisible / setMaterial / highlight / resetScene
│   ├── camera.ts     moveCamera
│   ├── ui.ts         openPanel / closePanel / openLink
│   ├── state.ts      setVariable
│   └── index.ts      registerBuiltinActions()
├── executor.ts     sequence / parallel / reentry / abort
├── engine.ts       EcaEngine：绑定文档、订阅事件、分发规则
├── headless.ts     HeadlessRuntime（测试与用例生成用）
└── testgen.ts      规则表 → 验收用例骨架（技术方案 R14）
```

---

## 2. 事件

### 2.1 事件表

| `event` | 载荷 | 触发时机 | v0 |
|---|---|---|---|
| `sceneReady` | `{}` | 文档加载完成、首帧渲染后 | ✅ |
| `click` | `{ nodeId, point, distance }` | 射线命中可交互节点并完成一次点击 | ✅ |
| `hoverEnter` | `{ nodeId }` | 射线首次进入节点 | ✅ |
| `hoverLeave` | `{ nodeId }` | 射线离开节点 | ✅ |
| `hotspotClick` | `{ hotspotId }` | 热点标记被点击 | ✅ |
| `animationEnd` | `{ animationId, completed }` | 动画自然播完（`completed: true`）或被中断（`false`）| ✅ |
| `variableChange` | `{ variableId, from, to }` | 变量值发生变化 | ✅ |
| `timer` | `{ timerId, tick }` | 规则声明的定时器到点 | ✅ |
| `pageEnter` | `{ pageId }` | 切换到某页 | v1 |
| `flowStepEnter` | `{ flowId, stepId }` | 进入流程步骤 | v1 |

### 2.2 事件描述符

```ts
const EventDescriptorSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('sceneReady') }),
  z.object({ event: z.literal('click'),      target: NodeTargetSchema }),
  z.object({ event: z.literal('hoverEnter'), target: NodeTargetSchema }),
  z.object({ event: z.literal('hoverLeave'), target: NodeTargetSchema }),
  z.object({ event: z.literal('hotspotClick'), hotspotId: Id('hs') }),
  z.object({ event: z.literal('animationEnd'), animationId: Id('anm') }),
  z.object({ event: z.literal('variableChange'), variableId: z.string() }),
  z.object({ event: z.literal('timer'),
             delay: z.number().nonnegative(),          // 毫秒
             repeat: z.boolean().default(false),
             startOn: z.enum(['sceneReady', 'manual']).default('sceneReady') }),
])

const NodeTargetSchema = z.union([
  z.object({ nodeId: Id('nd') }),                          // 精确节点
  z.object({ nodeId: Id('nd'), includeDescendants: z.literal(true) }),  // 节点及其子树
  z.object({ any: z.literal(true) }),                      // 任意节点（用于"点空白处"类规则）
])
```

`includeDescendants` 是必要的：用户在层级树上选中"泵组"这个分组配交互，期望点击它的任何子件都触发。没有这个选项，用户要为 34 个 mesh 配 34 条规则。

### 2.3 分发

`buildIndex` 产出的 `rulesByEvent: Map<EventType, Rule[]>` 是分发的唯一入口。事件到达 → 查表 → 逐条对 `when` 做目标匹配 → 匹配的候选进入条件求值。

**禁止**每次事件遍历全部规则。100 条规则 × hover 事件每秒几十次 = 无谓开销，且是最容易被忽略的性能陷阱。

**匹配顺序**：`rules` 数组的自然顺序。多条规则同时命中时**全部执行**，各自独立（不是"第一条胜出"）。若用户想要互斥，用条件表达。

---

## 3. 条件

### 3.1 值表达式

```ts
const ValueExprSchema = z.union([
  z.object({ const: z.union([z.number(), z.string(), z.boolean()]) }),
  z.object({ var: z.string() }),                    // 变量当前值
  z.object({ prop: z.object({                       // 场景属性
    nodeId: Id('nd'),
    key: z.enum(['visible', 'materialId', 'positionY']),
  })}),
  z.object({ event: z.enum(['nodeId', 'hotspotId', 'animationId']) }),  // 当前事件载荷
])
```

`{ event: 'nodeId' }` 让"点了哪个就高亮哪个"这类规则可以用一条通配规则表达，而不是 N 条。

### 3.2 条件

```ts
const ConditionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.enum(['eq','ne','gt','gte','lt','lte']),
             left: ValueExprSchema, right: ValueExprSchema }),
  z.object({ op: z.literal('in'),  left: ValueExprSchema,
             right: z.array(z.union([z.number(), z.string(), z.boolean()])) }),
  z.object({ op: z.literal('isVisible'),     nodeId: Id('nd'), value: z.boolean() }),
  z.object({ op: z.literal('isPlaying'),     animationId: Id('anm'), value: z.boolean() }),
  z.object({ op: z.literal('isPanelOpen'),   hotspotId: Id('hs'), value: z.boolean() }),
])
```

### 3.3 求值规则

```
enabled === false                        → 不执行
if 为空 且 ifAny 为空                     → 通过
if 非空                                   → 全部为真才通过（AND）
ifAny 非空                                → 至少一个为真才通过（OR）
两者都非空                                 → AND组 && OR组
```

**类型比较严格，不做隐式转换。** `"2" == 2` 为 false。类型不匹配时求值返回 false 并 `warn` 一条到调试通道——静默的 true 会造成极难排查的行为。`checkIntegrity` 的 I4 会在保存时提前抓到大部分此类问题。

**求值必须是纯函数、无副作用、同步。** 条件里不许调用任何会改变状态的东西。

---

## 4. 动作

### 4.1 注册表

```ts
export type ActionHandler<P = unknown> = (
  ctx:    RuntimeContext,
  params: P,
  signal: AbortSignal,
) => void | Promise<void>

export interface ActionDefinition<P = unknown> {
  type:    string
  schema:  ZodType<P>
  handler: ActionHandler<P>
  /** 规则编辑 UI 靠它生成表单，不用为每种动作手写面板 */
  ui: {
    label: string                    // '播放动画'
    icon?: string
    group: 'animation' | 'scene' | 'camera' | 'ui' | 'state' | 'flow'
    fields: FieldDescriptor[]
  }
  /** 引用了文档中的哪些 id —— 供 checkIntegrity 与 refsTo 反向索引使用 */
  refs: (params: P) => Array<{ kind: string; id: string }>
  /** 生成一句人话描述，用于验收用例与调试日志 */
  describe: (params: P, doc: SceneDocument) => string
}

export function registerAction<P>(def: ActionDefinition<P>): void
export function getAction(type: string): ActionDefinition | undefined
export function allActions(): ActionDefinition[]
```

**`refs`、`describe`、`ui` 三项都是必填的。** 它们看着像样板，但各自撑起一个关键能力：

- `refs` → `checkIntegrity` 能发现"规则引用了已删除的节点"，`refsTo` 能回答"删这个节点会影响什么"；
- `describe` → 技术方案 R14 要求的验收用例文档由此自动生成；
- `ui` → 规则编辑器不需要为每种动作手写表单，这直接决定了"新增动作只改 3 个文件"这个北极星指标（NORTH_STAR §7）。

漏掉任何一项，新增动作的边际成本就从"半天"变成"两天"。

### 4.2 动作清单

| `action` | 参数 | 语义 | await 行为 |
|---|---|---|---|
| `playAnimation` | `{ animationId, await?: true, restart?: boolean }` | 播放动画 | `await: true` 时挂起到播完；`loop` 动画即使 `await: true` 也**立即 resolve** |
| `stopAnimation` | `{ animationId, reset?: boolean }` | 停止 | 立即 |
| `seekAnimation` | `{ animationId, time }` | 跳到指定秒 | 立即 |
| `setVisible` | `{ nodeId, value, includeDescendants?: boolean }` | 显隐 | 立即 |
| `setMaterial` | `{ nodeId, materialId \| null }` | 换材质（null = 还原源材质） | 立即 |
| `highlight` | `{ nodeId, preset \| null, includeDescendants?: boolean }` | 高亮（null = 取消） | 立即 |
| `moveCamera` | `{ viewpointId, duration?: number, await?: boolean }` | 飞到已存视点 | `await: true` 时挂起到到位 |
| `openPanel` | `{ hotspotId }` | 打开热点面板 | 立即 |
| `closePanel` | `{ hotspotId \| 'all' }` | 关闭面板 | 立即 |
| `setVariable` | `{ variableId, value: ValueExpr, mode?: 'set'\|'add' }` | 赋值 | 立即，同步触发 `variableChange` |
| `wait` | `{ ms }` | 等待 | 挂起 `ms` 毫秒（走 `ctx.wait`） |
| `openLink` | `{ url, target: '_blank'\|'_self' }` | 打开链接 | 立即 |
| `resetScene` | `{}` | 恢复到文档初始状态（transform / visible / material / 变量默认值 / **灯光参数**） | 立即 |
| `setLight` **（v0.5）** | `{ nodeId, intensity?, color? }` | 改灯光参数（目标节点须为灯节点，否则 skip + error，同 B9） | 立即 |
| `playMedia` **（v0.5）** | `{ mediaId, await?: false, loop?: false, volume?: 1 }` | 播放媒体 | `await: true` 时按 media 记录的 `durationS` 挂起（走 `ctx.wait`）；**`loop: true` 立即 resolve**（同 D6 边界）；`durationS` 缺失立即 resolve + warn |
| `stopMedia` **（v0.5）** | `{ mediaId \| 'all' }` | 停止播放 | 立即 |

`moveCamera` **只能飞到已保存的视点**（技术方案 §1.3 原文限定）。允许填任意坐标等于让用户在规则编辑器里手搓相机，UI 复杂度暴涨且几乎无人用对。

`wait` 是技术方案没列但必需的：没有它，"高亮 → 停 1 秒 → 弹面板"这类最常见的编排做不出来，用户会被迫用假的 loop 动画去凑。

**`playAnimation` 默认 `await: true`，`playMedia` 默认 `await: false`——这是有意的差别，不是笔误。**
（T-211 裁决。此前本表只给 `playMedia` 写了默认值，`playAnimation` 那格写的是 `await?: boolean`，
于是「D19 说媒体与动画语义对齐」被读成了「默认值也一样」，`media.ts` 里还留着一句
「same as playAnimation」的错误注释。）动画通常**就是**下一步要等的那件事（「抬起阀盖之后弹面板」），
而音频通常是**垫在后续动作底下**的旁白。两个默认值都已冻结，改任何一个都会改变既有文档的行为。

**`setLight`（v0.5，进化规划 §4.3）只有强度与颜色两个参数**，这是刻意的：它们是场景**响应
事件**时会变的量（"报警 → 聚光灯变亮变红"）。锥角、衰减、阴影质量是创作期决定，属于文档，
不属于规则。想加进来 = 改冻结清单 = 触发分诊 Q3。

颜色字段用 `type: 'string'` 而不是取色器：`FieldDescriptor` 是 §4.4 的封闭六种，规则编辑器
只渲染这六种。加一种 `'color'` 等于同时改规范和改规则编辑器——而 v0.5 的整个主张就是新增
动作两样都不用改。格式由 zod 的 `#rrggbb` 校验在动作跑起来之前挡住。

**`playMedia` 的三条边界都立即 resolve**，各有各的理由，都有测试：

- **`loop: true`** —— 循环的音频没有"播完"，await 它等于把 sequence 永远挂住。与
  `playAnimation` 是同一条边界（D6），任务卡把它标成"必测"。
- **`durationS` 缺失** —— 导入时浏览器没肯报时长（T-160）。不知道要等多久，而编一个数字
  等于把 sequence 挂在没人量过的值上。resolve + warn。
- **浏览器拒绝自动播放** —— 在 `ctx.playMedia` 内部处理，resolve 而不是 reject（风险 V3）。
  reject 会中断整条链：「响完铃再弹面板」变成「铃没响，面板也没弹」，用户看到的不是少了
  一个声音，而是**什么都没发生**。

**`stopMedia` 的 `mediaId` 用 `type: 'string'` 而不是 `ref`**：`'all'` 是合法值而媒体选择器
提供不了它。与 `setLight` 的颜色同一笔交易——`FieldDescriptor` 是 §4.4 的封闭六种，新增动作
不许加宽它。另外 `'all'` **不贡献引用**，否则每个用了它的场景都会被完整性检查报成"引用了
不存在的媒体 all"。

`playMedia` 的 `refKind: 'media'` 从 v0 起就在 `FieldDescriptor` 里——规则编辑器**零改动**
长出这个表单，这是 C5 的验收证据之一。

### 4.3 一个完整的动作定义示例

**agent 应完全照抄这个形状实现其余动作。**

```ts
// packages/core/src/eca/actions/animation.ts
const PlayParams = z.object({
  animationId: Id('anm'),
  await:   z.boolean().default(true),
  restart: z.boolean().default(true),
})

registerAction({
  type: 'playAnimation',
  schema: PlayParams,
  async handler(ctx, p, signal) {
    if (p.restart) ctx.stopAnimation(p.animationId, { reset: true })
    const done = ctx.playAnimation(p.animationId, { signal })
    if (p.await) await done
  },
  ui: {
    label: '播放动画', group: 'animation', icon: 'play',
    fields: [
      { key: 'animationId', type: 'ref', refKind: 'animation', label: '动画', required: true },
      { key: 'await',   type: 'boolean', label: '等待播放完成再执行下一步', default: true },
      { key: 'restart', type: 'boolean', label: '若正在播放则从头开始',     default: true },
    ],
  },
  refs: p => [{ kind: 'animation', id: p.animationId }],
  describe: (p, doc) => {
    const a = doc.animations.find(x => x.id === p.animationId)
    return `播放动画「${a?.name ?? p.animationId}」${p.await ? '（等待播完）' : ''}`
  },
})
```

### 4.4 FieldDescriptor

规则编辑 UI 靠这个描述生成表单。类型集合是封闭的：

```ts
type FieldDescriptor =
  | { key: string; type: 'ref'; refKind: 'node'|'material'|'animation'|'hotspot'|'viewpoint'|'variable'|'media'
      label: string; required?: boolean }
  | { key: string; type: 'number';  label: string; min?: number; max?: number; step?: number; default?: number }
  | { key: string; type: 'boolean'; label: string; default?: boolean }
  | { key: string; type: 'string';  label: string; multiline?: boolean; default?: string }
  | { key: string; type: 'enum';    label: string; options: Array<{ value: string; label: string }> }
  | { key: string; type: 'valueExpr'; label: string }        // 常量 / 变量 / 事件载荷 三选一
```

`type: 'ref'` 的字段，UI 渲染成一个下拉 + "在视口中拾取"按钮。这一个字段类型撑起了绝大多数动作的编辑体验。

---

## 5. 执行器

### 5.1 语义

```ts
export async function execute(
  rule:   Rule,
  ctx:    RuntimeContext,
  event:  RuntimeEvent,
  signal: AbortSignal,
): Promise<ExecResult>
```

**sequence**：逐个 await。任一动作抛错 → 按 `rule.onError`（`abort` 默认 / `continue`）处理。每个动作执行前检查 `signal.aborted`，已取消则立即返回。

**parallel**：`Promise.allSettled` 全部动作。`onError: 'abort'` 时，首个 reject 触发本规则的 abort（取消其余）；`continue` 时收集错误继续。

### 5.2 重入（MVP 规划 D9 · 技术方案未覆盖，必须实现）

引擎为每条规则维护一个执行槽 `Map<ruleId, { controller: AbortController; promise: Promise<void> }>`。

| `reentry` | 行为 |
|---|---|
| `restart`（默认） | abort 上一次，立即开始新的一次 |
| `ignore` | 上一次仍在跑 → 丢弃本次触发（记一条 debug 日志） |
| `queue` | 排入队列，上一次结束后开始。队列上限 8，溢出丢弃最旧的并 warn |

**不处理重入的后果**：用户连点三下，三条 sequence 交叠执行，动画和变量互相打架，且极难复现——典型的"演示的时候才出现"的 bug。

### 5.3 取消语义

- `AbortSignal` 逐级向下传：规则 → 动作 → `ctx.playAnimation` / `ctx.wait`；
- 被取消的动画**停在当前帧**，不自动回到起点（回起点会造成视觉跳变）；
- 被取消导致的 `animationEnd` 事件，`completed` 为 `false`。规则可以据此区分"播完了"和"被打断了"；
- 取消不算错误：`AbortError` 由执行器吞掉，不进 `onError` 流程，不产生用户可见的报错。

### 5.4 执行结果

```ts
type ExecResult = {
  ruleId: string
  status: 'completed' | 'aborted' | 'failed' | 'skipped-condition' | 'skipped-reentry'
  startedAt: number; endedAt: number            // ctx.now()
  steps: Array<{ index: number; action: string; status: 'ok'|'failed'|'skipped'; error?: string }>
}
```

`ExecResult` 是三样东西的共同数据源：规则调试面板（T-093）、parity 测试的比对轨迹（T-103）、验收用例的执行记录（§8）。所以它必须完整且确定性——**不含时间戳之外的任何非确定性字段**。

---

## 6. RuntimeContext

这是引擎与渲染层之间**唯一的接缝**（宪法 C8 的技术基础）。

```ts
export interface RuntimeContext {
  // ---- 变量 ----
  getVar(id: string): VarValue
  setVar(id: string, v: VarValue): void          // 内部负责发 variableChange

  // ---- 场景 ----
  isVisible(nodeId: string): boolean
  setVisible(nodeId: string, v: boolean, opts?: { includeDescendants?: boolean }): void
  setMaterial(nodeId: string, materialId: string | null): void
  highlight(nodeId: string, preset: string | null, opts?: { includeDescendants?: boolean }): void
  getNodeProp(nodeId: string, key: string): VarValue
  resetScene(): void
  /** v0.5 · 目标非灯节点时 skip + error（同 B9）；resetScene 会还原它改过的值（B13） */
  setLight(nodeId: string, patch: { intensity?: number; color?: string }): void

  // ---- 媒体（v0.5） ----
  /** 开始播放后即 resolve；等到播完是**动作**的事（D19）。浏览器拒绝自动播放时也 resolve（V3） */
  playMedia(id: string, opts: { loop?: boolean; volume?: number; signal?: AbortSignal }): Promise<void>
  /** `'all'` 是退出预览时调的那个（B13 扩展：离开预览必须静音） */
  stopMedia(id: string | 'all'): void
  isMediaPlaying(id: string): boolean
  /** v0.5 · 片段真的播完时 resolve；与 `wait(durationS)` 竞速构成 D19 的「先到者为准」。
      **未在播放（含 V3 自动播放被拒）永不 resolve，由时钟决定**；headless 同理（ADR-0019） */
  waitForMediaEnd(id: string, signal?: AbortSignal): Promise<void>

  // ---- 动画 ----
  playAnimation(id: string, opts: { signal?: AbortSignal }): Promise<void>
  stopAnimation(id: string, opts?: { reset?: boolean }): void
  seekAnimation(id: string, time: number): void
  isAnimationPlaying(id: string): boolean

  // ---- 相机 ----
  moveCamera(viewpointId: string, opts: { duration?: number; signal?: AbortSignal }): Promise<void>

  // ---- UI ----
  openPanel(hotspotId: string): void
  closePanel(hotspotId: string | 'all'): void
  isPanelOpen(hotspotId: string): boolean
  openLink(url: string, target: '_blank' | '_self'): void

  // ---- 时间（必须可注入，见约束三）----
  now(): number
  wait(ms: number, signal?: AbortSignal): Promise<void>

  // ---- 观测 ----
  readonly doc: SceneDocument
  emit(event: RuntimeEvent): void
  log(level: 'debug'|'warn'|'error', msg: string, data?: unknown): void
}
```

**两个实现**：

- `SceneRuntime implements RuntimeContext` —— 生产环境，操作真实 three 对象；
- `HeadlessRuntime implements RuntimeContext` —— 纯 JS，用 Map 记录状态，假时钟，动画用"到时间就 resolve"模拟。

**接口没有 `getLight` 之类的读取方法**，但契约测试仍然逐项比对两侧的灯光状态：读取器由
**契约测试的 harness** 提供，两侧各自暴露自己的状态，跑同一批断言。理由是冻结清单
（进化规划 §4.3）只有 `setLight` 与三个媒体方法；为了测试方便去加宽一份冻结清单，冻结
就不再有意义。

> **一处已知的维护陷阱**：`engine.ts` 的 `withCurrentEvent` 是手写的逐方法委托，所以
> **每新增一个 RuntimeContext 方法都必须改 `engine.ts`**——哪怕新方法与任何动作类型都
> 无关。C5 的实质（引擎里不出现 `if (action.type === …)`）没有被破坏，但 v0.5 每卡纪律
> 里"engine.ts diff 必须为空"这条对本节强制的四个新方法字面上不可满足。已登记进
> IMPL_NOTES §4，并给出修法（改为 Proxy 委托，不再需要逐方法列表）。

两者**必须共用同一套接口一致性测试**：写一个 `describeRuntimeContract(makeCtx)` 测试套件，两个实现各跑一遍。否则 HeadlessRuntime 会慢慢和真实行为漂移，测试全绿但产品是坏的——这是这类架构最隐蔽的失效方式。

---

## 7. 引擎生命周期

```ts
export class EcaEngine {
  constructor(ctx: RuntimeContext)
  attach(doc: SceneDocument): void       // 建 rulesByEvent 索引，注册变量默认值
  detach(): void                         // abort 全部在跑的规则，清定时器
  onDocumentPatch(patches: Patch[]): void // 编辑器改了规则/变量时增量更新索引
  dispatch(event: RuntimeEvent): void    // 事件入口
  setEnabled(v: boolean): void           // 编辑模式关、预览模式开
  readonly history: ExecResult[]         // 调试面板与 parity 测试用，环形缓冲，上限 500
}
```

### 编辑模式 vs 预览模式

**编辑模式下引擎 `enabled = false`**：点击节点是"选中"，不是"触发规则"。否则用户没法编辑一个配了点击交互的物体。

预览模式：`enabled = true`，且进入时执行一次 `resetScene()` + 变量恢复默认值 + `dispatch(sceneReady)`。退出预览时同样 reset —— **预览不许污染编辑态**，这是很容易漏掉且用户一定会遇到的问题。

---

## 8. 规则表 → 验收用例（技术方案 R14）

```ts
export function generateTestCases(doc: SceneDocument): TestCase[]

type TestCase = {
  id: string           // 'TC-RL-001'
  title: string        // 规则名
  precondition: string // 由 if 条件的 describe 拼成
  steps: string[]      // ['在场景中点击「阀盖」']
  expected: string[]   // 由每个 action 的 describe() 拼成
  ruleId: string
}
```

导出为 Markdown 表格，即《附件C 验收测试用例》的骨架。非交互类功能（导入、发布、出图）的用例人工补充。

**收益**：规则表每增一条，验收文档自动多一条，且措辞与实际行为严格一致。技术方案 §5.1 给验收材料预留了 4 人日，这个生成器能吃掉其中相当一部分，同时消灭"文档写的和实现不一致"这个验收现场最尴尬的问题。

---

## 9. 测试要求（宪法 C8 的落地）

### 9.1 硬门槛

- **每个已注册动作至少一条单测**，覆盖率门槛设为 100%（`allActions()` 遍历比对测试清单，缺失直接 fail —— 这样新增动作忘了写测试会立刻暴露）；
- ECA 全部单测在**纯 Node 环境**运行，不加载 jsdom、不加载 canvas；
- 假时钟，单次测试套件耗时 < 2s。

### 9.2 必须覆盖的边界

| # | 场景 | 断言 |
|---|---|---|
| B1 | sequence 中 `await: true` 的动画 | 后续动作在动画结束之后才执行（用假时钟推进验证） |
| B2 | `loop: true` 的动画 + `await: true` | **立即 resolve，不挂起**（否则序列永久卡死） |
| B3 | `reentry: 'restart'` 连续触发 3 次 | 只有最后一次跑完，前两次 `status: 'aborted'` |
| B4 | `reentry: 'ignore'` 连续触发 | 后续为 `skipped-reentry` |
| B5 | `reentry: 'queue'` | 严格串行，顺序与触发顺序一致 |
| B6 | 条件类型不匹配（`"2"` vs `2`） | 求值 false + 一条 warn，不抛异常 |
| B7 | 动作抛错 + `onError: 'abort'` | 后续步骤 `skipped`，`status: 'failed'` |
| B8 | 动作抛错 + `onError: 'continue'` | 后续步骤照常执行 |
| B9 | 规则引用了已删除的 nodeId | 不崩溃，记 error 日志，该动作 `skipped` |
| B10 | `variableChange` 事件中 `setVariable` 同一变量 | **两道各自独立的防线**：① 同步连锁深度上限 **16**（`MAX_CHAIN_DEPTH`），越限则中止本次分发 + error；② 每个变量每 **1 秒**变化上限 **240 次**（`ChurnGuard`，`CHURN_WINDOW_MS` / `CHURN_LIMIT`），越限则中止本次分发 + error |
| B11 | `detach()` 时有规则在跑 | 全部 abort，无悬挂 Promise，无泄漏定时器 |
| B12 | parallel + 首个失败 + `abort` | 其余动作收到 abort |
| B13 | 退出预览模式 | 变量、可见性、transform、材质、**灯光参数（v0.5）** 全部回到进入前的编辑态 |
| B14 | `{ event: 'nodeId' }` 值表达式 | 在 `target: { any: true }` 的规则中拿到正确的节点 |

**B10 值得单独说**：变量变化触发规则、规则又改变量，是最容易写出无限循环的地方，而且它在编辑器里表现为整个页面卡死。必须有硬性上限。

**为什么是两道而不是一道**（T-204 / [ADR-0029](adr/0029-变量变化的跨-await-循环防线.md)）：`MAX_CHAIN_DEPTH` 数的是 `dispatch` 的**同步嵌套深度**，而这个数只在整条链同步时才等于「链有多长」。规则的 `then` 里只要出现一个 `await`（`wait` / `playAnimation(await:true)` / `playMedia` / 任何返回 Promise 的动作），那次 `dispatch` 就已经返回、`chainDepth` 已经减回去，下一跳是从干净的栈上重新进来的，深度永远是 1。**实测**：两条互写变量的规则夹一个 `wait(1ms)`，跑到第 480 跳仍然零告警不收敛；去掉 `wait` 的对照组恰好在第 16 层报一条。所以第二道防线的判据刻意**不看调用栈**，只问「这个变量在过去 1 秒里变了多少次」——这个问题对同步环和带 await 的环给出同一个答案。

**明确接受的代价**：它**只拦失控环，不拦慢环**。每秒 239 次的环不会被拦住——它不是失控，它是慢。240 这个数字是手算的（16 ms 一帧 × 每帧至多 4 次写），**不是实测的**（G0.5-8 未闭合），撤销条件见 ADR-0029。

### 9.3 Parity 测试（宪法 C3 的验证 · MVP 规划 G0-4）

```
给定：golden-path.json + 一串固定输入事件
执行：Editor 预览侧跑一遍，Player 侧跑一遍
断言：两侧 EcaEngine.history 的 ExecResult 序列逐项相等
      （比对 ruleId / status / steps；时间戳因假时钟一致故也应相等）
```

这是"编辑器里是这样、发布出来不一样"（技术方案 §1.1）这个验收灾难的唯一自动化防线。**它跑不通就说明 C3 被违了，停下来修架构，不要继续加功能。**

---

## 10. 新增一种动作的完整清单

**这是北极星 §7"新增动作所需改动文件数 ≤ 3"的操作定义。** agent 每次加动作按此执行：

1. 在 `actions/<group>.ts` 里写一个 `registerAction({...})`（含 `schema` / `handler` / `ui` / `refs` / `describe` 五项，缺一不可）；
2. 若需要新的运行时能力，在 `RuntimeContext` 加方法，并在 `SceneRuntime` 与 `HeadlessRuntime` 两侧都实现；
3. 在 `actions/<group>.test.ts` 加至少一条单测。

**结束。** 不改 `executor.ts`，不改 `engine.ts`，不改规则编辑器组件，不改 schema。

如果你发现必须改上述任何一个文件，**停下来**——这说明抽象漏了一块，按北极星 §4 的分诊 Q4 处理：先写 ADR，不要直接动手。

> **T-211 更正**：本节此前写的是「未在播放（含 V3 自动播放被拒）**立即 resolve**」，
> 而两个运行时都返回 `neverEnds`。裁决**改规范、不改实现**，理由是实现那边已经有人算过账：
> 浏览器拒绝自动播放时，什么都没在播，于是「响完」这件事**没有发生**，而不是「已经发生过了」。
> 立即 resolve 会让 `await: true` 当场返回，规则的下一步立刻触发，作者编排的节奏整个塌掉——
> 一个音频被拦的场景会在**静音之外**再多坏一种、且更难解释的方式。
> T-186 试过那条路并把理由写进了 `media-bus.test.ts`，**是 parity 的自检把它抓出来的**
> （当时两侧没有分叉，两侧一样错）。`spec-parity.test.ts` 的 ② 组钉住现在这条语义。
