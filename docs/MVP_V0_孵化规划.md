# MVP v0 孵化规划 · 底座打穿

**上位文档**：[NORTH_STAR.md](NORTH_STAR.md)（宪法，冲突时以它为准）
**配套规范**：[SCHEMA_SPEC.md](SCHEMA_SPEC.md) · [ECA_SPEC.md](ECA_SPEC.md) · [CLAUDE.md](CLAUDE.md) · [TASK_BACKLOG.md](TASK_BACKLOG.md)
**读者**：负责实现的 coding agent，以及验收它的人

---

## 0. 一句话目标

> **用一条端到端的垂直切片，把"场景文档 + Runtime Core + ECA 引擎 + 编辑器 + 播放器"这套底座打穿到生产质量，其余 15 项功能一律不做。**

v0 的成功标准不是"看起来像个 3D 编辑器"，而是**技术方案 §0.5 那个判断能不能兑现**：这次写的东西，下一个客户能不能直接用。所以 v0 宁可只有 3 个功能，也要这 3 个功能背后的抽象是对的。

**v0 不含后端**（已决策）。存储走 `StorageProvider` 抽象，v0 只实现 `IndexedDbProvider`；v1 接后端时新增一个 `HttpApiProvider`，业务代码零改动——这个"零改动"本身就是 v1 对 C7 的验收项。

---

## 1. 范围：做什么，不做什么

### 1.1 做（v0 In Scope）

| 领域 | v0 交付内容 | 为什么它属于底座 |
|---|---|---|
| 场景文档 | schema v1 完整定义、Zod 校验、迁移框架、引用完整性检查、assetRef 重映射 | 技术方案 §1.2：schema 错了 18 个功能都跟它打架 |
| 存储 | `StorageProvider` 接口 + IndexedDB 实现 + 内容哈希寻址 + `.w3p` 场景包 | C7；也是 v1 接后端的插座 |
| Runtime Core | 加载、场景图构建、增量应用、射线拾取、相机与视点、动画（导入 clip + tween）、材质（clone-on-write）、高亮、热点锚点与遮挡 | 编辑器和播放器共用的全部 3D 能力 |
| 资产管线 | 体检（面数/贴图/材质统计 + 阈值报告）、单位与朝向归一、客户端缩略图 | 技术方案 R01 的唯一保险，且成本极低 |
| 编辑器外壳 | 层级树、属性面板、视口、gizmo、多选、资产面板 | 一切编辑功能的公共 UI 底座 |
| 撤销重做 | Immer patches 栈、`commit` / `preview` 双通道语义 | 技术方案 §5.2：不能后补（反模式 A8） |
| ECA 引擎 | 事件总线、条件求值、动作注册表、sequence/parallel 执行器、重入策略、无 GPU 可测 | 4 个交互类功能项（24,858 预算）的统一收口 |
| 规则编辑 UI | 变量面板、规则编辑器（表单由动作参数 schema 驱动）、触发日志 | 验证"新增动作 = 加注册项 + 表单描述"这个假设 |
| 发布与播放器 | 完整性检查 → 快照 → `.w3p` 导出；Player 读包只读执行 | C3 的载体 |
| 质量基建 | 宪法检查脚本、schema fixture 回归、一致性测试、benchmark 页 | v0 的晋级门槛全靠它 |

### 1.2 不做（v0 Out of Scope，明确列出防止 agent 发散）

后端服务 · 登录认证 · 权限 · 审计 · 编辑锁 · 模型库 · 材质库 · 特效预设（Bloom/雾/粒子）· 渲染出图 · 流程管理（`flows`）· 页面覆盖层（`pages`）· 多媒体（`media`）· 分享链接与二维码 · 约束关系对接 · 移动端适配 · 国际化

> （**减面与几何压缩**已由 [ADR-0031](adr/0031-减面移出-Out-of-Scope.md) 移出本清单，落在 **v1.5 的服务端资产转码**：Draco 几何压缩为必做、减面为**可选档位且默认关闭**。v0 / v0.5 期间浏览器侧只做 Draco **解码**，从来没有做过编码——这两个词此前被写在同一项里，掩盖了它们完全不同的成本。）

> **重要**：不做 ≠ schema 里不留位置。`flows` / `pages` / `media` 的**字段与类型定义在 v0 就写进 schema**（见 SCHEMA_SPEC §7），只是没有运行时实现和编辑 UI。理由：这些字段一旦 v1 才加，就要走一次 schemaVersion 迁移；提前定义是零成本的。

### 1.3 灰区裁决（避免反复讨论）

| 项 | 裁决 | 理由 |
|---|---|---|
| 热点（hotspot） | **做**，但只做锚点投影 + 遮挡检测 + 纯文本面板 | 3D↔DOM 坐标同步与遮挡判定是 core 能力，属底座；富文本/媒体面板属功能层，v1 做 |
| 高亮（highlight） | **做**，v0 用 emissive 叠加实现，不引后处理 | 保持 v0 无 EffectComposer；`preset` 字段先占位，v1 接 `postprocessing` 的 OutlineEffect 时 **schema 不变**——这正好是 C5 的一次实战演示 |
| 几何压缩 | **不做**压缩，但**必须做** Draco/KTX2 **解码器自托管与加载路径** | 客户素材可能已经是 Draco 压缩的；解码器缺失是 C6 的典型翻车点 |
| 多选 | **做**，但只支持批量 transform / 显隐 | 层级树与属性面板的选择模型必须一开始就是集合，事后从单选改多选要重写 |
| 拖拽改父 | **做** | 它是 `parent` 字段 + 撤销 + 增量同步的联合压力测试 |

---

## 2. 黄金路径（v0 唯一的验收剧本）

这 12 步就是 v0 的定义。**E2E 测试必须逐步覆盖，缺一步不算完成。**

```
 1. 打开编辑器 → 新建项目 "泵组拆装演示"
 2. 拖入 pump.glb → 自动体检 → 报告：面数 128,400 / 材质 12 / 贴图 6 / 8.4MB
                                  → 与阈值对照，逐项标 通过 | 超标 + 建议
 3. 确认导入 → 资产按内容哈希入库 → 层级树出现节点树 → 生成缩略图
 4. 层级树选中「阀盖」→ 属性面板显示 transform → gizmo 拖动 → 松手落一次 undo 记录
 5. Ctrl+Z 撤销位移 → 视口回退 → Ctrl+Y 重做 → 视口前进（三者严格一致）
 6. 选中「阀盖」→ 材质面板改 roughness 0.4 → 只有「阀盖」变化，共享同一材质的其他 mesh 不变
 7. 相机转到合适角度 → 保存视点 vp_1「拆解视角」
 8. 新建补间动画 anm_1：目标「阀盖」→ 位置 [0, 0.35, 0]，时长 1.2s，easeInOutCubic
 9. 在「阀盖」上加热点 hs_1，内容"拆卸第一步：松开六颗固定螺栓"，开启遮挡
10. 新建变量 step:number=1；新建规则 rl_1：
        when  click on 阀盖
        if    step == 1
        mode  sequence
        then  playAnimation(anm_1) → highlight(阀盖, amber) → openPanel(hs_1) → setVariable(step, 2)
11. 编辑器内进入预览模式 → 点击阀盖 → 动画播完 → 高亮亮起 → 面板弹出 → step 变 2
        → 再次点击无反应（条件不满足），验证条件求值正确
12. 发布 → 完整性检查通过 → 导出 demo.w3p → 用 Player 打开 → 重复第 11 步
        → 行为与编辑器预览**逐项一致**
```

**第 12 步的"逐项一致"是硬指标**，由自动化的 parity 测试保障，不靠肉眼：同一份文档 + 同一串输入事件，两侧产出的状态轨迹（变量值序列、动画开始/结束时刻序列、可见性变更序列、面板开合序列）必须完全相等。这是宪法 C3 的唯一可信验证方式。

---

## 3. 仓库结构与依赖方向

```
web3d-engine/
├── CLAUDE.md                      ← 复制自 docs/CLAUDE.md，agent 每次会话自动读
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── schema/     @w3/schema     零 three 零 UI。类型 + Zod + 迁移 + 完整性检查
│   ├── storage/    @w3/storage    StorageProvider 接口 + IndexedDB / Memory 实现
│   ├── core/       @w3/core       Runtime Core + ECA 引擎。框架无关
│   ├── editor/     @w3/editor     React SPA
│   └── player/     @w3/player     只读 SPA，体积敏感
├── scripts/
│   ├── check-core-purity.mjs
│   ├── check-no-external.mjs
│   ├── check-storage-abstraction.mjs
│   └── check-constitution.mjs     ← 上面三个的总入口
├── e2e/                           Playwright，黄金路径
├── docs/
│   ├── NORTH_STAR.md  SCHEMA_SPEC.md  ECA_SPEC.md  TASK_BACKLOG.md
│   ├── adr/
│   ├── BENCHMARK.md   METRICS.md
│   └── 附件A_数字资产规范_草案.md
└── vendor/                        Draco decoder / KTX2 transcoder 等自托管三方运行时
```

### 依赖方向（**单向，不许有反向箭头**）

```
        @w3/schema  ←──────────────┐
             ↑                     │
        @w3/storage                │
             ↑                     │
        @w3/core  ─────────────────┘   (core 依赖 schema，不依赖 storage)
          ↑    ↑
   @w3/editor  @w3/player
```

- `@w3/schema`：依赖仅 `zod`。**不许 import three**。
- `@w3/storage`：依赖 `@w3/schema` + `idb`。**不许 import three、不许 import react**。
- `@w3/core`：依赖 `three` + `@w3/schema`。**不许 import react / react-dom / @react-three/\* / @w3/storage**。资产字节由外部通过 `AssetResolver` 注入。
- `@w3/editor`：可依赖全部。
- `@w3/player`：依赖 `@w3/core` + `@w3/schema` + `@w3/storage`。React 可用，但保持极简（体积预算 gzip ≤ 400KB）。

> `core` 不依赖 `storage` 是刻意的：core 只认识"给我一段 ArrayBuffer"，谁给的它不关心。这让 core 在 Node 单测里能用假的 resolver 跑起来（C8）。

---

## 4. 技术选型锁定

| 层 | 选定 | 备注 |
|---|---|---|
| 包管理 | pnpm workspace | monorepo，技术方案 §1.1 已定 |
| 语言 | TypeScript `strict: true` | 所有包，无例外 |
| 构建 | Vite（editor / player）· tsup（schema / core / storage） | — |
| 3D | three.js | **精确锁版本，不用 `^`。** three 的次版本常含破坏性变更 |
| 编辑器 3D 层 | React Three Fiber | 仅在 editor 内使用；core 保持命令式（技术方案 §3.1 的取舍） |
| 状态 | Zustand + Immer（`produceWithPatches`） | patches 直接做撤销重做 |
| 校验 | Zod | schema 单一真源：先写 Zod，TS 类型用 `z.infer` 推导 |
| 资产处理 | `@gltf-transform/core` + `/functions` | 体检与归一 |
| 本地存储 | `idb` | 只出现在 `@w3/storage` 内部 |
| 打包格式 | `fflate`（zip） | `.w3p` 场景包 |
| 测试 | Vitest（单元）+ Playwright（E2E） | ECA 单测必须跑在纯 Node 环境 |
| UI 组件 | 成熟组件库，不自研设计系统 | 技术方案 §5.1 补平方案第 3 条 |

**版本锁定规程**：agent 初始化时执行安装并把 `pnpm-lock.yaml` 提交，然后把实测版本号回填到本表下方的《实测版本》小节。**不要凭记忆写版本号**。所有 3D 相关依赖（three / R3F / postprocessing / gltf-transform）在 `package.json` 中写精确版本，不带 `^` `~`。

#### 实测版本（由 agent 在 T-001 完成后回填）

| 包 | 版本 | 回填日期 |
|---|---|---|
| three | _待填_ | |
| @react-three/fiber | _待填_ | |
| @gltf-transform/core | _待填_ | |
| zod | _待填_ | |

---

## 5. 关键设计决策

这 10 条是 agent 最容易做错、且做错后代价最高的地方。每条都给了"错误做法"作为对照。

### D1 · 编辑器与 Core 的同步：增量补丁，不是全量重建

编辑器每次 `commit` 产出 Immer patches，把 patches 交给 `runtime.applyPatch(patches)`。core 内部按 patch 路径分发到对应的更新器。

- ❌ 错误：文档一变就 `runtime.load(doc)` 全量重建。拖 gizmo 时会掉帧到不可用。
- ✅ 正确：`/nodes/3/transform/p` → 只更新那个 Object3D 的 position。
- 兜底：无法识别的 patch 路径 → 回落到全量重建，但必须 `console.warn` 并计数，测试里断言计数为 0。

### D2 · gizmo 拖拽：`preview` 与 `commit` 双通道

拖拽过程中每帧调 `preview(recipe)`——直接写文档但**不入撤销栈**；`pointerup` 时调一次 `commit(label, recipe)`，以拖拽**起点**为基准生成一条 patch。

- ❌ 错误：每帧 commit。撤销栈里塞进 300 条记录，Ctrl+Z 变成慢动作回放。
- ✅ 正确：一次拖拽 = 撤销栈里一条 `"移动 阀盖"`。

### D3 · 材质：clone-on-write（技术方案 R08）

glTF 里多个 mesh 共享同一个 material 实例是常态。`MaterialRegistry.resolveFor(nodeId, matDef)`：
1. 若该节点无 material override → 直接用源材质；
2. 若有 override 且源材质被 >1 个 Object3D 引用 → clone 一份，记录 `clonedFrom`，只把 clone 挂到该节点；
3. 引用计数归零时 dispose。

同时**必须处理色彩空间**：`map` / `emissiveMap` / `specularMap` 设 `SRGBColorSpace`，`normalMap` / `roughnessMap` / `metalnessMap` / `aoMap` 保持线性。配错的表现是整体偏色，且很容易被误判成"美术问题"。

### D4 · 资产不可变，按内容哈希寻址

上传文件 → WebCrypto SHA-256 → `sha256:<hex>` → 存储路径 `assets/<hex[0:2]>/<hex[2:4]>/<hex>.glb`。同一份文件二次上传直接命中，不重复存。资产条目一旦写入**永不修改**，"更新模型"是新增一个 asset + 一次重映射（见 D5）。

### D5 · 资产二次上传的重映射（技术方案 R02）

`remapAssetRefs(doc, oldAssetId, newAssetId, newObjectIndex)` 按序尝试：

| 序 | 策略 | 结果标记 |
|---|---|---|
| 1 | `objectPath` 完全相等 | `exact` |
| 2 | `objectName` 在新资产中唯一 | `byName` |
| 3 | `objectName` 多个候选 → 按 `objectPath` 最长公共后缀打分，唯一最高分者胜出 | `byPathScore` |
| 4 | 以上皆失败 | `orphaned` |

输出 `MigrationReport { exact[], byName[], byPathScore[], ambiguous[], orphaned[] }`，UI 必须展示成"N 项已迁移 / M 项需人工确认 / K 项失效"，并允许人工逐条重指。

**孤儿节点不删除**，标记 `assetRef.missing = true`，在层级树上显示警示。删掉用户的配置是不可接受的。

### D6 · 动画：统一 Promise 语义（技术方案 §1.3 / 反模式 A10）

`ctx.playAnimation(id, opts)` 返回一个 **在动画自然播放结束时 resolve** 的 Promise；被 `stopAnimation` 或 `AbortSignal` 中断时以 `AbortError` reject（由执行器吞掉并静默终止序列）。循环动画（`loop: true`）的 Promise **立即 resolve**，否则 sequence 会永久挂起——这是必须写进测试的边界。

### D7 · 热点遮挡

每帧（或每 3 帧，可配）对每个可见热点：从相机向锚点世界坐标发一次射线，若首个命中物体的距离 < 锚点距离 − ε，则判定被遮挡。锚点 DOM 元素用 `transform: translate3d()` 定位，不用 `left/top`（避免逐帧触发布局）。视锥外的热点直接跳过射线，不做无谓计算。

### D8 · 发布快照 `.w3p`

zip，内含：

```
manifest.json    { schemaVersion, coreVersion, snapshotId, projectId, publishedAt, assetCount }
scene.json       完整 SceneDocument（已通过 checkIntegrity）
assets/<hash 分片路径>/*.glb|.ktx2|...
thumbnail.png
```

发布前**强制** `validate(doc)` + `checkIntegrity(doc)`，任一失败阻断发布并列出问题清单。`coreVersion` 写入 manifest，是 v1 之后排查"老包新播放器"问题的唯一线索。

### D9 · ECA 重入策略（技术方案未覆盖，必须现在定）

同一条规则在上一次执行尚未结束时再次被触发，默认 `reentry: "restart"`：abort 上一次的 signal，重新开始。可选 `"ignore"`（丢弃新触发）、`"queue"`（排队）。

- ❌ 错误：不处理。用户连点三下，三条 sequence 交叠执行，动画与变量状态互相打架，且极难复现。
- ✅ 正确：默认 restart，在规则编辑 UI 里可改，写进 schema。

### D10 · 时间必须可注入（宪法 C8）

ECA 引擎内部**禁止**出现 `Date.now()` / `performance.now()` / `setTimeout` / `requestAnimationFrame`。一律走 `ctx.now()` 与 `ctx.wait(ms, signal)`。生产环境注入真实时钟，测试注入可手动推进的假时钟。

- 收益一：`timer` 事件、动画时长、面板延迟关闭都能确定性测试。
- 收益二：技术方案 §1.3 说的"直接产出合同要求的验收测试用例"才真正可行——测试跑得快、不 flaky，才会有人一直跑它。

---

## 6. 里程碑

每个里程碑都有一个**可演示的东西**。没有可演示物的里程碑不算里程碑。

| M | 名称 | 完成标志（Demo） | 覆盖任务卡 |
|---|---|---|---|
| **M0** | 骨架与守卫 | `pnpm check:constitution` 全绿；5 个包能互相 import；CI 跑通 | T-001 ~ T-006 |
| **M1** | 文档模型 | Node 里构造文档 → 校验 → 存 → 读 → 迁移 → 完整性检查，全套单测绿 | T-010 ~ T-024 |
| **M2** | 看得见 | 命令行喂一份写死的 `scene.json` + 一个 GLB → 浏览器渲染出来、能转相机、能点选高亮 | T-030 ~ T-036 |
| **M3** | 编得动 | 层级树 + 属性面板 + gizmo + 撤销重做；黄金路径 1–7 步跑通 | T-050 ~ T-072 |
| **M4** | 活起来 | ECA 引擎 + 规则编辑 UI；黄金路径 8–11 步跑通；ECA 单测覆盖 100% | T-037 ~ T-041, T-080 ~ T-093 |
| **M5** | 发得出 | 发布 → `.w3p` → Player 打开；parity 测试绿；黄金路径 12 步全通 | T-100 ~ T-105 |
| **M6** | 站得住 | benchmark 实测记录、E2E 全绿、七条晋级门槛全过、附件 A 草案产出 | T-110 ~ T-114 |

**M2 是第一个心理拐点**（终于看得见东西了），**M5 是第一个技术拐点**（架构假设被证明了）。如果 M5 的 parity 测试写不出来或者一直不过，说明 C3 被违了，**停下来修架构，不要继续加功能**。

---

## 7. 验收标准

### 7.1 自动化（`pnpm verify` 一条命令跑完）

```
pnpm check:constitution   # C2 C6 C7 三项静态检查
pnpm -r test              # 全部单测；@w3/core 的 ECA 部分在纯 Node 环境
pnpm test:parity          # 编辑器预览 vs 播放器 状态轨迹一致性
pnpm test:e2e             # 黄金路径 12 步
pnpm build --offline      # 断网构建（C6）
pnpm size-limit           # Player 体积预算
```

门槛（对应北极星 §3 的 G0-1 ~ G0-7）：
- 所有命令零失败；
- 已注册动作单测覆盖 = 100%；
- `@w3/schema` 语句覆盖 ≥ 90%（它是最不该出错的包）；
- 全量重建回落计数（D1 兜底）在 E2E 中断言为 0。

### 7.2 人工

| # | 检查项 | 怎么算过 |
|---|---|---|
| H1 | 在目标机器上跑 benchmark 页 | 帧率、drawcall、WebGL2 可用性记录进 `docs/BENCHMARK.md` |
| H2 | 用一份**真实客户素材**（不是理想的测试模型）走一遍黄金路径 | 走不通的地方逐条记录，转为附件 A 的数值依据 |
| H3 | 二次上传同名模型（改过节点名/层级），看重映射报告 | 报告分类正确，孤儿项可人工重指 |
| H4 | 断网打开 Player | 无任何外部请求，功能完整 |
| H5 | 翻一遍 `docs/adr/`，每条 ADR 的"代价"和"撤销条件"都不为空 | 见 NORTH_STAR §5 |

---

## 8. 风险登记册 → v0 工程动作

技术方案 §4 的 15 条风险，在 v0 落哪些防线。**没落防线的，注明推迟到哪个版本**——不写"暂不考虑"。

| ID | 风险 | v0 的工程防线 | 对应任务卡 |
|---|---|---|---|
| R01 | 资产失控 | 导入体检 + 阈值报告 + 超标警示；阈值集中配在 `assetPolicy.ts`，其数值直接生成《附件A》草案 | T-050, T-051, T-113 |
| R02 | 二次上传引用全断 | `assetRef` 三重冗余 + `remapAssetRefs` 四级策略 + 迁移报告 UI + 孤儿标记不删除 | T-016, T-066 |
| R03 | 动画范围膨胀 | v0 只实现 `imported` clip 播放 + `tween` 补间两种 kind，schema 的 `kind` 字段是封闭枚举——想加曲线编辑必须改 schema，自动触发分诊 Q3 | T-037, T-038 |
| R04 | 约束关系对接变仿真 | v0 不做。schema 预留 `constraints` 字段但不定义内部结构，等甲方澄清 | — （v1） |
| R05 | 渲染出图变离线渲染 | v0 不做。但 **R06/R07 的设计决策在 v0 就定**（下两行） | — （v1） |
| R06 | HTML 热点与出图冲突 | v0 的热点渲染层做成可切换的 `HotspotRenderer` 接口（DOM 实现 / 未来 sprite 实现），出图时切到 sprite 实现即可——**接口现在留，实现 v1 补** | T-041 |
| R07 | 后处理 / 透明 / 抗锯齿三角冲突 | v0 刻意不引 EffectComposer（高亮用 emissive），把这个冲突整体推到 v1 一次性解决，避免 v0 被拖住 | — （v1，已在 D 区留出 `preset` 扩展点） |
| R08 | 材质共享陷阱 | clone-on-write + 色彩空间表 + **专项单测**：改一个 mesh 材质，断言兄弟 mesh 材质引用不变 | T-039 |
| R09 | 工时缺口 40% | v0 不含后端（省 5 人日）；不做 8 项功能；用成熟组件库 | 全局 |
| R10 | SLA 无限责任 | 非技术项。工程侧唯一能做的：审计与错误日志接口在 v0 预留，便于事后自证 | — （v1） |
| R11 | 知识产权排他转让 | **v0 就要做的事**：`@w3/core` `@w3/schema` 与项目定制层严格分包，License 头注明；谈判时"底座 vs 定制"的边界是**目录级别可指的** | T-001 |
| R12 | 多人协同隐含期望 | v0 单人本地，不涉及。v1 做悲观锁 | — （v1） |
| R13 | 页面编辑变建站器 | v0 不做 `pages` 运行时，只留 schema 字段。字段类型故意限定为 `text|image|button|panel` 封闭枚举 | SCHEMA §7 |
| R14 | 验收材料被低估 | **v0 就产出**规则表 → 用例骨架生成器；每写一条规则，附件 C 的用例自动多一条 | T-087 |
| R15 | 甲方无可用素材 | H2 人工验收项强制用真实素材试一次，尽早暴露 | §7.2 H2 |

---

## 9. 第一天就该存在的文件

M0 结束时，下列文件必须存在且非空。这是 agent 开工的第一份 checklist：

```
CLAUDE.md
pnpm-workspace.yaml
tsconfig.base.json
.editorconfig  .gitignore  .npmrc(shamefully-hoist=false)
packages/{schema,storage,core,editor,player}/package.json
packages/{schema,storage,core,editor,player}/tsconfig.json
packages/{schema,storage,core,editor,player}/src/index.ts
scripts/check-core-purity.mjs
scripts/check-no-external.mjs
scripts/check-storage-abstraction.mjs
scripts/check-constitution.mjs
vendor/draco/            (自托管解码器)
vendor/basis/            (KTX2 transcoder)
docs/adr/0001-monorepo-与包边界.md
docs/adr/0002-v0-不含后端.md
.github/workflows/ci.yml   (或等价的本地 pre-push 钩子)
```

---

## 10. 给 agent 的启动指令

把下面这段原样交给写代码的 agent 作为第一条指令：

```
你要实现的项目是一个 Web 3D 工具引擎的 MVP v0。

开工前必读，按顺序：
1. docs/NORTH_STAR.md      —— 宪法。九条约束任何情况下不得违反。
2. docs/MVP_V0_孵化规划.md  —— 本次要做什么、不做什么、黄金路径 12 步。
3. docs/SCHEMA_SPEC.md     —— 场景文档模型。这是整个系统的地基，逐字实现，不要自由发挥。
4. docs/ECA_SPEC.md        —— 规则引擎。同上。
5. CLAUDE.md               —— 工程铁律与 DoD。每次提交前对照。
6. docs/TASK_BACKLOG.md    —— 任务卡。从 T-001 开始，按依赖顺序领。

工作方式：
- 一次只做一张任务卡。做完跑该卡的"自测"命令，绿了再领下一张。
- 每张卡完成后，在 TASK_BACKLOG.md 里把状态改为 [x] 并回填实际耗时。
- 遇到规范里没写清楚的地方：先在 docs/adr/ 写一条 ADR 记录你的选择和代价，再实现。
  不要静默做假设。
- 遇到需要修改 SCHEMA_SPEC 或 ECA_SPEC 的情况：停下来问人，不要自己改规范。
- 任何时候不确定"这个该不该做"，回到 MVP_V0_孵化规划.md §1.2 的 Out of Scope 清单。

先执行 T-001，完成后停下来汇报，等确认再继续。
```

**为什么最后一句要"停下来汇报"**：T-001 定的是包边界和依赖方向，它错了后面全错，且是唯一无法靠单测发现的错误。人工看一眼的成本远低于返工。之后的任务卡可以连续做。
