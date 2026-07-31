# CLAUDE.md · 工程铁律

> **部署说明**：这份文件属于代码仓，不属于规划目录。创建代码仓时把它复制到**仓库根目录**，Claude Code 每次会话会自动读取它。

---

## 项目是什么

Web 3D 工具引擎（当前版本 v0.5）。一句话：**把"三维资产 + 交互逻辑"表达为一份可版本化的 JSON 文档，编辑器和播放器只是这份文档的两种视图。**

v0 已完成（底座打穿）。**当前活动版本是 v0.5「表现力与体验」**：对象库与放置 · 光照与环境 · 材质纹理 · 多媒体，经 [ADR-0015](docs/adr/0015-插入-v0.5-表现力与体验版本.md) 插入版本阶梯。目标仍是把能力"长在底座上"，不是把功能做全。**看到一个"顺手也能做"的功能时，先查 [docs/MVP_V0_5_进化规划.md](docs/MVP_V0_5_进化规划.md) §1.2 的 Out of Scope 清单**（v0 历史清单在 [docs/MVP_V0_孵化规划.md](docs/MVP_V0_孵化规划.md) §1.2）。

## 必读文档（按顺序）

| 文档 | 什么时候读 |
|---|---|
| [docs/NORTH_STAR.md](docs/NORTH_STAR.md) | 开工前。九条宪法任何情况下不得违反 |
| [docs/MVP_V0_5_进化规划.md](docs/MVP_V0_5_进化规划.md) | 开工前。v0.5 范围、黄金路径 II、设计决策 D11–D20、规范增量 §4（已冻结） |
| [docs/MVP_V0_孵化规划.md](docs/MVP_V0_孵化规划.md) | 参考。v0 范围、黄金路径 I、设计决策 D1–D10 |
| [docs/SCHEMA_SPEC.md](docs/SCHEMA_SPEC.md) | 动 `@w3/schema` 或任何文档字段之前（v0.5 增量以进化规划 §4 为准，T-120 回写） |
| [docs/ECA_SPEC.md](docs/ECA_SPEC.md) | 动 `packages/core/src/eca/` 之前 |
| [docs/TASK_BACKLOG_V0_5.md](docs/TASK_BACKLOG_V0_5.md) | 每次领新任务时（v0 历史台账：[docs/TASK_BACKLOG.md](docs/TASK_BACKLOG.md)，只读） |

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
- [ ] 在当前版本任务台账（[docs/TASK_BACKLOG_V0_5.md](docs/TASK_BACKLOG_V0_5.md)）里把该卡标为 `[x]` 并回填实际耗时

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
pnpm test:e2e                      # 黄金路径 12 步
pnpm verify                        # 上面全部，提 PR 前跑
```

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

第 7 条尤其重要：它意味着编辑器与播放器已经分叉（宪法 C3），**这时候继续加功能只会让返工面积变大**。

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

---

## 一句话速查

> 状态进文档 · core 不认识 React · 两个视图一份引擎 · 老文件永远能打开 · 加能力靠注册不靠改引擎 · 断网能跑 · 存储只见接口 · 无显卡能测 · ID 是唯一主键
