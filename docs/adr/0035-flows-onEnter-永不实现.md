# ADR-0035 · `flows[].steps[].onEnter`：字段保留，永不获得运行时

- **状态**：Accepted
- **日期**：2026-08-04
- **任务卡**：T-225 · schema v3 主卡（冲突登记 **X-14**）
- **相关**：[ADR-0020](0020-v1-拆成三级台阶.md)（v1 的三级台阶）· [SCHEMA_V3_FREEZE.md](../SCHEMA_V3_FREEZE.md) §1.5 · ECA_SPEC §4 · 铁律 12（先 ADR 后实现）

---

## 背景

`FlowStepSchema` 从 v0 起就带一个 `onEnter: z.array(ActionSchema).default([])`。它的意思一望
即知：**进入这一步时执行这些动作**。

它从来没有被执行过一次。v0 / v0.5 / v1.0 的引擎里，没有任何一处读它——`grep -rn "onEnter"
packages/core/src` 只命中 schema 的类型再导出。它是一个躺了两个版本的**字面承诺**。

T-225 把 `flows` 从 `deferred.ts` 搬进 `flow.ts`、给它加上 `startStepId`、把 `variableId`
收紧成 `VariableIdSchema`——也就是说，**v1.0 第一次让这个集合看起来像是要通电了**。于是
「`onEnter` 什么时候实现」必须现在有答案，否则 v1.2 做编排时它会以「原来早就有这个字段，
接上就行」的姿态出现，而它接不上。

## 为什么接不上

不是排期问题，是**签名问题**。ECA 的执行入口是

```ts
execute(rule: Rule, ctx: RuntimeContext, event: RuntimeEvent): Promise<void>
```

它收的是一条 **`Rule`**，不是一个 `Action[]`。整条链路——重入策略（`restart` / `ignore` /
`queue`，按 `rule.id` 归组）、`onError` 模式、执行模式（`sequence` / `parallel`）、
`AbortSignal` 的归属、日志里的规则名——全部挂在 `Rule` 上，没有一样能从裸的 `Action[]` 推出来。

要让 `onEnter` 跑起来，只有两条路：

1. **给 `executor.ts` 加一个收 `Action[]` 的第二入口。** 这直接撞上铁律 5 与北极星 §4 的
   Q4：「需要修改 `executor.ts` / `engine.ts` 才能实现某个动作」是必须停下来问人的情形。
   而且第二入口一旦存在，重入与 onError 就有了两套语义，两套都要测、都要在编辑器里解释。
2. **把 `onEnter` 在运行时合成一条匿名 `Rule`。** 那条合成规则的 `id` 从哪来？用户在规则
   列表里看不见它，却能观测到它的副作用；它的重入策略是什么，谁改；报错时日志里显示什么。
   这是把一个隐藏的规则系统埋进流程系统里。

## 决定

**`flows[].steps[].onEnter` 的形状保留，但永不获得运行时。**

- 字段留在 schema 里（删它要 bump，而 v1 的 bump 已经用完，见 [ADR-0020](0020-v1-拆成三级台阶.md) 决定第 1 条）；
- `.describe()` 改成中文的 **「v1 未实现 —— 步骤动作请用 flowStepEnter 规则」**，让读 schema
  的人第一眼看到替代路径；
- 完整性检查 **I49**：`onEnter` 非空时报 **warn**（不是 error——C4：一份能打开的文档永远要能打开）；
- 想在进入某一步时做事，**写一条 `flowStepEnter` 规则**。v3 已经为此把这个事件冻进
  `EVENT_TYPES`（8 → 11），载荷里带 `flowId` 与 `stepId`。

这不是把功能砍掉，是把它**换了个入口**：同一件事由规则系统做，而规则系统本来就有重入、
有 onError、有日志、有编辑器界面。

## 代价

**老文档里已经配置的 `onEnter` 动作不会被执行，只报 warn。**

今天这个代价是零——没有任何一份文档配置过它（`pages` / `flows` 在 v1 与 v2 的 fixture 里
全空，实测 0 条）。但这条代价是真的，且随时间增长：如果哪个客户在 v1.2 之后手工编辑过
文档往 `onEnter` 里塞了动作，他会看到一条 warn 而不是一个报错，然后什么都不发生。

warn 而不是 error 是刻意的，理由见上：C4 优先于「早点让他发现」。**I49 的文案必须直接写出
替代路径**，否则这条 warn 只是告诉用户「你错了」而不告诉他该怎么做。

次要代价：schema 里留着一个永远为空的数组字段，每份文档多几个字节，读 schema 的人多一次
「这是什么」的疑问——`.describe()` 就是为这次疑问准备的。

## 撤销条件

**v2 若决定实现步骤动作，必须先解决「`execute()` 入参是 `Rule` 不是 `Action[]`」这条 Q4。**

具体地，撤销这条 ADR 的前置条件是下面两件事**至少完成一件**，且各自走完一次 Q4 分诊：

1. `executor.ts` 的入口重构成收「一个带 id 的可执行单元」，`Rule` 与 `FlowStep` 都是它的
   一种——重入与 onError 的归组键从 `rule.id` 换成那个单元的 id；
2. 明确接受「合成匿名 Rule」的全部后果，并给合成规则一套**用户可见**的表示：编辑器里能看到
   它、日志里能认出它、重入策略有地方配。

在此之前，任何「顺手把 `onEnter` 接上」的改动都是把这条 ADR 作废而不承认。
