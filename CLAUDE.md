# CLAUDE.md · 工程铁律

> **部署说明**：这份文件属于代码仓，不属于规划目录。创建代码仓时把它复制到**仓库根目录**，Claude Code 每次会话会自动读取它。

---

## 项目是什么

Web 3D 工具引擎（当前版本 v1.0）。一句话：**把"三维资产 + 交互逻辑"表达为一份可版本化的 JSON 文档，编辑器和播放器只是这份文档的两种视图。**

v0（底座打穿）与 v0.5（表现力与体验）已完成。**当前活动版本是 v1.0「地基与表现力」**：六张地基卡与 v0/v0.5 债务清偿 · schema v3 一次性冻结 · 描边与雾 · 爆炸视图与剖切平面 · 渲染出图 · 播放器嵌入 SDK · 泵组样板工程 · 项目层（新建 / 列表 / 重命名 / 删除）· 编辑器三条打磨。原「v1 合同交付」经 [ADR-0020](docs/adr/0020-v1-拆成三级台阶.md) 拆成 **v1.0 → v1.2「编排与复用」→ v1.5「合同交付」**三级台阶。

**"v1"从此是歧义词**：合同语境里指 18 项功能全部交付（= v1.5），工程语境里必须补出是哪一级。写"v1"而不补级别，按缺陷处理。

v1.0 的定义是三个词：**能演示、能卖、能被嵌进别人的系统**。目标仍是把能力"长在底座上"，不是把功能做全。**看到一个"顺手也能做"的功能时，先查 [docs/MVP_V1_进化规划.md](docs/MVP_V1_进化规划.md) §1.2 的 Out of Scope 清单**（历史清单：v0.5 在 [docs/MVP_V0_5_进化规划.md](docs/MVP_V0_5_进化规划.md) §1.2，v0 在 [docs/MVP_V0_孵化规划.md](docs/MVP_V0_孵化规划.md) §1.2；三份都查不到 → 走北极星 §4 分诊四问）。

⚠ **G0.5-8（目标机器 benchmark）尚未闭合**，经 [ADR-0022](docs/adr/0022-G0.5-8-目标机器-benchmark-的挂载方式.md) 改挂为 **v1.0 的出口门槛**（v1 规划 §7.2 的 H1）。这是 NORTH_STAR §8 的一次显式破例，到期版本号 `v1.0`。**因此：三个默认值（设备像素比封顶 / 剖切平面上限 / 描边预设上限）现在都是拍的，不是测的**——碰到它们时不要当成实测结论引用。

## 必读文档（按顺序）

| 文档 | 什么时候读 |
|---|---|
| [docs/V1_KICKOFF.md](docs/V1_KICKOFF.md) | **新会话第一件事**。v1 点火指令的唯一权威（规划 §9 的同名代码块已被它取代，别照那个执行）· 仓库现状与文档不一致的四处 · 批次报告模板 |
| [docs/NORTH_STAR.md](docs/NORTH_STAR.md) | 开工前。九条宪法任何情况下不得违反 |
| [docs/MVP_V1_进化规划.md](docs/MVP_V1_进化规划.md) | 开工前。v1.0/v1.2/v1.5 范围、Out of Scope §1.2、灰区裁决 §1.3、黄金路径 III–V、设计决策 D21 起、**规范增量 §4（已冻结的逐字 zod 清单）**、验收门槛 §7 |
| [docs/TASK_BACKLOG_V1.md](docs/TASK_BACKLOG_V1.md) | 每次领新任务时。199 张卡 / 222.7 人日 / 36 个波次 |
| [docs/SCHEMA_SPEC.md](docs/SCHEMA_SPEC.md) | 动 `@w3/schema` 或任何文档字段之前（**v1 增量以 v1 进化规划 §4 为准**，按 §4.5 的回写卡回写） |
| [docs/ECA_SPEC.md](docs/ECA_SPEC.md) | 动 `packages/core/src/eca/` 之前 |
| [docs/MVP_V0_5_进化规划.md](docs/MVP_V0_5_进化规划.md) | **历史参考**。v0.5 范围、黄金路径 II、设计决策 D11–D20 |
| [docs/MVP_V0_孵化规划.md](docs/MVP_V0_孵化规划.md) | **历史参考**。v0 范围、黄金路径 I、设计决策 D1–D10 |
| [docs/TASK_BACKLOG_V0_5.md](docs/TASK_BACKLOG_V0_5.md) · [docs/TASK_BACKLOG.md](docs/TASK_BACKLOG.md) | **历史台账，只读**。不许往里加新卡 |

**两份 SPEC 是逐字实现的规范，不是参考建议。** 需要偏离时写 ADR 并停下来问人，不要自行调整字段名或结构。

---

## 包边界（最重要的一条）

```
        @w3/schema  ←──────────────┐
             ↑                     │
        @w3/storage                │
             ↑                     │
        @w3/core  ─────────────────┘
          ↑    ↑
   @w3/editor  @w3/player
```

| 包 | 允许依赖 | **禁止出现** |
|---|---|---|
| `@w3/schema` | `zod` | three、react、任何 DOM API |
| `@w3/storage` | `@w3/schema`、`idb`、`fflate` | three、react |
| `@w3/core` | `three`、`@w3/schema` | **react / react-dom / @react-three/\*** · `@w3/storage` · `indexedDB` · 任何云 SDK |
| `@w3/editor` | 全部 | 直接 `import 'three'` 绕过 core 做场景操作 |
| `@w3/player` | `@w3/core`、`@w3/schema`、`@w3/storage` | 体积超预算的依赖 |

`pnpm check:constitution` 会静态检查这些。**提交前必须跑一次。**

---

## 十二条铁律

### 1 · 状态只进文档
所有可持久化状态在 `SceneDocument` 里。写代码时如果你在组件 state / ref / 模块级变量里存业务状态，**停下来**——它一定会导致撤销失效、发布丢失、播放器不一致三个 bug 一起来。

运行时瞬态（当前播放进度、hover 中的对象、相机实时位置）不进文档，这是唯一例外。

### 2 · 只通过 commit / preview 改文档
```ts
commit('移动 阀盖', d => { d.nodes[i].transform.p = [0, 0.35, 0] })   // 落撤销
preview(d => { ... })                                                  // 不落撤销，拖拽中间态
```
**永远不要**直接 mutate 文档对象，**永远不要**直接改 three 对象的 transform 来"实现"编辑功能。

### 3 · 引用永远用 ID
`nodes.find(n => n.name === '泵体')` 是 bug，不是代码。用 `index.nodeById.get(nodeId)`。名字是给人看的，随时会变。

### 4 · 改 schema = 三件套
`schemaVersion` +1 **且** 一个 `Migration` **且** 一份 fixture。三者缺一不可，没有商量余地。

### 5 · 加交互能力靠注册表
按 [ECA_SPEC.md](docs/ECA_SPEC.md) §10：改 3 个文件，不改 `executor.ts` / `engine.ts` / 规则编辑器。如果发现必须改，说明抽象漏了——写 ADR，停下来问人。

### 6 · ECA 里不许有 GPU、不许有真实时间
禁止 `Date.now()` / `performance.now()` / `setTimeout` / `requestAnimationFrame`，一律走 `ctx.now()` / `ctx.wait()`。ECA 单测跑在纯 Node 环境。

### 7 · 不引外部资源
不引 CDN，不引 Google Fonts，不引任何运行时会发起外部请求的东西。三方运行时资源（Draco decoder、KTX2 transcoder、字体、图标）全部放进 `vendor/` 自托管。内网部署时这条不遵守就是白屏。

### 8 · 存储只见接口
业务代码里不许出现 `indexedDB`、`localStorage`（存业务数据）、`fetch` 到固定端点、任何云厂商 SDK。一切经 `StorageProvider`。

### 9 · 材质写时复制
改任何节点的材质之前，先确认源材质有没有被其他 mesh 共享。共享就 clone。这是 glTF 的常态，不是边界情况。

### 10 · 动作返回 Promise
所有可能耗时的 `RuntimeContext` 方法返回 Promise，并接受 `AbortSignal`。fire-and-forget 会让"播完动画再弹面板"永远做不出来。

### 11 · 增量同步，不全量重建
文档变了 → `runtime.applyPatch(patches)`，不是 `runtime.load(doc)`。全量重建路径只作为兜底存在，且要 `warn` + 计数，E2E 里断言计数为 0。

### 12 · 不静默做假设
规范没写清楚的地方，**先在 `docs/adr/` 写一条 ADR 记录你的选择和代价，再实现**。ADR 的"代价"和"撤销条件"两栏不许留空。

---

## 命名规范

| 对象 | 规范 | 例 |
|---|---|---|
| 文件 | kebab-case | `material-registry.ts` |
| 类型 / 接口 / 类 | PascalCase，接口不加 `I` 前缀 | `SceneDocument`、`StorageProvider` |
| Zod schema 变量 | PascalCase + `Schema` 后缀 | `NodeSchema` |
| 函数 / 变量 | camelCase | `buildIndex`、`remapAssetRefs` |
| 常量 | SCREAMING_SNAKE | `CURRENT_VERSION` |
| React 组件 | PascalCase，文件同名 | `HierarchyTree.tsx` |
| 测试 | 与被测文件同名 + `.test.ts` | `executor.test.ts` |
| ID 前缀 | 见 [SCHEMA_SPEC.md](docs/SCHEMA_SPEC.md) §2 | `nd_` `mat_` `rl_` |

**面向用户的字符串一律中文**（层级树、属性面板、报错提示、体检建议）。代码标识符、注释、日志一律英文。

---

## 每张任务卡的 DoD

不满足全部条目的任务卡不算完成：

- [ ] 实现符合对应 SPEC 的字面描述，没有自由发挥
- [ ] `pnpm check:constitution` 通过
- [ ] `pnpm -r typecheck` 通过（`strict: true`，**零 `any`**，确实必要时用 `unknown` + 类型守卫）
- [ ] `pnpm -r lint` 通过
- [ ] 该卡列出的自测命令通过
- [ ] 新增的公共 API 有 JSDoc（一句话说清它做什么、什么时候用）
- [ ] 涉及 ECA 动作的，单测已加（否则覆盖率门槛会 fail）
- [ ] 涉及 schema 变更的，三件套齐（铁律 4）
- [ ] 有 ADR 需求的，ADR 已写
- [ ] 在当前版本任务台账（[docs/TASK_BACKLOG_V1.md](docs/TASK_BACKLOG_V1.md)）里把该卡标为 `[x]` 并回填实际耗时

---

## 协作节奏（怎么跟我打交道）

> 这一节管的是**你和我之间的交互方式**，不是工程约束。它与下面「什么时候必须停下来问人」
> 是一对：那一节列的是**必须停**的少数情况，这一节说的是**其余时候不要停**。

### 1 · 步子要大：一轮至少 10 ~ 15 张卡

v1 有 199 张卡，这代进化要跑很多轮。**不要做完一张卡就回来汇报等指令。**

- 默认批量：**一轮连续做 10 ~ 15 张卡**（按台账 §1 的波次表取，优先取同一波次或同一里程碑内的连续段）。
- 卡与卡之间**不要中途请示**。单张卡的自测绿了就继续下一张，把汇报攒到批次结束。
- 只有下面两类情况才允许在批次中途停：**① 触发了「什么时候必须停下来问人」八条中的任何一条；
  ② 台账里写死的阀门**（T-206 之后 · T-225 单卡波次 · 各里程碑收尾的 `milestone-close`）。
  除此之外遇到的问题**自己判断、自己往下走**，把判断写进提交信息或 ADR，批次末尾一并汇报。
- 中途卡住某一张时，**不要停整批**：跳过它、继续做批次里不依赖它的卡，把被跳过的卡与原因
  记在批次报告里。

### 2 · 不确定时给我出选择题，不要开放式提问

需要我定方向时，**不要问「你觉得该怎么办」**，给我 **2 ~ 4 个具体选项**，每个选项写清：

- 它具体做什么（一句话，落到文件/字段/命令级）
- **代价**（人日、风险、以后要还的债）
- 哪个是你的推荐，以及为什么

一次可以出多道题。**技术裁决你自己拍板，别做成选择题**——出给我的应该只有三类：
改宪法 / 版本阶梯的 · 影响合同措辞的 · 需要外部资源的（例如一台目标机器）。
这三类要**两个选项都写全代价，明确不代我选**。

### 3 · 每批收尾要给下一批的预告

一批做完后，除了汇报做了什么，**还要展望下一批**，固定四行：

```
下一批打算做：T-2xx ~ T-2yy（N 张卡，属 M1x「里程碑名」）
主要内容：一句话
工作量预估：合计 X.X 人日 ≈ Y 小时 agent 时钟（换算见台账附录 C.3）
风险点：这一批里最可能超预估 / 最可能假绿 / 最可能要 ADR 的是哪一张
```

然后**停下来等我一句话**，我会指定这一批是：

| 我说 | 你要怎么做 |
|---|---|
| **精细** | 每张卡的变异检验全跑、E2E 也补上、边界情况逐条列、该写 ADR 的都写。慢没关系 |
| **快速推进** | 走 DoD 的最小闭环（实现 + 自测绿 + 变异检验只跑卡面点名的那一处 + 台账回填），把可延后的登记进 IMPL_NOTES，**但 DoD 一条都不许省** |
| 不说话 / 只说「继续」 | 按你预告的原样做，默认按**精细**处理地基卡与 schema 卡，其余按快速推进 |

⚠ **「快速推进」不是降低门槛**：`pnpm check:constitution` / typecheck / lint / 卡面自测命令 /
变异检验登记 / 台账回填这六项在任何模式下都不许省。它省的是**广度**（补充测试、边界枚举、
文档打磨），不是**下限**。

---

## 提交规范

一张任务卡一个提交。格式：

```
<type>(<scope>): <中文简述>

T-0XX
<可选：为什么这么做，尤其是有取舍的地方>
```

`type`：`feat` `fix` `refactor` `test` `docs` `chore` `perf`
`scope`：`schema` `storage` `core` `eca` `editor` `player` `build` `ci`

例：
```
feat(eca): 实现 sequence/parallel 执行器与三种重入策略

T-083
重入默认 restart。理由见 MVP 规划 D9：用户连点会导致多条 sequence
交叠，状态互相覆盖且难以复现。
```

**不要在一个提交里混多张卡。** 出问题时二分定位的成本会翻倍。

---

## 常用命令

```bash
pnpm install
pnpm dev                 # 起 editor 开发服务器
pnpm dev:player          # 起 player
pnpm -r build
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -F @w3/core test eca          # 只跑 ECA 单测（纯 Node，秒级）
pnpm check:constitution            # C2 / C6 / C7 静态检查
pnpm test:parity                   # 编辑器预览 vs 播放器 一致性
pnpm test:e2e                      # 黄金路径 I / II / III
pnpm size                          # Player 体积预算 gzip ≤ 400 KB
pnpm verify                        # 上面全部，提 PR 前跑
```

**命令名注意**：体积门槛的脚本名是 **`pnpm size`**，不是 `pnpm size-limit`——后者在 `package.json` 里根本不存在，历史文档四处写错，已由 [ADR-0021](docs/adr/0021-撤销-D20-v1.0-引入后处理链.md) 第四条统一订正。**写进文档的每一条命令都要能真的跑起来**，这是 v0.5 留下的教训（一条按字面执行会报"命令不存在"的晋级门槛，等于没有门槛）。

---

## 什么时候必须停下来问人

不要自己拍板，直接停下来汇报：

1. 需要修改 [SCHEMA_SPEC.md](docs/SCHEMA_SPEC.md) 或 [ECA_SPEC.md](docs/ECA_SPEC.md) 的字段定义
2. 需要修改 `executor.ts` / `engine.ts` 才能实现某个动作（触发北极星 §4 分诊 Q4）
3. 需要引入一个规划里没列的第三方依赖
4. 发现某条宪法（C1–C9）挡住了唯一可行的实现路径
5. 任务卡的验收标准与 SPEC 有冲突
6. 一张卡的实际耗时超出预估 2 倍以上
7. Parity 测试（T-103）写不出来或持续不过
8. **任何超出 [docs/MVP_V1_进化规划.md](docs/MVP_V1_进化规划.md) §4 冻结清单的字段 / 动作 / 事件改动**——新增字段、改字段名、改类型、改默认值、加一种事件或动作，只要不在 §4 的逐字 zod 清单里，一律停下来问人

第 7 条尤其重要：它意味着编辑器与播放器已经分叉（宪法 C3），**这时候继续加功能只会让返工面积变大**。

第 8 条同样不许自行放行：schema 在 v1 只 bump 一次（2 → 3，在 v1.0 内完成），§4 的清单**同时冻住了 v1.2 与 v1.5 才消费的全部字段**。**开工后发现漏字段 → 登记 v2，不追加**（[ADR-0020](docs/adr/0020-v1-拆成三级台阶.md) 决定第 1 条）。自己补一个字段进去，就是把唯一一次 bump 变成两次。

---

## 反模式速查

看到这些立刻停手：

| 长这样 | 违反 |
|---|---|
| `object3D.position.set(...)` 出现在编辑器组件里 | 铁律 1、2 |
| 播放器里另写了一份渲染/交互逻辑 | 宪法 C3 |
| `executor.ts` 里出现 `if (action.type === ...)` | 铁律 5 |
| 加了个 schema 字段但没动 `schemaVersion` | 铁律 4 |
| `nodes.find(n => n.name === ...)` | 铁律 3 |
| `<link href="https://fonts.googleapis...">` | 铁律 7 |
| "撤销重做等做完功能再统一加" | 技术方案 §5.2 已明令禁止 |
| 改一个 mesh 的材质，一片 mesh 全变了 | 铁律 9 |
| `RuntimeContext` 方法返回 `void` 但内部是异步的 | 铁律 10 |
| ECA 代码里出现 `setTimeout` | 铁律 6 |
| 先写完功能，测试"以后补" | v0 的晋级门槛全是自动化的，没测试等于没门槛 |
| `packages/player/src` 里出现 `bench/` `embed/` 之外的 diff，且不在 `app.ts` 的装配段 | **C3 验收口径**（下方单列） |

---

## C3 的验收口径（v1 统一，台账 §0 新纪律 7）

「`packages/player/src` diff 必须为空」这条规矩，**v1 有五份领域设计各自开了例外，加起来它什么都拦不住了**。
统一收窄成一句可执行的：

> **除 `bench/` 与 `embed/` 之外的文件，diff 只允许出现在 `app.ts` 的装配段，且必须逐行在提交信息里点名。**

允许的改动行数记进 `docs/METRICS.md`，可趋势观察。**「逐行点名」不是仪式**：一条没被点名的
装配行，与一份被悄悄分叉的播放器，在 diff 上长得一模一样——而 C3 分叉是验收时最丢人的缺陷类型（A2）。

---

## 一句话速查

> 状态进文档 · core 不认识 React · 两个视图一份引擎 · 老文件永远能打开 · 加能力靠注册不靠改引擎 · 断网能跑 · 存储只见接口 · 无显卡能测 · ID 是唯一主键
