# ADR-0028 · `RefKind` 注册表化：把「新增一种引用类型」从 Q4 降级

- 状态: **Accepted**
- 日期: 2026-08-03
- 相关宪法条款: **C5**（扩展靠注册表，不靠改引擎）· NORTH_STAR §4（分诊四问的 Q4）· ECA_SPEC §10（三文件法）
- 承接卡: **T-203**
- 同构先例: [ADR-0018](0018-withCurrentEvent-改用-Proxy-委托.md)（`engine.ts` 的逐方法委托改 Proxy）

## 背景

今天「一种引用类型」这件事的知识被**穷尽 switch** 存在两个地方，而这两个地方分处两个包：

| 位置 | 函数 | 形态 |
|---|---|---|
| `packages/core/src/eca/executor.ts:23` | `refExists(index, kind, id)` | `switch (kind)`，七个 case |
| `packages/editor/src/rule-editor/ActionFields.tsx:256` | `refOptions(doc, kind)` | `switch (kind)`，七个 case |

于是**加一种引用类型 = 同时点亮 `executor.ts` 与规则编辑器**。而这两个文件正是 [ECA_SPEC](../ECA_SPEC.md) §10 明令不许改的那两个：

> §10 三文件法：新增一种交互能力 = 改 3 个文件，**不改 `executor.ts` / `engine.ts` / 规则编辑器**。

按 NORTH_STAR §4 的分诊，这是 **Q4（需要改 core 架构 / 执行器）= 【停】不许直接动手**。也就是说，今天这个仓库里「加一种引用类型」这件事的定价是**重新计价 + 变更单**，而它的实际工作量是往两个 switch 里各加一个 case。

v1.2 的 T-302 要加四种（`flow` / `step` / `page` / `dataSource`）。四次 Q4。

**还有一层，比上面那层更要紧**：C5 的守卫今天**看不见这个形状**。`check-core-purity.mjs` 的两条 `EXECUTOR_SMELLS` 正则都要求判别式前面有一个 `.`：

```
/\bswitch\s*\(\s*[\w.]*\.\s*(action|type|kind)\s*\)/
/\.\s*(action|type|kind)\s*===\s*['"]/
```

而 `executor.ts:24` 是**裸 `switch (kind)`**——两条正则一条都不匹配。所以：**C5 的执行器无分支检查，对本仓库执行器里唯一真实存在的那个 switch，是失明的。**

## 选项

### 选项 1 · 维持现状，每次扩容各改两处 switch，靠 ADR 逐次放行

- **收益**：零结构改动；每次扩容的 diff 最小且最直白。
- **代价**：把一个 0.1 人日的动作永久钉在 Q4 的价签上。更实际的问题是它训练出错误的直觉——`executor.ts` 每个版本都被改一次，「不许改 executor」这条规矩会先在心里失效，再在代码里失效。NORTH_STAR §7 的指标表要求如实记「新增一个动作所需改动文件数」，而这条路让「新增一种 ref 种类」永远是 8。

### 选项 2 · 穷尽 `Record<RefKind, RefKindSpec>` 注册表（**采纳**）

- **做什么**：新建 `packages/core/src/eca/ref-kinds.ts`，导出 `REF_KINDS: Record<RefKind, RefKindSpec>`，每项含 `label`（中文）/ `exists(index, id)` / `options(doc)` / `expectTypeOf?(index, id)`。`executor.ts` 的 switch 换成一次 `REF_KINDS[kind].exists(...)`；`ActionFields.refOptions` 改查同一张表。
- **收益**：扩容变成「往一张表里加一行」，`executor.ts` 与规则编辑器 diff 为 0 —— 分诊从 Q4 降到 **Q2（新增注册项，0.3–1 人日）**。用 `Record` 而不是数组：漏一种是**编译错误**，不是运行时 `undefined`。
- **代价**（见下）。

### 选项 3 · 把 `refExists` 收进 `DocIndex`（`index.has(kind, id)`）

- **收益**：`executor.ts` 同样不再有 switch，且不新增文件。
- **代价**：`refOptions` 的另一半留在编辑器里没人管，扩容仍要改规则编辑器——只解决了一半，而两半是同一份知识。且它把「引用类型」这个 ECA 概念推进 `@w3/schema`，schema 不该知道 `RefKind` 是什么（它今天确实不知道：`RefKind` 定义在 `eca/types.ts`）。

## 决定

**采纳选项 2。**

1. `ref-kinds.ts` 是这份知识在全仓的**唯一落点**。`REF_KINDS` 用穷尽 `Record<RefKind, RefKindSpec>`，漏一种即编译错。
2. `executor.ts` 在本卡的 diff **只允许有一处 import 与一处调用替换**，不含任何 switch。**这是买断，不是违规**——本 ADR 就是这次买断的授权，v1 全程 `executor.ts` 此后 diff 必须为 0。
3. **同批把守卫补齐。** 给 `check-core-purity.mjs` 的 `EXECUTOR_SMELLS` 加两条**只对 `executor.ts` 生效**的正则：`/\bswitch\s*\(/` 与 `/\bcase\s+['"](node|material|animation|hotspot|viewpoint|variable|media|flow|step|page|dataSource)['"]/`。**不补这一条，v1.2 的 T-302 那条关键变异（「在 executor.ts 里手写一个 `case 'step'` → 守卫必须红」）按今天的实现是绿的**，而那条变异是本决定「真的把 Q4 降级了」的唯一可执行证据。
4. **本卡不新增任何 `RefKind`。** 只做结构改造。四种新的由 v1.2 的 T-302 加；`'scene'` 按 A3(b) **永不进 `RefKind`**，走 v1.5 T-432 的 `FieldRefKind` + 宿主注入。

## 代价

1. **`@w3/editor` 从此为了一个下拉框依赖 `@w3/core` 的一张表。** 依赖方向没有被违反（editor 本来就允许依赖 core），但耦合是真的：`refOptions` 的返回形状 `{id, name}` 现在是 core 的公开契约，改它要动两个包。
2. **`options(doc)` 让 `ref-kinds.ts` 同时认识 `DocIndex` 和 `SceneDocument`。** 一张表承担了「运行时查存在」与「编辑期列选项」两件事，它们的消费者在两个包、两个时刻。合起来的理由是**它们是同一份知识**（"哪些东西可以被引用"），拆开的代价刚刚论证过。但要如实记：**这张表因此不是纯运行时的**，未来若 core 要瘦身，它是第一个要被重新切分的东西。
3. **第 3 条的两条新正则只对 `executor.ts` 生效，是一条白名单。** 它挡不住有人把同样的 switch 写进 `dispatch.ts` 或一个新文件。挡住那个需要的是「ECA 目录下任何文件都不许 switch on kind」，而那条会误伤 `ref-kinds.ts` 自己和 `actions/` 下的合法分支。**取舍是：窄而准，不是宽而吵。**
4. **降级是结构上的，不是自动的。** 「加一种 RefKind 现在是 Q2」这句话成立的前提是新种类真的只需要 `exists` / `options` 两个函数。如果某种引用需要执行器在别处也认识它（例如需要一条新的跳过语义），它仍然是 Q4，而这张表会让人误以为不是。**T-302 落地时必须逐项对照这一条。**

## 撤销条件

- **出现一种引用类型，`exists` / `options` / `expectTypeOf` 三个钩子表达不了它。** 那说明 `RefKindSpec` 的形状猜错了，应当先扩钩子而不是在 `executor.ts` 里开一个特例——出现第二个特例时回来重开本条。
- **`@w3/core` 需要与 `@w3/editor` 解耦**（例如 core 单独发包给第三方）。此时 `options(doc)` 那一半应当移出 core，本条的代价第 2 项到期。
- **第 3 条的两条正则开始产生误报**，导致有人给 `executor.ts` 加 `eslint-disable` 式的豁免。豁免出现的那一刻，守卫的价值归零，应当改为「executor.ts 行数上限 + 人工评审点名」这类更粗但不会被绕过的判据。
