# 实现记录 · BUILDER

**性质**：实现侧的实测数据与未验证项登记。**不是需求文档。**
**为什么单独一份**：MVP_V0 §4 与 TASK_BACKLOG 要求把实测版本号与任务状态回填进规划文档本身，
但规划类 MD 在本工作流中是只读的。数据落在这里，回填由人工决定是否执行。

---

## 1. 实测依赖版本

MVP_V0 §4《实测版本》表对应的实际安装结果。3D 相关依赖全部精确版本，无 `^` `~`。

| 包 | 版本 | 所属 | 备注 |
|---|---|---|---|
| three | 0.185.1 | @w3/core | 精确锁定。**不自带 TS 类型**，另装 `@types/three` |
| @types/three | 0.185.1 | @w3/core / @w3/editor (dev) | 与 three 同版本 |
| zod | 4.4.3 | @w3/schema | 由 schema 转出给 core，见 ADR-0007 |
| idb | 8.0.3 | @w3/storage | 仅 IndexedDbProvider 内部使用 |
| fflate | 0.8.3 | @w3/storage | `.w3p` 打解包 |
| react / react-dom | 19.2.8 | @w3/editor | |
| zustand | 5.0.14 | @w3/editor | |
| immer | 11.1.15 | @w3/editor | `produceWithPatches` 做撤销重做 |
| @gltf-transform/core | 4.4.2 | @w3/editor | 资产体检 |
| @gltf-transform/functions | 4.4.2 | @w3/editor | 归一化 |
| vite | 8.1.5 | editor / player (dev) | |
| @vitejs/plugin-react | 6.0.4 | @w3/editor (dev) | |
| typescript | 7.0.2 | 根 (dev) | 原生编译器，与 tsup 的 dts 不兼容，见 ADR-0003 |
| tsup | 8.5.1 | 根 (dev) | 只产 JS |
| vitest | 4.1.10 | 根 (dev) | |
| @vitest/coverage-v8 | 4.1.10 | 根 (dev) | |
| jsdom | 30.0.1 | @w3/editor (dev) | |
| fake-indexeddb | 6.4.0 | @w3/storage (dev) | 人工批准（R1-Q3）。真实 IndexedDB 实现，非桩 |
| @gltf-transform/core | 4.4.2 | @w3/core | §4 锁定选型。体检在 GPU 资源创建前跑；也用于测试中构造真 GLB |
| pnpm | 11.12.0 | — | 工作区配置在 `pnpm-workspace.yaml`，不在 `.npmrc` |

**未安装且已决定不装**：`@react-three/fiber`（ADR-0009）、UI 组件库（ADR-0010）。
**未安装、待定**：`postprocessing`（v0 刻意不引 EffectComposer，R07 整体推到 v1）、
`@playwright/test`（会下载浏览器二进制，未在无人确认时执行）。

### 环境

Node v24.18.0 · pnpm 11.12.0 · git 2.48.1 · Windows 11

---

## 2. 未验证项（重要）

以下代码已实现但**在当前环境下未被真实执行过**，不得当作已验证。

| 项 | 状态 | 原因 | 何时能验证 |
|---|---|---|---|
| `IndexedDbProvider` 契约 | ✅ **已真实执行** | 经批准引入 `fake-indexeddb` | — |
| IndexedDB 的配额、跨标签页锁、超大 blob | **未验证** | fake-indexeddb 不模拟这些；E2E 只走了正常读写 | 需人工造配额压力 |
| `WebGLRenderer` 的实际绘制 | ✅ **已真实执行** | E2E 在 SwiftShader 下回读 canvas 像素并断言内容 | — |
| 编辑器的交互：导入、选中、改属性、撤销重做、重命名、删除、保存刷新、预览 | ✅ **已真实执行** | `pnpm test:e2e` 九步，连跑 5 次零 flaky | — |
| gizmo 拖拽手感、层级树拖拽改父、多选与 Shift 范围选 | **未验证** | E2E 未覆盖指针拖拽序列 | 人工 `pnpm dev:editor` |
| 1000 节点时层级树的流畅度 | **未测量** | 需构造大文档 | T-110 |
| GLB 加载 / 体检 / 实例化 | ✅ **已真实执行** | gltf-transform 在内存造真 GLB，GLTFLoader 在 Node 解析 | — |
| SceneRuntime 组装与生命周期 | ✅ **已真实执行** | 渲染器可注入，除 GL 调用外全部跑到 | — |
| Draco / KTX2 解码器实际加载 | **未执行** | E2E 用的 GLB 未压缩 | 需一个 Draco 压缩的测试资产 |
| `--offline` 断网构建（C6 / T-006） | **未执行** | 未在断网环境实测 | 需人工断网后跑 `pnpm build` |
| Player 体积预算 gzip ≤ 400KB | **未测量** | Player 尚未实现 | T-105 |
| benchmark 实测（G0-7） | **未执行** | 需目标机器 | T-110 → 顺延为 G0.5-8 / H1 |
| CI 工作流在 GitHub 上真跑一次 | ✅ **已真实执行** | 2026-07-31 推 main。前两轮红，第三轮两个 job 全绿（run 30660510375：verify 44s · E2E 2m1s）。红的两条见下方「T-117 首跑抓到的两条」 | — |

**Runtime 的可测边界**：three 的场景图、材质、Raycaster、相机数学、AnimationMixer 都不
需要 GL 上下文，所以 T-033~T-040 是**真跑过的**，不是"看起来对"。只有 `WebGLRenderer`
的实际绘制需要浏览器——那部分现在由 E2E 的像素断言覆盖。

**但是**：Node 里跑得再多也证明不了接线。评测报告里三个 P0 的每一个，单测都是全绿的。
E2E 上线第一天又抓到三个同类缺陷（材质注册表在图重建后丢覆盖、StrictMode 把自动保存
永久打死、退出预览没还原相机）。这条边界要记住：**单测证明零件对，只有 E2E 证明它们连着。**

`scripts/check-no-external.mjs` 在未构建的包上会打印
`NOT built, therefore NOT checked`，不会把"没查"报成"通过"。

---

## 3. 与规范的差异登记

每一条都有对应 ADR，且在代码注释中就地说明。

| # | 差异 | ADR |
|---|---|---|
| 1 | `Vec3` / `Quat` 收窄为有限数（规范写 `z.number()`） | ADR-0004 |
| 2 | 重映射失败时 `assetId` 仍迁到新资产（规范"保留原 ref"有两种读法） | ADR-0005 |
| 3 | `RuntimeContext` 增加 `currentEvent()` | ADR-0006 |
| 4 | core 经 `@w3/schema` 取 zod，不直接依赖 | ADR-0007 |
| 5 | 动作以数据导出后集中注册，非"导入即注册" | ADR-0008 |
| 6 | 声明文件由 tsc 生成，非 tsup dts | ADR-0003 |
| 8 | 编辑器 3D 层不使用 R3F（§4 锁定了 R3F） | ADR-0009 |
| 9 | v0 不引入 UI 组件库（§4 要求用成熟组件库） | ADR-0010 |
| 10 | 材质写时复制改为无条件克隆（D3 写的是"被 >1 引用才克隆"） | ADR-0011 |
| 7 | `checkIntegrity` 新增 `I3-actions-unchecked` 一档 info：未注入动作解析器时显式声明"动作参数内的引用未检查" | — （不改变任何检查项语义，仅拒绝把"没查"报成"通过"） |
| 11 | T-110 明列的「逐级加载压力测试」在任何规范里都没有定义，实现为场景副本倍增阶梯（×1/×2/×4/×8） | ADR-0016 |
| 12 | HDR 解析用 `HDRLoader` 而非进化规划写的 `RGBELoader` | — （three 0.185 里 `RGBELoader` 是已废弃别名，构造即打印弃用警告；同一个 RGBE 解析器，零新增依赖，不构成设计取舍） |
| 13 | 原始体的朝向与分段数：规范只冻结了语义尺寸，两者都没写 | ADR-0017 |

`@w3/schema` 中另加了两个规范未列出的文件：`selectors.ts`（纯查询，T-014 点名要 `getAncestors`
等）与 `rule.ts`（承载 EventDescriptor / Condition / Action 信封 / Rule 的数据形状——
它们被 `RuleSchema` 引用，而 schema 不能依赖 core）。

---

## 4. 任务卡状态

TASK_BACKLOG 已勾选：**72 张完成 / 1 张未开工**。

- **完成**：T-001 ~ T-006、T-010 ~ T-024、T-030 ~ T-041、T-050 ~ T-054、
  T-060 ~ T-072、T-080 ~ T-087、T-090 ~ T-093、T-100 ~ T-105、T-110、T-112 ~ T-114
- **未开工**：T-111（WebGL1 降级 —— 不可实现，见下）

### T-111 保持未勾选

three 0.185 已删除 `WebGL1Renderer` 且只请求 `webgl2` 上下文，卡片要求的降级
用当前锁定的依赖无法实现。交付的是能力检测与中文阻断页，不是卡片要求的东西，
所以不勾。决策、代价与撤销条件见 [ADR-0013](adr/0013-v0-不支持-webgl1.md)。

**商务影响**：只有 WebGL 1 的浏览器会看到说明页而不是内容。这是真实的商业损失，
需要在签约前与客户确认部署环境。

### 需人工确认的一项偏差

T-102 卡片指定 `packages/editor/src/preview/preview-session.ts`，实际放在
`packages/core/src/runtime/playback-session.ts`。理由是播放器不能依赖编辑器
（MVP §3 依赖方向），在卡片指定的位置上「两侧共用」与「依赖方向」互相排斥。

按 CLAUDE.md「什么时候必须停下来问人」第 5 条，任务卡验收标准与 SPEC 冲突
**应当停工问人**，而不是自行写 ADR 放行。已写 [ADR-0014](adr/0014-共用播放会话放在-core.md)
记录选择与代价，但**未自行销案**，等人工确认。

### 对抗式审查未修完的 11 条（人工审阅项）

2026-07-31 的一轮对抗式审查（4 维度并行找问题，每条发现由三个视角独立试图证伪）
产出 22 条发现，存活 18 条。已修 7 条（见提交 `ebcc9cf`），**剩余 11 条如实登记在此**：

| 严重度 | 发现 | 位置 | 状态 |
|---|---|---|---|
| major | E2E 第 9 步断言的是样例文档里原有的热点，「在选中对象上新建」整个坏掉也会绿 | `e2e/tests/golden-path-full.spec.ts:161` | ✅ T-115 已修 |
| major | E2E 第 8 步用 `.first()` 而非数量前后对比，「新建补间」不生效也会绿 | 同上 `:155` | ✅ T-115 已修 |
| major | E2E 第 6 步从头到尾没改过 roughness，定位到的「roughness 控件」其实是材质下拉框 | 同上 `:136` | ✅ T-115 已修 |
| major | bench p95 断言用 `toBeGreaterThanOrEqual(16.7)`，把 p95 实现成「最慢帧」也全绿 | `packages/player/test/bench-metrics.test.ts:41` | ✅ T-116 已修 |
| major | 缩略图取景断言从不读 `view.target`，唯一的朝向断言又用了 y=z=0 的样本 | `packages/core/test/assets/thumbnail.test.ts:89` | ✅ T-115 已修 |
| minor | `from-the-future` 包在 `unpackScene` 就抛出，`assertCompatible` 的中文提示成了死代码 | `packages/storage/src/package.ts:143` | ✅ T-116 已修 |
| minor | `BENCH_LIMITS.textures` 被断言「来自 policy」，但 `gradeScene` 不用它评级 | `packages/player/test/bench-metrics.test.ts:29` | ✅ T-116 已修 |
| minor | benchmark 缺卡片明列的「逐级加载压力测试」 | `packages/player/src/bench/main.ts` | ✅ T-116 已补（ADR-0016） |
| minor | T-105 的「超标 CI fail」没有落点：仓库里没有任何 CI 配置 | `package.json` | ✅ T-117 已补（`.github/workflows/ci.yml`；推送验证待授权） |

> 上面写的是「剩余 11 条」，表里只有 9 行——v0 收尾时的计数与登记对不上，本身就是一条
> 登记纪律缺陷。以表为准：9 条有位置、可复核；另 2 条无据可查，不再追认。

**前五条都是「测试断言不到点上」**，也就是它们保护的功能改坏了也不会红。这类问题
比功能缺陷更值得优先处理——一个假绿的测试会让后续每一次改动都失去保护。

被证伪的 4 条不予采纳，其中一条我原本会误信：「parity 对资产解析分叉结构性失明」，
验证者实测证明加一条含 `wait` 的规则时 parity 确实会红。

**清偿进度（v0.5 M7）**：T-115 修 4 条、T-116 修 4 条，剩 T-117 的 CI 一条。
八条修复各附一次变异检验（把被测行为改坏 → 测试转红），记录在对应提交信息里。

### T-117 首跑抓到的两条（均已修）

| 严重度 | 发现 | 位置 | 处置 |
|---|---|---|---|
| major | **全新 clone 上 `pnpm -r typecheck` 直接失败**：`Cannot find module '@w3/schema'`。每个包都经 `types: ./dist/index.d.ts` 认识兄弟包（ADR-0003：声明由 tsc 出），全新机器上 `dist/` 不存在，所以类型检查一行都没查到就挂了。本机一直是绿的，因为 `dist/` 是上一次构建留下的 | `.github/workflows/ci.yml` · 各包 `package.json` 的 `types` | 已修：CI 里 `build` 提到最前 |
| major | **黄金路径第 12 步在没有显卡的机器上跑不完**：播放器检测到软件渲染会盖一层可关闭的「性能提示」（`.w3-capability`，见 `player/app.ts` + T-111），E2E 直接去点画布，被这层拦住，180 秒超时。产品行为本身是对的，**测试从来没走过这条分支**——写测试的机器全都有硬件 GL。而软件渲染对这个产品不是边缘情况：内网工作站、虚拟机、瘦客户端默认就是这个状态 | `e2e/tests/golden-path-full.spec.ts` | 已修：按真实用户的走法先关提示，并顺带断言提示内容与「仍然继续」真的让开。变异检验：把 `dismiss` 的 `box.remove()` 改成空操作 → 转红 |

> 两条都不是「CI 配置写错了」，是**本机与干净环境的差**：第一条差在 `dist/` 残留，
> 第二条差在开发机有显卡。工作流文件写完、YAML 校验过、每条命令本机跑通，头两轮
> 仍然是红的。**没跑过的 CI 配置与没有 CI 配置，可靠性是同一档。**
>
> 顺带记一条不修的观察（低）：编辑器在软件渲染下**不提示**，只有播放器提示。
> 作者机器与客户机器的假设不同，可以辩护；登记在此，v1 若统一再说。

### M9「亮起来」收尾对抗式审查（T-130 ~ T-136）

三个视角各扫一遍，每条发现都先写一个探针测试证实，再决定修还是登记。**未证实的怀疑不进表。**

| 严重度 | 视角 | 发现 | 处置 |
|---|---|---|---|
| major | 生命周期 | **每次 `resetScene()`（= 每次退出预览）之后，所有灯光 helper 都指着已被丢弃的灯对象**。three 的 helper 持有灯的引用并每帧读它的矩阵；`resetScene` 重建整个场景图，helper 于是冻在灯原来的位置上。`sync()` 看见节点还在就跳过，不会发现对象换了身份。代理球没坏（它每帧从图里重新取位置），所以**现象只出现在 helper 上，任何已有测试都看不见** | ✅ **已修**：entry 记住建构时的灯对象，身份变了就重建；`resetScene` 补一次 `sync`。变异检验：去掉那次 sync → 转红 |
| minor | 性能 | 每个 patch 批次要做**三次全节点扫描**（`syncDefaultRig` / `syncShadows` / `lightHelpers.sync`），外加 `sync` 里每次新建一个 Map。1000 节点的文档拖 gizmo 时约 18 万次节点访问/秒 | 登记不修。三者都是"场景级事实变了没有"的判断，没有单一 patch 路径负责；真要优化，做法是先看这批 patch 有没有碰过 `/nodes/**` 或 `/meta/environment/**`，碰过再扫。等 T-174 的 bench 有数再说，现在改属于凭感觉优化 |
| minor | C3 | M9 对"播放器自动获得灯光"的证据只有**`packages/player/src` 的 diff 为空**，没有轨迹层面的证明——parity 的输入文档（黄金路径 I）里一盏灯都没有 | 登记。T-171 的 parity 扩展就是补这个的，卡片已明写。在那之前，"播放器灯光正确"是**推断**不是观测，别当成已验证 |

被自己证伪、因此不登记的两条：①怀疑 `EnvironmentController.apply` 在 patch 路径上是
fire-and-forget 会漏未处理拒绝——读代码确认它内部全捕获，永不 reject；②怀疑代理球会挡住
它背后的对象——picker 按距离取最近命中，代理半径 0.18 且位于灯的中心，实测点击穿过它后面
的物体仍然命中物体（`follows the light when the node moves` 那条用的就是这个位置关系）。

### M10「摆得快」收尾对抗式审查（T-140 ~ T-145, T-150）

三个视角：**卡片字面 vs 实际接线**（卡上写了什么、代码里真接了什么）· **陈旧快照**（剪贴板
是快照，快照与文档之间隔着时间）· **变异存活**（哪些断言其实什么都没约束住）。每条发现都先
写探针证实再定处置。

| 严重度 | 视角 | 发现 | 处置 |
|---|---|---|---|
| major | 字面 vs 接线 | **库模型拖进视口毫无反应**。`LibraryPanel` 的模型条目 `setData('application/x-w3-library', item.id)`，而全仓只有这一处提到这个 MIME——视口的 `onDragOver` 只认 `x-w3-primitive`，`onDrop` 对其余一律早退。因为 `onDragOver` 不 `preventDefault`，光标还是"禁止放置"。T-141 卡面写的是「拖出 = 进入 T-142 放置流程」，原始体这条成立，**库模型这条从来没接上**。双击可用，所以面板"看起来是好的" | ✅ T-146 已修 |
| major | 字面 vs 接线 | **没有幽灵预览**。T-142 卡面写「拖拽中的幽灵预览走 `preview` 通道」，代码里一个字都没有。`resolveDropPoint` 的 `exclude` 参数注释写着"给拖拽预览用的"——设计想到了，接线没做。同类的还有 `offsetToRestOn`，注释自称"用于库模型"，**全仓零调用者** | ✅ T-146 已修 |
| minor | 字面 vs 接线 | **双击落点是世界原点，不是"视口中心地面"**（T-141 卡面）。`DROP_AT = [0,0,0]` 是个常量，而"视口中心"取决于相机——用户转过视角之后双击，物体落在画面外，现象是"点了没反应" | ✅ T-146 已修 |
| major | 陈旧快照 | **陈旧剪贴板会粘出悬空引用**：Ctrl+C 之后材质或资产记录消失，再 Ctrl+V，文档里就多出 I3 error（探针实测两条都复现）。卡片验收写的是「粘贴后 `checkIntegrity` 零 error」，而我的测试只覆盖了顺路径 | ✅ **已修**：粘贴时目标文档解析不了的引用一律丢弃（materialId 删掉、assetRef 置 null），节点本身照旧落地。变异检验：两处各去掉一次 → 同一条测试转红 |
| — | 可达性 | 上一条今天**用 UI 走不到**：v0.5 的编辑器里既不能删材质也不能删资产（全仓搜不到删除路径）。所以它是潜伏缺陷不是线上缺陷 | 已在代码注释里写明是护栏而非修复；T-154 材质预设库会让它变得可达 |

**T-146 接线之后又掉出四条**（全是只有真浏览器才看得见的，单测全绿时它们都在）：

| 严重度 | 发现 | 处置 |
|---|---|---|
| major | **取消一次拖拽会重建整个场景**。幽灵回滚的反向补丁是 `replace /nodes/3/transform/p` + `remove /nodes/3`，第一条指着一个已经不存在的下标 → 被当成不认识的补丁 → 全量重建。D1 的警报在「改主意了」上响，等于没警报 | ✅ 已修：字段补丁指向"本批次要删掉的节点"时是 no-op 而非回落。窄着写：只有"之前在、按 id 现在没了"才算，其余仍然回落。变异两向都转红 |
| major | **撤销第一次放置也会重建整个场景**。第一个原始体顺手造出 默认材质 记录，撤销时连它一起删，而"删材质"是 apply-patch 里少数几条**故意**回落全量重建的路径 | ✅ 已修两处：apply-patch 把受影响节点还原成自带材质（全量重建本来也就是干这个），并补上下标位移判断——不判断的话删 A 材质会把用 B 材质的节点也剥光；同时让幽灵**不再创建**材质记录，只借用已有的，落地时才真造 |
| major | **库模型的落点量不出来**。资产补丁是异步应用的（字节要先解析），紧接着 `boundsOf` 量到的是还没长出节点的场景图 → 永远 null → 模型永远不会被抬到表面上。**单测因为 stub 了 `boundsOf` 完全看不见** | ✅ 已修：`patchesSettled()` 暴露补丁队列，落点先等它 |
| minor | **撤销之后 gizmo 还挂在已经不存在的对象上**，three 每帧报一次 `The attached 3D object must be a part of the scene graph`，一次 E2E 跑几十条 | ✅ 已修：把「选区只能指活节点」变成 store 的不变量。按节点数守卫，拖 gizmo 那条每帧路径只多一次整数比较 |

前两条只有 E2E 里那句 `全量重建 = 0` 能看见：对象数对、撤销栈深度对、DOM 全对。第三条连
E2E 都看不见（模型确实出现了，只是没贴在表面上），是读 `createPatchForwarder` 的注释读出来的
——**注释写着"host 必须先 await ensureAssets"，而我的新调用方没有 await**。

> 这四条合起来把 M10 那条教训又推进了一格：**"给手势加测试"不够，还得让手势跑在真浏览器里。**
> `drop-controller.test.ts` 十五条全绿的同时，上面三条 major 全都在。差别在于单测里所有异步
> 边界和渲染副作用都被替身抹平了，而它们正是缺陷所在的地方。

**变异存活两条**（都补了断言才转红，过程记在 T-144 的提交信息里）：

- `taken.add(id)` 拿掉之后**没有任何测试转红**。原因是 `createSequentialIdFactory` 自带计数器，
  不管 `taken` 传什么都不会重复——现有测试根本碰不到这条契约。补了一个"会撞的工厂"：反复给
  同一个候选 id，只有被告知已占用才往前走。**教训**：用"永远不会出错的替身"去测"出错了怎么办"，
  测的是替身不是代码。
- 「一次粘贴一条 commit」改成逐节点提交之后**也没转红**。原因是 `History` 会合并 500ms 内的
  同名 commit，逐节点提交在 undo 下与一次提交完全同形——直到大粘贴超出窗口或标签不同才炸。
  改断言为「一次粘贴 = 一个补丁批次」（铁律 11），这条不会被合并窗口盖住。

被自己证伪、因此不登记的两条：①怀疑 `snapPosition` 会把落点的 y 也吸到网格上、导致物体陷进
地面——读代码确认 y 原样透传，`snap.test.ts` 里有直接断言；②怀疑拖拽时 `restOnPoint` 用的是
参数推的包围盒、与真实几何不一致——`primitiveBounds` 是从真实几何量出来的，T-140 已有对照测试。

> M10 的三条 major 里有两条是同一个形状：**卡面写了、注释也写了、就是没接线**，而单测全绿——
> 因为测的都是被调用的那一半（`place.ts` 的数学、`library.ts` 的导入），没有一条测试问过
> "这个函数有人调吗"。写成可执行的检查：**凡是卡面出现"拖 / 双击 / 点击"这类手势的，验收里
> 必须有一条走到 UI 事件入口的测试或 E2E 步骤**，否则手势层永远是测试盲区。

### T-135 登记的一条（未修，等人工裁决）

| 严重度 | 发现 | 位置 | 处置 |
|---|---|---|---|
| minor | **`engine.ts` 的 `withCurrentEvent` 是手写的逐方法委托**，所以每新增一个 `RuntimeContext` 方法都必须改 `engine.ts` 一行——哪怕新方法与任何动作类型都无关。v0.5 每卡纪律第 2 条要求「涉及 ECA 动作的卡，engine.ts 的 diff 必须为空」，而进化规划 §4.3 强制新增四个 RuntimeContext 方法：这两条**字面上互相矛盾**。T-163（media 三个方法）会再撞一次 | `packages/core/src/eca/engine.ts:54` | 本卡只加了 `setLight` 一行（无动作知识，C5 的实质未破），**没有擅自重构引擎**。建议改法：`withCurrentEvent` 改用 Proxy 委托——`get` 拦截 `currentEvent`，其余 `Reflect.get` 后 `bind(target)`，写入自然落到真实运行时上，从此不再需要逐方法列表。等人工确认后再动 |

### T-132 抓到的一条（已修）

| 严重度 | 发现 | 位置 | 处置 |
|---|---|---|---|
| blocker | **真的 `lightFactory` 从来没被装进 `SceneGraph`**：`new SceneGraph()` 用的是 `carrier-types.ts` 的占位工厂，于是每个 `node.light` 都materialise 成空 Group。层级树里有灯、gizmo 能拖、patch 能到、完整性检查通过——场景照样是黑的。T-131（工厂）和 T-130（分发）各自的测试都是全绿的，因为**两张卡都在对着对方的替身测自己那一半**，中间那根线没有主人 | `packages/core/src/runtime/scene-runtime.ts` | 已在 T-132 装上，并补一条直接断言「灯节点必须变成真的 three 灯、强度与角度都到位」的测试。变异检验：去掉 `{ lights: lightFactory }` → 2 条转红 |

> 这是"接口先行 + 占位实现"这套做法的固有风险：占位让两边都能独立开工，也让**没人接线**
> 这件事对两边的测试都不可见。教训写成一条可执行的检查：**凡是引入占位实现的卡，都要有一条
> 断言真实实现已被安装的测试**——不是断言真实实现正确（那是它自己的卡），而是断言它在生产
> 组装路径上真的被用上了。T-140 的 PrimitiveFactory 是下一个同形状的坑。

### T-120 抓到的一条（已修）

| 严重度 | 发现 | 位置 | 处置 |
|---|---|---|---|
| blocker | **编辑器恢复上次工程用 `validate` 而不是 `migrate`**。`schemaVersion` 是 `z.literal(CURRENT_VERSION)`，所以 v2 一上线，用户盘上每一份 v1 工程都校验失败 → 静默回落到样例场景。文档没丢，但用户看到的是别的场景，与数据丢失无法区分。v1 是唯一版本时这条完全看不出来 | `packages/editor/src/main.tsx:92` | 已改为 `migrate` + 升级日志。用一次性 Playwright 脚本往 IndexedDB 播种一份 v1 工程实测：打开、日志显示 v1→v2、层级树节点数不变（D14 没注入灯）；把 `migrate` 改回旧行为 → 转红。常设回归测试归 T-172 |

> 这条是 schema bump 的连带缺陷，不是 schema 本身的错——但它说明**版本号 +1 的影响面不止
> `@w3/schema`**。下次 bump 前先搜一遍 `validate(` 的调用点：每一处"读外部来的文档"都必须
> 是 `migrate`。

### T-115 期间新发现（未修，登记）

| 严重度 | 发现 | 位置 | 处置 |
|---|---|---|---|
| major | 黄金路径 12 步跑完，`fullRebuildCount` 实际为 **1**：第 12 步删节点/撤销一带有 3 条 patch 未被识别，回落全量重建。E2E 只在第 6、11 步断言过 `全量重建 = 0`，断言点全在这次回落之前，所以一直是绿的（铁律 11 的报警器在整条路径上其实没有生效） | `packages/core/src/runtime/apply-patch.ts` · `e2e/tests/golden-path-full.spec.ts` | 已确认**先于 T-115 存在**（stash 掉本卡改动后复跑，警告照旧）。T-170 卡片明写要断言 `fullRebuildCount === 0`，届时必须先定位这 3 条 patch 再谈达标 |

发现方式：跑 E2E 时 dev server 转发的 `[runtime] applyPatch 回落到全量重建（第 1 次）：3 条
patch 未被识别` 一直在日志里，但没有任何断言看它。**日志里说了、没人断言的东西，等于没说。**

### 晋级门槛现状（NORTH_STAR §3）

| # | 门槛 | 状态 | 证据 |
|---|---|---|---|
| G0-1 | 黄金路径 12 步 E2E 全绿 | ✅ | `pnpm test:e2e` 10/10，连跑 5 次零 flaky |
| G0-2 | `pnpm check:constitution` 全绿 | ✅ | 四项 PASS，且已改为 `--require-build`（播放器没构建不再算通过） |
| G0-3 | Schema 迁移回归 | ✅ | schema 144 条全绿 |
| G0-4 | 编辑器预览 / 播放器 轨迹一致性 | ✅ | `pnpm test:parity` 3 条，两次变异检验确认会红 |
| G0-5 | 已注册动作 100% 无 GPU 单测 | ✅ | core 388 条全绿 |
| G0-6 | 二次上传重映射（含 orphan） | ✅ | — |
| G0-7 | benchmark 目标机器实测 | ❌ | 页面已可独立运行，**缺目标机器实测数据** |

**6/7 通过。** 唯一未过的 G0-7 差的不是代码，是一次在客户机器上的实测。
