# v0.5 任务卡清单

**用法**：agent 一次领一张，做完跑自测命令，绿了改 `[x]` 并回填耗时，再领下一张。
**上位文档**：[MVP_V0_5_进化规划.md](MVP_V0_5_进化规划.md) · [CLAUDE.md](../CLAUDE.md)（每张卡的 DoD 在那里）
**v0 台账**：[TASK_BACKLOG.md](TASK_BACKLOG.md)（历史存档，只读）

每张卡的字段：
- **依赖**：必须先完成的卡（`v0` 表示依赖已完成的 v0 交付物）
- **实际**：agent 实时耗时（小时）。与人日预估不是同一量纲，只用来看**卡与卡之间**的相对
  大小和"是否显著超出预期"（CLAUDE.md 停工条款第 6 条）
- **独占**：这张卡会创建/修改的文件。**多 agent 并行时，独占文件不重叠的卡才能同时开工**；
  同分支串行卡允许独占重叠（波次表里排同一列即可）
- **验收**：怎么算做完
- **自测**：跑什么命令

标 ★ 的是**接口/地基先行卡**——完成后同时解锁多条并行分支。

**本版新纪律（对每张卡生效）**：
1. 新增的每条测试附一次**变异检验**（把被测行为故意改坏 → 测试必须转红），在提交信息里记录；
2. 涉及 ECA 动作的卡，`executor.ts` / `engine.ts` / 规则编辑器组件的 diff 必须为空；
3. 涉及渲染能力的卡，`packages/player/src` 的 diff 必须为空（能力长在 core，播放器自动获得）。

---

## 并行波次

单 agent 顺序模式可忽略本节，直接从 T-115 按编号做。

| 波次 | 可同时开工 | 前置 |
|---|---|---|
| W0 | T-115, T-116, T-117, ★T-120 | —（四张卡独占互不重叠） |
| W1 | T-121, T-122, ★T-130, T-145 | T-120（T-145 仅依赖 T-120） |
| W2 | T-131 ｜ T-140 ｜ T-150 | W1 对应 ★ 卡 |
| W3 | T-132 → T-133 → T-134（同独占串行）｜ T-141 → T-142 ｜ T-151 → T-153 ｜ T-160 | W2 |
| W4 | T-135 → T-136 ｜ T-143, T-144 ｜ T-152 → T-154 ｜ T-161, T-162, T-163 | W3 |
| W5 | T-155 | T-141, T-145, T-150, T-133 |
| W6 | T-170 → T-171, T-172, T-173, T-174 | 全部功能卡 |
| W7 | T-175, T-176 | W6 |

---

## E11 · v0 清债（先还债，再进化）

### [x] T-115 · E2E 与缩略图假绿断言修复
- **依赖** v0 · **预估** 0.8d · **实际** 0.7h
- **独占** `e2e/tests/golden-path-full.spec.ts`, `packages/core/test/assets/thumbnail.test.ts`
  （+ `packages/editor/src/viewport/runtime-registry.ts`：新增 DEV-only 只读钩子
  `__w3DevMaterialOf`，"渲染侧生效"没有它就只能靠像素猜——理由见文件内注释）
- **做** 修 [IMPL_NOTES](IMPL_NOTES.md) §4 登记的四条：①第 6 步真实修改 roughness 并断言文档与渲染侧生效（当前定位到的"roughness 控件"其实是材质下拉框）；②第 8 步用数量前后对比断言"新建补间"生效（弃用 `.first()`）；③第 9 步断言**本次新建**的热点而非样例遗留热点；④缩略图取景断言读取 `view.target` 且样本包含非零 y/z 分量。每条修完做一次变异检验。
- **验收** 四处变异检验转红记录在提交信息；全套 E2E 仍绿
- **自测** `pnpm test:e2e && pnpm -F @w3/core test thumbnail`

### [x] T-116 · benchmark 假绿与包兼容提示清偿
- **依赖** v0 · **预估** 0.8d · **实际** 0.6h
- **独占** `packages/player/test/bench-metrics.test.ts`, `packages/player/src/bench/main.ts`, `packages/player/src/bench/metrics.ts`, `packages/storage/src/package.ts`, `packages/storage/test/package.test.ts`
  （+ `packages/player/src/compat.ts` 改为委派给 storage 的新版本闸门，避免同一句中文提示
  在两个包里各写一份；+ [ADR-0016](adr/0016-逐级加载压力测试的含义.md)：③ 的「逐级加载压力测试」
  在任何规范里都没有定义，按铁律 12 先写 ADR 再实现）
- **做** ①p95 断言改为构造已知帧分布并断言精确分位值（当前 `toBeGreaterThanOrEqual(16.7)` 把 p95 写成"最慢帧"也全绿）；②`BENCH_LIMITS.textures` 真正参与 `gradeScene` 评级，或从断言中移除并注明理由；③补 T-110 卡片明列但缺失的「逐级加载压力测试」；④`unpackScene` 先 `assertCompatible` 再解析，让 from-the-future 包的中文提示不再是死代码，附一条对应测试。
- **验收** 变异检验（p95 实现改回"最慢帧"→ 测试红）；from-the-future 包报中文明确错误
- **自测** `pnpm -F @w3/player test && pnpm -F @w3/storage test package`

### [x] T-117 · CI 工作流落地
- **依赖** v0 · **预估** 0.5d · **实际** 0.8h（含三轮推送验证）
- **独占** `.github/workflows/ci.yml`
- **做** GitHub Actions：constitution → typecheck → lint → 全部单测 → build → size-limit；Playwright E2E 单列 job（可 nightly）。pnpm 缓存。补上 IMPL_NOTES §4 点名的「T-105 超标 CI fail 没有落点」。
- **验收** 分支上推送一次全绿；临时把 size 预算调小验证 CI 会红（验证后还原）
- **自测** 推送后观察 CI 结果
- **实际情况**：步骤顺序较卡片有调整——`build` 提到最前，两个理由都只在干净机器上才
  显形：① 各包经 `types: ./dist/*.d.ts` 认识兄弟包，没构建时 `pnpm -r typecheck` 一行
  都查不到就挂（**CI 首跑就是被这条抓红的**，见 [IMPL_NOTES](IMPL_NOTES.md) §4）；
  ② `check:constitution --require-build` 未构建即 fail。另加 `pnpm test:parity`
  （属于 `pnpm verify`，卡片未列但漏了就是 CI 里没有 C3 守卫）。
  体积闸门「会红」已本地验证：预算临时改 100 KB → `pnpm size` 打印 FAIL 并 exit 1（已还原）。
  **推送验证已完成**：前两轮红（各抓到一条本机看不见的真问题），第三轮两个 job 全绿
  （run 30660510375：verify 44s · E2E 2m1s）。

---

## E12 · schema v2

### [x] T-120 · schema v2 三件套 ★
- **依赖** 无（与 T-115 ~ T-117 可并行开工） · **预估** 1.5d · **实际** 1.6h
- **独占** `packages/schema/src/{node,light,primitive,material,document,deferred,media,migrate,primitives}.ts`, `packages/schema/test/fixtures/v2/golden-path-2.json`, `packages/schema/test/migrate.test.ts`, `docs/SCHEMA_SPEC.md`
  （版本 bump 的必然波及，逐一登记：`schema/src/{factory,index}.ts` 与
  `schema/test/{fixtures,validate,remap,index-builder}.test.ts` —— `Node` 类型多两个必填字段，
  凡是手写节点字面量的地方都要补；`core/src/assets/instantiate.ts` 同理；
  `core/test/{assets/pipeline,runtime/apply-patch,runtime/scene-graph}.test.ts`、
  `storage/test/package.test.ts` 里的 `schemaVersion: 1` 字面量改为读 `CURRENT_VERSION`；
  **`editor/src/main.tsx` 是唯一一处真缺陷**，见下）
- **做** 按进化规划 **§4.1 逐字**落地：节点承载体 `primitive` / `light`（新文件 `primitive.ts` / `light.ts`）、`meta.environment` 与 `background` 增 `'hdri'`、材质 physical 参数与 `uv` 块、`MediaSchema` 从 `deferred.ts` 出列进 `media.ts`（+`name` / `durationS`）、`Vec2`。`CURRENT_VERSION = 2` + 迁移 `1→2`（纯函数补默认值，**不注入灯节点**，D14）+ fixture `v2/golden-path-2.json`（黄金路径 II 终态文档）。v1 fixture 只增不改不删。**同步回写 SCHEMA_SPEC.md** 对应章节（§1/§4/§6/§7/§10，标注 v2 增量）。
- **验收** 三件套齐；v1 与 v2 fixture 均 `migrate → validate → checkIntegrity` 零 error；文档 JSON 往返 `toEqual`；无手写 interface、无裸 `z.string()` 当枚举
- **自测** `pnpm -F @w3/schema test`
- **⚠ 完成后停下来汇报，等人工确认再继续。** 字段形状错了，后面六个里程碑全错，且单测发现不了。
- **本卡抓到的一条真缺陷**：`editor/src/main.tsx` 的恢复路径用 `validate` 而不是 `migrate`。
  v1 是唯一版本时看不出来，v2 一上线就变成"升级后所有工程消失"——文档还在盘上，用户看到的
  是样例场景，与数据丢失无法区分（直接违 C4）。已改为 `migrate` 并记录升级日志；
  用一次性 Playwright 脚本播种 v1 工程实测通过（把 `migrate` 改回旧行为 → 转红），
  常设回归测试归 T-172。

### [x] T-121 · 完整性检查增量 I11–I15
- **依赖** T-120 · **预估** 0.5d · **实际** 0.5h
- **独占** `packages/schema/src/integrity.ts`, `packages/schema/test/integrity.test.ts`
  （+ `index-builder.ts` 的 `RefTarget` 增可选 `expectType`：I14 第三句「playMedia 只能引用
  audio」是**动作知识**，硬编码动作名会把 ECA 语义塞进唯一不许认识 ECA 的包。改为解析器
  报约束、schema 只负责执行，与 id 解析同一套分工）
- **做** 进化规划 §4.2 的五项：I11 承载体互斥、I12 环境引用与背景依赖、I13 贴图槽位资产类型、I14 媒体类型匹配（含 `playMedia` 目标必须为 audio）、I15 physical 参数错配（warn）。
- **验收** 每项至少一条正例 + 一条反例单测
- **自测** `pnpm -F @w3/schema test integrity`
- **实际情况**：I13 比 v0 的同类检查更严——原来 I3 里那段允许 `image`，v0.5 明确把
  `texture`（材质采样）与 `image`（媒体展示）分开，两条规则并存会让人说不清哪条才算数，
  所以把类型判断整体挪进 I13。8 次变异检验逐条转红。

### [x] T-122 · 工厂、选择器与索引增量
- **依赖** T-120 · **预估** 0.5d · **实际** 0.5h
- **独占** `packages/schema/src/factory.ts`, `packages/schema/src/selectors.ts`, `packages/schema/src/index-builder.ts`, 对应 `test/*.test.ts`
- **做** `createPrimitiveNode` / `createLightNode` / `createMediaRecord`；`ensureDefaultMaterial(doc)`（无则创建名为「默认材质」的共享记录并返回 id，D15）；`DocIndex` 增 `mediaById`；`refsTo` 覆盖 `hotspot.content.mediaId` 与 `media.assetId`；selectors 增灯/原始体节点查询。
- **验收** 工厂产物直接过 `validate`；`refsTo` 能回答"删除 med_x 会影响哪些热点/规则"
- **自测** `pnpm -F @w3/schema test`
- **实际情况**：`refsTo` 对 `hotspot.content.mediaId` 与 `media.assetId` 在 v0 就已覆盖，
  本卡补的是**没人点名但会静默出事的第三条**——`meta.environment.hdriAssetId`：它不挂在任何
  节点上，删掉那张 .hdr 时删除确认框会说"无人引用"，然后场景照明整个消失。
  另加两个选择器给 core 用：`getCarrier`（三种承载体归一成一个可 switch 的值，T-130 的
  分发点）与 `needsDefaultLightRig`（D14 的判据放 schema，编辑器与运行时不可能对它有分歧）。
  8 次变异检验逐条转红。

---

## E13 · 光照与环境（`@w3/core`）

### [x] T-130 · 场景图承载体分发 ★
- **依赖** T-120 · **预估** 0.8d · **实际** 1.2h
- **独占** `packages/core/src/runtime/scene-graph.ts`, `packages/core/src/runtime/apply-patch.ts`, `packages/core/src/runtime/carrier-types.ts`, `packages/core/test/runtime/scene-graph.test.ts`, `packages/core/test/runtime/apply-patch.test.ts`
- **做** 场景图识别三种承载体（assetRef / primitive / light），primitive 与 light 的 Object3D 构建委托给 `PrimitiveFactory` / `LightFactory` 接口（本卡定义接口 + 占位实现，真实实现在 T-140 / T-131）。applyPatch 增路径分发：`/nodes/i/primitive/**`、`/nodes/i/light/**`、`/meta/environment/**`、`/meta/background/**`、`/media/**`——**每类路径都不落全量重建**。
- **验收** 新路径逐类有单测；`fullRebuildCount` 在全部新路径上为 0
- **自测** `pnpm -F @w3/core test scene-graph apply-patch`
- **实际情况**：顺手清掉了 IMPL_NOTES §4 登记的那条 major——黄金路径 `fullRebuildCount`
  实测为 1。根因不在新路径上，而在**索引位移**：immer 把 `nodes.splice(2,1)` 描述成
  `replace /nodes/2` + `remove /nodes/3`，按字面读会删掉一个还活着的节点、再重复添加失败。
  现在整条黄金路径实测 0，并在 E2E 末尾（第 12 步之后）补了断言——原来两处断言都在
  那次回落之前，这才是它活了一整个版本的原因。
  另修 `resyncNode` 把非 Mesh 节点的 `applyToNode === false` 当成"未识别"：**文档里
  只要有一盏灯，任何 `/nodes` 整体替换都会回落全量重建**（灯没有 mesh），D1 的报警器
  会从 M9 开始持续鸣叫。还顺带修了 `disposeSubtree` 无差别 dispose 几何——资产实例的
  几何是共享的，删一个节点会让同一零件的其他实例白掉到下次上传。13 处变异检验全红。

### [x] T-131 · LightFactory：五种灯
- **依赖** T-130 · **预估** 0.8d · **实际** 0.6h
- **独占** `packages/core/src/runtime/light-factory.ts`, `packages/core/test/runtime/light-factory.test.ts`
- **做** ambient / hemisphere / directional / point / spot 的构建与增量更新；方向性灯沿节点局部 -Z（D13，target 由世界矩阵每帧推出，不进文档）；`angleDeg` → 弧度；`quality` → mapSize 512/1024/2048；颜色/强度/角度等参数 patch **就地更新**不重建，`kind` 变更走重建 + dispose。
- **验收** 每种灯一条构建断言 + 一条增量更新断言；-Z 朝向有数学断言（旋转节点 → 光照方向随动）
- **自测** `pnpm -F @w3/core test light-factory`
- **实际情况**：D13 的实现不需要每帧 tick——把 target 挂成灯的**子对象**放在局部 -Z，
  three 自己每帧从灯的世界矩阵推出朝向。10 处变异检验全红，其中两条值得记：
  target 不挂成子对象（回到 three 默认的游离 target）→ 5 条红；换阴影质量不 dispose
  旧 map → 红（three 只在首次按 mapSize 分配，不 dispose 的话"高"档永远还在 512 渲染，
  控件看起来什么也没干）。

### [x] T-132 · 阴影管线
- **依赖** T-131 · **预估** 0.5d · **实际** 0.5h
- **独占** `packages/core/src/runtime/scene-runtime.ts`（阴影段）, `packages/core/test/runtime/scene-runtime.test.ts`
- **做** 存在任一 `shadow.enabled` 灯 → 开 `renderer.shadowMap`（PCFSoft），全关 → 关闭；阴影管线开启时 mesh 缺省 `castShadow = receiveShadow = true`，`node.overrides.castShadow / receiveShadow`（v0 字段，此前空转）接通生效；`bias` 应用。
- **验收** 无 GL 断言对象标志位与 shadowMap 开关联动；overrides 关掉单个节点的投影有效
- **自测** `pnpm -F @w3/core test scene-runtime`
- **本卡抓到的一条 blocker**：`SceneRuntime` 从来没把真的 `lightFactory` 装进 `SceneGraph`，
  所有 `node.light` 都落到占位工厂的空 Group —— 层级树里有灯、gizmo 能拖、patch 能到，
  场景照样是黑的。T-131 与 T-130 各自全绿，因为两边都在对着对方的替身测。已装上并补一条
  直接断言"灯节点必须变成真的 three 灯"的测试。`bias` 由 T-131 的 LightFactory 应用，
  已有覆盖（light-factory.test.ts）

### [x] T-133 · 环境与背景（HDRI / IBL）
- **依赖** T-132 · **预估** 0.8d · **实际** 0.7h
- **独占** `packages/core/src/runtime/environment.ts`, `packages/core/src/runtime/scene-runtime.ts`（环境段）, `packages/core/test/runtime/environment.test.ts`
- **做** `AssetResolver` 取 `.hdr` 字节 → `RGBELoader.parse` → PMREM → `scene.environment`（`intensity` 走 `scene.environmentIntensity`）；`background.type === 'hdri'` 时同图作背景；`exposure` → `toneMappingExposure`；`hdriAssetId` 非空切 ACESFilmic、清空还原 v0 现状（进化规划 §4.1.4）；卸载与切换时 dispose PMREM 与纹理。
- **验收** 设 → 清 → 再设无泄漏（`renderer.info` 纹理计数还原）；无 HDRI 文档的 toneMapping 与 v0 相同
- **自测** `pnpm -F @w3/core test environment`
- **实际情况**：三处需要记：①用 `HDRLoader` 而不是卡片写的 `RGBELoader`——同一个 RGBE
  解析器，后者在 three 0.185 里是**已废弃别名**，构造时会打印弃用警告；零新增依赖
  （登记进 IMPL_NOTES §3）。②PMREM 需要真 GL，所以把「equirect → 预过滤」抽成可注入的
  `compile`，其余（选哪张、何时重取、场景读什么、释放什么）全是文档逻辑，纯 Node 可测；
  `renderer.info` 计数要 GL，改为对自己分配的对象记账并在测试里说明。③`scene.background`
  的所有权整体收进 `EnvironmentController`——原来 `applyBackground` 会在任何 meta 变更时
  把 `background.color` 刷到 HDRI 背景上，症状（改个项目名字，HDRI 背景变回灰）看起来
  和背景色八竿子打不着。

### [x] T-134 · 默认灯架条件退场 + 老文档观感回归
- **依赖** T-133 · **预估** 0.5d · **实际** 0.4h
- **独占** `packages/core/src/runtime/scene-runtime.ts`（installLighting 段）, `packages/core/test/runtime/default-rig.test.ts`
- **做** D14：文档无灯节点且 `environment.hdriAssetId` 为空 → 挂 v0 默认三灯 rig（不进文档、不可拾取）；出现任一灯或环境 → rig 整体退场；删光复原。加载 v1 fixture 断言 rig 存在且**三灯参数与 v0 逐项相等**（G0.5-6 的落点）。
- **验收** 增删最后一盏灯往返，rig 出场/退场正确；老文档观感回归绿
- **自测** `pnpm -F @w3/core test default-rig`
- **实际情况**：G0.5-6 那条测试里，v0 三灯的参数是**手抄的字面值**，不是从实现里读回来的。
  从实现读等于写 `rig.intensity === rig.intensity`，一条永远不会红的断言——而这正是一条
  晋级门槛该有的样子的反面。判据 `needsDefaultLightRig` 在 schema（T-122），编辑器与运行时
  不可能对"该不该挂默认灯"产生分歧。

### [x] T-135 · `setLight` 动作
- **依赖** T-131, T-134 · **预估** 0.5d · **实际** 0.7h
- **独占** `packages/core/src/eca/actions/light.ts`, `packages/core/src/eca/types.ts`, `packages/core/src/eca/headless.ts`, `packages/core/src/runtime/scene-runtime.ts`（ctx 实现段）, `packages/core/test/eca/actions.test.ts`, `packages/core/test/runtime-contract.ts`, `docs/ECA_SPEC.md`
- **做** 进化规划 §4.3：`RuntimeContext.setLight` 双实现 + 契约测试条目；动作五项齐全（schema / handler / ui / refs / describe，describe 中文）；目标节点非灯时 skip + error 日志（B9 同款语义）。**回写 ECA_SPEC.md** 动作表与 RuntimeContext 章节。`executor.ts` / `engine.ts` / 规则编辑器 diff 为空。
- **验收** 覆盖率门槛 14/14；规则编辑器零改动可编辑该动作（既有 rule-editor 测试自动把关）
- **自测** `pnpm -F @w3/core test eca`
- **实际情况**：`executor.ts` 与 `packages/editor` 的 diff **确为空**；**`engine.ts` 不为空**
  ——它的 `withCurrentEvent` 是手写逐方法委托，每加一个 RuntimeContext 方法都得改它一行，
  与动作类型无关（C5 的实质没破）。这条纪律对进化规划 §4.3 强制的四个新方法字面上不可满足，
  T-163 还会再撞一次。已登记 IMPL_NOTES §4 并给出修法（Proxy 委托），**未擅自重构引擎**。
  另两处：颜色字段用 `type: 'string'` 而不是新增 `'color'` 字段类型（§4.4 是封闭六种，
  加一种等于同时改规范和改规则编辑器）；契约测试的灯光读取器由 harness 提供而不是往
  `RuntimeContext` 上加 `getLight`——为测试方便加宽冻结清单，冻结就不再有意义。
  三次变异检验，其中**第二次一开始没抓住**：只传 intensity 时，把「目标必须是灯」的守卫
  整个删掉，测试照样全绿（往错的 Object3D 上写个数字在 JS 里是静默成功的）。断言改为同时
  传颜色后才转红——已写进契约测试的注释。

### [x] T-136 · 灯光 helper 与拾取（编辑态）
- **依赖** T-131 · **预估** 0.5d · **实际** 0.6h
- **独占** `packages/core/src/runtime/light-helpers.ts`, `packages/core/src/runtime/picker.ts`, `packages/core/test/runtime/light-helpers.test.ts`
- **做** `mode: 'edit'` 时为灯节点挂对应 helper + 不可见代理球供射线拾取（灯没有 mesh，点不中就没法选中调参）；helper 不进文档；`mode: 'play'` 下零 helper 对象；locked 灯不可拾取（沿 v0 语义）。
- **验收** 编辑模式点选灯节点命中正确 nodeId；play 模式 helper 计数为 0
- **自测** `pnpm -F @w3/core test light-helpers`
- **实际情况**：helper 图层挂在 `scene` 上、**不挂在 `graph.root` 下**，代价是 picker 要多
  认一个根（`setAuxRoot`，本卡独占里的 picker.ts 就是为这个留的）。理由：全览是
  `Box3.setFromObject(graph.root)`，而灯今天对这个盒子毫无贡献（没有几何体）——把点击代理
  放进文档图，会让"加一盏灯"改变整个场景的取景。代理用 `material.visible = false` 而不是
  `object.visible = false`：两者都不画，但射线检测测的是**对象**，对象级隐藏会让灯变成
  点不中的——那正是这层要解决的问题本身。
  写测试时抓到一个真 bug：`update()` 之后没刷新世界矩阵，而 picker 直接读 `matrixWorld`。
  生产里靠每帧 render 顺手刷新掩盖了，但用户在刚打开的工程上点第一下时 picker 先跑——
  那一刻所有代理还在原点，点哪盏灯都命中同一个位置。已在层内 `updateMatrixWorld(true)`。

---

> **M9「亮起来」收尾对抗式审查已完成**（T-130 ~ T-136）：三个视角，一条 major 当场修掉
> （退出预览后灯光 helper 指向已丢弃的灯对象），两条 minor 如实登记，两条怀疑被自己证伪。
> 详见 [IMPL_NOTES](IMPL_NOTES.md) §4。

## E14 · 对象库与放置体验

### [x] T-140 · PrimitiveFactory：七种原始体
- **依赖** T-130 · **预估** 0.5d · **实际** 0.6h
- **独占** `packages/core/src/runtime/primitive-factory.ts`, `packages/core/test/runtime/primitive-factory.test.ts`
  （+ `scene-runtime.ts` 一行接线，+ [ADR-0017](adr/0017-原始体的朝向与分段数.md)）
- **做** 七种语义尺寸 → BufferGeometry（分段数固化在 core，不进文档，进化规划 §4.1.2）；参数 patch → 几何重建 + 旧几何 dispose；bbox 正确（贴面放置依赖它）；`overrides.materialId` 缺失时兜底渲染中性灰 standard 并 warn（文档态由编辑器创建时显式挂默认材质，D15）。
- **验收** 每种一条尺寸断言（bbox 与语义尺寸一致）；参数更新后旧几何已 dispose（`renderer.info` 断言）
- **自测** `pnpm -F @w3/core test primitive-factory`
- **实际情况**：规范只冻结了语义尺寸，没写**朝向**与**分段数**，两者都是改不回来的决定，
  按铁律 12 先写 [ADR-0017](adr/0017-原始体的朝向与分段数.md)：七种体全部沿用 three 的默认
  朝向（plane 因此是竖着的，想要地面自己转 90°，且这个旋转落在文档的 `transform.r` 里——
  烘进几何等于给用户一份看不见也改不掉的隐藏状态），分段数写死在 core。
  旧几何 dispose 用 three 的 `dispose` 事件断言，不用 `renderer.info`——后者要真 GL 上下文，
  而这条断言的内容（"改一次尺寸不泄漏一个 buffer"）本身不需要 GPU。
  **接线断言单独写了一条**：T-132 刚因为"工厂建好了、分发建好了、没人接线"栽过一次，
  同形状的坑一个文件之隔，不靠推断。变异检验：去掉 `{ primitives: primitiveFactory }`
  → 3 条转红。

### [ ] T-141 · 资源库面板（对象页签）
- **依赖** T-122, T-140, T-145 · **预估** 1d · **实际** ___
- **独占** `packages/editor/src/panels/LibraryPanel.tsx`, `packages/editor/src/lib/library.ts`, `packages/editor/test/library.test.ts`
- **做** 资源库面板骨架（页签：对象 / 纹理 / 环境，后两个页签本卡占位、T-155 填充）；对象页签 = 7 种原始体 + manifest 内置模型；双击 = 放到视口中心地面，拖出 = 进入 T-142 放置流程；库模型首次引入走**既有导入管线**（hash 查重、体检、缩略图），二次引入命中缓存不重复存储。
- **验收** 断网下面板完整可用；库模型引入后出现在资产面板；创建原始体时 `ensureDefaultMaterial` 生效（材质面板非空）
- **自测** `pnpm -F @w3/editor test library` + `pnpm dev` 目视

### [ ] T-142 · 拖拽放置与落点规则
- **依赖** T-141 · **预估** 0.8d · **实际** ___
- **独占** `packages/editor/src/viewport/place.ts`, `packages/editor/src/viewport/Viewport.tsx`（drop 接线）, `packages/editor/test/place.test.ts`
- **做** D18：拖到视口 → 射线命中场景表面 → 包围盒**底面**对齐命中点；未命中 → 地平面 y=0；拖拽中的幽灵预览走 `preview` 通道；松手 = **一条 commit**（新建节点 + 挂默认材质一体）。
- **验收** 一次放置在撤销栈里恰好一条，Ctrl+Z 整体消失；贴面与落地两分支均有测试
- **自测** `pnpm -F @w3/editor test place` + `pnpm dev` 目视

### [ ] T-143 · 吸附（网格 / 角度）
- **依赖** T-142 · **预估** 0.5d · **实际** ___
- **独占** `packages/core/src/runtime/gizmo.ts`（snap API）, `packages/editor/src/viewport/SnapToolbar.tsx`, `packages/editor/test/snap.test.ts`
- **做** core gizmo 增 `setSnap({ translate?: number; rotateDeg?: number })`；工具栏：网格 0.1 / 0.5 / 1 m 三档 + 角度 15° 开关；吸附同时作用于 gizmo 拖拽与 T-142 的放置落点；设置为**编辑器会话态**（不进文档、不进 localStorage，D18）。
- **验收** 开吸附拖动后文档坐标为格点值；关吸附行为与 v0 完全一致
- **自测** `pnpm -F @w3/editor test snap` + `pnpm dev` 目视

### [ ] T-144 · 复制 / 粘贴 / Ctrl+D
- **依赖** T-122 · **预估** 0.5d · **实际** ___
- **独占** `packages/editor/src/store/clipboard.ts`, `packages/editor/src/shortcuts.ts`（增）, `packages/editor/test/clipboard.test.ts`
- **做** 复制节点**子树**：全部新 id、保持相对层级与 order 间隔、材质引用共享（不 clone 记录）、**不复制规则与热点**（灰区裁决）；粘贴位置 = 原位偏移 `[0.2, 0, 0.2]`；一次粘贴一条 commit；剪贴板为内存态（跨项目粘贴不支持）。
- **验收** 粘贴后 `checkIntegrity` 零 error；undo 一步整树消失；输入框聚焦时快捷键不误触发（沿 T-071 语义）
- **自测** `pnpm -F @w3/editor test clipboard`

### [x] T-145 · 内置库 manifest 机制与 starter 内容
- **依赖** T-120 · **预估** 0.8d · **实际** 0.7h
- **独占** `packages/editor/public/library/**`, `scripts/gen-library-starter.mjs`, `scripts/check-library-manifest.mjs`, `docs/LICENSES_LIBRARY.md`
- **做** manifest schema（id / 名称 / 类别 model|texture|hdri / 文件相对路径 / 预览图 / **license 必填**）+ 加载校验；`check-library-manifest.mjs`：零外链 + license 必填，静态扫描；starter 内容**程序化生成**（D17）：纹理若干（棋盘 / 噪声 / 拉丝金属色+法线，canvas 生成）、HDRI 2 张（渐变天空，RGBE 编码写出）、组合模型 2 个（gltf-transform 由原始体拼装）；真实美术内容包为人工供给（H2），本卡只交付机制与 starter。
- **验收** `node scripts/check-library-manifest.mjs` 绿；starter 总量 ≤ 40MB；断网可用；许可登记逐项可查（自产标 CC0）
- **自测** `node scripts/gen-library-starter.mjs && node scripts/check-library-manifest.mjs`
- **实际情况**：根目录脚本**取不到** workspace 的 `@gltf-transform/core`（它属于两个包，不属于
  根），所以 PNG / Radiance `.hdr` / glTF 二进制三个编码器全部手写（PNG 走 `node:zlib`，
  另两个直接写字节）。为一个 4 KB 的立方体给根加一个依赖是错的取舍。噪声用整数哈希不用
  `Math.random`——生成物必须逐字节可复现，否则每次跑脚本都是一次无意义的 diff。
  生成物经**真实解析器**验证：两张 `.hdr` 过 `HDRLoader`，两个 `.glb` 过 `GLTFLoader` 并解出
  带中文名的层级。starter 共 8 项 / 1.1 MB（预算 40 MB）。校验脚本做了六次变异检验：外链、
  缺 license、文件不存在、绝对路径、id 重复、类别越界，六种坏 manifest 全部被拦。
  纳入 `pnpm check:constitution` 是 T-173 的事，本卡不动 check-constitution.mjs。

---

## E15 · 材质与纹理

### [x] T-150 · 纹理与 HDRI 导入管线
- **依赖** T-120 · **预估** 0.8d · **实际** 0.9h
- **独占** `packages/editor/src/lib/import-flow.ts`（图像段）, `packages/core/src/assets/audit.ts`（图像增量）, `packages/core/src/assets/policy.ts`（增量）, 对应测试
- **做** 图片导入（png / jpg / webp → `type: 'texture'`；ktx2 透传）；`.hdr` 导入（→ `type: 'hdri'`）；体检增量：分辨率上限、非 2 幂 warn、bytes 阈值（阈值进 `policy.ts`，数值将回填附件A）；缩略图 = 缩放原图。
- **验收** 超标项 advice 具体（"4096 降 2048"而非"请优化"）；同图二次导入命中 hash 不重复存储
- **自测** `pnpm -F @w3/core test audit && pnpm -F @w3/editor test import-flow`
- **实际情况**：尺寸从**文件头**读，不解码。三个理由都成立：纯 Node 可测（C8）、发生在解码
  **之前**（R01 的前提就是"报告一个大到不该加载的资产"，解码它来得知它太大等于自相矛盾）、
  以及 `.hdr` / `.ktx2` 浏览器根本解不了。顺带写了 png/jpeg/webp(三种编码)/ktx2/hdr 五种头。
  METRICS 加了 `scopes`：一张 PNG 拿 `maxTriangles` 评级会报「三角面数 0 / 300,000 通过」，
  不算错，但正是教人不再读体检报告的那种噪声。NPOT 检查不是阈值判定，所以 MetricSpec 加了
  可选的 `level` —— 硬塞进比较会让存下来的 `limit` 变成一句假话。
  图片**自己就是自己的缩略图**（`<img>` 直接能显示），`.hdr` 没有缩略图（任何浏览器都显示
  不了未色调映射的 HDR，给个坏图不如给个类型图标）。
  **本卡新建了测试文件 `core/test/assets/audit-image.test.ts`**——卡片的自测命令
  `test audit` 原来一条测试都匹配不到（审计测试住在 pipeline.test.ts 里）。
  另动了两个 独占 外的文件：`pipeline.test.ts` 的 describePolicy 断言（7 行 → 按 scope 取），
  和 `AssetPanel.tsx` 的 accept / 分派（不改它的话新路径无法从 UI 到达，等于交付了一段
  死代码）。三次变异检验：JPEG 帧头假设固定偏移、NPOT 变成 fail、grade 忽略 scope。

### [ ] T-151 · 贴图槽位应用与纹理缓存（core）
- **依赖** T-130, T-150 · **预估** 0.8d · **实际** ___
- **独占** `packages/core/src/runtime/material-registry.ts`, `packages/core/src/runtime/texture-cache.ts`, `packages/core/test/runtime/material-registry.test.ts`
- **做** 六个贴图槽位接通：`AssetResolver` 取字节 → Texture（按 assetId 缓存 + 引用计数 dispose）；**色彩空间按槽位固定处理**（D3 的表不变：map/emissiveMap 走 sRGB，normal/roughness/metalness/ao 保持线性）；`uv` 块（repeat / offset / rotationDeg）应用到全部已挂槽位；aoMap 的 UV 通道按 three 0.185 行为处理并加回归断言；一切仍走 clone-on-write。
- **验收** 共享同源材质的两个 mesh，其一挂图另一不变（铁律 9 回归）；uv 更新增量生效不重建材质实例
- **自测** `pnpm -F @w3/core test material-registry`

### [ ] T-153 · physical 参数与 base 升级（core）
- **依赖** T-151 · **预估** 0.5d · **实际** ___
- **独占** `packages/core/src/runtime/material-registry.ts`（physical 段）, `packages/core/test/runtime/material-registry.test.ts`（增）
- **做** `MeshPhysicalMaterial` 参数应用（transmission / ior / thickness / clearcoat / clearcoatRoughness）；`base` 在 standard ↔ physical 间切换时重建材质实例并迁移共有参数；`transmission > 0` 时的透明处理规则固化并写测试。
- **验收** 玻璃参数组合渲染路径无 NaN / console 警告；base 切换往返参数不丢
- **自测** `pnpm -F @w3/core test material-registry`

### [ ] T-152 · 材质面板 v2（贴图 / UV / physical）
- **依赖** T-151, T-153 · **预估** 0.8d · **实际** ___
- **独占** `packages/editor/src/panels/MaterialPanel.tsx`, `packages/editor/src/widgets/TexturePicker.tsx`
- **做** 六槽位 UI + `TexturePicker`（项目资产页 + 内置纹理库页，选库图即触发引入流程）+ 清除槽位；uv 三控件（走 preview / previewCommit 支持拖拽调节）；`base === 'physical'` 时展开 physical 参数区。改动一律走 commit。
- **验收** 黄金路径 II 第 5 步可完成；共享材质陷阱目视复验
- **自测** `pnpm dev` 目视 + `pnpm -F @w3/editor test`

### [ ] T-154 · 材质预设库
- **依赖** T-152 · **预估** 0.8d · **实际** ___
- **独占** `packages/editor/src/lib/material-presets.ts`, `packages/editor/src/panels/MaterialPanel.tsx`（预设区）, `packages/editor/test/material-presets.test.ts`
- **做** 预设数据 ≥ 10 种（拉丝金属 / 抛光金属 / 哑光塑料 / 亮面塑料 / 橡胶 / 玻璃 / 磨砂玻璃 / 木 / 陶瓷 / 亚克力），每种 = 一组全量 params；应用 = 全量参数 commit + 记录 preset 名（D16 填充器语义）；应用前共享检测：材质被 >1 节点引用时提示「分离后应用 / 应用到全部」二选一；「分离材质」按钮（clone 记录，commit）。
- **验收** 应用预设后删除整个库目录，发布包照常渲染（D16 的验证）；分离后原节点独立可改
- **自测** `pnpm -F @w3/editor test material-presets`

### [ ] T-155 · 资源库纹理 / 环境页签
- **依赖** T-141, T-145, T-150, T-133 · **预估** 0.5d · **实际** ___
- **独占** `packages/editor/src/panels/LibraryPanel.tsx`（纹理 / 环境页签区）
- **做** 纹理页签：starter 纹理陈列，点选 → 引入为资产，若当前选中节点有材质则提供"挂到 map 槽位"快捷流；环境页签：HDRI 陈列，点选 → 引入 + 设 `meta.environment.hdriAssetId` + `background.type = 'hdri'`，**一条 commit**。
- **验收** 黄金路径 II 第 7 步可完成；撤销一步环境整体还原
- **自测** `pnpm dev` 目视

---

## E16 · 多媒体

### [ ] T-160 · 媒体导入与记录
- **依赖** T-150 · **预估** 0.8d · **实际** ___
- **独占** `packages/editor/src/lib/import-flow.ts`（媒体段）, `packages/core/src/assets/policy.ts`（媒体阈值）, 对应测试
- **做** audio / video / image 导入 → asset（对应 type）+ media 记录（`name` = 原文件名；`durationS` 经 `HTMLMediaElement` 元数据读取，失败置空 + warn）；policy 增量：音频 ≤ 10MB、视频 ≤ 50MB、格式白名单（mp3/wav/ogg · mp4/webm · png/jpg/webp）。
- **验收** `durationS` 与真实时长误差 < 0.1s；超标与格式外文件的 advice 具体
- **自测** `pnpm -F @w3/editor test import-flow`

### [ ] T-161 · 媒体库面板
- **依赖** T-160 · **预估** 0.5d · **实际** ___
- **独占** `packages/editor/src/panels/MediaPanel.tsx`
- **做** 列表（类型图标 / 名称 / 时长 / 大小）、试听与预览、重命名、删除走 `refsTo` 确认（"该媒体被 1 个热点、2 条规则引用，确认删除？"）。
- **验收** 删除有引用媒体时提示准确；黄金路径 II 第 8 步可完成
- **自测** `pnpm dev` 目视

### [ ] T-162 · 热点媒体内容
- **依赖** T-160 · **预估** 0.8d · **实际** ___
- **独占** `packages/core/src/runtime/hotspot-layer.ts`, `packages/editor/src/panels/HotspotPanel.tsx`, `packages/core/test/runtime/hotspot.test.ts`（增）
- **做** 热点面板渲染 `content.mediaId`：image 自适应展示、video 原生 controls；字节经 `AssetResolver` → Blob URL，面板关闭 / 文档卸载时 revoke（生命周期计数管理）；编辑器 HotspotPanel 增媒体选择（`ref` 字段，refKind `'media'`）。**播放器零改动自动获得**（同一 core 渲染层，C3）。
- **验收** 编辑预览与 Player 面板渲染一致；revoke 计数归零无泄漏
- **自测** `pnpm -F @w3/core test hotspot`

### [ ] T-163 · `playMedia` / `stopMedia` 动作与 MediaBus
- **依赖** T-135, T-160 · **预估** 1d · **实际** ___
- **独占** `packages/core/src/runtime/media-bus.ts`, `packages/core/src/eca/actions/media.ts`, `packages/core/src/eca/types.ts`（增）, `packages/core/src/eca/headless.ts`（增）, `packages/core/src/runtime/scene-runtime.ts`（ctx 实现段）, `packages/core/test/eca/actions.test.ts`（增）, `packages/core/test/runtime-contract.ts`（增）, `docs/ECA_SPEC.md`（回写）
- **做** `MediaBus`（`<audio>` 元素池、volume / loop、`AbortSignal` 停播、**自动播放解锁**：首次用户手势前的播放请求 resolve + warn 不 reject 不卡 sequence——风险 V3 的防线）；`RuntimeContext` 四方法双实现 + 契约条目；两个动作五项齐全；await 语义按 D19（headless 用假时钟 + `durationS`；`loop` 立即 resolve **必测**；`durationS` 缺失立即 resolve + warn）；`stopMedia('all')` 供 `resetScene` / 退出预览调用（预览退出必须音停）。
- **验收** 覆盖率门槛 16/16 全绿；纯 Node 环境全部通过；退出预览音频停止（B13 语义扩展）
- **自测** `pnpm -F @w3/core test eca`

---

## E17 · 质量收口

### [ ] T-170 · 黄金路径 II E2E
- **依赖** 全部功能卡 · **预估** 1d · **实际** ___
- **独占** `e2e/tests/golden-path-2.spec.ts`, `e2e/fixtures/gen-media-fixtures.mjs`（生成 warning.png / alarm.wav）
- **做** 进化规划 §2 的 12 步逐步覆盖；音频断言用运行时状态（`isMediaPlaying`）不断言声卡；断言 `fullRebuildCount === 0`；**黄金路径 I 的 spec 文件不改且保持全绿**；每步断言附变异检验（V6，防止重蹈 T-115 修的覆辙）。
- **验收** 连跑 5 次零 flaky；两条黄金路径同时全绿
- **自测** `pnpm test:e2e`

### [ ] T-171 · parity 扩展（灯光 / 媒体轨迹）
- **依赖** T-135, T-163, T-170 · **预估** 0.5d · **实际** ___
- **独占** `test/parity/**`
- **做** 事件脚本增两条规则：`setLight`、`playMedia(await: true)`（假时钟推进）；两侧 `ExecResult` 序列含新动作步骤且逐项相等；做两次变异检验（如改坏 headless 的 `setLight` → parity 必须红）。
- **验收** parity 绿 + 变异检验记录在提交信息
- **自测** `pnpm test:parity`

### [ ] T-172 · 老文档打开回归（编辑器侧）
- **依赖** T-134, T-120 · **预估** 0.5d · **实际** ___
- **独占** `packages/editor/test/legacy-open.test.ts`
- **做** 打开 v1 fixture 工程：静默迁移到 v2 → 层级树无新增节点（D14：不注入灯）→ 保存 → 重开往返稳定 → `checkIntegrity` 零 error。
- **验收** 全链路断言通过
- **自测** `pnpm -F @w3/editor test legacy-open`

### [ ] T-173 · 宪法与体积复核
- **依赖** T-145, T-170 · **预估** 0.5d · **实际** ___
- **独占** `scripts/check-constitution.mjs`（挂新检查）, `size-limit.config.js`（如需）
- **做** `check-library-manifest.mjs` 纳入 `pnpm check:constitution`；size-limit 复核（预算不变 gzip ≤ 400 KB——HDRI / 媒体 / 库内容全部走资产管线不进 bundle，本卡验证这一点）；断网构建 + 断网 `pnpm dev` 冒烟，结果记入 IMPL_NOTES §2。
- **验收** `pnpm check:constitution` 全绿（含新项）；`pnpm size-limit` 通过并记录余量
- **自测** `pnpm check:constitution && pnpm size-limit`

### [ ] T-174 · benchmark 灯光 / 阴影压力档
- **依赖** T-116, T-134 · **预估** 0.5d · **实际** ___
- **独占** `packages/player/src/bench/**`（压力档段）
- **做** bench 页增灯光档位：0 / 1 / 4 / 8 盏动态灯 × 阴影 off / medium / high，记录 fps / drawcall；结果表一键复制 Markdown；在可用机器实测一轮记入 `docs/BENCHMARK.md`（目标机器实测仍是 H1 人工项 = G0.5-8）。
- **验收** 档位切换即时生效；BENCHMARK.md 有本机数据
- **自测** 人工跑 bench 页

### [ ] T-175 · 文档与指标收口
- **依赖** T-170~174 · **预估** 0.5d · **实际** ___
- **独占** `docs/METRICS.md`, `docs/BENCHMARK.md`, `docs/附件A_数字资产规范_草案.md`, `README.md`, `docs/DEVELOPMENT.md`, `docs/TASK_BACKLOG_V0_5.md`（回填）
- **做** METRICS 增 v0.5 快照（新增动作数 16、E2E 总步数 24、`fullRebuildCount`、Player 体积、库内容体积、新增动作所需文件数是否仍 ≤3）；附件A 增补纹理 / HDRI / 媒体规格（数值全部来自 `policy.ts` 与 bench 实测，不拍脑袋）；DEVELOPMENT 增"如何新增一种灯 / 材质预设 / 库内容"操作节；台账回填。
- **验收** 每个数值有来源；一个没参与过的人照文档能新增一种材质预设并跑通
- **自测** 人工评审

### [ ] T-176 · v0.5 全量对抗式审查
- **依赖** T-175 · **预估** 1d · **实际** ___
- **独占** `docs/IMPL_NOTES.md`（登记）
- **做** ≥ 4 个维度并行找问题（规范一致性 / 假绿测试 / 宪法违背 / 性能悬崖），每条发现由 3 个独立视角试图证伪；blocker 与 major 修复，其余如实登记进 IMPL_NOTES §4（v0 的先例：22 条发现存活 18 条，其中 2 条 blocker 全部有单测覆盖周边却没被发现——测试测的是函数，不是函数的用处）。
- **验收** 发现清单与修复 / 登记状态入 IMPL_NOTES；无未登记的已知问题
- **自测** 人工评审

---

## 收尾：v0.5 晋级门槛核对

全部任务卡完成后，逐条核对 [NORTH_STAR.md](NORTH_STAR.md) §3 的 G0.5-1 ~ G0.5-8：

- [ ] G0.5-1 黄金路径 II 全绿 + 黄金路径 I 回归全绿（T-170）
- [ ] G0.5-2 宪法检查全绿，含库 manifest 零外链（T-173）
- [ ] G0.5-3 v1 + v2 fixture 迁移回归全过（T-120）
- [ ] G0.5-4 parity 含灯光 / 媒体轨迹（T-171）
- [ ] G0.5-5 动作覆盖 100%（16/16）（T-135 / T-163）
- [ ] G0.5-6 老文档默认观感回归（T-134 / T-172）
- [ ] G0.5-7 Player gzip ≤ 400 KB（T-173）
- [ ] G0.5-8 目标机器 benchmark 实测（T-174 + H1，**顺延的 G0-7**）

八条全过 → v0.5 完成，可以开工 v1。**任何一条不过，不许开工 v1。**

---

**预估总计**：约 25 人日（清债 2.1 + schema 2.5 + 光照 4.4 + 对象与放置 4.1 + 材质纹理 4.2 +
多媒体 3.1 + 质量收口 4.5）。与 v0 的 42 人日相比几乎减半，原因是底座在替 v0.5 干活：
灯和原始体复用了节点的全部机制（层级 / gizmo / 撤销 / patch），三个新动作复用了注册表，
媒体复用了 v1 就预留的字段。**如果实际耗时显著超出这个数，最可能的原因是有能力没有
"长在底座上"而是另起炉灶——先查 D12 / D15 / V9，再查排期。**
