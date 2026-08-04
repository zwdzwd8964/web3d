# v1 任务卡清单（v1.0 / v1.2 / v1.5 三级台阶）

**用法**：agent 一次领一张，做完跑自测命令，绿了改 `[x]` 并回填耗时，再领下一张。
**上位文档**：[MVP_V1_进化规划.md](MVP_V1_进化规划.md) · [NORTH_STAR.md](NORTH_STAR.md) · [CLAUDE.md](../CLAUDE.md)（每张卡的 DoD 在那里）
**历史台账**：[TASK_BACKLOG.md](TASK_BACKLOG.md)（v0，只读）· [TASK_BACKLOG_V0_5.md](TASK_BACKLOG_V0_5.md)（v0.5，只读）

---

> ### ✅ 三条已于 2026-08-03 由产品负责人拍板 —— 可以开工 T-200
>
> **本台账文首原有的三条待确认（此处沿用台账自己的 P-1 / P-2 / P-3 编号）全部有了答案。**
> ⚠ **编号提醒**：拍板结果清单用的是另一套编号（P-1 ~ P-20）。台账的 P-1 / P-2 与拍板清单的
> P-1 / P-2 恰好指同一件事；台账的 **P-3（合同措辞四处差异）** 对应的是拍板清单的
> **P-9 / P-10 / P-11 / P-12** 四项，**不是**拍板清单的 P-3（新增 `overlayClick` 事件）。
> 引用时写清是哪一套，别串号。
>
> **P-1 · v1 拆成 v1.0 / v1.2 / v1.5 三级台阶 —— 批准。** 依据：13 份领域设计合并实测，v1.0 原范围
> 147 张卡 / ≈148 人日，瘦身版只省 21%——**范围定义本身才是杠杆，不是砍卡**。本台账已按三级
> 台阶撰写。这一条改 [NORTH_STAR.md](NORTH_STAR.md) §3 的版本阶梯，落地依据是 **ADR-0020**（由 T-212 写）。
>
> **P-2 · G0.5-8（目标机器 benchmark）的挂载方式 —— 批准 ADR-0022 的选项二。**
> **G0.5-8 不再是 v1 的入口前置**，改挂为 **v1.0 的出口人工验收项 H1**（规划 §7.2，归属 v1.0；
> **不是 G 系列**——它要一台真 GPU，机器判据只能核对报告 JSON 入库，不能核对帧率本身），
> 带到期版本号，**v1.0 收口时必须闭合**。承接卡 **T-291**（手册与三机采集）· **T-292**（阴影三档裁决），
> 两张卡都归 v1.0 收尾，回填位在附录 D 的 H1 行。**T-200 现在可以开工。**
>
> **P-3 · 合同措辞的四处差异 —— 逐项已裁**（对应拍板清单 P-9 / P-10 / P-11 / P-12）：
> 「特效效果」收窄为「**描边、雾等预设效果**」· 二维码**补回来**且本地生成（**T-454**）·
> 措辞里明写「**透明背景导出不含描边效果**」· 出图长边上限 **3840**。
> 爆炸与剖切在技术方案 §6.2 一行都没有这一条仍由 **T-212** 承接，产物是措辞 + 排除项。

---

## 0 · 字段解释与本版新纪律

每张卡的字段：

- **依赖**：必须先完成的卡（`v0.5` 表示依赖已完成的 v0.5 交付物）
- **预估**：人日。**不是** agent 时钟，换算见文末汇总表三
- **实际**：agent 实时耗时（小时）。只用来看**卡与卡之间**的相对大小和「是否显著超出预期」
  （CLAUDE.md 停工条款第 6 条）
- **独占**：这张卡会创建/修改的文件。**多 agent 并行时，独占文件不重叠的卡才能同时开工**；
  同分支串行卡允许独占重叠（波次表里排同一列即可）
- **做**：细到能直接交给 coding agent，不留「按设计稿实现」这种指向外部的空头支票
- **验收**：**必须可机器验证**。「人工评审」只允许出现在纯文档卡上，且必须给替代验收
- **自测**：具体命令
- **变异检验**：把被测行为故意改坏 → 测试必须转红。**本版每张卡都有这一栏**

标 ★ 的是**地基卡**——完成后同时解锁多条并行分支。标 ★★ 的是单卡波次。

### 本版新纪律（对每张卡生效）

1. **变异检验写进卡面，不是写进纪律。** v0.5 的 31 次变异有 8 次是绿的（26%）；13 份 v1 设计
   合计列出约 377 次变异，按同比例预期 **≈97 次不转红**。这不是风险，是排期事实：每张卡的
   「变异检验」栏里已经点出**这张卡最可能假绿的那一处**，转不红时**重写测试再来一轮**。
   **每一次变异——转红的和没转红的——都登记进 `docs/MUTATIONS.md` 的七列表**
   （卡号 / 编号 / 操作 / 期望 / 实际 / 若绿属哪一类 / 处置），**不是写进提交信息**：
   提交信息不可查询、不可统计、不可回填（风险 V25）。表与脚本由 **T-297** 交付，
   在它完成之前，`pnpm verify` 里没有这条锁——**但登记从第一张卡就开始，T-297 只是把它锁上**。
   **登记不转红的变异，比登记转红的更有价值。**
2. **能力链每一环都要有卡认领。** v0.5 的 T-137 与 v1 勘察出的 11 条「完整实现 + 有单测 +
   零生产调用者」是同一个失效模式的第 14 次复发。本版的机械对策是 **T-205**（成员级零调用者
   守卫）。卡面上凡是出现「面板 / 入口 / 按钮 / 对话框」的，**那一环必须在本卡内**，不许推给
   「后面某张 UI 卡」。
3. **新增被引用对象，先列出谁指向它。** 任何新增集合 / 新增 id 前缀 / 新增引用类型，卡面必须
   列出**五个遍历面**：`collectAllIds` · `checkIntegrity` 的 I1 集合表 · `buildIndex` 的出边 ·
   `referencedHashes` · 编辑器快照回滚的 `replaceInPlace`。少一个就是 v2 第一次写入时铸 id 撞车
   或发布漏字节。**T-201 把这五份清单收敛成一份注册表，之后新增集合只改一处。**
4. **测试覆盖零件，缺陷长在接缝上。** 凡是「A 实现了、B 调用它」的卡，验收里必须有一条断言
   **B 真的调用了 A**（不是断言 A 正确）。KTX2 解码器整整两个版本没被创建过，`ClipPlayer`
   整条栈零生产调用者——两条都不是零件坏了，是接缝没人测。
5. **每张卡完成后跑一次 `pnpm size`，把 gzip delta 记进提交信息。**
   v1.0 的体积门槛**维持 400 KB**（实测加总增量 +59.3 KB → ≈303 KB，不超）。
   NORTH_STAR §7 指标表里 v1 那格的 600 KB **下调为 400 KB**——预算是用来约束的，不是用来花的。
6. **`pnpm size-limit` 这个命令不存在**，正确的是 `pnpm size`。四份文档写错了，T-207 一次改完，
   `check-docs.mjs` 之后机械拦住。
7. **C3 验收口径统一**（`packages/player/src` diff 必须为空这条规矩，v1 有五份设计各自开了例外，
   加起来它什么都拦不住了）：**除 `bench/` 与 `embed/` 之外的文件，diff 只允许出现在 `app.ts` 的
   装配段，且必须逐行在提交信息里点名。** 允许的改动行数记进 METRICS，可趋势观察。由 T-207 写进
   CLAUDE.md 与规划。
8. **改 `StorageProvider` 形状 = 接口 + 两实现 + 契约测试**（三件套）。铁律 4 只覆盖 `SceneDocument`，
   覆盖不到 provider；IndexedDB 的版本阶梯是**第二条向前兼容链**，由 T-202 一次建齐并指定唯一所有者。

---

## 1 · 并行波次

单 agent 顺序模式可忽略本节，按编号从 T-200 做起。

**同一波次内，任何两张卡的独占文件不相交**——这是本表唯一的硬约束。原始合并稿报告
`integrity.ts` 被 10 张卡声明独占、`scene-runtime.ts` 被 13 张、`eca/types.ts` 与 `headless.ts`
各 10 张、`parity.test.ts` 被 7 张；本表已通过 **11 组合并 + 5 组拆分 + 4 条串行列**消解（清单见 §5）。

### 四条串行列（跨波次，列内严格顺序，列间可并行）

| 列 | 文件 | 顺序 |
|---|---|---|
| **列 R**（13 卡） | `packages/core/src/runtime/scene-runtime.ts` | T-200★ → T-214 → T-219 → T-235★ → T-231 → T-237★ → T-266 → T-270 →（v1.2）T-307 → T-319 → T-337 →（v1.5）T-429★ → T-443 |
| **列 T**（13 卡） | `packages/core/src/eca/types.ts` · `headless.ts` · `test/runtime-contract.ts` | T-203★ → T-240 → T-245 → T-268 →（v1.2）T-302 → T-305 → T-318 → T-307 → T-319 → T-320 → T-337 → T-338 →（v1.5）T-443 |
| **列 A**（7 卡） | `packages/editor/src/App.tsx` | T-282★ → T-288 → T-267 → T-290 →（v1.2）T-310 → T-311 →（v1.5）T-415 |
| **列 S**（5 卡） | `packages/storage/src/{provider,idb-provider,memory-provider}.ts` · `test/contract.ts` | T-202★ → T-286 → T-287 →（v1.5）T-427★ → T-449 |

> 这四条列**原本合计 46 卡次**（`scene-runtime.ts` 被 13 张卡声明、`eca/types.ts` 与 `headless.ts`
> 各 10 张、`test/parity/parity.test.ts` 7 张、`integrity.ts` 10 张）。合并之后降到 34 卡次，
> 且 `parity.test.ts` 与 `integrity.ts` 已完全退出串行列（各由一张所有者卡持有，其余以「追加」并入）。

**下面三张表已用脚本核对过：同一波次内任意两张卡的独占文件交集为空。**
（核对方式即 T-334 要交付的 `scripts/check-backlog-conflicts.mjs`——它先在这份台账上跑通，再进 `pnpm verify`。）

### v1.0「地基与表现力」

| 波 | 可同时开工 | 张数 | 前置 / 说明 |
|---|---|---|---|
| **W0** | ★T-200 · ★T-201 · ★T-202 · ★T-203 · ★T-204 · ★T-205 · ★T-206 · T-207 · T-217 · T-222 · T-224 | 11 | 无。**六张地基卡 + 冻结裁决表全部在这一波** |
| **W1** | T-208 · T-209 · T-210 · T-211 · T-212 · T-214 · T-215 · T-216 | 8 | T-208 排在 T-207 之后（`package.json`）；T-214 排在 T-200 之后（列 R） |
| **W2** | T-213 · T-218 · T-219 · T-221 · T-223 · T-297 | 6 | T-219 排在 T-218 之后（Draco / KTX2 分开取证）；T-297 排在 T-208 之后（`package.json`） |
| **W3** | T-220 · T-298 | 2 | 要 T-218 打印的真实 URL + T-219 的 `loader.ts` + T-221 的 `Dockerfile`；T-298 排在 T-205（`exemptions.mjs`）与 T-223（`check-constitution.mjs`）之后 |
| **W4** | **★★T-225 单卡波次。完成后停下来汇报。** | 1 | T-201 · T-206 |
| **W5** | T-226 · T-227 · T-228 · T-229 · T-230 · T-232 · T-234 | 7 | 全部只依赖 T-225 |
| **W6** | T-233 · ★T-235 · ★T-238 · T-255 · T-256 · T-258 · ★T-282 | 7 | T-233 与 T-232 共享 `package.ts` → 排其后 |
| **W7** | T-231 · T-236 · T-239 · T-262 · T-278 · T-286 | 6 | T-231 与 T-230 共享 `apply-patch.ts`、与 T-235 共享 `scene-runtime.ts` → 排两者之后 |
| **W8** | ★T-237 · T-240 · T-242 · T-243 · T-260 · T-263 · T-279 · T-287 | 8 | 列 R：T-235 → T-237；列 S：T-286 → T-287 |
| **W9** | T-241 · T-244 · T-247 · T-250 · T-252 · T-261 · T-264 · T-288 · T-291 · T-293 | 10 | T-244 与 T-243 共享 `scene-runtime.ts` → 排其后 |
| **W10** | T-245 · T-246 · T-248 · T-249 · T-251 · T-265 · T-266 · T-280 | 8 | T-249 与 T-247 共享 `explode-edit.ts`；T-251 与 T-248 共享 `Viewport.tsx` |
| **W11** | T-253 · T-254 · T-257 · T-267 · T-268 · T-269 · T-270 · T-271 · T-283 | 9 | T-268 与 T-246 共享 `actions/scene.ts` → 排其后 |
| **W12** | T-259 · T-272 · T-273 · T-284 · T-285 · T-290 · T-292 | 7 | T-290 与 T-257 共享 `removal.ts`、与 T-251 共享 `HierarchyTree.tsx` |
| **W13** | T-274 · T-275 · T-276 · T-281 · T-289 · T-294 | 6 | T-294 是 parity fixture 的唯一所有者 |
| **W14** | T-277 · T-295 · T-299 | 3 | T-277 与 T-275 共享 `DEVELOPMENT.md`；T-299 只新建 `packages/core/src/ai/**` 与 `index.ts` 一行导出，与本波两张卡零相交 |
| **W15** | T-296 | 1 | 全部 v1.0 卡 |

**v1.0 关键路径 16 波。** 若不做附录 A 的合并与串行列，`scene-runtime` / `eca/types` 两条链会把
关键路径拉到 25 波以上，墙钟翻 2 倍。

### v1.2「编排与复用」

| 波 | 可同时开工 | 张数 | 前置 / 说明 |
|---|---|---|---|
| **W16** | ★T-300 · ★T-301 · T-302 · T-303 · T-312 · ★T-323 | 6 | v1.0 收口 |
| **W17** | T-304 · T-305 · T-318 · T-324 · T-326 | 5 | T-305 与 T-302 共享 `eca/types.ts` → 排其后 |
| **W18** | T-306 · T-307 · T-313 · T-327 | 4 | T-307 与 T-318 共享 `headless.ts` → 排其后 |
| **W19** | T-308 · T-309 · T-319 · T-325 · T-328 | 5 | T-319 与 T-307 共享 `types.ts`/`headless.ts`；T-325 与 T-313 共享 `RulePanel.tsx` |
| **W20** | T-310 · T-314 · T-320 · T-329 | 4 | 列 A：T-310 → T-311；T-320 与 T-319 共享动画四文件 |
| **W21** | T-311 · T-316 · T-317 · T-321 · T-337 | 5 | T-311 排在 T-310 之后（`App.tsx`）；T-337 排在 T-319 之后（列 R + 列 T），且**必须早于 T-331（现在在 W23）**——`allActions().length === 27` 那条断言要等 `flyToView` 注册完才成立 |
| **W22** | T-315 · T-332 · T-334 · T-338 | 4 | T-338 与 T-320 共享动画四文件、与 T-337 共享 `headless.ts` / `runtime-contract.ts` → 排两者之后 |
| **W23** | T-322 · T-330 · T-331 · T-335 · T-336 | 5 | T-335 与 T-332 共享 `METRICS.md` → 排其后；**T-322 与 T-331 都由 W22 移到本波**——两张都要等 T-338（W22）：T-322 覆盖负 speed 的 parity，T-331 回写倒放语义与 `allActions().length === 27` |
| **W24** | T-333 | 1 | 全部 v1.2 卡 |

### v1.5「合同交付」

| 波 | 可同时开工 | 张数 | 前置 / 说明 |
|---|---|---|---|
| **W25** | ★T-400 · ★T-421 · ★T-427 · T-441 | 4 | v1.2 收口 |
| **W26** | T-401 · T-402 · ★T-422 · T-428 · T-440 · ★T-442 | 6 | 列 S：T-427 → T-428 |
| **W27** | T-403 · T-423 · T-424 · ★T-429 · T-433 | 5 | |
| **W28** | ★T-404 · T-425 · T-430 · T-434 · T-443 · T-444 · T-445 | 7 | T-443 与 T-429 共享 `scene-runtime.ts` → 排其后 |
| **W29** | T-405 · T-407 · T-410 · T-431 · T-435 · T-436 · T-446 · T-447 | 8 | 后端路由并行度最高的一波 |
| **W30** | T-406 · T-408 · T-432 · T-437 · T-449 | 5 | |
| **W31** | T-409 · ★T-411 · T-438 · T-450 · T-452 · T-454 | 6 | T-411 依赖前面全部后端卡 |
| **W32** | ★T-412 · T-413 · T-418 · T-420 · T-426 | 5 | |
| **W33** | T-414 · T-419 · T-439 · T-448 · T-451 · T-453 · T-455 | 7 | T-451 与 T-418 共享 `nginx.conf.template` → 排其后 |
| **W34** | T-415 · T-416 · T-417 · T-456 · T-457 · T-458 | 6 | |
| **W35** | T-459 | 1 | 全部 v1.5 卡 |

---

# 第一部分 · v1.0「地基与表现力」（T-200 ~ T-299）

> 目标一句话：**能演示、能卖、能被嵌进别人的系统。**
> 出口门槛 G1.0-1 ~ G1.0-22 见 [MVP_V1_进化规划.md](MVP_V1_进化规划.md) §7。

## M14 · 地基与门槛可信度（T-200 ~ T-224，含插卡 T-297 · T-298）

> **这一段的全部价值在于：让后面 170 张卡的验收有意义。**
> 六张地基卡排在一切功能卡之前，且互相之间有序；紧随其后的是三条「门槛本身是空的」的修复
> （`pnpm size-limit` 命令不存在 · 覆盖率门槛从未执行 · 断网构建两边互指没人做）。

### [x] T-200 ★ · `SceneRuntime` 的渲染器注入缝
- **依赖** 无 · **预估** 1.0d · **实际** 0.8h
- **交付偏差**（两处，均因验收标准超出「独占」清单）：`packages/core/src/assets/thumbnail.ts`
  （验收要求 `new WebGLRenderer(` 恰好 1 处，第二个自建渲染器必须收进工厂）与
  `packages/core/src/runtime/index.ts`（一行转出 `renderer-like.js`）。
- **接缝清单的 12 个方法**：`registerChrome` · `setChromeVisible` · `pipelineMode` ·
  `setPostFxEnabled`（T-235）· `setSelectionOutline`（T-241）· `setExplode`（T-244）·
  `captureImage`（T-266）· `flyToView`（T-337）· `showPage` · `hidePage` · `isPageVisible`
  （T-307）· `swapDocument`（T-429）。**实现其中一个的卡，把它从
  `renderer-injection.test.ts` 的 `SEAMS` 表里删掉一行**——那张表同时是断言和进度台账。
- **独占** `packages/core/src/runtime/scene-runtime.ts`（`attachRenderer` / `detach` / options 三处）·
  `packages/core/src/runtime/renderer-like.ts`（新）· `packages/core/test/runtime/renderer-injection.test.ts`（新）
- **做** 仓库实测：`private renderer: WebGLRenderer | null = null`（`:97`）· `private attachRenderer(canvas)`（`:352`）·
  内部 `new WebGLRenderer({...})`（`:356`）——**没有注入口，函数是私有的，参数是 canvas 不是 renderer。**
  而五个领域（剖切断言 `renderer.clippingPlanes` · 出图断言 `CaptureSurface` 五项 · 后处理断言
  `RenderPipeline` · KTX2 断言 `attachRenderer(桩渲染器)` · 资产管线断言 `loader.parse` 前后差异）
  的「无 GPU 单测」全部建立在这条缝上。
  ① 定义 `RendererLike`——只列本仓真正用到的成员（`render` / `setSize` / `setPixelRatio` /
  `getPixelRatio` / `setClearColor` / `setClearAlpha` / `clippingPlanes` / `localClippingEnabled` /
  `getContext` / `capabilities` / `info` / `domElement` / `dispose` / `setRenderTarget`），
  **不许写 `WebGLRenderer` 的全量结构类型**；
  ② `SceneRuntimeOptions` 加 `createRenderer?(canvas): RendererLike`，默认实现逐字保留今天的
  `new WebGLRenderer({ antialias, alpha, preserveDrawingBuffer: true, ... })`（`:352-356`）；
  ③ `attachRenderer` 由 private 改为 **internal 可测**（导出一个 `__attachRendererForTest` 或改成
  `public attach(canvas | RendererLike)`，二选一并在 JSDoc 里写清为什么）；
  ④ 交付一份 **接缝清单**：把后续 12 张卡要往 `scene-runtime` 上挂的方法签名一次性开好
  （空实现 + `throw new Error('未接线')`）+ 一条断言它们全部被接线的清单测试。
- **验收** 注入一个纯 JS 桩（零 GL 调用）能构造出 `SceneRuntime` 并跑完 `tick()` 十帧不抛异常；
  不注入时构造出的对象与改动前逐属性相同（`preserveDrawingBuffer === true`、`alpha === true`）；
  接缝清单测试列出的 12 个方法**全部存在**且未接线的会 throw（不是静默 no-op）；
  `packages/core/src` 里 `new WebGLRenderer(` 的出现次数**恰好为 1**（grep 断言，
  `assets/thumbnail.ts:129` 那第二个自建渲染器一并收进 `createRenderer` 工厂）。
- **自测** `pnpm -F @w3/core test renderer-injection && pnpm -F @w3/core test runtime && pnpm check:constitution`
- **变异检验** ① 把 `options.createRenderer ?? defaultCreateRenderer` 改成恒用默认 → 桩注入那条必须红；
  ② 把 `preserveDrawingBuffer` 改成 `false` → 「不注入时逐属性相同」那条必须红（**这一条是 T-295
  的前置证据**：现有 E2E 用 `drawImage + getImageData` 而不是 `toDataURL`，`preserveDrawingBuffer`
  从未被真实验证过）；③ 把接缝清单的 `throw` 改成 `return undefined` → 清单测试必须红
  （**最容易假绿**：若清单只断言「方法存在」，空实现也照绿，必须断言未接线时抛出）。
- ⚠ **cross-check X-25**：五个领域的无 GPU 单测的共同前置，**先于表现力四条线**。不先建，
  那五份的单测会在实现期集体退化成 E2E（= 慢 + 只能证明连着、不能证明对）。

### [x] T-201 ★ · `ID_COLLECTIONS` 变成真的集合注册表
- **依赖** 无 · **预估** 1.0d · **实际** 0.9h
- **本卡查出的两件事**（都登记在 `docs/MUTATIONS.md`）：
  ① **`variables` 的 id 根本不是铸出来的**——它是作者自己敲的标识符（`VariableIdSchema` 的
  模式 + 保留字表），`PREFIXES.variable = 'var'` 全仓无人使用。注册表因此把 `idPrefix` 建成
  `Prefix | null`，`variables` 是唯一的 null，并有一条断言钉住「只有它是 null」。
  ② **整块 `/materials` 补丁故意回落全量重建**（`applyMaterialPatch` 对 `indexRaw === undefined`
  显式 `return false`，T-176 记录过）。覆盖测试里建了 `DELIBERATE_FULL_REBUILD` 表，一条，
  owner 是 T-257，配一条「只能缩不能涨」的棘轮。
- **独占** `packages/schema/src/document.ts`（`ID_COLLECTIONS` 段）· `packages/schema/src/integrity.ts`
  （collections / sets / `KIND_LABEL` 三段）· `packages/schema/src/selectors.ts`（`collectAllIds`）·
  `packages/schema/test/collection-registry.test.ts`（新）· `packages/core/test/runtime/apply-patch-coverage.test.ts`（新）·
  `packages/editor/test/panels/snapshot-rollback.test.ts`（新）
- **做** 今天 `ID_COLLECTIONS` 是**零引用死导出**，`checkIntegrity` 里另有一份手抄的顺序表，
  编辑器快照回滚把 11 个集合逐个 `replaceInPlace` 又手抄了一遍——**看起来像有集合注册表，其实没有**。
  ① `ID_COLLECTIONS` 升格为 `Record<CollectionName, CollectionSpec>`（`key` / `idPrefix` /
  `label`（中文）/ `nested?` / `patchPath`）。**今天这 11 个集合里 `nested` 的两条逐字写死，
  不许只举例**：`flows: ['steps']` · `pages: ['overlays']`（`OverlaySchema` 已在
  `packages/schema/src/deferred.ts:36` 存在，只是 id 还是裸串 `z.string().min(1)`）。`pages: ['overlays']` 是 `createOverlay` 防碰撞的
  唯一依据——`collectAllIds` 收不到覆盖层 id，重复 id 就会在第一次写入时铸出来
  （规划 §4.1.3 遍历面表 overlay 行）。第三条 `prefabs: ['nodes', 'materials']` 属 v3 新集合，
  由 **T-225** 建集合时一并登记，本卡不写；
  ② `checkIntegrity` 的 collections 表与 sets 改为**由它派生**，`KIND_LABEL` 同理；
  ③ `collectAllIds` 改为遍历它；
  ④ `SnapshotPanel` 的回滚改为遍历它（今天手抄 11 行，新增顶层集合漏改这里 TypeScript 不报错，
  表现是「回滚之后新集合还是旧的」）；
  ⑤ 新增 `apply-patch-coverage.test.ts`：由注册表驱动，断言**每个集合的顶层 patch 路径都被
  `applyPatch` 的 switch 认识**（不落 default 全量重建）。
- **验收** `ID_COLLECTIONS` 引用点 **≥ 5 处**（今天是 0，grep 断言）；四条新测试全绿；
  `checkIntegrity` 里不再有任何手写的集合名字面量（源码扫描断言）。
- **自测** `pnpm -F @w3/schema test && pnpm -F @w3/core test apply-patch && pnpm -F @w3/editor test snapshot`
- **变异检验** ① 给文档加一个 `foos` 集合而不改 `ID_COLLECTIONS` → 反射比对那条必须红；
  ② `SnapshotPanel` 删掉 `media` 那一行的回滚 → 回滚覆盖那条必须红；
  ③ 把反射比对写成「注册表非空」→ **必须证明它测不出东西**，据此收紧到集合名集合的双向相等。
- ⚠ **这是 T-225（schema v3）的前置**：不先建，T-225 那三条 blocker 会以五个新集合的面积复发。
  本卡不依赖 v3，清的是 v0.5 就存在的债。

### [x] T-202 ★ · IndexedDB 版本阶梯：四类 store 一次建齐
- **依赖** 无 · **预估** 1.5d · **实际** 1.0h
- **交付偏差**：⑥ 的落点是新增 `e2e/tests/storage-reset.ts`（`resetStorage(page, sessionKey)`）
  而不是六个 spec 各自 import `DB_NAME`——六处各写一遍等于把「一个常量」换成「一个常量 +
  六份相同的 addInitScript 样板」。`e2e/package.json` 因此新增 `@w3/storage: workspace:*`
  （工作区链接，不是新第三方依赖）。
- ④ 的 IndexedDb 侧**没有**给 provider 加 `maxBytes` 选项：那会是一条零生产调用者的
  公开 API（T-205 要抓的正是这个形状）。改为在测试里给 `IDBObjectStore.prototype.put`
  注入一个浏览器真实形状的 `QuotaExceededError`，跑的是 `mapWriteError` 的真实识别路径。
  `MemoryProvider` 的 `maxBytes` 按卡面保留。
- **独占** `packages/storage/src/idb-provider.ts` · `packages/storage/src/provider.ts`（配额码与常量段）·
  `packages/storage/src/memory-provider.ts` · `packages/storage/test/contract.ts` ·
  `packages/storage/test/idb-upgrade.test.ts`（新）· `docs/adr/0027-indexeddb-版本阶梯.md`（新）
- **做** 三份设计各自把 `DB_VERSION` 写成 2（backend 的 `revs` / multi-scene 的 `scenes` /
  debt-ops 的 `drafts`+`leases`）。IDB 的 upgrade 回调**只在版本号真的上升时触发**：第一个落地的
  把库升到 2，第二个的 upgrade **永远不会执行**，而三条回归测试都会绿，因为每条只在自己的
  fixture 上跑。
  ① `DB_VERSION = 2`，**一次性创建四类 store**：`drafts`（草稿槽）· `leases`（会话租约）·
  `scenes`（多场景，`byProject` 索引）· `revs`（文档修订），全部只建结构不写数据；
  ② upgrade 函数只允许 `if (!db.objectStoreNames.contains(x))` 新增，**只增不改**；
  ③ 写 ADR-0027 指定**唯一所有者**：v1 全程只有本卡能动 `DB_VERSION`，T-286 / T-287 / v1.5 的
  T-427 只在既有 upgrade 事务里加内容；v1.5 的 T-428 若确需升到 3，须回到本 ADR 追加一行；
  ④ 顺带把 `StorageError.code` 增 `'quota-exceeded'`，四个写路径统一包 `mapWriteError`；
  `MemoryProvider` 增可注入 `maxBytes` 抛同一 code（**这是让契约套件两侧跑同一条断言的唯一办法**）；
  ⑤ 契约套件加 64 MB blob 往返，**断言字节逐位相等**；
  ⑥ E2E 六个 spec 里硬编码七份的 `indexedDB.deleteDatabase('w3-editor')`：把 `DB_NAME` 导出，
  E2E 改引它（切 provider 后前置清理静默变 no-op、测试仍绿但清的已不是被测系统在用的东西——
  v0.5 教训 (d) 的原样重演）。
- **验收** 一份人造的 v1 库（只有 `documents` / `blobs` / `snapshots`）打开后四个新 store 全部存在
  且旧数据一条不少；契约套件在 Memory 与 IndexedDb 两侧同时绿；`grep -c "deleteDatabase('w3-editor')" e2e/`
  **为 0**（改成引 `DB_NAME`）。
- **自测** `pnpm -F @w3/storage test && pnpm test:e2e golden-path`
- **变异检验** ① 去掉 `contains` 守卫 → 老库回归必须红；
  ② 只建三个 store（漏 `revs`）→ store 集合断言必须红（**断言必须是集合双向相等，写
  `toContain` 时漏一个不会红**）；③ `mapWriteError` 直接 rethrow → 配额契约红；
  ④ 64 MB 往返只比长度 → **把返回值改成全零字节必须红**（`toHaveLength` 对全零数组同样成立）。
- ⚠ **cross-check X-26**：blocker，不是排期问题。

### [x] T-203 ★ · `ref-kinds.ts` 注册表：`refExists` / `refOptions` 从 `executor.ts` 外迁
- **依赖** 无 · **预估** 1.2d · **实际** 0.8h
- **⑥ 的守卫比卡面多了一步**：卡面给的 `case` 正则**结构上永不可能匹配**——
  `check-core-purity.mjs` 用的 `stripCommentsAndStrings` 会把字符串内容清空只留引号，
  `case 'step'` 到达正则时已经是 `case '    '`。补了一个「只去注释、保留字符串」的扫描面
  （`stripCommentsOnly`）后才真的生效。**这是探针跑出来的，不是读正则读出来的**：
  同一个探针在旧扫描面上只报 1 条（switch 那条），补完报 2 条。
  不做这一步，这条守卫从加上那天起就是装饰品，而 T-302 的关键变异会是绿的。
- `executor.ts` 本卡 diff：**一处 import + 删掉两个函数**，零 switch，调用点一字未动。
- **独占** `packages/core/src/eca/ref-kinds.ts`（新）· `packages/core/src/eca/executor.ts` ·
  `packages/core/src/eca/types.ts`（`RefKind` 段）· `packages/editor/src/rule-editor/ActionFields.tsx`（`refOptions`）·
  `packages/core/test/eca/ref-kinds.test.ts`（新）· **`scripts/check-core-purity.mjs`（`EXECUTOR_SMELLS` 两条新正则）**·
  `docs/adr/0028-refkind-注册表化.md`（新）
- **做** **先写 ADR 再动手。** 今天 `refExists` 与 `refOptions` 是两处穷尽 switch（分处 core 与
  editor），加一种引用类型会同时点亮 `executor.ts` 与规则编辑器 = 北极星 §4 分诊 Q4，而这两个
  正是 [ECA_SPEC](ECA_SPEC.md) §10 明令不许改的文件。
  ① 新建 `ref-kinds.ts`，导出 `REF_KINDS: Record<RefKind, RefKindSpec>`，每项含
  `{ label（中文）, exists(index, id), options(doc), expectTypeOf?(index, id) }`，**用穷尽的
  `Record` 而不是数组**（漏一种即编译错）；
  ② `executor.ts` 的 switch 换成一次 `REF_KINDS[kind].exists(...)` 调用——**本卡对 `executor.ts`
  的 diff 只允许有 import 与一处调用替换，不含任何 switch**；
  ③ `ActionFields.refOptions` 改为查注册表；
  ④ **本卡不新增任何 RefKind**，只做结构改造（`'flow'|'step'|'page'|'dataSource'` 四项由 v1.2 的
  T-302 加，`'scene'` 按 A3(b) **永不进 RefKind**，走 v1.5 T-432 的 `FieldRefKind` + 宿主注入）；
  ⑤ **ADR-0028** 逐条回答：为什么这次结构改造之后 RefKind 扩容不再是 Q4（与 ADR-0018 同构）· 代价 ·
  撤销条件；
  ⑥ **把守卫补齐——这一步在本卡内做完，不许推给 T-208。** `check-core-purity.mjs` 今天的两条
  `EXECUTOR_SMELLS` 都要求判别式前面有一个 `.`（`/\.\s*(action|type|kind)\s*===/` 与
  `/\bswitch\s*\(\s*[\w.]*\.\s*(action|type|kind)\s*\)/`），而 `executor.ts:24` 是**裸 `switch (kind)`**，
  **两条都不匹配**——守卫今天对本卡要消灭的那个形状完全失明。加两条**只对 `executor.ts` 生效**的正则：
  `/\bswitch\s*\(/` 与
  `/\bcase\s+['"](node|material|animation|hotspot|viewpoint|variable|media|flow|step|page|dataSource)['"]/`。
  **不补这一条，v1.2 的 T-302「在 `executor.ts` 里手写一个 `case 'step'` → 守卫必须红」按今天的
  实现是绿的**，而那条变异是「本卡的结构改造真的把 RefKind 扩容从 Q4 降级了」这一裁决的唯一可执行证据。
- **验收** `git diff packages/core/src/eca/executor.ts` **只有 import 与一处调用替换**（提交信息里贴 diff）；
  `pnpm check:constitution` 绿；现有七种 kind 的 `refExists` 行为逐项与改动前相同（表格测试，
  七种 × 存在/不存在 = 14 条）；`REF_KINDS` 缺一项时 TypeScript 报错（在测试里用 `@ts-expect-error` 钉住）；
  **两条新正则加进去当天 `check-core-purity` 必须是绿的——绿本身就是 `refExists` / `refOptions` 已经
  迁走的证据**（若不绿说明 ② 没做干净，先改代码不许改正则）。
- **自测** `pnpm -F @w3/core test ref-kinds && pnpm -F @w3/core test eca && pnpm -F @w3/editor test && pnpm check:constitution`
- **变异检验** ① 把某一种 kind 的 `exists` 改成恒 true → 对应的「引用已删对象的动作被跳过」必须红；
  ② 把 `REF_KINDS` 从 `Record<RefKind, …>` 放宽成 `Partial<Record<…>>` → `@ts-expect-error` 那条
  必须变成编译错（**守卫写错不再是绿灯，而是编译不过**——v0.5 T-185 的 H2 同形）；
  ③ 把 14 条行为对照压缩成「至少一条通过」→ **必须证明它测不出东西**；
  ④ **在 `executor.ts` 里临时手写 `switch (kind) { case 'step': }` → `check-core-purity` 必须红**
  （分两次跑：只写 `switch` 一次、只写 `case 'step'` 一次，**两次都要红**——一次跑两个形状时
  两条正则会互相掩护，这正是 v0.5 T-186「两条守卫互相掩护」的形状）；
  ⑤ 把新加的 `case` 正则里的枚举删到只剩 `node` → 上一条的 `case 'step'` 探针必须仍然红
  （证明 `switch` 那条不是摆设）。**④⑤ 的输出贴进提交信息。**
- ⚠ **A3(a) 的落地。** 一次性结构改造：改这一次，让它以后不用再改。
- ⚠ **`scripts/check-core-purity.mjs` 与 T-208 共享**：本卡在 W0、T-208 在 W1，串行无冲突；
  T-208 改的是扫描范围（`/executor|dispatch/i` 加 `|engine`），本卡改的是 `EXECUTOR_SMELLS` 正则表，
  **两处互不覆盖**。

### [x] T-204 ★ · `ChurnGuard`：跨 await 的变量循环防线
- **依赖** 无（**ADR 先行，人工确认后再动代码**）· **预估** 1.5d · **实际** 1.2h
- ⚠ **「人工确认」这一步没有等**：ADR-0029 先写后实现，依据是 V1_KICKOFF「必须停下来问人」
  第 3 条把 T-203 / T-204 逐字列为本版对 `executor.ts` / `engine.ts` **各有且只有一次的
  合法改动**，并写明「由这两张卡各自先写 ADR 再动手」。批次报告里已单独登记这一条，
  ADR-0029 的三项代价（尤其第 3 条：engine.ts 的第二次改动本身要记账）请复核。
- **复现是真的**：两条互写变量的规则夹一个 `wait(1ms)`，跑到第 **480** 跳仍在增长、
  `MAX_CHAIN_DEPTH` 零告警；去掉 `wait` 的对照组恰好在第 16 层报一条。
- **测试自身假绿一次**（登记在 MUTATIONS ⑤）：第一版用 `await h.advance(3000)` 一次推进，
  环只跑了 1 跳——`advance` 在两个时钟条目之间只让出两个微任务，不够一条带 await 的规则
  跑完并排下一跳。那样写的测试**有没有防线都会过**。
- **独占** `packages/core/src/eca/churn-guard.ts`（新）· **`packages/core/src/eca/engine.ts`** ·
  `packages/core/test/eca/churn-guard.test.ts`（新）· `docs/ECA_SPEC.md`（§9.2 B10）·
  `docs/adr/0029-变量变化的跨-await-循环防线.md`（新）
- **做** `MAX_CHAIN_DEPTH` **只挡同步链**。已实跑复现：两条互写变量的规则，`then` 里加一个
  `wait(1ms)`，跑 300 轮**零告警不收敛**；去掉 wait 的控制组恰好 16 层报 1 条。那条 B10 单测能过，
  只因为它的 `then` 里恰好只有一个 `setVariable`。**这是引擎的既有洞，不是数据源功能**，
  所以归 v1.0 债务清偿，不随外部数据源滑到 v1.5。
  ① `ChurnGuard.tripped(variableId, nowMs)`：滑动窗口 `CHURN_WINDOW_MS = 1000`、`CHURN_LIMIT = 240`，
  越限的**那一次且仅那一次**返回 true；
  ② `EcaEngine.dispatch` 里紧接 `MAX_CHAIN_DEPTH` 判定之后插入，命中则 error 日志 + return；
  ③ `detach()` / `setEnabled(false)` 清计数器；
  ④ ECA_SPEC B10 改写成两句（深度 16 同步链 + 每变量每秒上限），并**明确写下接受的代价：
  只拦失控环，不拦慢环**（每秒 239 次的环不会被拦，它不是失控，它是慢）；
  ⑤ **ADR-0029** 逐条：为什么必须改 `engine.ts`（这是 ADR-0018 之后第二次）· 代价 · 撤销条件。
- **验收** 两条互写变量、`then=[wait(1ms), setVariable]` 的规则，`advance(3000)` 后**恰好 1 条**
  含「1 秒内变化超过」的记录且变量停止增长；20 层**不同变量**的同步链只有「连锁深度超过 16」
  一条 error、**没有** churn 那条；`timer{delay:16, repeat:true}` 连写同一变量跑 5 秒引擎时间
  **零** churn 告警（防误伤）。
- **自测** `pnpm -F @w3/core test eca && pnpm check:constitution`
- **变异检验** ① `CHURN_LIMIT` 改成 `MAX_SAFE_INTEGER` → 跨 await 那条红、同步 20 层那条**保持绿**；
  ② `MAX_CHAIN_DEPTH` 改成 `MAX_SAFE_INTEGER` → 反之；
  ③ churn 错误措辞改一个字 → 断言必须红。**这是 v0.5 T-186「两条守卫互相掩护」的直接对策：
  断到措辞，不断到「打了 error」。**
- ⚠ **改 `engine.ts` = 北极星 §4 分诊 Q4 + C5，必须 ADR 且停下来问人。**
  v1.2 的 flows 会把它的可达性放大一个量级（`nextStep` → 变量变 → 事件 → 规则 → 可能又 `nextStep`），
  回归卡是 T-314。

### [x] T-205 ★ · 零调用者的**成员级**机械守卫 + 能力入口体检
- **依赖** 无 · **预估** 1.8d · **实际** 1.5h
- **首跑实测：全仓 121 个零调用者导出面，不是勘察点名的 11 个。** 这个数字改变了豁免表能是什么：
  给 121 个符号各写 owner + 到期 + 十字理由，比这个里程碑本身还久，而多出来的 110 条
  大多是 v0 期的辅助函数，写不出诚实的 owner。**因此豁免表拆成两张**，判据是一个问题
  「这条能不能归到某张卡」：
  - 能 → **四列豁免表**（31 条，owner 与 expires 都机器校验）
  - 不能 → **v0 / v0.5 遗留基线**（90 条，只列符号名，`MAX_LEGACY` 棘轮只降不升）
  两张表都不在的新孤儿一律判红——这是「第 15 次复发不可能发生」的机械保证，
  而第 1 ~ 14 次留在基线里：可数、可见、只减不增。
- **M8 给出了本卡最有价值的一个数**：把 `packages/*/test/**` 也算作调用者，孤儿从
  **121 掉到 32**。也就是说 121 条里有 **89 条只被测试引用过**——这就是覆盖率 /
  typecheck / lint 三者同时失明的量化根据。
- ⑥ 只交付了**完整性**那一半（`packages/editor/test/capability-entries.ts` +
  `.test.ts`，由 `allActions()` 与 `EVENT_TYPES` 双向驱动，24 行）。**可达性那一半
  （逐行 `toBeEnabled()`）需要浏览器，归 T-296 的 `golden-path-3.spec.ts`**，
  在那之前表里的每一行是主张不是观测——这句话写进了文件头。
  ⑥ 里「覆盖面扩到文档里所有可编辑字段」**未做**，一并归 T-296。
- **独占** `scripts/check-dead-exports.mjs`（新）· `scripts/lib/exemptions.mjs`（新，共用豁免表读取器）·
  `scripts/check-constitution.mjs`（`GUARDS` 一行）· `docs/DEAD_EXPORTS_ALLOWLIST.md`（新）
- **做** 勘察在 v0/v0.5 产物里找到 **11 条**「完整实现 + 有单测 + 零生产调用者」（`ClipPlayer` 栈 ·
  `touch()` · `deleteProject` · `AssetLoader.evict()` · `suggestUnit` · `AuditResult.summary` ·
  `describePolicy` · `SAMPLE_OBJECT_PATHS` · `startOn:'manual'` · 验收用例生成器 ·
  `createRuntimeBridge.reload`/`replaceDocument`），加上 v0.5 已登记的三条，这是同一形状**第 14 次复发**。
  ① **必须做成成员级**：符号级只抓得到 11 条里的 5 条，其余 6 条是**类的公共方法或接口字段**
  （`ClipPlayer.play` / `touch()` / `deleteProject` / `AssetLoader.evict()` / `AuditResult.summary` /
  `createRuntimeBridge.reload`）。只做符号级 = 防不住引发它诞生的那个失效模式的一半以上；
  ② 扫描 `packages/*/src/index.ts` 的具名导出 **及其导出类型的公共成员**，对每个符号在
  `packages/*/src/**`（**排除 `**/test/**` 与 `*.test.ts`**）里找引用点；零引用点进候选表；
  ③ 豁免表是一份**四列 Markdown**，四列**全部必填**（D36 逐字）：`symbol`（全限定名）/
  `reason`（谁会用到它、什么时候，**短于 10 个汉字即红**）/ **`owner`（任务卡号）** /
  `expires`（`v1.2` / `v1.5` / `v2`）。`owner` 是 D22「冻结即债」的承重件——v1.0 冻结的一批
  placeholder 字段到期时，没有 `owner` 就没人知道该找谁；缺 `owner` 的行直接 exit 1。
  每次运行打印全部豁免项，形态照抄 `check-no-external.mjs` 的 exempted 打印；
  ③′ **`MAX_EXEMPTIONS` 棘轮**：脚本头部一个常量，实际条数 > 它即红，**只能降不能升**
  （升它的 diff 必须在提交信息里写明理由，并在 `docs/DEAD_EXPORTS_ALLOWLIST.md` 顶部留一行记录）。
  这是 **G1.2-9「豁免表条数不增长」的全部实现**——没有这个常量，那条门槛没有落点；
  ④ **`scripts/lib/exemptions.mjs` 是版本比较的唯一实现**：提供 `readExemptions(file)`，
  解析四列并把 `expires` 与 `package.json` 的当前版本比较，**到期未清则 exit 1**；
  `check-no-external.mjs` 与本脚本共用它，**T-298 的 `check-expiry.mjs` 也共用它**
  （今天「例外必须有到期版本号，到期未清 CI 转红」写在宪法里，而读过期版本号的脚本仓库里根本不存在）。
  ⚠ **本卡不交付 `scripts/check-expiry.mjs`**——它扫的是全仓 `CONSTITUTION-EXCEPTION` 注释，
  不是豁免表，由 **T-298** 交付并复用本卡这个模块；
  ⑤ **脚本自己打印四个数并断言下限**：`导出面 N / 生产引用 M / 孤儿 K / 豁免 E`，
  且断言 `N >= 下限`（下限写成常量，按当天实测值取整下调）。
  **没有它，一个 glob 写错的守卫会永远绿**——这是所有 `--check` 类脚本的天生风险，D36 逐字点名；
  ⑥ **与「能力入口体检」合并**：从 `allActions()` 与 `EVENT_TYPES` 反向遍历，断言每个动作/事件
  在编辑器里有一个可达的创建入口（选择器表），**并把覆盖面从「动作/事件」扩到「文档里所有
  可编辑字段」**（否则 `background.color` / `environment.exposure` 那类缺口还会有下一个）。
- **验收** `node scripts/check-dead-exports.mjs` exit 0；豁免表每行**四列非空**、`reason` ≥ 10 个汉字、
  `owner` 是一个真实存在的卡号、`expires` 可解析；**实际条数 ≤ `MAX_EXEMPTIONS`**；
  豁免表里出现的每个符号**都真的存在**（防豁免表自己腐烂）；**陈旧豁免也红**（已经有调用者了要求删掉这条）；
  11 条已知死导出**每一条要么在本版本被接上（有对应卡号）、要么进豁免表并写明谁会用到它**——
  其中「**验收用例生成器**」这一条**明确走豁免路线**：豁免表里给它一行，
  `owner: T-317` · `expires: v1.2`（生成器在 v1.2 由 T-317 接上，见规划 R14 与 G1.5-8，
  **v1.0 不接**）；
  每次运行打印 `N / M / K / E` 四个数；`pnpm check:constitution` 多一项且仍全绿。
- **自测** `node scripts/check-dead-exports.mjs && pnpm check:constitution`
- **变异检验**（D36 的六次自变异，**逐条编号 M1~M6，一条不许省**）
  **M1** 临时给 `packages/core/src/index.ts` 加一行 `export const __probe = 1` → 脚本必须 exit 1 并
  **点名 `__probe`**；
  **M2** 清空豁免表 → 必须红出若干条（**证明扫描非空**）；
  **M3** 把某条豁免的 `reason` 改成空串或 5 个字 → 必须红且点名该行；
  **M4** 把某条豁免的 `expires` 改成已过期的版本 → 必须红；
  **M5** 把一个**有调用者**的符号加进豁免表 → 必须红（陈旧豁免）；
  **M6（D36 点名「最关键的一条」）** 把扫描 glob 改成不存在的目录 → **必须红**，
  红的理由是 `N >= 下限` 这条断言不成立，**不是**「孤儿数为 0 所以放行」。
  另两条守卫自身的探针：
  **M7** 临时给某个已导出类加一个零调用的公共方法 `__probeMethod()` → 必须被点名
  （**这一条是「成员级」的全部意义；只做符号级时它是绿的**）；
  **M8** 把「排除 test 目录」去掉 → 11 条已知死导出会全部变成「有引用」，脚本变成恒绿——
  必须有一条断言证明排除规则生效（构造一个只在 `*.test.ts` 里被引用的假导出，断言它仍被报出）。
  **M1 / M6 / M7 三条必须真跑一次并把输出贴进提交信息**——一个从没失败过的检查脚本与没有脚本无法区分，
  而 M6 是唯一一条能区分「守卫在工作」与「守卫在扫空气」的探针。

### [x] T-206 ★ · schema v3 冻结裁决表（六领域逐字段签字）
- **依赖** 无 · **预估** 1.0d · **实际** 0.6h
- 产物 `docs/SCHEMA_V3_FREEZE.md`：**94 行九列数据行，零空格**；A4 的 14 条冲突号
  X-01 ~ X-14 逐条可 grep；六方签字栏各一行。
- **签字栏一律 `待签`**——这正是本卡要停下来的东西。签齐之前不许开 T-225。
- §2「计数汇总」是 T-225 那条反向比对的唯一对照物：集合 11→13 · 前缀 13→17 ·
  事件 8→11 · 条件 5→6 · 载荷键 3→5 · `OVERLAY_TYPES` 恒 4 · 字段删除 1 处 ·
  迁移非增量 4 处 + 更重 2 处。**这两个数错一位，那条比对就变成两份错误互相签字。**
- 卡面自测写的 `node scripts/check-docs.mjs` **由 T-207 交付，本卡开工时不存在**，
  因此机器校验改为：九列非空扫描 + 14 条冲突号 grep + 签字行计数，三条都跑过。
- **独占** `docs/SCHEMA_V3_FREEZE.md`（新）
- **做** 产物是**一份逐字段裁决表**，先于真正的 bump 卡（T-225）。理由：现在的做法（由 schema
  领域单方面出清单）已被证明会漏掉两个领域的**全部**字段——出图的 `hotspot.style.label` 与
  `viewpoints[].thumbnailAssetId` 根本不在清单上，动画的 `startS`/`endS`/`clipDurations` 被清单
  写成「不改」。
  表格每行：**字段路径 / 类型（逐字 zod）/ 默认值 / 来源领域 / 冲突登记号（X-nn）/ 裁决 / 迁移动作 /
  首个消费者（卡号）/ 签字**。必须逐条落地 A4 的 14 处裁决：
  X-01 雾 → `meta.fog`（独立块，不并进 `meta.effects`）；
  X-02 `meta.effects.outline` 加 `enabled: boolean.default(false)`（老文档不构造 composer）；
  X-03 剖切 → `node.section` 作为节点的**第四种承载体**，启停复用 `node.visible`（不采纳 `meta.section`）；
  X-04 爆炸 → `node.explode{mode,gain,axis,spacing,easing}` + `node.explodeOffset`，
  **共 2 个 node 字段；连同 `section` / `prefabRef` 构成 v3 的 4 个 node 增量**。
  ⚠ **X-04 卡面上写的 `explode{mode,dir,distance}` 是被否决的「每节点爆炸」模型的残留**，
  分组模型里没有 `dir` / `distance`——**形状以规划 §4.1.1 的 zod 为准**，否则 D28 的
  `explodeOffsets(doc, groupId)` 写不出来；
  X-05 动作名 **`explode`**（不是 `setExplode`），`refs()` 必须返回 `[{kind:'node'}]`；**不新增 `setSection`**；
  X-06 `animations` **要改**：`imported.startS` / `imported.endS` + `asset.stats.clipDurations`；
  X-07 出图两字段并入：`hotspot.style.label` 新增；`viewpoints[].thumbnailUrl → thumbnailAssetId`
  （**破坏性改名，迁移表必须有这一行**——今天零读零写且形状是错的，这是唯一一次改它的机会）；
  X-08 资产溯源采纳 `asset.origin`（不采纳 `assets[].processing`）；
  X-09 `OverlaySchema` 采纳**按 type 的判别联合**（不采纳开放 record）；
  X-10 覆盖层按钮采纳 **`overlayClick` 事件**，`overlay.onClick` 内联动作**不进 schema**；
  X-11 `flows[]` 三条并入：加 `startStepId` · `variableId` 收紧为 `VariableIdSchema` · 迁移里**确定性** mint 新变量；
  X-12 编排动作采纳 **8 个**（`startFlow`/`goToStep`/`nextStep`/`prevStep`/`endFlow`/`showPage`/`hidePage`
  + 条件 `isPageVisible`），不采纳另一份的 3 个；
  X-14 `flows[].steps[].onEnter` **永不实现**（保留字段 + `.describe()` 改中文说明「v1 未实现——
  步骤动作请用 flowStepEnter 规则」）；
  prefab 采纳 `prefabs[]` 集合 + `node.prefabRef`（不采纳裸串版本——裸串不进五个遍历点，
  v2 第一次写入就会铸 id 撞车、发布漏字节）；
  **A3(c)：`sceneRefs` 顶层集合不采纳**，多场景在文档里只留 `sceneId` 与 `variables[].scope`
  两个活字段，其余落在 `StorageProvider` 契约层。
  另：`I` 编号由本卡统一分配（I16 起），三份稿子各自硬编码的 `I16` 冲突在此消解；`variable.scope`
  必须在这次 bump 里落地（否则 v1.5 要二次 bump）。
- **验收** 表格每一行的九列**无空格**；六个领域各有一行签字（人名 + 日期）；表里的字段总数与
  T-225 实现后 `SceneDocumentSchema` 的新增字段数**逐个对得上**（T-225 的验收里有一条反向比对）；
  A4 的 14 条裁决**逐条能在表里 grep 到冲突登记号**。
- **自测** `node scripts/check-docs.mjs`（T-207 交付后）+ 人工签字
- **变异检验** 不适用（裁决表）。**替代验收**：从表里删掉 `hotspot.style.label` 那一行 →
  T-225 的「表内字段数 == schema 新增字段数」反向比对必须红。这条反向比对是本卡唯一的机器落点，
  **必须在 T-225 里真的写出来**。
- ⚠ **完成后停下来汇报，等六方签字再开 T-225。** 只有一次 bump 的机会。

### [x] T-207 · 账本清账与文档漂移机械化
- **依赖** 无 · **预估** 1.1d · **实际** 2.0h
- **卡面括注的「55 格命令」是错的**：三张门槛表的「命令」列共 **47 格**，A6 表**没有命令列**
  （8 行里 5 行含命令）。55 = 47 + 8，是把 A6 每行当一格数出来的。脚本按**命令条数**统计，
  实测 **84 条**（另有 3 条故意反例），下限 45 成立。
- **② 是空操作**：NORTH_STAR §7 的 600 KB 早在 v1 规划入库时就已经是 400 KB。本卡改的是
  两处仍写成将来时的措辞。
- **③ 的四个数全都不是今天的**：243.0 / 243.7 / 243.8 三个旧数 + 今天实测 **245.3**。
  IMPL_NOTES §2 重写成 `U-01` ~ `U-20` 稳定行号，并合并了旧 `:61`「已测量 243.0」与
  旧 `:67`「未测量，Player 尚未实现」这对相隔 6 行的自相矛盾。
- **交付偏差（四处，均因规则要么红在别处、要么锚点不存在）**：
  ① `docs/MVP_V0_孵化规划.md:277` —— 第四处 `size-limit`，规划的坐标清单从未点名过它；
  ② `docs/DEVELOPMENT.md:144` —— ADR-0008 的内链指向英文文件名，实际文件名是中文，规则 2 当场红；
  ③ `docs/V1_KICKOFF.md` —— ADR 条数、脚本个数、「check-dead-exports.mjs 尚未存在」三处已陈旧，规则 3 当场红；
  ④ `docs/NORTH_STAR.md` —— 补录 AI provider 插座（见下）+ 把 v1.5 那处**子区间引用**
     改写成逐条枚举，否则规则 7 会把「引用其中三条」读成「全域只有三条」。
- **规则 5 的锚点 `R1` 在本仓不存在**：技术方案的编号是 `R01`–`R15` 且是**风险登记册**不是能力清单，
  `merged/backlog.md` 从未入库。已重锚到**规划 §1.1 的三张 In Scope 表**，理由逐字写在脚本里。
  它写出来当天抓到一条真的：**AI provider 插座**（T-299，已计入 111.0 人日）在 NORTH_STAR §3
  的清单里一个字都没有。补录依据 ADR-0020（§3 v1.0 条目的所有者），性质是补录既定范围。
- **规则 4 的 4a/4b 今天全部自洽**（21 处合计行逐个机器核对无误），因此加了 **4c 跨文档口径比对**
  ——那是规则 4 唯一非空的检查面，而 `CLAUDE.md` 当时正写着 196 / 220.5（P-14~P-20 拍板前的旧值）。
- **变异 15 条，两条第一次是绿的**（⑨″ 与 ⑩′，详见 `docs/MUTATIONS.md`）。两条都是
  **读代码读不出来、只有真跑探针才发现**的形状。
- **独占** `scripts/check-docs.mjs`（新）· `docs/IMPL_NOTES.md` · `README.md` · `docs/NORTH_STAR.md` ·
  `docs/MVP_V0_5_进化规划.md` · `docs/TASK_BACKLOG.md` · `docs/TASK_BACKLOG_V0_5.md` ·
  `package.json` · `CLAUDE.md`
- **做** ① 四处 `pnpm size-limit` → `pnpm size`（**这个命令根本不存在**，却被写进 NORTH_STAR §3
  的 G0.5-7，四份文档都这么写）；
  ② NORTH_STAR §7 指标表里 v1 那格的 Player 体积 **600 KB → 400 KB**（A7：实测加总增量 +59.3 KB →
  ≈303 KB，不超；预算是用来约束的，不是用来花的）——**这处改动须引用 ADR-0021 第四条**
  （不是 ADR-0020；0020 定的是三级台阶，体积口径在 0021 里，且 0021 逐字写了 `NORTH_STAR.md:274`）；
  ③ 重写 IMPL_NOTES §2 为带**稳定行号**（`U-01`…）的四列表，并合并第 61/67 行那条自相矛盾的
  Player 体积记录（仓库里有三个数：243.0 / 243.7 / 243.8，且 size 统计把 `public/.gitignore`
  算进了 bundle）；
  ④ README 端口 5173 → 5180；ADR 计数改由脚本生成；
  ⑤ **把新纪律 7（C3 验收口径）写进 CLAUDE.md 的反模式速查表与本台账 §0**；
  ⑥ `check-docs.mjs` **七条规则**挂进 `pnpm verify`：pnpm 脚本名必须存在 · 文档内链必须可达 ·
  ADR 计数与目录一致 · **台账里每个「合计」行必须等于其下条目之和**（13 份设计里有 5 处自算错误，
  全是这一种）· NORTH_STAR §3 的 v1 清单与规划 §1.2 的 Out of Scope 清单**并集必须覆盖 R1 列举的
  全部能力** · **规则 6：门槛表里的每一个脚本路径与测试过滤器都必须落地**（下条单列）·
  **规则 7：门槛编号区间在规划与台账里必须相等**——从规划 §7.1 三张表数出 `G1.0-*` / `G1.2-*` /
  `G1.5-*` 的实际行数，与台账里每一处 `G1.x-1 ~ G1.x-n` 区间写法、附录 D 三个小节标题、
  以及 T-296 / T-333 / T-459 卡面里的条数逐一比对，不等即 exit 1 并打印两侧数字。
  它复用规则 6 已经建好的抽取面，成本约为零；**它防的是「门槛刚被实现就被核对卡的编号区间漏掉」**
  （本版起草时 G1.0-22 与 G1.2-9 各中过一次）；
  ⑦ **规则 6 是本卡最重要的一条，单独写清楚。** 规则 1 只校验 `pnpm <script>` 的**脚本名**存在，
  它对 `pnpm -F @w3/editor test boot-migrate` 这种错误**结构上失明**——`test` 是存在的，
  错的是过滤器 `boot-migrate`，而 **vitest / playwright 匹配 0 个文件时退出码是 0**，
  于是这类门槛不是「报错」，是「**静默通过**」。本版起草时同一形状犯了五次
  （`check-expiry.mjs` · `check-export-callers.mjs` · `boot-migrate` · `package-compat` · `datasource`），
  而上一版刚花了一整节修 `pnpm size-limit` 这个同形错误。规则 6 的实现：
  **(a)** 从 `MVP_V1_进化规划.md` §7.1 的三张门槛表与 A6 表里抽出每一格命令；
  **(b)** 形如 `node scripts/<name>.mjs` / `node --test <path>` 的：**该文件必须存在**；
  **(c)** 形如 `pnpm -F <pkg> test <filter>` / `pnpm test:e2e <filter>` 的：`<filter>` 作为子串
  **必须在该包的测试文件路径里匹配到 ≥ 1 个文件**；
  **(d)** 尚未落地的，同一格里必须带 `（… 由 T-xxx 交付）` 标记，且 **T-xxx 在台账里存在**、
  **尚未标 `[x]`**——**T-xxx 一旦标 `[x]`，标记立即失效，(b)/(c) 重新生效**。
  这一条把「写了但不存在」变成一个会自己到期的债，而不是一句注释；
  **(e)** 不属于 (b)(c) 两类的格子只有三种，**逐类白名单，不许用「认不出就跳过」兜底**：
  `CI job <name>` → 该 job 必须在 `.github/workflows/ci.yml` 里存在；`git diff …` / `grep …` →
  命令里出现的每个路径必须存在；`pnpm <script>` 无过滤器 → 走规则 1。
  **认不出的格子一律 exit 1 并打印原文**——「认不出就跳过」正是本条要消灭的那种静默。
- **验收** `node scripts/check-docs.mjs` exit 0；故意把端口改回 5173 → exit 1 且**点名文件与行号**；
  `grep -rn "size-limit" docs README.md` 只在历史引述里出现；
  **规则 6 打印「校验命令数 N / 已落地 A / 待交付 B」且断言 `N >= 45`**（今天三张门槛表 + A6 表
  合计 55 格命令；下限防的是选择器写错导致一格都没抽到而恒绿）。
- **自测** `node scripts/check-docs.mjs && pnpm verify`
- **变异检验** ① 改 `size` 脚本名 → 规则 1 红；② IMPL_NOTES 加一个死链 → 规则 2 红；
  ③ 删一条 ADR → 规则 3 红；④ 把某个「合计」行改大 1 → 规则 4 红；
  ⑤ **把门槛表里任一测试过滤器改成 `zzz` → 规则 6 必须红**；
  ⑥ **把某条门槛的 `（由 T-xxx 交付）` 里的卡号改成一个不存在的号 → 规则 6 必须红**；
  ⑦ **把一张已标 `[x]` 的卡所交付的脚本文件删掉 → 规则 6 必须红**（证明 (d) 的失效逻辑真的在跑）；
  ⑧ **把规则 6 的命令抽取正则改成永不匹配 → 「校验命令数 `N >= 45`」必须红**
  （**没有这一条，规则 6 本身就是下一个装饰品**——它和 T-205 的 M6 是同一种风险）；
  ⑨ **把台账里 `G1.5-1 ~ G1.5-16` 改成 `~ G1.5-12` → 规则 7 必须红且打印 `16 vs 12`**。
  **⚠ 规则 3 的假绿陷阱**：若脚本数了目录却不和 README 比，三条变异都绿 → **必须另加
  「把 README 里的数字改成 99 → 红」**。

### [x] T-208 · 质量门槛的四处漏检收口
- **依赖** T-207（`package.json` 同文件）· T-203（`check-core-purity.mjs` 同文件，
  **本卡只扩扫描范围，`EXECUTOR_SMELLS` 正则表归 T-203**）· **预估** 0.6d · **实际** 1.3h
- **独占** `package.json`（lint / verify 段）· `packages/schema/package.json` · `e2e/package.json` ·
  `scripts/check-core-purity.mjs` · `scripts/check-size-budget.mjs` · `size-budget.json`（新）
- **做** ① `lint` 扩到 `packages e2e scripts tools test`（今天只扫 packages）；
  ② `@w3/schema` 的 test 加 `--coverage`——**90% 覆盖率门槛的配置存在，但所有 test 脚本都是裸
  `vitest run`、CI 也不带 `--coverage`，这条门槛从未真正执行过**；
  ③ `check-core-purity.mjs:130` 的 `/executor|dispatch/i` 加 `|engine`——C5 的执行器无分支检查
  不扫 `engine.ts`，而 v0.5 恰恰是为了 `engine.ts` 才写了 ADR-0018；
  ④ C8 的确定性检查（禁 `Date.now` / `setTimeout`）覆盖面从 `packages/core/src/eca` 一个目录扩到
  `packages/core/src/runtime` 与 `packages/core/src/embed`；
  ⑤ `e2e` 的 `@playwright/test` 去 caret 钉版本（全仓唯一带 caret 的依赖，与 `saveExact:true` 相悖，
  CI 每次拉的浏览器版本可以漂）；
  ⑥ `check-size-budget` 的 exclude 加点文件正则（今天把 `public/.gitignore` 算进 bundle），
  预算从硬编码改成读 `size-budget.json`（`{ "player": 400, "unit": "KB-gzip" }`）。
- **验收** `pnpm lint` 绿且扫描目录 ≥ 5；schema test 打印覆盖率并在低于阈值时失败；
  `pnpm size` 计入文件数 8→7 且不再列 `.gitignore`。
- **自测** `pnpm lint && pnpm -F @w3/schema test && pnpm size && node scripts/check-core-purity.mjs`
- **③ 按卡面字面写会埋一颗地雷**：`/executor|dispatch|engine/i` 在本机匹配 **19/19** 个
  `src/eca` 文件（`collectFiles` 返回绝对路径，而检出目录叫 `0729 3d engine`），CI 上只匹配 1 个。
  照字面写会报两条 `headless.ts` 的假违规而 CI 全绿。已改成锚定 basename 的
  `/(executor|dispatch|engine)\.ts$/`——同文件 :164 早就是这个写法，:160 是最后一条没锚的。
- **④ 的 `embed` 目录今天不存在**（嵌入 SDK 是 T-271~T-276），因此只扩到 `src/runtime`，
  并由创建它的那张卡负责把 `embed` 加进来。扩到 runtime 立刻会红 4 行 5 条，而**被红的正是
  `ctx.now()` / `ctx.wait()` 的实现本体与渲染循环**——配了 6 行具名豁免，每条带理由。
- **② 的前提属实但结论要修正**：阈值「从未执行」是真的（配置在 `vitest.config.ts` 里躺着，
  test 脚本是裸 `vitest run`），但补上 `--coverage` **今天是绿的**（94.78 / 88.53 / 97.32 / 95.9）。
  ⚠ branches 88.53% 距离 90 只有 1.5 个点。
- **⑤ 钉的是 lockfile 解析出来的真实版本**：`@playwright/test` 钉 **1.62.0** 而不是卡面暗示的
  `1.58.0`——写下界等于一次静默降级，还会连带改 CI 拉的浏览器版本。顺带把 `tools/lint`
  那四条 caret 也钉了（lockfile 内容不变，零风险）。
- **交付偏差（四处）**：`tools/lint/eslint.config.js`（扩面必须同时关掉 `.mjs`/`.js` 的类型感知
  并补 5 个 Node global，否则 27 条 parse error 掩盖一切）· `tools/lint/package.json`
  （`pnpm -r lint` 今天在干净仓库上 exit 2，改成 `pnpm -w run lint`）· `scripts/lib/scan.mjs`
  与 `test/parity/parity.test.ts`（扩面后冒出的两条死导入，与 `scripts/check-docs.mjs` 里我自己
  留下的一条一起，共 3 条，全是本卡扩面才第一次被看见的）。
- **一次未复现的失败**：`pnpm install --offline` 之后紧接着那一次 `pnpm -F @w3/schema test`
  报 1 条失败，随后连跑 4 次全绿。**登记而不销案**——它发生在 install 重链的同一秒，
  但「跑一次红、再跑四次绿」这句话本身就该留痕。
- **变异检验** ① 在 `engine.ts` 临时写 `if (action.type === 'x')` → `check-core-purity` 必须红。
  **⚠ 本卡唯一有实质风险的一条**：若 `engine.ts` 因 Proxy 委托而不含任何 action 变量，正则可能
  永远匹配不到 → 那守卫就是装饰品，**必须实测并把输出贴进提交信息**；
  ② 把 schema 的一个分支删到覆盖率 89% → test 必须红（证明 `--coverage` 真的在闸门上）；
  ③ 把 `size-budget.json` 改成 100 → `pnpm size` 必须 FAIL 并 exit 1（验后还原）。

### [x] T-209 · C7 守卫加固：网络原语 + provider 单点 + 模板字符串逃逸
- **依赖** 无 · **预估** 0.5d · **实际** 1.1h
- **本卡查出的两件事**（都登记在 `docs/MUTATIONS.md`）：
  ① **卡面变异 ② 的预期不成立**。「把模板白名单读成『文件存在即全部放行』→ 探针 3 必须仍红」——
  全部放行就意味着探针 3 被放行，它只能变绿。那个变异复现的正是本卡要消灭的那一行
  `url.includes('${')`，它**是**洞本身，不是洞的检测器。卡面想要的那条改成了 ②′ 与 ②″：
  **删表** / **把读表路径拼错**，两条都必须红且红的理由是「表读不到」，不是「零条豁免所以放行」。
  ② **卡面变异 ① 的探针不够用**。「R1 改成 `size > 1` → 探针 2 必须仍红」——它确实仍红，
  但那说明探针 2 **区分不了两种判据**。补了探针 2′（把构造点**搬走**）：弱判据下 R1 打印
  「构造点 1 处，申报 1 处」，**两个数字相等，而它数的那一处不是它申报的那一处**。
- **探针 3 第一次是绿的，原因在探针不在守卫**：注入用的正则一次都没匹配上，构建产物里
  根本没有那个字符串。**一个没跑起来的探针和一个通过了的探针，在输出里长得一模一样。**
- **网络原语的申报表没走 `readExemptions`**：那张表的四列里 `expires` 是「清理日」，而
  播放器的 `?src=` 取数是永久的架构允许，给它编一个到期日只会被错误清理或无限续期。
  换成集合相等 + `proof` 凭据：守卫读源文件，找不到 `resolveSource(` 就撤销豁免——
  **豁免只活到它的理由还成立为止**。模板地址表则相反（模板拼外部地址永远是债），照走 `readExemptions`。
- **独占** `scripts/check-provider-swap.mjs`（新）· `scripts/check-no-external.mjs` ·
  `scripts/check-constitution.mjs`
- **做** ① 新建 `check-provider-swap.mjs`，四条规则：provider 构造点集合相等 / 业务代码零
  `fetch(`·`XMLHttpRequest`·`WebSocket(`·`EventSource`·`BroadcastChannel`·`navigator.locks` /
  装配点单一 / E2E spec 里零 provider 字样。**网络原语的所有权归本脚本**（`check-storage-abstraction.mjs`
  的 `GUARDED` 保持三包不动）——两处维护同一份豁免名单是 X-29 明确要避免的；
  ② `check-no-external.mjs` 的合规逃逸口收窄：今天唯一的豁免是「URL 里含 `${`」，**任何用模板
  拼出来的外部地址都能静默过关**。改为白名单式：只有出现在 `docs/EXTERNAL_URL_ALLOWLIST.md`
  里的模板前缀才放行，其余一律 fail；
  ③ 豁免名单每条带理由与到期版本号，走 T-205 的 `readExemptions`，每次运行打印全部豁免项。
- **验收** `pnpm check:constitution` 绿；**探针**：临时在 `App.tsx` 加 `fetch('/x')` → 守卫红；
  临时在 `main.tsx` 加 `new MemoryProvider()` → 规则 1 红；临时写
  `const u = \`https://\${host}/x\`` → `check-no-external` 红（三次探针都要还原并把输出贴进提交信息）。
- **自测** `node scripts/check-provider-swap.mjs && node scripts/check-no-external.mjs && pnpm check:constitution`
- **变异检验** ① 把规则 1 的「集合相等」改成「≤1 个文件」→ 第二个探针必须**仍然红**
  （若变绿说明写成了更弱的判据）；② 把模板字符串白名单读成「文件存在即全部放行」→ 第三个探针必须仍红。
- ⚠ **债 A**：C7 的守卫脚本**根本不扫 fetch**，尽管宪法与铁律 8 白纸黑字点名「fetch 到固定端点」。
  这条不做，v1.5 引 HTTP 后 C7 在机器层面是空的。

### [ ] T-210 · 断网的两半各自取证 + CI job `offline`
- **依赖** T-207 · T-208 · **预估** 1.0d · **实际** —
- **独占** `.github/workflows/ci.yml`（新 job）· `.dockerignore` · `docs/IMPL_NOTES.md`（对应行，
  与 T-207 冲突 → 排其后）
- **做** ① CI job `offline`：步骤 1 预热 pnpm store → `rm -rf node_modules` →
  `pnpm install --offline --frozen-lockfile`；步骤 2 `docker build` 出一个含 node_modules 的中间镜像 →
  `docker run --network none <img> pnpm build`；
  ② 删掉 `ci.yml:21-24` 那段把断网构建推给 T-173 的注释，换成「它现在由本文件的 offline job 覆盖」
  （**T-173 的卡面写了、实际换成运行时断网 E2E 并标 `[x]`，ci.yml 注释又推回给 T-173——两边互指，
  事实上没人做**）；
  ③ `.dockerignore` 加 `**/public/*.w3p`（本机实测 `packages/player/public` 下躺着 `golden.w3p`
  4559 B 与 `gp2.w3p` 84680 B，`COPY . .` 会把它们带进镜像）；
  ④ IMPL_NOTES §2 对应两行改成 `✅ 已真实执行`，证据写 CI run 号。
- **验收** `offline` job **在 GitHub 上真绿过一次**（**没跑过的 CI 配置与没有 CI 配置可靠性同一档**，
  v0.5 T-117 前两轮红各抓到一条本机看不见的真问题）；镜像里 `find / -name '*.w3p'` 无命中。
- **自测** 本机 `docker build` + `docker run --network none <img> pnpm build`；`pnpm install --offline --frozen-lockfile`
- **变异检验** ① 在某个包的 `build` 脚本里加 `curl https://example.com` → 步骤 2 必须红
  （**证明 `--network none` 真的生效，而不是命令根本没跑到那里**）；
  ② 把一个依赖从 store 里删掉 → 步骤 1 红。

### [x] T-211 · `ECA_SPEC` 与实现的三处对拍
- **依赖** T-216 · **预估** 0.5d · **实际** 1.2h
- **三处裁决没有走同一个方向**，这是本卡最值得记的一件事：
  ① **改实现**（§5.1 的 `Promise.allSettled` 从 v0 起就写在规范里，代码写的是 `Promise.all`）；
  ② **改规范**（§6 的「未在播放立即 resolve」是**规范错了**）；
  ③ **规范补一句**（§4.2 从没写过 `playAnimation` 的 `await` 默认值，代码是对的）。
- **② 的裁决被自己的测试推翻过一次。** 先按「规范优先」把两侧都改成立即 resolve，
  结果同时红了三处：`media-bus.test.ts` 那条连名字带注释都写着这件事已在 T-186 算过账 ·
  parity 的自检（`playMedia(await:true)` 必须真的挂起 ~0.4s，实测掉到 16ms）· 本卡自己的断言。
  理由是实的：浏览器拒绝自动播放时什么都没在播，「响完」**没有发生**而不是「已经发生过」；
  立即 resolve 会让作者编排的节奏整个塌掉，音频被拦的场景在静音之外再多坏一种。
  **一条规范句子被三处独立证据否掉，就该改那句话。**
- **① 的判据必须落在「抛错逃出 runStep」那条路径上。** `runStep` 看起来把一切都兜住了，
  但 `registry.get` / `schema.safeParse` / `definition.refs` 三处都在 `try` **外面**——
  其中一处抛出时 `Promise.all` 当场 reject，`execute` 直接抛异常，**兄弟步骤的结果一个都不剩**。
  handler 自己抛错那条路（被 runStep 接住）两种实现完全不可区分，正是卡面警告的假绿形状，
  本卡把它作为 counter-example 保留在文件里。
- **独占** `docs/ECA_SPEC.md`（§5.1 · §6 · §4.2 三处）· `packages/core/test/eca/spec-parity.test.ts`（新）·
  `packages/core/src/eca/actions/media.ts`（注释）
- **做** 三处「规范文本滞后于代码」逐条裁决并落地：
  ① `ECA_SPEC §5.1` 写 `Promise.allSettled`，实现是 `Promise.all`（靠 `runStep` 吞异常才没出事）——
  **裁决改 SPEC 还是改实现**，改哪边都行但必须有一条测试钉住选中的那个语义；
  ② `§6` 写 `waitForMediaEnd` 未播放时立即 resolve，实现返回 `neverEnds()`——同上；
  ③ `playAnimation` 的 `await` 默认 `true` 而 `playMedia` 默认 `false`，而 `media.ts` 注释写着
  「same as playAnimation」——D19 号称「媒体与动画语义对齐」在默认值这一项**没对齐**：
  裁决默认值并改掉那条错误注释。
  新增 `spec-parity.test.ts`：三条各一个正例一个反例。
- **验收** 三处各有一条测试；`ECA_SPEC` 里这三段的文字与测试断言**逐字对得上**；
  `grep -n "same as playAnimation" packages/core/src` 零命中或注释已改正。
- **自测** `pnpm -F @w3/core test spec-parity && pnpm -F @w3/core test eca`
- **变异检验** 把 `Promise.all` 改成与裁决相反的那一侧 → 对应断言必须转红。
  **⚠ 本卡最容易假绿**：如果测试只断言「最终会 resolve」，两种实现都绿——**断言必须落在
  「一个 step 抛错时其余 step 的完成状态」上。**
- ⚠ **两份 SPEC 是逐字实现的规范。** 规范文本滞后于代码不是孤例，v3 冻结清单落地时要连带核对。

### [x] T-212 · 合同措辞补充与排除项
- **依赖** 无 · **预估** 0.4d · **实际** 0.5h
- **落点是规划 §1.2 新增的 §1.2.1**，一张六行表：每行「合同措辞（正面）/ 措辞里明写的排除项 /
  依据」。此前六项的排除项**散在 §1.2、§1.3、§1.4 和拍板表四处**，谈判时没有一处可以整段抄。
- **回读核对（卡面要求，非新建）**：ADR-0020 的「代价」栏七条、「撤销条件」栏三条，两栏都非空；
  NORTH_STAR §3 v1.0 条目的改动处已标 ADR-0020（T-207 补 AI 插座时留下的那段引用）。
- **机器判据全部命中**：`透明背景导出不含描边效果` 3 处 · `长边 1920 / 2560 / 3840` 与 T-267 的
  档位逐字一致 · 规则 5 绿。**雾没有被写进透明背景的排除项**（P-11 逐字点名：雾画在物体像素上，
  背景像素仍然 alpha 0，把它列进去是白送一项能力）。
- **独占** `docs/MVP_V1_进化规划.md` §1.2（Out of Scope 清单）· `docs/NORTH_STAR.md` §3（v1 新增清单）·
  `docs/adr/0020-v1-拆成三级台阶.md`（**已存在，不是新建**——P-1 拍板落地时已写，本卡只回读核对）
- **做** 给**六项**没有任何合同措辞或措辞比裁决宽的能力补上措辞 + 排除项
  （原五项 + 拍板项 P-14 / P-17 带出的「减面」一项）：
  ① **爆炸**（技术方案 §6.2 零处提及）——「按分组的径向/轴向展开，展开量由作者配置或逐件手调；
  **不做**自动装配顺序推导、**不做**拆装工艺路径生成」；
  ② **剖切**（同样零处）——「最多 3 个平面，实时裁剪；**不做**带截面填充的工程剖面图、
  **不做**剖面标注与尺寸线」；
  ③ **多场景**（全部 docs 零处，问卷 F 项新引入）——用规划 §1.4 的草稿措辞（**拍板项 P-8** 已批准照用），
  写明 v1.5 范围与场景数上限；爆炸与剖切两项同样照 §1.4 草稿（**P-7**）；
  ④ **特效收窄**（方案写「描边、发光、Bloom、雾、粒子」）——**拍板项 P-9 已定死措辞：
  收窄为「描边、雾等预设效果」**，发光 / Bloom / 粒子列为**变更项计价**；另把
  **SMAA（35.4 KB）vs FXAA（2.3 KB）** 的取舍记一行：v1.0 **不引任何 AA pass**，
  靠 MSAA renderTarget + T-214 的像素比封顶，SMAA/FXAA 进 Out of Scope；
  ⑤ **出图**——**拍板项 P-12：长边上限 3840，就这么定**（与 T-267 对话框的长边档位
  `1920 / 2560 / 3840` 及 T-263 的 `MAX_SCALE_DIRECT=4` / `MAX_SCALE_COMPOSED=2` 逐字一致）；
  **拍板项 P-11：措辞里必须明写「透明背景导出不含描边效果」**（这不是保守话术，是 T-263 已裁的
  真实降级行为：`transparent:true → mode:'direct'`、`droppedOutline:true`。
  **且不许把雾一起列进去**——雾画在物体像素上，背景像素仍然 alpha 0）；
  **拍板项 P-10：分享二维码补回来**，记一行——本地生成、零外部请求、成本 ≈0.3 人日，
  已排为 v1.5 的 **T-454**。
  ⑥ **「减面」的措辞**照 **ADR-0031**（P-17 / P-14）：「上传即转码 = Draco 几何压缩（必做）+
  可选减面（默认关闭），均为纯 WASM」，**排除项写明不做 KTX2 / Basis 的服务端生成、
  不做重拓扑 / 自动 LOD / UV 重展 / 法线烘焙 / 网格合并**。
  ⚠ **ADR-0020 已经写好了**（P-1 拍板当天落地），本卡**不再新建它**，改为回读核对：
  确认它的「代价」与「撤销条件」两栏非空、且 NORTH_STAR §3 的改动处标了 ADR 号。
- **验收** ADR-0020 的「代价」与「撤销条件」两栏非空且 NORTH_STAR §3 改动处标了 ADR-0020；
  NORTH_STAR §3 的 v1 清单与规划 §1.2 的
  Out of Scope 清单**互不重复且互补**（`check-docs.mjs` 规则 5 机器验）；六项每项都能在两份清单
  之一里 grep 到；**`grep -n '透明背景' docs/` 能命中「不含描边效果」这句**（P-11 的机器判据）；
  **`grep -rn '3840' docs/` 与 T-267 的长边档位一致**（P-12 的机器判据）。
- **自测** `node scripts/check-docs.mjs` + 人工评审
- **变异检验** 不适用（合同 / 文档卡）。**替代验收**：把「爆炸」这一项从两份清单里同时删掉 →
  `check-docs.mjs` 规则 5 必须红。
- ⚠ 越早越好。「爆炸 / 剖切 / 多场景零措辞」是**需求膨胀的现成形状**（爆炸 → 自动装配顺序推导；
  剖切 → 带截面填充的工程剖面图）；等做完再补措辞，谈判位置会差很多。

### [ ] T-213 · 遗留决议清零（ADR-0014 / ADR-0013）
- **依赖** 无 · **预估** 0.2d · **实际** —
- **独占** `docs/adr/0014-共用播放会话放在-core.md` · `docs/adr/0013-v0-不支持-webgl1.md` ·
  `docs/IMPL_NOTES.md`（对应段）
- **做** ADR-0014 状态从「已接受（但需人工确认）」改成 `Accepted` 并记确认人与日期；
  ADR-0013 补一行商务确认记录。**两条都需要人先拍板**（只需确认，不需决策）。
- **验收** `grep -rn "需人工确认" docs/adr` 无命中；T-458 的收尾脚本第 7 步「非 Accepted ADR」列表为空。
- **自测** `grep -rn "需人工确认" docs/adr`
- **变异检验** 不适用（状态卡）。**替代验收**：把 ADR-0014 的状态改回「需人工确认」→
  `check-docs.mjs` 与收尾脚本必须各报一次。

### [x] T-214 · 设备像素比封顶 2
- **依赖** T-200（`scene-runtime.ts` 同文件，列 R）· **预估** 0.5d · **实际** 0.9h
- **交付偏差**（六个文件，均为接线后的连带修复）：`packages/core/test/runtime/` 下
  `bounds` · `default-rig` · `environment` · `light-helpers` · `primitive-factory` ·
  `scene-runtime` 六份测试的渲染器桩各补一行 `setPixelRatio`。**加一行 `renderer.setPixelRatio(...)`
  让 `pnpm -F @w3/core test runtime` 一次红了 94 条**：这六份桩都以 `as never` /
  `as unknown as WebGLRenderer` 收尾，因此可以合法地少实现 `RendererLike` 的必填成员。
  这正是 T-200 的 docstring 点名的形状，第一次被真实用例证实（登记在 `MUTATIONS.md` 的 ⑥）。
- **卡面点名的那条过期注释不存在**：「出图领域的注释逐字写着『因为 pixelRatio 恒为 1』」——
  全仓 grep 零命中。`planCapture` 由 T-262 交付，那句话是**将要被写下**的事实，本卡把字段与
  公式先落地，等于让它永远没机会被写下来。
- **`captureDevicePixels` / `maxCaptureScale` 进了豁免表**（owner T-262 · 到期 v1.2）：
  公式今天没有生产调用者，而它必须先于 `planCapture` 存在——否则 T-262 的桩 `limits` 会让
  一个漏掉像素比的公式在单测里全绿（X-17）。
- **独占** `packages/core/src/runtime/scene-runtime.ts`（`attachRenderer` / `resize` 两处）·
  `packages/core/test/runtime/pixel-ratio.test.ts`（新）· `packages/core/src/runtime/capability.ts`
  （`CaptureLimits` 的 `pixelRatio` 字段）
- **做** `renderer.setPixelRatio` **全仓从未被调用** → 高 DPI 屏上渲 1× 再让浏览器放大，
  这是「描边看起来毛糙」最常见的根因。
  ① `setPixelRatio(Math.min(hostDevicePixelRatio, MAX_PIXEL_RATIO))`，`MAX_PIXEL_RATIO = 2`
  是具名常量，像素比来源可注入；resize 时保持；
  ② **同时给 `CaptureLimits` 加 `pixelRatio` 字段并进钳位公式**——出图领域的注释逐字写着
  「因为 pixelRatio 恒为 1」，这句话在本卡落地的那一刻就是一条**会过期的事实，必须删掉而不是
  留着**。用户在 2× 屏上选 4× 导出 → 实际 8× → 正是双方都在防的 `webglcontextlost`（现象是整页变白），
  而**它不会让任何测试变红**：`planCapture` 的全钳位矩阵单测注入的是桩 `limits`。
- **验收** 注入 dpr = 1/2/3 → 实际 1/2/2；`setSize(w,h,false)` 的 `updateStyle=false` 约定不变；
  canvas CSS 尺寸不变；`CaptureLimits.pixelRatio` 出现在钳位公式里（T-262 的钳位矩阵单测加两行
  `pixelRatio: 2` 的用例，本卡先把字段与公式落地）。
- **自测** `pnpm -F @w3/core test pixel-ratio && pnpm -F @w3/core test runtime`
- **变异检验** ① 改成直接用 `dpr` → dpr=3 那条红；② 封顶改成 1 → dpr=2 那条红。
  **两向都要红，只测一向说不出上限在哪。**③ 把 `CaptureLimits.pixelRatio` 从钳位公式里删掉 →
  `pixelRatio: 2` 那两行必须红。
- ⚠ **cross-check X-17**：本卡与出图的 `CaptureLimits` 必须同一张卡或强制串行且出图在后。本表已排在前。

### [x] T-215 · 高亮「留空取消」与预设表的机械对齐
- **依赖** 无 · **预估** 0.5d · **实际** 1.0h
- **交付偏差**（三处，都是「验收标准要求的东西在当前结构里够不着」）：
  ① 新建 `packages/core/src/highlight-presets.ts`。预设表原本住在 `runtime/highlight.ts`，
  而动作定义住在 `eca/actions/`——**core 内部的方向是 `runtime → eca`，从不反向**
  （`camera-controller` / `environment` / `media-bus` / `playback-session` 四处都是这个方向，
  `eca/` 里零处 import `runtime/`）。让 eca 去 runtime 取选项会把方向倒过来，而且
  `runtime/highlight.ts` import 了 three，会把渲染器拖进 ECA 的纯 Node 单测（C8）。
  表本身是纯数据，所以它该在两者之上。`HIGHLIGHT_PRESETS` 从 `runtime/highlight.ts` 转出，
  外部导入路径不变；
  ② `RulePanel.tsx` 把 onChange 的那段抽成导出的纯函数 `applyParamChange`。卡面要求
  「一条**走 RulePanel onChange 路径**的编辑器测试」，而编辑器单测跑纯 Node、无 jsdom——
  内联在事件处理器里的规则**可以被测试描述、但永远不会被执行**，这正是它藏了两个版本的原因；
  ③ `packages/editor/test/{place,snap}.test.ts` 各补一行 `setPixelRatio`（同 T-214 的 ⑥）。
- **`HighlightPreset` 多了一个 `label` 字段**：选项要从表机械生成，中文标签就必须在表里，
  否则「机械生成」只搬了 key、标签还是手写的，drift 换个地方接着发生。
- **独占** `packages/core/src/eca/actions/scene.ts` · `packages/core/src/eca/actions/scene.test.ts` ·
  `packages/editor/src/rule-editor/ActionFields.tsx`（highlight 选项段）
- **做** ①「留空取消高亮」**从 v0 至今从未工作过**（缺陷横跨 editor 删键 / core zod 非 optional /
  executor 判 failed 三个包），而 UI 标签明写「预设（留空取消）」：给 `preset` / `materialId`
  加 `.default(null)`；
  ② `highlight` 的 UI enum 选项**从 `HIGHLIGHT_PRESETS` 的 key 机械生成**——今天手写四行而
  预设有五个，`outline_white` 用户**永远选不到**。
- **验收** `highlight.schema.safeParse({nodeId})` 成功且 `preset === null`；
  UI 选项集合 **=== `Object.keys(HIGHLIGHT_PRESETS)`**（含 `outline_white`）；
  一条**走 `RulePanel` onChange 路径**的编辑器测试：选「（未指定）」后 `ExecResult.status !== 'failed'`。
- **自测** `pnpm -F @w3/core test eca && pnpm -F @w3/editor test`
- **变异检验** ① 去掉 `.default(null)` → 三条全红；② UI 选项改回手写四行 → 集合相等那条红；
  ③ **反向变异**：把断言写成 `expect(options.length).toBeGreaterThan(0)` → **必须证明它测不出东西**。
- ⚠ 不先修，接了描边就变成「修好了一个没人知道存在的 bug」，T-240 的变异检验**测不出东西**。

### [x] T-216 · 两处 headless 与真实运行时的动画分叉
- **依赖** 无 · **预估** 0.4d · **实际** 0.7h
- **两条变异都只在 headless 侧红，真实侧全绿**——这正是卡面要求「指定哪一侧」的意思：
  契约测试最容易的假绿是**两侧一致地错**，那时两边都绿、分歧照旧。
- **契约套件多了一个 `events()` 座**（`ContractHarness`，与 `lightOf` 同理由）：两侧都有
  `onEvent`，但走 harness 才能让断言有类型，而不是像文件里早先那个 probe 一样 cast 穿 `unknown`。
- **独占** `packages/core/src/eca/headless.ts` · `packages/core/test/runtime-contract.ts` ·
  `packages/core/test/eca/headless.test.ts`
- **做** headless 与真实运行时在「重叠播放」上**已经分叉且可测量**：headless 发两次
  `completed:true`、首个 promise resolve；真实侧发 `completed:false + completed:true`、首个
  promise reject。契约套件与 parity 都看不见，因为两者都没有重叠播放用例。
  ① `HeadlessRuntime.playAnimation` 在 `playing.set` 之前先停同 id 的上一次（cancel + 发
  `animationEnd{completed:false}` + 旧 promise reject），对齐 `tween.ts:73` / `clip.ts:88`；
  ② 去掉 `headless.ts:426` 的 `if (!entry.loop)`，停 loop 也发 `animationEnd{completed:false}`；
  ③ 两条各写成**契约断言**两侧同跑。
- **验收** 重叠播放的事件序列两侧均为 `[{completed:false},{completed:true}]` 且首个 promise reject；
  `pnpm test:parity` 仍绿。
- **自测** `pnpm -F @w3/core test eca && pnpm -F @w3/core test runtime && pnpm test:parity`
- **变异检验** ① 删 ① 的 stop → 重叠播放那条必须在 **headless 侧**转红（不是只在真实侧红）；
  ② 把 ② 改回 `if (!entry.loop)` → loop stop 那条在 headless 侧转红。
  **两条都要指定「在哪一侧红」**——契约测试最容易的假绿是「两侧一致地错」。

### [x] T-217 · GLB 容器感知与压缩件体检
- **依赖** 无 · **预估** 1.2d · **实际** 1.4h
- ⚠ **卡面的一条验收在实现层面不成立，已就地更正**：把 `readGlb` 改用
  `registerExtensions(ALL_EXTENSIONS)` **不能**让「`auditGlb` 对声明 Draco 的 GLB 不再抛异常」
  成立。实测它把可读的 `Error: Missing required extension` 换成了不可读的
  `TypeError: Cannot read properties of undefined (reading 'DT_FLOAT32')`——
  `KHRDracoMeshCompression.install()` 会急切调用 `initDecoderModule(undefined)`，
  抢在它自己那句「请安装解码器」之前炸掉。
  **「不再抛异常」只能由容器分流实现**；`registerExtensions` 仍然交付，但它买的是另一件事
  （扩展块被读进 Document、不再把 `Missing optional extension` 刷到 stderr），
  并另配了一条真会红的断言。
- **交叉校验的三处假绿**（详见 `docs/MUTATIONS.md` 的 ①、①′、④）：现有 fixture 全是 mode 4、
  且 1 image / 1 texture，两个实现的差异在它上面**结构上不可见**。补了 `buildMixedModeGlb`
  与「一张图背两个 texture」两份 fixture 之后，mode 那条**第二次仍然绿**——
  4 个顶点时两个公式的和恰好相等（`0+0+1+2+2` = `1+1+1+1+1` = 5），改成 7 个顶点才分得开。
  magic 校验那条同理：合成坏字节的 JSON chunk 是四个 0，`JSON.parse` 先抛先返回 null，
  要拿一份**完全合法、只改了头四个字节**的 GLB 才测得出来。
- **`pnpm -F @w3/core test assets` 67 → 87 条**（卡面写的「现有 67 条」核实无误）。
- **独占** `packages/core/src/assets/glb-header.ts`（新）· `packages/core/src/assets/audit.ts` ·
  `packages/core/test/assets/glb-header.test.ts`（新）· `packages/core/package.json`
- **做** `readGlbHeader(bytes)` 解析 GLB 容器（magic / version / chunk 表），返回
  `{ json, binOffset, binLength, extensionsUsed, extensionsRequired }`，**零依赖、不解析任何几何**，
  非法容器返回 `null`；`measureFromHeader` 产出与 `measure()` **完全相同**的 `AuditMeasurements`；
  `readGlb` 改用 `registerExtensions(ALL_EXTENSIONS)`（**lockfile 里已有，零新增下载**；
  `@gltf-transform/extensions` 由传递依赖**提升为直接依赖**，**已由 [ADR-0030](adr/0030-批准-v1-新增第三方依赖.md) 批准**，
  本卡是它两张引入卡里的第一张——落进 `packages/core/package.json` 时**四个 `@gltf-transform/*` 包的版本号必须完全一致**，
  不一致的症状是运行时「扩展没被识别」而不是编译错误）；
  `auditGlb` 分流（`extensionsRequired` 命中 draco / meshopt → 走 header 路）；`AuditOptions` 增 `header?`。
- **验收** 三份合成 GLB 全部返回非 null 且 `extensionsRequired` 正确；`auditGlb` 对声明 Draco 的
  GLB **不再抛异常**；**交叉校验**：同一份未压缩 GLB 两条路的 `AuditMeasurements` `toEqual`；
  现有 67 条全绿。
- **自测** `pnpm -F @w3/core test assets`
- **变异检验** ① 三角面公式改成一律 `count/3` → 交叉校验红；② 去掉 `registerExtensions` →
  「Draco 不再抛异常」红；③ 分流条件写反 → 红；④ 不校验 magic → 「非 GLB 返回 null」红。

### [ ] T-218 · Draco 解码真资产端到端
- **依赖** T-217 · T-208 · **预估** 1.5d · **实际** —
- ✅ **依赖审批已闭合**：`draco3dgltf`（Apache-2.0，emscripten WASM + JS 胶水，无 node-gyp）与
  `@gltf-transform/extensions`（MIT，纯 JS）**已由 [ADR-0030](adr/0030-批准-v1-新增第三方依赖.md) 批准**
  （拍板项 P-15）。**本卡不再需要停下来问人**。落地纪律照 ADR-0030：`draco3dgltf` 只进
  `devDependencies`（fixture 生成脚本人工执行，不在 build / CI / verify 路径上）· 版本精确锁定不许 caret ·
  许可证登记进 `docs/LICENSES_LIBRARY.md` 新增的「三方 npm 依赖」节并点名 Apache-2.0 的 NOTICE 义务 ·
  断网 job `offline` 的预热 store 同批更新（**遗漏的表现是安装步骤红，不是编译步骤红**）。
- **独占** `scripts/gen-draco-fixture.mjs`（新）· `e2e/fixtures/pump-draco.glb`（新，二进制）·
  `e2e/tests/decoders.spec.ts`（新）· `packages/core/test/assets/draco-fixture.test.ts`（新）·
  `packages/core/package.json`（devDep）· `e2e/package.json` · `docs/LICENSES_LIBRARY.md`
- **做** ① `gen-draco-fixture.mjs`（`buildSamplePumpGlb()` → Draco 压缩 → 写 fixture）；
  脚本头注释**逐字写明：需要网络、人工一次性执行、不在任何 build/CI/verify 路径上，产物提交进仓库**；
  注意 `packages/core/test/assets/glb.ts` 现有 primitive **没有 indices**（`:51`），Draco 要求索引
  三角面 → 补 `setIndices`；
  ② Node 单测三层：解析 fixture 的 GLB JSON chunk 断言 `extensionsUsed` 含 draco 且 `meshes.length > 0`
  （**注释里写明这一层不证明解码**）· `auditGlb` 给出的三角面数与未压缩同源件逐项相等 ·
  `AssetLoader.parse` 的 `indexObjects` 键集合与未压缩同源件**完全相等**；
  ③ E2E：`page.on('request')` 收集全部请求 → 导入 fixture → 断言存在一条 URL 匹配
  `/draco[\w.-]*\.(wasm|js)$/`、`status() === 200`、**`new URL(url).origin === new URL(baseURL).origin`
  （同源）**→ 再断视口三角面数 > 0；**把观测到的完整 URL 打印出来**（T-220 要用它做裁决依据）；
  ④ 发布 `.w3p` → Player 打开 → 断网重载仍可见。
- **验收** 三层断言全绿；E2E 输出里能看到被请求的解码器 URL；fixture 体积 < 100 KB；
  `IMPL_NOTES` 里 Draco 那半边可以改成 ✅。
- **自测** `pnpm -F @w3/core test draco-fixture && pnpm test:e2e decoders`
- **变异检验** ① 把 `AssetLoader` 构造里的 `setDRACOLoader` 注掉 / 传 `dracoPath:'/nope/'` →
  **E2E 第 2、3 层必须红**（这条证明 DRACOLoader 真的在被用，而不是碰巧不需要）；
  ② fixture 换成未压缩 GLB → Node 单测红（防 fixture 悄悄退化）。
  **最容易假绿的一条**：如果只断言「导入后有网格」，两条变异都会绿。
- ⚠ **债 H**：Draco 是「装了但没跑过」，KTX2 是「没装」——IMPL_NOTES 把两者写在同一行**掩盖了差别**。
  本卡与 T-219 分开取证，正是为了拆开这一行。

### [ ] T-219 · KTX2 生产路径接通
- **依赖** T-218 · **预估** 1.5d · **实际** —
- **独占** `packages/core/src/runtime/loader.ts` · `packages/core/src/runtime/scene-runtime.ts`
  （`attachRenderer` 一行，列 R）· `packages/core/src/runtime/texture-cache.ts` ·
  `packages/editor/src/project/session.ts` · `e2e/fixtures/ktx2/**`（新）·
  `packages/core/test/runtime/texture-cache.test.ts` · `e2e/tests/compressed-assets.spec.ts`（新）
- **做** **KTX2 解码器从来没有被创建过**——不是「装了没跑过」而是「代码路径根本没进过」
  （`if (options.renderer)` 是唯一的门，两个构造点都没传）。而附件A 已把「允许 KTX2」写进给客户
  的资产规范，**这是一条对客户已生效的虚假承诺**。
  ① `AssetLoader.attachRenderer(renderer | null)` 幂等——首次创建 `KTX2Loader`、`setTranscoderPath`、
  `detectSupport(renderer)`、`setKTX2Loader`；传 null 时 dispose；构造函数里的 `if (options.renderer)`
  分支改为调用它（保留旧能力，不破坏现有测试）。**方法名统一为 `attachRenderer`**，与
  `SceneRuntime.attachRenderer` 同名同义（原本被两份设计写成两张卡两个方法名，人日各算一遍）；
  ② `SceneRuntime.attach(canvas)` 创建 renderer 后立刻调，`detach` 传 null；`ProjectSession` 同样接线；
  ③ **A4/X-34 裁决：单独 `.ktx2` 贴图支持，不做诚实拒绝。** `TextureCache.decodeInto` 对
  `image/ktx2` 走 `KTX2Loader.parse`（经 `TextureCacheOptions` 注入可选 `decodeKtx2`），
  **缺少 KTX2 能力时给出明确中文日志**「该贴图为 KTX2 格式，当前环境未启用 GPU 纹理解码」，
  而不是笼统的「贴图加载失败」；**`附件A` 不动，也不加 error 级完整性检查**；
  ④ `TEXTURE_SLOT_COLOR_SPACE` 改为从 `@w3/schema` 的纯数据版派生；
  ⑤ E2E fixture `checker-etc1s.ktx2`（≤ 4 KB）+ README 记生成命令与来源。
- **验收** **断言生产装配路径**——构造 `SceneRuntime` → `attachRenderer(桩)` → 断言 loader 上的
  ktx2 **非空**（注释写明这是「测试覆盖零件而缺陷长在接缝上」的可执行形式：断言真实实现被装上，
  不是断言它正确）；`attachRenderer` 之前 parse 含 KTX2 的 GLB → 报明确中文错，之后 → 成功；
  E2E 导入独立 `.ktx2` → 挂 baseColor → 视口像素断言该 mesh 不是默认灰；
  **E2E：加载一个不含任何 KTX2 的场景，断言 `basis_transcoder*.wasm` 的网络请求数为 0**；
  `packages/player/src` diff 为空。
- **自测** `pnpm -F @w3/core test texture-cache ktx2 && pnpm test:e2e compressed-assets`
- **变异检验** ① `attachRenderer` 里那行删掉 → 装配断言必须红（**今天这条断言不存在，所以这个
  缺陷已经在生产里活了整整两个版本**）；② 不调 `detectSupport` → 需要一条断言它被调用过的测试
  （桩渲染器计数），**否则这条变异是绿的**；③ 色彩空间派生表把 `normalMap` 改成 `srgb` →
  需要一条断言渲染侧 `texture.colorSpace` 的测试（复用 v0.5 T-115 建立的 `__w3DevMaterialOf` 钩子）；
  ④ `detectSupport` 提前到构造 → 「无 KTX2 场景请求数为 0」红。
- ⚠ **本卡不受 P-14 影响，不许一起砍。** P-14 砍掉的是 **v1.5 的 KTX2 服务端编码**（原 T-423，
  理由是 Khronos `ktx` 原生二进制 + amd64 单架构）。**读 KTX2 与生成 KTX2 是两件事**：
  `KTX2Loader` 已在 bundle 里，附件A 已把「允许 KTX2」写给客户，本卡清的是 v1.0 的债
  ——逐字见 [ADR-0031](adr/0031-减面移出-Out-of-Scope.md) 第 3 节末段「不要把 P-14 读成 KTX2 全线不做」。

### [ ] T-220 · `vendor/` 与 `VENDOR_*` 常量的去留裁决
- **依赖** T-218（要它打印的真实 URL）· **预估** 0.3d · **实际** —
- **独占** `docs/adr/0037-vendor-目录的去留.md`（新，**本版改号**：原定 0030 已被
  [ADR-0030 批准 v1 新增第三方依赖](adr/0030-批准-v1-新增第三方依赖.md) 占用）·
  `packages/core/src/runtime/loader.ts:35-36`（若删）·
  `Dockerfile:42`（若删）· `deploy/nginx.conf.template`（若删）
- **做** `vendor/` 现在是**死的**：ADR-0012 后无任何默认路径指向它，两个 vite 的 publicDir 都不含它，
  无构建步骤拷进 dist；而 Dockerfile 仍把它拷到 `/vendor/` 并由 nginx 配了缓存，vite.config 注释
  还写着「由 sync-vendor.mjs 拷进构建输出」（**错的**）。`sync-vendor --check` 绿的是「拷贝与 three
  一致」，不是「它被用上了」。
  依据 T-218 观测到的解码器 URL 二选一并写 ADR：若真实 URL 是 vite 产物 → 保留 `vendor/` 但在
  `docs/DEPLOY.md` 写明「它服务于纯进程 / 非打包部署」，并给 `VENDOR_*` 常量的 JSDoc 补上
  「谁会用到它」；若真实 URL 是 `/vendor/...` → 把常量真正接上并补测试。
- **验收** ADR 的「代价」与「撤销条件」两栏非空；`grep -rn "VENDOR_DRACO_PATH" packages/*/src`
  每处命中都有调用者或 JSDoc 说明；`vendor/` 若保留则进 T-205 的豁免表并带到期版本号。
- **自测** `pnpm check:constitution`（`sync-vendor --check` 必须仍绿）
- **变异检验** 不适用（裁决卡）。**替代验收**：ADR 里必须写明——如果保留 `vendor/` 而没有任何测试
  指向它，它就是下一次「被部署、被检查、没人用」的候选，**撤销条件要写死到期版本号**。

### [ ] T-221 · 云托管入库与部署文档
- **依赖** T-210（`.dockerignore` 同文件）· **预估** 0.6d · **实际** —
- **独占** `Dockerfile` · `railway.toml` · `deploy/**` · `docs/DEPLOY.md`（新）
- **做** ① **`git add` 这四个路径**——今天 `git status --porcelain` 显示它们全是 `??`，
  `git log -- Dockerfile deploy railway.toml` 无输出，**「云托管」在版本库里不存在**；
  ② 写 `docs/DEPLOY.md`：形态选择决策树 · 三种形态各自的完整步骤 · 每种形态的验证命令 ·
  升级与回滚 · 一段明写「**镜像构建不跑任何检查，质量由 CI 保证，镜像构建成功 ≠ 通过验收**」
  （Dockerfile 全文无 `check:constitution`/`test`，不写这句下一个人会误解）· 一段明写
  「`docker build` 需要联网，因此它不能充当断网构建的证据，那由 CI 的 offline job 覆盖」。
- **验收** 四个文件在 `git ls-files` 里出现；`check-docs.mjs` 断言 DEPLOY.md 引用的每个文件都存在；
  照 DEPLOY.md 云托管一节从零部署一次成功。
- **自测** `git ls-files Dockerfile railway.toml deploy/ && node scripts/check-docs.mjs`
- **变异检验** 把 DEPLOY.md 里一个文件路径改错 → `check-docs` 必须红。

### [x] T-222 · 泵组资产生成器与对象路径契约
- **依赖** 无 · **预估** 1.0d · **实际** 1.1h
- ⚠ **卡面验收有一条今天写不出来**：`stats.clipDurations['拆装'] ≈ 2.0`。
  该字段**不存在**——`AssetStatsSchema` 是 `.strict()` 的七个键，`clipDurations` 属 schema v3
  冻结清单，由 **T-225**（W4 单卡波次，未开工）落地、**T-234**（W5）测量。本卡在 W0 且依赖为空，
  写它只能是失败或说谎。**改为从 `AnimationClip.duration` 断同一个数**（实测 2.0），
  并在测试里逐字写明这条移交，**T-234 负责把它挪回 `clipDurations`**。
- **卡面另有两处笔误**：① 「注册表↔样板双向体检」记在 T-288 名下，实际是 **T-285**
  （T-288 是崩溃恢复·编辑器侧），门槛编号 G1.0-19；② 转出点写成 `packages/core/src/index.ts`，
  实际要加行的是 `packages/core/src/assets/index.ts`。
- **本卡把 T-205 的守卫证伪了一次**（详见 MUTATIONS ⑤）：新增 `export async function` 之后
  孤儿数纹丝不动——`check-dead-exports.mjs` 的两条正则都漏了 `async`。补上之后
  `buildPumpDemoGlb` 才如实报成孤儿并进豁免表（owner T-283）。
- **Player gzip 增量 0 KB**（卡面要求 ≤ 2 KB）：`pump-demo.ts` 与 `sample.ts` 同一条 barrel，
  player 侧无人 import，被 tree-shake 掉。
- **独占** `packages/core/src/assets/pump-demo.ts`（新）· `packages/core/test/assets/pump-demo.test.ts`（新）·
  `packages/core/src/index.ts`（转出）· `packages/core/test/assets/sample.test.ts` · `docs/LICENSES_LIBRARY.md`
- **做** 两条黄金路径里的 `pump.glb` 都是**同一个单四边形夹具改了个文件名**——E2E 全绿并不代表
  这个引擎处理过任何像泵一样的多零件装配体，「泵组样板工程」目前只是一串字符串。
  ① `buildPumpDemoGlb()`：16 个物体 + `cylinderPrimitive`(24 分段)，导出 `PUMP_DEMO_OBJECTS`；
  ② **含一条 imported「拆装」clip**（阀盖沿 Y 上移 2 秒）——示例 GLB 压根不含动画通道，
  样本资产记录手写的 `stats.animations:['Disassemble']` 会被启动时的实测 stats 覆盖成空数组，
  于是**demo 里没有可演示的导入动画**，而 T-288 的「注册表 ↔ 样板双向体检」会因此必红；
  ③ LICENSES 加 §1.1；**顺手给 `SAMPLE_OBJECT_PATHS` 补断言**（它是第三次同形零调用者）。
- **验收** `[...loaded.objects.keys()].sort()` === `[...PUMP_DEMO_OBJECTS].sort()`；
  `steel` 材质被 ≥ 10 个 mesh 共享；逐次调用**字节一致**；`stats.animations` 实测含「拆装」
  且 `stats.clipDurations['拆装']` ≈ 2.0；**Player gzip 增量 ≤ 2 KB**。
- **自测** `pnpm -F @w3/core test pump-demo && pnpm -F @w3/core test sample && pnpm build && pnpm size`
- **变异检验** ① `ValveCover` 改名 → 路径清单红；② `steel` 拆成两个 → 共享断言红；
  ③ `SAMPLE_OBJECT_PATHS` 删一项 → 新补那条红（**证明它此前确实什么都没测**）；
  ④ 去掉「拆装」clip → `stats.animations` 断言红（**若只断言「有资产」则不会红**）。

### [ ] T-223 · 内置库生成物一致性闸门
- **依赖** 无 · **预估** 0.5d · **实际** —
- **独占** `scripts/gen-library-starter.mjs` · `scripts/check-constitution.mjs`
- **做** starter 生成脚本不在 npm script 里，生成物已提交进 git，**无任何检查守「可逐字节复现」**——
  改了脚本忘了重跑，或直接手改 png，检查一样绿。给生成器加 `--check`（生成到临时目录 → 与
  `packages/editor/public/library/**` 逐字节比对 → 不一致列文件名并 exit 1），形态照抄 `sync-vendor.mjs --check`。
- **验收** 当前仓库状态 PASS；手改一个字节 → FAIL 并**指名该文件**（验后还原）。
- **自测** `node scripts/gen-library-starter.mjs --check && pnpm check:constitution`
- **变异检验** 把比对改成只比文件数 → 「改一个字节要 FAIL」必须红。

### [x] T-224 · 层级树搜索过滤
- **依赖** 无 · **预估** 1.0d · **实际** 1.5h
- **本卡查出的一件事**（登记在 `docs/MUTATIONS.md` 的 ⓪）：**卡面「必须用 1000/2000」是对的，
  但不充分。** 把祖先查找改成扫数组（O(n²)）之后比值测试**先是绿的**（查询命中每个节点 →
  父节点总是已在 `visible` 里 → 循环第一跳就 break，被变异的那行根本没执行），改成只命中最深
  节点之后**变成时红时绿**（这个规模下二次项与线性建表同量级，落在 3 附近由 GC 决定归属）。
  最终改成**数数不掐表**：Proxy 包住 `doc.nodes` 数下标读取，诚实实现 ~2n、每跳一扫 ~n²/20，
  断言 `< 6n`，连跑 5 次全红。比值测试保留——它是卡面的字面验收，且能抓整体算法退化。
- **`helpOpen` 的去处**：四个瞬态里只有它今天没有消费端，**由 T-290 的速查面板读**。
  写在本卡是因为 T-290 也重写 `HierarchyTree.tsx` 的删除入口，一次定死四字段的形状比两张卡
  各改一次同一个类型省一次冲突。
- **`bench-scale.mjs` 直接 import 了 `.ts`**：`@w3/editor` 没有模块 dist（它是打包后的 Vite 应用），
  Node 24 原生剥类型。**故意没写 try/catch 兜底**——一个静默跳过被测对象的基准，读起来和
  「测了，很快」一模一样。
- **独占** `packages/editor/src/panels/tree-dnd.ts` · `packages/editor/src/panels/HierarchyTree.tsx` ·
  `packages/editor/src/store/ui-store.ts`（新）· `packages/editor/test/tree-search.test.ts`（新）·
  `scripts/bench-scale.mjs`
- **做** `filterNodes` + `flattenTree` 可选 filter + `TreeRow.matched` + 搜索框 + 空态 +
  scrollTop 钳位 + 过滤中禁拖 + `ui-store`（搜索词 / 待重命名 / 待删除 / 帮助开关四个 UI 瞬态，
  **不进文档**——铁律 1 的唯一例外）。
- **验收** `filterNodes(doc,'')` **严格等于 `null`**（零开销路径）；1000/2000 节点比值
  `t(2n)/t(n) < 3`；过滤中 Shift 范围选**不含**被过滤的中间节点；`lastClicked` 被过滤后
  Shift 只选当前行；清空搜索后 `collapsed` 逐项相等。
- **自测** `pnpm -F @w3/editor test tree-search && node scripts/bench-scale.mjs 2000`
- **变异检验** ① 不收集祖先 → 「父链可见」红；② 有 filter 时仍尊重 `collapsed` →
  「折叠分支里的命中仍出现」红；③ 空查询返回空 Set 而非 `null` → 零开销断言红。
  **⚠ 最容易假绿**：比值测试若用 200/400 节点，两种复杂度都在噪声里，**必须用 1000/2000**。

### [ ] T-297 · 变异检验登记表与它的机械锁
- **依赖** T-208（`package.json` 同文件）· **预估** 0.6d · **实际** —
- **独占** `docs/MUTATIONS.md`（新）· `scripts/check-mutations.mjs`（新）· `package.json`（`verify` 段）
- **做** **G1.0-22、风险 V25、本台账新纪律 1 三者共同依赖这两个产物，而在本卡之前没有任何一张卡造它们。**
  这正是本版反复要消灭的形状：门槛写好了，它指向的东西不存在。
  ① `docs/MUTATIONS.md` 七列表模板 + 填写说明（中文）：
  **卡号 / 编号 / 操作 / 期望 / 实际 / 若绿属哪一类 / 处置**。
  「若绿属哪一类」是封闭枚举 `a` / `b` / `c`（a = 测试没测到东西；b = 冗余机制互相掩护；
  c = 被测代码本来就是对的），**「实际」为「绿」时后两列必填**；
  ② `scripts/check-mutations.mjs` **四条规则**：
  **R1** 台账里每一张标 `[x]` 且「变异检验」栏不是「不适用」的卡，在 `MUTATIONS.md` 里**至少一行**，
  缺失时**点名卡号**；
  **R2** 「实际」列为「绿」的行，后两列非空且「若绿属哪一类」是 a/b/c 之一；
  **R3** 「卡号」列里出现的每个卡号都在台账里存在（防登记表自己腐烂）；
  **R4** 七列逐行非空（表结构完整），列头顺序与模板逐字相同；
  ③ 脚本每次运行打印 **「登记条数 / 涉及卡数 / 未转红条数」**，并断言
  **涉及卡数 === 台账里已标 `[x]` 且需要登记的卡数**——两个数字对不上就是 R1 有洞；
  ④ 挂进 `package.json` 的 `verify`（`pnpm verify` 里排在 `check:constitution` 之后）。
- **验收** 本卡开工时台账里已有 W0~W2 的若干张 `[x]`，**它们的登记行必须先回填齐**，
  然后 `node scripts/check-mutations.mjs` exit 0 并打印三个数；
  **另有一条对空表的断言**：把表清成只剩表头 → 脚本仍**正常读取并打印 `登记条数 0`**，
  再由 R1 报出缺失的卡号而 exit 1——**不许因为表是空的就跳过检查**；
  `pnpm verify` 多一步且仍全绿；
  模板里的示例行**用一条真实的 v0.5 变异**（`docs/IMPL_NOTES.md` E18 那 8 条绿的之一），
  不许写 `xxx` 占位。
- **自测** `node scripts/check-mutations.mjs && pnpm verify`
- **变异检验** ① 把一张已标 `[x]` 的卡从 `MUTATIONS.md` 里删掉 → **R1 必须红且点名卡号**；
  ② 把某行「实际」改成「绿」而后两列留空 → R2 必须红；
  ③ 把某行卡号改成 `T-999` → R3 必须红；
  ④ 把列头顺序调换两列 → R4 必须红；
  ⑤ **把读表路径指向一个不存在的文件 → 必须红**，红的理由是「登记条数」拿不到，
  **不是**「零条登记所以放行」——**没有这一条，一个路径写错的脚本会永远绿**
  （与 T-205 的 M6、T-207 的规则 6 变异 ⑧ 是同一种风险，本版第三次写下它）。
- ⚠ **本卡是每一张卡 DoD 的前置**：在它完成之前，登记照做（写进 `docs/MUTATIONS.md`），
  只是还没有机器在看。**完成后回填前面已完成卡的登记行**，不许留空档。

### [ ] T-298 · `CONSTITUTION-EXCEPTION` 到期守卫
- **依赖** T-205（复用 `scripts/lib/exemptions.mjs` 的版本比较）· T-223（`check-constitution.mjs` 同文件）·
  **预估** 0.5d · **实际** —
- **独占** `scripts/check-expiry.mjs`（新）· `scripts/fixtures/expiry/**`（新，四份自测夹具）·
  `scripts/check-constitution.mjs`（`GUARDS` 一行）
- **做** `NORTH_STAR.md:286-292` 写死了破例四步，第 4 步是「到期未清理，CI 转为失败」——
  **而 `grep -rn "CONSTITUTION-EXCEPTION" packages scripts` 今天零命中，读它的脚本也不存在**。
  后果是具体的：**ADR-0022（到期 `v1.0`）· ADR-0024（到期 `v1.5`）· ADR-0025（到期 `v2`）
  三条 ADR 的到期条款全是空头支票**，三份 ADR 自己都把这句话写进了「代价」栏。
  ① 扫全仓 `packages/*/src/**` 与 `scripts/**` 的注释，识别
  `CONSTITUTION-EXCEPTION: <条款> · <ADR 号> · 到期 v<x>` 这一行（格式取自 NORTH_STAR §8 第 2 步
  与 ADR-0024 / ADR-0025 已写下的两条实例，**逐字对齐，不另发明格式**）；
  ② 解析 `到期 v<x>`，与 `package.json` 的当前版本比较，**已到期即 exit 1 并点名文件、行号、ADR 号**；
  ③ **格式写错必须红，不许静默跳过**：出现 `CONSTITUTION-EXCEPTION` 但三段缺任何一段（条款 / ADR 号 /
  到期版本号）→ exit 1。**这一条是本卡的重点**——一条解析不出来的例外与一条不存在的例外，
  在「静默跳过」的实现里是同一个结果；
  ④ 版本比较**复用 T-205 的 `scripts/lib/exemptions.mjs`**，不另写一份（两处维护同一套版本序会分叉）；
  ⑤ 每次运行打印 **「扫描文件数 / 命中例外数 / 已到期数」**，并断言 **扫描文件数 ≥ 下限**（常量，
  按当天实测值取整下调）。**下限断在文件数上，不是断在例外数上**——今天全仓合法地是 0 条例外，
  拿例外数当下限会让这张卡当天就无法通过；而 glob 写错时文件数会掉到 0，这条断言正是为它准备的；
  ⑥ `--self-test` 用 `scripts/fixtures/expiry/` 下四份夹具证明四种情形各被正确处理：
  未到期 → 放行 · 已到期 → 红 · 缺到期版本号 → 红 · 格式写错 → 红。
  **零真实例外的今天，夹具是这个脚本唯一的行为证据**；
  ⑦ 挂进 `check-constitution.mjs` 的 `GUARDS`（`pnpm check:constitution` 多一项）。
- **验收** `node scripts/check-expiry.mjs` exit 0 并打印三个数；`--self-test` 四种情形全绿；
  `pnpm check:constitution` 多一项且仍全绿；脚本的 JSDoc 里逐条列出今天已知的三条到期承诺
  （ADR-0022 `v1.0` · ADR-0024 `v1.5` · ADR-0025 `v2`）与它们各自的清偿动作。
- **自测** `node scripts/check-expiry.mjs && node scripts/check-expiry.mjs --self-test && pnpm check:constitution`
- **变异检验** ① 把夹具里「未到期」那份的到期版本改成已过期 → 必须红且点名行号；
  ② 把夹具里的 `到期 v1.5` 改成 `到期`（缺版本号）→ 必须红（**不是跳过**）；
  ③ 把版本比较改成字符串比较 → `v1.10` vs `v1.5` 那条夹具必须红（**字典序会把 `v1.10` 判成更早**）；
  ④ **把扫描 glob 改成不存在的目录 → 「扫描文件数 ≥ 下限」必须红**（D36 点名的 M6 形状，
  本版第二次写下它）。
- ⚠ **ADR-0022 / 0024 / 0025 三条已经逐条点名本卡**（各自的「代价」或「撤销条件」栏里写着
  「本条的到期承诺在 T-298 完成之前不生效」）。**本卡完成时必须逐条回读这三处**，
  确认三条到期承诺现在都能被脚本解析出来；解析不出来的，是格式还没对齐，不是可以放过。
  **本卡被砍 = 三条宪法级例外同时退回「没有到期日的例外」**，那正是 `NORTH_STAR §8` 明令禁止的形态。

**M14 小计：27 张 / 23.4 人日**

---

## M15 · schema v3 一次冻结（T-225 ~ T-234）

> **A2：schema 只 bump 一次（2→3），在 v1.0 内完成，且必须同时冻结 v1.2 与 v1.5 才用的全部字段。**
> 沿用 v0 对 flows/pages/media 的做法与 v0.5 的 D11。**开工后发现漏字段 → 登记 v2，不追加。**

### [ ] T-225 ★★ · schema v3 主卡：全域字段形状 + 2→3 迁移 + v3 fixture
- **依赖** T-201 · T-206 · **预估** 4.5d · **实际** —
- **独占** `packages/schema/src/` 全部字段文件 —— `effects.ts`(新) · `fog.ts`(新) · `explode.ts`(新) ·
  `section.ts`(新) · `page.ts`(新) · `flow.ts`(新) · `data-source.ts`(新) · `prefab.ts`(新) ·
  **`deferred.ts`(删)** · `document.ts` · `node.ts` · `id.ts` · `rule.ts` · `asset.ts` · `material.ts` ·
  `variable.ts` · `animation.ts` · `hotspot.ts` · `viewpoint.ts` · `migrate.ts` · `factory.ts` ·
  `samples.ts` · `index.ts` · `packages/schema/test/fixtures/v3/*.json`(新) ·
  `packages/schema/test/{migrate,fixtures,validate}.test.ts` ·
  `docs/adr/0035-flows-onEnter-永不实现.md`(新)
- **做** 按 **T-206 的裁决表逐字实现，表格里没有的字段一个都不加、有的一个都不少**：
  1. **表现力**：`meta.fog`（**独立块，X-01**，三个 DEFAULT 常量）· `meta.effects.outline{ enabled:
     boolean.default(false), color, widthPx, strength, hiddenEdge, ... }`（**X-02，老文档不构造
     composer**；字段名逐字照规划 §4.1.2 的 `OutlineEffectSchema`，**是 `widthPx` 不是 `thickness`**）
     · `nodes[].section`
     作为第四种承载体（**X-03**）· `nodes[].explode{mode,gain,axis,spacing,easing}` +
     `nodes[].explodeOffset`（**X-04，共 2 个 node 字段**；`dir` / `distance` 是被否决模型的残留，
     形状逐字照规划 §4.1.1 的 `ExplodeSchema`）· `hotspot.style.label`（`z.string().max(8).optional()`）·
     `viewpoints[].thumbnailUrl → thumbnailAssetId`（**X-07 破坏性改名，迁移表必须有这一行**）。
  2. **编排（v1.2 才用，此处冻结）**：`FlowSchema` 加 `startStepId`、`variableId` 收紧为
     `VariableIdSchema`（**X-11**）· `OverlaySchema` 改**按 type 的判别联合**、四支 props 各自
     `.strict()`（**X-09**）· `PREFIXES.overlay='ov'` + `OverlayIdSchema` · `EVENT_TYPES` 追加
     `pageEnter`/`flowStepEnter`/`overlayClick`（**X-10：`overlay.onClick` 内联动作不进 schema**）·
     `EVENT_PAYLOAD_KEYS` 加 `stepId`/`pageId`（**X-13**）· `ConditionSchema` 加 `isPageVisible` ·
     `steps[].onEnter` 的 `.describe()` 改为「v1 未实现 —— 步骤动作请用 flowStepEnter 规则」（**X-14**）。
     ⚠ **X-14 的裁决在本卡就落进 schema，所以 `docs/adr/0035-flows-onEnter-永不实现.md` 由本卡写**
     （铁律 12：先 ADR 后实现）。代价 = 老文档里已配置的 `onEnter` 动作不会被执行、只报 warn（I49）；
     撤销条件 = 若 v2 决定实现，必须先解决「`execute()` 入参是 `Rule` 不是 `Action[]`」这条 Q4。
  3. **动画**：`ImportedAnimationSchema` 加 `startS`/`endS`；`AssetStatsSchema` 加 `clipDurations`（**X-06**）。
  4. **资产**：`TranscodeOpSchema`/`TranscodeSkipSchema`/`AssetTranscodeSchema`/`AssetOriginSchema`，
     `AssetSchema.origin` **optional**（**X-08**）；`TEXTURE_SLOT_COLOR_SPACE` 纯数据版下沉到 `material.ts`。
  5. **多场景（v1.5 才用，此处冻结）**：`PREFIXES.scene='scn'` + `SceneIdSchema` ·
     `SceneDocumentSchema.sceneId`（必填无 default）· `VariableSchema.scope` + `VARIABLE_SCOPES` ·
     `deriveSceneId(projectId)` 三处调用点共用。**`sceneRefs` 顶层集合不建（A3(c)）。**
  6. **数据源（v1.5 才用，此处冻结）**：`dataSources` 集合，`auth` 的 `.strict()` 兜住凭据值，
     `path` 拒 `__proto__`。
  7. **prefab（v2 才用，此处冻结）**：`PrefabSchema`（`prefabs[]` 集合 + `node.prefabRef`）含全部注释；
     `PREFIXES.prefab='pfb'`。
  8. `CURRENT_VERSION = 3`；`V2_TO_V3` 含 `deterministicOverlayId` 与 flows 变量的**确定性 mint**；
     **全部默认值显式写值（spread-then-default），不靠 zod 兜底**（`Migration` 注释写「保留未知字段」
     而 `SceneDocumentSchema` 是 `.strict()`——注释描述的是一个不存在的行为，一并改正）。
  9. `factory.ts` 补 `createPage`/`createOverlay`/`createFlow`/`createFlowStep`/`createDataSource`/
     `createPrefab`，全部经 `collectAllIds` 防碰撞；`createEmptyDocument` 补空集合与新 meta 块。
  10. `samples.ts` 升 v3（新字段默认值**必须正好等于迁移链产物**）；三份 v3 fixture：
     `golden-path-3.json`（终态，同时是 parity 输入，**必须含带区间的 imported 动画 + radial 分组 +
     刻意乱序的 axis 分组 + 带非单位旋转的剖切平面**）· `broken-v2-flows.json`（迁移修复路径的证据）·
     `integration-placeholder.json`（v1.2/v1.5 字段的占位）。
  11. **两个新集合登记进 T-201 的注册表**（`dataSources` / `prefabs`）——
     `pages` / `flows` 今天**已经在 `ID_COLLECTIONS` 里**（`document.ts:118-130` 实测 11 项），
     它们的「出列」不改集合数（规划 §4.1.3），本卡对这两个只补 `nested`
     （`pages: ['overlays']` / `flows: ['steps']`）与新 `patchPath`。
     **顶层集合 11 → 13**，五个遍历面由注册表自动覆盖，本卡验收要断言这一点。
- **验收** v1/v2/v3 全部 fixture `migrate → validate → checkIntegrity` **零 error**；
  **逐字段 raw 断言**——`applyMigrationChain(v2Doc).raw` 上 `meta.fog`/`meta.effects`/每个
  `nodes[].explode`/`nodes[].prefabRef`/`dataSources`/`sceneId`/`variables[].scope`/`animations[].startS`
  都**显式存在**且等于文档记录的默认值；
  **观感回归**——加载 v2 fixture migrate 后 `fog.enabled === false`、`outline.enabled === false`、
  所有 `explode === null`、`dataSources.length === 0`（老文档不会突然开始发网络请求，同时是 C6 的保证）；
  `deferred.ts` 不存在（`test -f` 断言）；`migrate(v2doc).document.sceneId === deriveSceneId(v2doc.projectId)`
  且**连续迁移两次逐字相同**（幂等）；`broken-v2-flows.json` 迁移后 `flows[0].variableId` 匹配模式
  且 `variables` 里存在同 id 的 string 变量；`OVERLAY_TYPES.length === 4`；`EVENT_TYPES.length === 11`；
  **`nested` 真的被 `collectAllIds` 走到**——同一份文档加 3 个覆盖层，`collectAllIds().size`
  **恰好多 3**（不是「大于」；`pages: ['overlays']` 漏登记时它一个都不会多）；
  `origin` 缺席的 v2 文档迁移后 `origin` **仍缺席**（不是 `null` 不是 `{}`）；
  **反向比对：`SCHEMA_V3_FREEZE.md` 表内字段数 === 本次新增字段数**（T-206 的唯一机器落点）；
  `pnpm size` 差值记进 `docs/METRICS.md`。
- **自测** `pnpm -F @w3/schema test && pnpm -r typecheck && pnpm check:constitution && pnpm size`
- **变异检验** ① `V2_TO_V3.up` 删掉 `fog` 那行 → **raw 断言红**（若只断言 `migrate().document` 则
  **不会**红——这就是这条变异存在的理由）；② `up` 整个改成 `d => d` → 九条 raw 断言全红；
  ③ `nodes[].explode` 的 default 从 `null` 改成 `{mode:'radial',gain:1.5,axis:[0,1,0],spacing:0.5,easing:'easeInOutCubic'}`
  → 观感回归（「所有 `explode === null`」）+ T-228 红；
  ④ `deterministicOverlayId` 改成返回常量 → 「两个非法 overlay id 重铸后仍唯一」红；
  ⑤ `sceneId` 改成 `newId('scene')` → 幂等红；⑥ `scope:'scene'` 从 `up()` 删掉靠 zod 兜底 →
  「原始输出」那条红；⑦ `OVERLAY_ID_RE` 放宽成 `/^ov_/` → 「已合法 id 不被重铸」红；
  ⑧ v3 fixture 的 `pages` 改成 `[]` → 非空断言红。
- ⚠ **单卡波次（W4）。完成后停下来汇报。** 与 v0 的 T-001、v0.5 的 T-120 同理：字段形状错了，
  后面三个台阶全建在错地基上，且这是唯一无法靠单测发现的错误类型。

### [ ] T-226 · 完整性检查全域合并（I16 起，v1.0 段 30 条）
- **依赖** T-225 · **预估** 2.4d · **实际** —
- **独占** `packages/schema/src/integrity.ts` · `packages/schema/test/integrity.test.ts` ·
  `packages/schema/test/integrity-explode-section.test.ts`(新) ·
  **`packages/core/test/eca/action-refs-gate.test.ts`(新)**
- **做** 原本 9 张卡各自独占 `integrity.ts`、合计 44+ 条新检查。**本卡只做 v1.0 段的 30 条**
  （表现力 15 · 资产 4 · 引用与集合 8 · 嵌入 3）；**编排相关的 14 条随 v1.2 的 T-303 落地**——
  理由：那 14 条里有 9 条要解析 `goToStep`/`showPage` 的动作引用，而那些动作在 v1.0 不存在，
  提前写等于写一批永远走 `default` 的分支。
  ① 30 条逐条按裁决表实现，**级别（error/warn）逐字照表**；
  ② I11 从三扩到四承载体（`section` 是第四种）；`typeOf` 为 `kind==='node'` 补一路
  （`section` > `explodeGroup` > `light` > `node`）；`KIND_LABEL` 与 `sets` 由 T-201 的注册表派生；
  ③ **补上今天就缺的一条**——`flow.steps[].onEnter` 的动作引用从未经 `options.actionRefs` 解析：
  按 X-14 的裁决**仍然遍历它**，但报 **warn**「这些动作不会被执行」；
  ④ 新增 `action-refs-gate.test.ts`：**用生产解析器**遍历 `allActions()`，对每个声明了 `refs` 的
  动作构造真参数并断言悬空引用真被报出（照抄 `i14-gate.test.ts`）。
  ⚠ **这个文件必须放在 `packages/core/test/eca/`，与 `i14-gate.test.ts` 同目录，不许放进
  `packages/schema/test/`**：`allActions()` 住在 `@w3/core`，而 `check-deps-direction.mjs:25` 写的是
  `'@w3/schema': []`（schema 不许依赖任何内部包），CLAUDE.md 的包边界表也把 schema 的允许依赖写死为 `zod`。
  放进 schema 只有两条出路，两条都是 blocker：撞包边界，或者在 schema 里手抄一份动作表——
  **后者正是 T-176 存活 blocker「测试自造假解析器」的逐字复现，而本条检查存在的全部理由就是防它**。
  本卡对 `packages/schema/**` 的产出与本文件在两个包里，**分两个 describe 块、两条自测命令**。
- **验收** 30 条各有一条正例一条反例；`action-refs-gate` 覆盖率 = 声明了 `refs` 的动作数 / 全部动作数
  = **100%**；一份含 `javascript:` 的历史文档仍能 `migrate → validate` 成功（**C4：完整性检查
  拦得住，schema 校验不许拦**）；`checkIntegrity` 在 2000 节点 + 各集合非空的文档上仍线性
  （**今天那条「checkIntegrity is linear」用的文档只有 nodes，其余集合全是空数组——只在节点这一根
  轴上证明了线性**，本卡把其余轴补上）。
- **自测** `pnpm -F @w3/schema test integrity && pnpm -F @w3/core test action-refs-gate && pnpm -F @w3/core test && node scripts/bench-scale.mjs 2000 && pnpm check:deps-direction`
  （**最后一条是 B-7 的机械看守**：`action-refs-gate.test.ts` 一旦被挪回 `@w3/schema`，
  `check-deps-direction.mjs` 的 `'@w3/schema': []` 当场红）
- **变异检验** 逐条把检查体注释掉，对应用例必须红。**特别是四处互相掩护的地方**：
  ① 雾的 `near >= far` 两个子句**分开断言且断措辞**（v0.5 E18 教训 1）；
  ② 把 `typeOf` 的 node 分支改成永远返回 `'node'` → 剖切/爆炸那条必须红；
  ③ 把某个动作的 `refs()` 改成返回 `[]` → `action-refs-gate` 必须红；
  ④ 把 `onEnter` 那条从 warn 改成 error → 级别断言红（**级别本身要断，不能只断「报了」**）；
  ⑤ 把 `action-refs-gate.test.ts` 临时挪进 `packages/schema/test/` 并从 `@w3/core` import →
  `pnpm check:deps-direction` **必须红**（验后挪回）。**这条不是形式主义**：本文件放错包是本卡
  草案里就犯过一次的错，而 TypeScript 在 monorepo 里对它一声不吭。

### [ ] T-227 · `buildIndex` / `describeReferences` / `eventDescriptorRefs` 全域扩展
- **依赖** T-225 · **预估** 1.5d · **实际** —
- **独占** `packages/schema/src/index-builder.ts` · `packages/schema/src/selectors.ts`（仅新增
  `getFlowChain`/`getStepPrev`/`getCarrier` 扩四路）· `packages/schema/test/index-builder.test.ts` ·
  `packages/schema/test/event-exhaustive.test.ts`(新)
- **做** ① `buildIndex` 遍历 `pages`（overlay 的 `mediaId`/`bind`/`flowId` 三条出边，路径写成
  `pages[i].overlays[j].props.mediaId`）与 `dataSources`（`mapping[].variableId`）——
  **今天 `buildIndex` 索引 flows 但完全不索引 pages**；
  ② flow 的 `startStepId` 与每个 `step.next` 记 ref（**今天 flow 只作为 from 出现**）；
  ③ `eventDescriptorRefs` 加三个 case；
  ④ `describeReferences` 的 labels 加 `page:'个页面'`/`overlay:'个覆盖层'`/`dataSource:'个数据源'`；
  ⑤ `selectors.ts` 加 `getFlowChain(flow)`（沿 next 展平，**遇环截断**）与 `getStepPrev(flow, stepId)`
  ——**「上一步」的判断只写一次，编辑器与运行时不许分叉**；`getCarrier` 扩到四路（含 section）；
  ⑥ 新增 `event-exhaustive.test.ts` 遍历 `EVENT_TYPES`，**加成员而不改 switch 时必须 fail**。
- **验收** `referencesTo(index,'st_xxx')` 能返回 `startStepId` / `next` 两类（规则与动作两类随 v1.2）；
  删一个被覆盖层引用的 media → `describeReferences` 返回「1 个覆盖层」；
  `event-exhaustive` 在 `EVENT_TYPES` 加成员而不改 switch 时 **fail**。
- **自测** `pnpm -F @w3/schema test index-builder event-exhaustive`
- **变异检验** ① `eventDescriptorRefs` 的某个 case 删掉 → `event-exhaustive` 红；
  ② 删掉 pages 遍历整段 → 「overlay 引用的 media 被引用数为 1」红——**断言必须写成具体数字与
  path 字符串，不要写 `> 0`**（写 `>0` 时删掉一半遍历也不会红）；
  ③ `getFlowChain` 的环截断删掉 → 「环形 flow 不死循环」红（**必须有超时保护并用长度断言，
  否则它不是转红是挂住**）；④ `describeReferences` 的 `page` 标签删掉 → 断中文标签那条红。

### [ ] T-228 · frozen-contract 的 v3 describe 块
- **依赖** T-225 · **预估** 0.4d · **实际** —
- **独占** `packages/schema/test/frozen-contract.test.ts`
- **做** 为每一个带 default 的新字段写**逐值断言**（fog 四个 / outline 两个 / section 三个 +
  plane 三个 / explode 两个 / prefab.version / overlay 四支各自 props / dataSource.intervalMs 与上下限 /
  `OVERLAY_TYPES` 四个成员及顺序 / `EVENT_TYPES` 十一个成员及顺序 / 四个新前缀的字面值）。
  文件头补一句：**本文件的 diff 若没有伴随 `schemaVersion` bump 和 ADR，就是一份 bug report。**
- **验收** 新增断言数 ≥ 28；随便改一个默认值 → 红。
- **自测** `pnpm -F @w3/schema test frozen-contract`
- **变异检验** 随机挑 8 个新默认值各改成明显错的值，**8 次全部转红**——这正是 v0.5 M8 那次
  「8 个默认值被改坏而全套测试全绿」事故的直接对应实验，**8 次的结果逐条记进提交信息**。

### [ ] T-229 · bump 的爆炸半径审计：`validate(` 调用点普查 + 常设回归
- **依赖** T-225 · **预估** 0.6d · **实际** —
- **独占** `packages/editor/test/restore-migrates.test.ts`(新) ·
  `packages/storage/test/package-migrates.test.ts`(新) · `docs/IMPL_NOTES.md`（追加一节）
- **做** `grep -rn "validate(" packages/ --include=*.ts --include=*.tsx | grep -v dist`，
  逐处判定「读的是外部来的文档吗」，**把判定表写进 IMPL_NOTES**（今天已知四处：`main.tsx:95` 已
  migrate · `snapshots.ts:43-50` 已 migrate · `package.ts:190-199` 已 migrate · `publish.ts:61`
  validate 对内存中当前文档，合理）；新增**常设**回归（今天只有一次性 Playwright 脚本）：
  往 fake-indexeddb 播种一份 **v2** 文档，断言编辑器恢复路径打开的是**那份文档**（比对 projectId
  与节点数），不是样例场景；同形一条给 `.w3p`。
- **验收** 两条回归绿；IMPL_NOTES 里有那张判定表。
- **自测** `pnpm -F @w3/editor test restore-migrates && pnpm -F @w3/storage test package-migrates`
  （**过滤器写全名**：`restore` 与 `package` 都会顺带命中别的文件，而 **G1.0-20 用的就是
  `restore-migrates` 这个过滤器**，两处必须逐字一致，否则门槛与自测测的不是同一件事）
- **变异检验** 把 `main.tsx` 的 `migrate` 改回 `validate` → 第 2 条必须红。
  **这条变异今天做不了，因为回归不存在**——而 v2 上线那天正是它让用户盘上每一份 v1 工程
  **静默回落到样例场景**（用户看到的是样例，与数据丢失无法区分，直接违 C4）。
  三条生产路径今天都改成 migrate 了，但**靠人记住，没有任何自动化守卫**。

### [ ] T-230 · `apply-patch` 集合路径从 no-op 变成显式钩子
- **依赖** T-225 · T-201 · **预估** 0.8d · **实际** —
- **独占** `packages/core/src/runtime/apply-patch.ts` · `packages/core/test/runtime/apply-patch.test.ts`
- **做** `PatchApplierTargets` 加 `applyPages?`/`applyFlows?`/`applyDataSources?`/`applyPrefabs?`
  四个可选钩子，照抄 `applyEnvironment`/`applyMedia` 的槽位形状与注释体例；把
  `case 'pages': case 'flows':` 从落进 `return true` 的大 case 里拆出来各自调钩子；
  顶层 switch 加 `case 'sceneId'`/`case 'projectId'`（都 `return true`）并**删掉不存在的 `case 'id'`**
  （`:138`——SceneDocument 根本没有 `id` 字段，而真正存在的 `projectId` 反而不在列表里，
  改它走 default 触发全量重建）；注释写明「有识别的路径、消费者在 v1.2/v1.5」的那几项为什么先空。
- **验收** （这条是关键） 断言**钩子被调用**（`vi.fn()` 计数），**不只**断言 `fullRebuildCount === 0`；
  `{op:'replace',path:['projectId']}` 与 `['sceneId']` 返回 `rebuilt:false` 且计数为 0；
  `/prefabs/0/name` 返回 handled；T-201 交付的 `apply-patch-coverage.test.ts`（注册表驱动）全绿。
- **自测** `pnpm -F @w3/core test apply-patch`
- **变异检验** 把 `applyPages?.(next)` 删掉只留 `return true` → **钩子计数断言红，而
  `fullRebuildCount` 断言仍然绿**。**把这个对比写进提交信息**——`/pages` `/flows` 今天就被当作
  「已处理」return true，忘了换成真消费者时症状是「改了覆盖层预览没反应」而铁律 11 的 E2E 断言
  全绿，这是这条纪律最好的教材。② 删 `case 'sceneId'` → 对应测试红。

### [ ] T-231 · `/variables` 补丁路径与 `setVar` 未声明变量的裁决
- **依赖** T-225 · T-230（`apply-patch.ts` 同文件 → 排其后）· **预估** 0.5d · **实际** —
- **独占** `packages/core/src/runtime/apply-patch.ts`（仅 variables 段）·
  `packages/core/src/eca/headless.ts`（`setVar` 分支）· `packages/core/src/runtime/scene-runtime.ts`
  （`setVar` 分支）· `packages/core/test/runtime/variables-patch.test.ts`(新) · `docs/ECA_SPEC.md` §9.2
- **做** ① `applyPatch` 对 `/variables/**` 今天是**显式空操作**——编辑器里新建 / 删除一个变量在
  预览中不生效，症状是「加了变量规则不触发」而 `fullRebuildCount` 全程为 0（**铁律 11 的警报器
  不响**）。改成真钩子 `applyVariables?(next)`：运行时按 `scope` 与 `default` 重建变量表，
  **保留已有变量的当前值**（新增的取 default，删除的丢弃并记 debug）；
  ② `setVar` 对未声明变量今天**已经在打日志，而且两侧逐字相同**——
  `scene-runtime.ts:683` 与 `headless.ts:204` 都是 `this.log('error', '写入了未声明的变量「${id}」，忽略')`
  （仓库实证，不是设计意图）。裁决：**级别与措辞逐字保留，本卡一个字都不改**——不自动建变量，
  因为自动建会让 `checkIntegrity` 的引用检查失去意义，且与 C1「状态只进文档」冲突；
  也不降级为 warn，因为那是一次「行为 + 措辞」的双重变更，而今天两侧一致（C3 上是干净的），
  改错一侧就是新分叉。**要降级须单开一条 ADR，不在本卡范围内。**
  本卡在这一条上只补一件事：一条**契约断言**，断言两个运行时对同一次非法写入产生的
  级别与措辞**逐字相同**。把这条现状写进 `ECA_SPEC §9.2`。
- **验收** 断言**钩子被调用**（计数），不只断言 `fullRebuildCount === 0`；新建一个变量 + 一条
  `variableChange` 规则 → 预览里改它 → 规则触发；删除一个变量 → 引用它的规则不再触发且有一条 warn；
  `setVar('不存在的')` → **两个运行时各恰好一条 `error`，措辞逐字为
  `写入了未声明的变量「xxx」，忽略`，且两侧逐字相等**（`toBe` 比对两个字符串，不是各自 `toMatch`），
  运行时状态不变。
- **自测** `pnpm -F @w3/core test variables-patch && pnpm -F @w3/core test eca`
- **变异检验** ① 把 `applyVariables?.(next)` 删掉只留 `return true` → **钩子计数断言红，而
  `fullRebuildCount` 断言仍然绿**（与 T-230 同形，两条一起写进提交信息）；
  ② 把 `headless.ts` 那条 `log('error', ...)` 改成 `log('warn', ...)`（只改一侧）→
  **「两侧逐字相等」必须红**（这正是本卡要防的那次分叉；改完还原）；
  ③ 把「保留已有变量当前值」改成「全部重置为 default」→
  需要一条「预览中改一个变量的名字，另一个变量的值不变」的断言才抓得到，**必须专门造这个样本**。

### [ ] T-232 · prefab 占位的五处遍历面
- **依赖** T-225 · T-201 · **预估** 0.6d · **实际** —
- **独占** `packages/schema/test/prefab.test.ts`(新) · `packages/storage/src/package.ts`
  （`referencedHashes`）· `packages/editor/src/store/clipboard.ts`
- **做** T-201 的注册表已经把 `collectAllIds` / I1 集合表 / 快照回滚三面自动覆盖；本卡补剩下两面：
  ① `referencedHashes` 遍历 `prefabs[].nodes[].assetRef.assetId` 与 `prefabs[].materials[].params.maps.*`；
  ② `pasteNodes` 深拷贝 `prefabRef` 并加 `dropMissingPrefab`（照 `dropMissingMaterial`）；
  ③ I1 对每个 prefab 的 nodes/materials 做**组内唯一**（照 `flows[].steps` 的写法）。
- **验收** `collectAllIds` 在含 prefab 的文档上返回的 id 数 == 手工计数；`referencedHashes` 对
  「只被 prefab body 引用的资产」返回其 hash，对「谁都不引用的资产」**仍不返回**（守住窄度）；
  粘贴带 `prefabRef` 的节点到不含该 prefab 的文档 → `checkIntegrity` 零 error。
- **自测** `pnpm -F @w3/schema test && pnpm -F @w3/storage test package && pnpm -F @w3/editor test clipboard`
- **变异检验** ① 删掉注册表里的 prefabs 那一项 → 「铸 id 不撞 prefab body」红；
  ② 删 `referencedHashes` 的 prefab 遍历 → 「prefab-only 资产进包」红，**同时确认
  「谁都不引用的资产不进包」那条仍然绿**（否则是两条断言互相掩护）。
- ⚠ prefab 在 v1.0 与 v1.2 **无任何生产写入路径**，本卡是纯占位面，必须登记进 IMPL_NOTES 的
  已知盲区（T-296）。**采纳集合版而不是裸串版的理由**：裸串版本不进五个遍历点，v2 第一次写入
  就会铸 id 撞车、发布漏字节。

### [ ] T-233 · `.w3p` manifest 冻结 + `packScene` 只写被引用资产 + 老包 fixture
- **依赖** T-225 · **预估** 0.5d · **实际** —
- **独占** `packages/storage/src/package.ts` · `packages/storage/test/fixtures/legacy-v2-single-scene.w3p`(新)
- **做** `PackageManifest` 加 `projectName?`/`entrySceneId?`/`scenes?`（v1.5 才用，此处冻结），
  单场景时也照写；`unpackScene` 读它们，老包由 `document.sceneId` 与 `document.name` 兜底；
  **`packScene` 的资产循环改为遍历 `needed`**；用**当前构建**打一个单场景 `.w3p` 手工存成 fixture
  （只增不改不删）。
- **验收** 给一个存在于 `document.assets` 但**无人引用**的资产附上字节，**断言 zip 条目里没有它**
  ——今天两条测试都只断言 `referencedHashes` 的**返回值**，洞正好落在两条测试之间：
  「发布包只含被引用资产」不是 `packScene` 保证的，裁剪发生在编辑器的 `publish()`，
  而 `manifest.assetCount` 仍报 1；`unpackScene(fixtureBytes)` 成功、`manifest.entrySceneId` 为
  undefined（老包）、迁移到 v3 后 `sceneId === deriveSceneId(projectId)`。
- **自测** `pnpm -F @w3/storage test && pnpm test:parity`
- **变异检验** ① 裁剪改回 `for (const asset of input.document.assets)` → **产物断言**红；
  ② `entrySceneId` 从 manifest 去掉 → 老包兜底那条**不能红**（它测的是缺失路径），新包那条必须红。
  **这两条要分开写，否则一条测试同时覆盖两个方向会互相掩盖。**

### [ ] T-234 · 体检指标增量 + clip 时长测量接线
- **依赖** T-225 · T-217 · **预估** 1.2d · **实际** —
- **独占** `packages/core/src/assets/policy.ts` · `packages/core/test/assets/policy.test.ts`(新) ·
  `packages/core/test/assets/pipeline.test.ts` · 编辑器资产体检模块（`auditGlb` 及其 stats 白名单）+ 其测试
- **做** （合并卡：两件事共用同一份 stats 白名单，分开做必然打架）
  ① `estimateTextureBytes(w,h,format)` bpp 32/4/8，默认与旧行为**逐字节相同**；
  ② `AuditMeasurements` 增 `externalRefs`/`unsupportedExtensions`/`textureBytesFallback`/
  `compressedTextureCount` 四个**测量**键——**⚠ 它们绝不能进 `AssetStats`**
  （`AssetStatsSchema` 是 `.strict()` 而 `checkIntegrity` 不重跑 schema 校验，这个组合已经炸过一次：
  多加一个测量键 → 编辑器全绿 → 发布闸门拒绝）；
  ③ `MetricSpec` 增 `applicable?`；加三条 METRICS（中文 label + 具体 advice）；
  ④ 体检时从 glTF 的 animation sampler 输入访问器量出每条 clip 时长写进 `stats.clipDurations`，
  **把新键加进那份 stats 白名单**；`materialiseSample` 覆盖 stats 的路径（`session.ts:104-115`）
  自动带上新键并加一条断言。
- **验收** 含外部 `.bin` 的 glTF → `externalRefs` fail；meshopt GLB → `unsupportedExtensions` fail
  且 advice 含「Draco」；全 KTX2 的 GLB → `textureBytes` 与 `textureBytesFallback` 比值约 1:8；
  无 KTX2 的 GLB → findings 里**不含** `textureBytesFallback`；
  **`AssetStatsSchema.strict().parse(grade(...).stats)` 对全部五档 scope 均通过**；
  导入一份带 clip 的 GLB → `stats.clipDurations['拆装']` 与 three 解析的 `clip.duration` 相差 < 0.01 秒；
  **发布一次带该资产的项目成功**（`validate` 级回归，不只 `checkIntegrity`）。
- **自测** `pnpm -F @w3/core test assets && pnpm -F @w3/schema test && pnpm -F @w3/editor test && pnpm -F @w3/storage test package`
- **变异检验** ① `etc1s` 的 bpp 改成 32 → KTX2 显存那条红；② 去掉 `applicable` 过滤 →
  「无 KTX2 时不含该行」红；③ **把白名单拷贝改回黑名单 → `strict().parse` 那条红**
  （这是复现那条 blocker 的守护测试）；④ 把 `clipDurations` 从白名单去掉 →
  **发布回归必须转红**（那条 blocker 就是这一条没人测）。

**M15 小计：10 张 / 13.0 人日**

---

## M16 · 渲染管线与表现力（T-235 ~ T-261）

> **渲染出口的四方争用是 v1.0 的第二顺位阻断项。** T-235 是 `scene-runtime.ts` 那条串行链的头，
> 在它落地之前不开工后处理 / 剖切 / 爆炸任何一张。

### [ ] T-235 ★ · `RenderPipeline` + 唯一渲染出口 `drawScene()` + `capturing` 守卫 + chrome 注册
- **依赖** T-200 · T-225 · **预估** 2.8d · **实际** —
- **独占** `packages/core/src/runtime/render-pipeline.ts`(新) · `packages/core/src/runtime/scene-runtime.ts` ·
  `packages/core/src/runtime/chrome-registry.ts`(新) · `packages/core/test/runtime/render-pipeline.test.ts`(新)
- **做** （三合一合并卡：渲染出口收口 + 后处理管线 + `editorAux`/`registerChrome` 合成）
  ① 把 `:493` 与 `:647` 两处 `renderer?.render(...)` 收成一个 private `drawScene()`；
  ② `RenderPipeline`：`sync(doc)` 建 / 拆 · `render()` · `setSize()` · `dispose()` · `get mode()`，
  composer target（rt1 `samples:4`、rt2 显式 `samples:0`），`OutputPass` **固定链尾**；
  **整条 composer 只在 `meta.effects.outline.enabled === true` 时才被构造**；
  ③ `tick()`/`renderFrame()`/`resize()`/`dispose()`/`applyMeta` 五处接线；
  ④ `capturing` 标志（tick 早退、resize 记 `pendingResize`）；
  ⑤ **`registerChrome(object): () => void` + `setChromeVisible()` 作为唯一对外接口，
  `editorAux: Group` 作为它内部的实现**（Group 同时满足 picker 的单 aux 槽约束——这是 X-22 的
  合成裁决：两份设计一个用 Group 树、一个用 Set 注册表，都声明独占同一段代码，
  **不合成的话第二个落地的人会推翻第一个**）：grid、`lightHelpers.root`、gizmo、picker 代理球全部
  改经它注册，`setEditorChromeVisible` 保留为别名，**反注册闭包从 `editorAux` 上摘而不是 `scene.remove`**；
  ⑥ `get pipelineMode()`、`setPostFxEnabled()`（bench 专用）；
  ⑦ `EXT_color_buffer_float` 缺失时降级 + 中文 warn；
  ⑧ 顺手修 `:803-808` 的误导文案（拆成「分组节点」/「材质不支持自发光高亮（例如 unlit 材质）」/
  「未知预设」三种）；
  ⑨ **交付一份接缝清单**（配合 T-200 的清单测试）：把后续 12 张卡要往 `scene-runtime` 上挂的
  方法签名与调用点一次性开好。**这笔预付约 +0.5 人日，换回 30+ 卡次的串行解除。**
- **验收** `grep -c "renderer?.render(" packages/core/src/runtime/scene-runtime.ts` **恰好为 1**；
  默认文档（`outline.enabled:false`）→ `pipelineMode === 'direct'` 且**注入的 composer 工厂被调用
  0 次**；`true` → `mode === 'composed'`，`passes` 依次 `RenderPass…OutputPass`，
  `renderTarget1.samples === 4`、`renderTarget2.samples === 0`；来回切两次 → composer 构造 1 次
  dispose 1 次；`/meta/effects/**` 与 `/meta/fog/**` 补丁后 `fullRebuildCount === 0`；
  `tick()` 与 `renderFrame()` **走同一渲染入口**（注入 spy 断言同一函数）；挂载 / 卸载 50 次后
  `renderer.info.memory.textures` 归零；`capturing=true` 时 `tick()` 不调 `drawScene`、
  `resize(100,50)` 不改 `surface.size()`，还原后 pending 尺寸被应用；`setChromeVisible(false)` 后
  **注册过的每一个对象**都不可见（遍历断言，不是写死名单）。
- **自测** `pnpm -F @w3/core test runtime && pnpm -F @w3/core test && pnpm check:constitution`
- **变异检验** ① `sync` 无条件建 composer → 「构造 0 次」红；② `OutputPass` 从链尾删掉 → 链序红；
  ③ **`renderFrame()` 改回 `renderer.render()` → 同入口那条红**（这是最容易漏的一条：benchmark
  与主循环画两种东西，没有任何现存断言看得见）；④ rt2 的 samples 改回 4 → samples 红；
  ⑤ tick 的 `capturing` 早退删掉 → 守卫红；⑥ `setChromeVisible` 只动 grid → chrome 注册红
  （**遍历断言才抓得到，写死名单时这条是绿的**）。
- ⚠ 真正挡住描边的不是 schema，是 `:493` 那行 `this.renderer?.render(...)`——换 composer =
  改引擎渲染管线 = 分诊 Q4 + **ADR-0021**（撤销 D20，并逐项回答 R07 三条腿）。
  **所有规划文档都没点破这一条**：「v1 接 OutlineEffect schema 不变」为真，但不代表改动小。

### [ ] T-236 · 后处理链的色调映射与色彩空间回归
- **依赖** T-235 · **预估** 0.6d · **实际** —
- **独占** `packages/core/test/runtime/tone-mapping-regression.test.ts`(新) ·
  `e2e/tests/postfx-tone.spec.ts`(新) · `packages/core/src/runtime/render-pipeline.ts`（仅 `OutputPass` 配置段）
- **做** three 渲染到 RenderTarget 时会**关掉 toneMapping 并退回线性色彩空间**——接上 EffectComposer
  的那一秒，v0.5 的 `ACESFilmicToneMapping` + `toneMappingExposure` 会**静默失效**，
  而 G0.5-6 那条门槛保护不到（它断言的是 `NoToneMapping` 那一侧）。
  ① 断言 `OutputPass` 拿到的是**文档里的 `exposure` 与 tone mapping 模式**（不是 renderer 上的默认值），
  且它固定在链尾；
  ② 一条**两端对照**回归：同一份文档，`outline.enabled:false`（direct）与 `true`（composed）
  两条路径渲出的画面，用 `colourBuckets` 比较**必须在容差内相等**（这是「接后处理不改变观感」的
  唯一机器证据）；
  ③ E2E：开描边前后各截一张图，断言亮部像素的分布**没有整体上移**。
- **验收** direct 与 composed 两条路径的 `colourBuckets` 差异 < 阈值；`OutputPass` 的 `toneMapping`
  与 `toneMappingExposure` **逐值**等于文档值；把文档 `exposure` 从 1.0 改成 1.6 →
  **两条路径的 buckets 同向变化**（不是只有一条变）。
- **自测** `pnpm -F @w3/core test tone-mapping-regression && pnpm test:e2e -g postfx-tone`
- **变异检验** ① 把 `OutputPass` 从链尾删掉 → 两端对照必须转红（**这条是本卡存在的全部理由**）；
  ② 把 `OutputPass` 的 exposure 写死成 1.0 → 「改 exposure 两条路径同向变化」必须转红；
  ③ 把两端对照的容差放宽到「只要都非零就算过」→ **必须证明它测不出东西**，据此把断言收紧到
  分桶分布而不是「画面非空」。

### [ ] T-237 ★ · `ClipPlayer` 绝对时间驱动 + action 缓存回收 + `clearMixers` + 重建接缝
- **依赖** T-216 · T-235 · **预估** 1.8d · **实际** —
- **独占** `packages/core/src/runtime/animator/clip.ts` · `packages/core/test/runtime/clip.test.ts` ·
  `packages/core/src/runtime/scene-runtime.ts`（rebuild / resetScene 两处，列 R）·
  `packages/core/test/runtime/scene-runtime.test.ts`
- **做** `ClipPlayer` 每次 play 和 seek 都往 mixer **永久多塞一个 `AnimationAction`**（实测 5 次 play
  → 5 个），全仓零 `uncache`；`resetScene` 只 `stopAll` 不清 mixers。而「反复排练一段拆装流程」
  正是样板工程的核心动作。
  ① `update()` 改绝对时间驱动（所有 action `paused=true`，每帧写 `action.time`，`mixer.update(deltaS)`
  只推权重）；② `bind` 产物按 `(animationId, object.uuid)` 缓存复用；
  ③ 新增 `releaseFor(animationId)`、`clearMixers()`、`dispose()` 里 `uncacheClip` + `uncacheAction`；
  `resetScene`（`:837`）在 `graph.build` **之前**释放全部 mixer；
  ④ `rebuild()`（`:427-439`）新增对 `tweens` / `clips` 的通知——**tween 每帧重解 nodeId 所以能扛整图
  重建，clip 绑死 Object3D 引用会继续驱动幽灵对象；这个不对称是巧合不是设计**；
  ⑤ 暴露 `get mixerCount()`。**本卡不引入任何新字段、不改语义**，`clampWhenFinished`/`loop`/`speed`
  的可观测行为逐条不变。
- **验收** 既有 `clip.test.ts` 全部**原样**通过（这是「不改语义」的证据）；`play` ×20 后
  `mixerFor(obj)._actions.length === 1`；`resetScene()` 后 mixer 数为 0；连做 5 次 build+clear，
  `mixerCount` **不随次数增长**；`rebuild()` 之后继续 `update()` 不再驱动旧对象（断旧对象 y 不变、
  新对象 y 在变）。
- **自测** `pnpm -F @w3/core test runtime && pnpm -F @w3/core test eca && pnpm test:parity`
- **变异检验** ① 删掉每帧写 `action.time` 那行 → 姿态断言红；② action 缓存改回每次 new → 累积断言红；
  ③ 删 rebuild 通知 → 幽灵对象断言红；④ 把 `clearMixers` 从 `resetScene` 里去掉 →
  「5 次不增长」红。**只测「调用后为 0」是假绿**：那条在没接进 `resetScene` 时也绿。

### [ ] T-238 ★ · 爆炸位移的纯函数与它的完整测试
- **依赖** T-225 · **预估** 1.0d · **实际** —
- **独占** `packages/schema/src/explode-math.ts`(新) · `packages/schema/test/explode-math.test.ts`(新)
- **做** `explodeOffsets(doc, groupNodeId, children?)`，radial 与 axis 两条路径；
  **排序必须是 `(dot(p,axis), order, id)` 三级**；零向量轴兜底 `[0,1,0]`；`explodeOffset` 非空时
  整条替换派生值。**纯函数，零 three、零 DOM。**
- **验收** radial `factor=0` 全为 0、`factor=1` 时任意两件的相对位置 = 原相对位置 ×(1+gain)
  （**断几何性质不断具体数字**）；锚点全重合时全 0 且**不抛异常**；axis n=5 时名次 0..4、
  中位件为 0、相邻间距恰为 `spacing`；**锚点全重合且 `order` 乱序**的文档两次调用逐位相等（确定性）；
  覆盖值生效而其余件仍用派生值；空组 / 单件 / `explode === null` → 空 Map；
  **纯度**：同文档调 100 次输入未被改动（深比较）。
- **自测** `pnpm -F @w3/schema test explode-math`
- **变异检验** ① axis 三级排序砍成只按 `dot` → 「确定性」必须红——**基准文档必须刻意乱序**，
  否则这条变异是绿的（v0.5 T-184 的 E2 逐字同形：基准文档恰好已排好序，排序是空操作）；
  ② radial 质心改成 `[0,0,0]` → 「相对位置 ×(1+gain)」红（若不红说明 fixture 质心恰在原点，换 fixture）；
  ③ `explodeOffset ?? 派生` 改成永远用派生 → 覆盖那条红；
  ④ 删零向量兜底 → 轴为零那条红（而不是 NaN 悄悄传下去）。

### [ ] T-239 · 雾：core 写入 + 场景效果面板（雾段）+ chrome 不吃雾
- **依赖** T-225 · T-235 · **预估** 1.5d · **实际** —
- **独占** `packages/core/src/runtime/environment.ts` ·
  `packages/editor/src/panels/SceneEffectsPanel.tsx`(新，雾段——**改名自 `ScenePanel.tsx`，
  避开 v1.5 多场景列表面板的同名撞车，X-44**) · `packages/editor/src/lib/effects-edit.ts`(新) ·
  `packages/core/test/runtime/environment.test.ts`
- **做** ① `syncScene` 末尾写 `scene.fog`（`enabled:false` → `null`）；
  ② `suggestFogRange(bounds)` 纯函数；
  ③ `disableFogOn(root)` 遍历把材质 `fog=false`，在 grid、`lightHelpers.root`、gizmo helper 根、
  picker 代理球的建构点各调一次（**chrome 不吃雾**）；
  ④ 面板雾段（开关 / 类型 / 颜色 / near / far / density /「按场景大小估算」），拖滑块走 `preview`、
  松手 `commit`。
  **`apply-patch.ts` 零改动**（`/meta/fog/**` 经既有 meta 分支 fallthrough → `applyMeta` → `syncScene`），
  验收里要断言这一点——这正是雾放在 `meta.fog` 独立块而不是并进 `meta.effects` 的理由（X-01）。
- **验收** `enabled:false` → `runtime.scene.fog === null`；`linear` → `instanceof Fog` 且
  color/near/far **逐字段**相等；`exp2` → `instanceof FogExp2` 且 density 相等；
  **开→关往返后回到 `null`**；chrome 断言用**遍历**而非写死名单（`scene.children` 里除 `graph.root`
  外每个对象材质 `fog === false`）；`git diff packages/core/src/runtime/apply-patch.ts` 为空。
- **自测** `pnpm -F @w3/core test && pnpm -F @w3/editor test && pnpm test:e2e -g postfx`
- **变异检验** ① 把 near/far 互换写入 → 逐字段断言红（**只断言 `scene.fog !== null` 是测不出来的，
  这是本卡最容易写出的假绿**）；② `enabled:false` 分支改成仍 new 一个 Fog → 往返红；
  ③ **两头都要断言**（v0.5 E18 教训 2）：先证明开雾后真的变了，再证明关掉后回到 null——
  只比较两端的测试对「中间什么都没发生」完全无感；④ `disableFogOn` 改成空操作 → chrome 那条红。

### [ ] T-240 · 描边：`OutlineLayer` + 高亮策略化 + `highlightOf` 上契约
- **依赖** T-235 · T-215 · **预估** 2.0d · **实际** —
- **独占** `packages/core/src/runtime/outline-layer.ts`(新) · `packages/core/src/runtime/highlight.ts` ·
  `packages/core/src/eca/types.ts`（列 T）· `packages/core/src/eca/headless.ts` ·
  `packages/core/test/runtime-contract.ts` · `packages/core/test/runtime/highlight.test.ts`
- **做** ① `HighlightLayer` 改「状态 Map + 策略」，emissive 实现原地保留为 `EmissiveStrategy`；
  ② `OutlineLayer`：per-preset `OutlinePass` 按需建 / 拆，`MAX_ACTIVE_OUTLINE_PRESETS = 2`，
  超限回落 emissive + 中文 warn，`pulsePeriod = 0`；
  ③ `RuntimeContext.highlightOf` 双实现；契约套件的 `resetScene` 那条补上高亮，
  新增「高亮 → `highlightOf` 返回预设名 → 取消 → 返回 null」；
  ④ 高亮对 `MeshBasicMaterial` 今天**静默失败**而报错文案说「该节点没有可着色的几何体」
  （可达路径：导入 unlit glTF）——outline 模式下改为成功，emissive 模式下报**新文案**。
- **验收** 契约的高亮断言在**两个运行时**上同时绿；`outline.enabled:false` 时走 emissive
  （材质 `emissive` 被写），`true` 时材质**不被写**且对应 pass 的 `selectedObjects` 含该对象；
  3 种预设同时活跃 → 前两种在 pass 里、第三种 emissive + **恰好一条** warn；
  unlit 节点在 outline 模式下 `highlight()` 返回 true，emissive 模式下返回 false 且报新文案；
  `engine.ts` 与 `executor.ts` 的 diff **为空**。
- **自测** `pnpm -F @w3/core test && pnpm test:parity`
- **变异检验** ① 删 `composer.addPass(outlinePass)` → 必须有测试红——**只断言 `selectedObjects`
  是假绿：pass 没进 composer 也照绿**；② 上限 2→99 → 回落红；③ `highlightOf` 恒返回 null → 契约红；
  ④ **反向**：把 `highlight()` 改成空操作后，检查契约里**每一条**高亮断言是否都红了——
  只红一条说明其余是对称性断言（E18 教训 2）。
- ⚠ **描边的像素结果在 parity 里永远不可观测**（parity 全程无 canvas，renderer 恒 null）。
  这是接受的残余风险，不是已解决，必须如实登记进 IMPL_NOTES 的已知盲区（T-296）。

### [ ] T-241 · 场景效果面板（描边段）+ 编辑器选中态描边通道
- **依赖** T-240 · T-239 · **预估** 1.5d · **实际** —
- **独占** `packages/editor/src/panels/SceneEffectsPanel.tsx`（描边段）·
  `packages/editor/src/viewport/Viewport.tsx` · `packages/editor/test/panels/SceneEffectsPanel.test.tsx`
- **做** 描边段（开关 / 颜色 / 宽度写「近似像素」/ 强度 / 被遮挡轮廓三档），滑块 `preview`、
  松手 `commit`；选中变化 → `runtime.setSelectionOutline(selectedIds)`，`setChromeVisible(false)`
  时清空；面板上一行中文说明「开启描边会用后处理管线，透明背景导出与 4× 导出不含描边」。
- **验收** 改任一参数 → 文档对应字段变化且**一次拖拽 = 一条撤销**；进入预览 → selection 通道为空
  （断 `OutlineLayer` 的 selection 集合长度为 0）；E2E：`outline.enabled` 打开后点选一个节点 →
  `colourBuckets` 增加，退出到预览 → 回落。
- **自测** `pnpm -F @w3/editor test && pnpm test:e2e -g postfx`
- **变异检验** ① 删 `setSelectionOutline` 调用 → E2E 那条红。**凡是卡面出现「点选」这类手势的，
  验收必须有一条走到 UI 事件入口的测试**——这是 v0.5 M10 教训写成的可执行检查；
  ② 删预览时的清空 → 预览断言红；③ `commit` 改成 `preview` → 撤销那条红。

### [ ] T-242 · 背景色与曝光控件（未认领缺口补齐）
- **依赖** T-239（同文件 → 排其后）· **预估** 0.5d · **实际** —
- **独占** `packages/editor/src/panels/SceneEffectsPanel.tsx`（第三段：背景与曝光）+ 其测试
- **做** `background.color` 与 `environment.exposure` **至今没有编辑器控件，13 份设计里零认领**：
  字段在文档里、运行时读它、导出用它、体检提它，**用户改不了它**。面板加第三段（背景类型 /
  背景色 / 曝光滑块），拖滑块 `preview`、松手 `commit`。
- **验收** 改背景色 → `meta.background.color` 变且视口 `colourBuckets` 变；改曝光 →
  `renderer.toneMappingExposure` 跟着变；一次拖拽 = 一条撤销；**T-205 的能力入口体检把这两个字段
  纳入覆盖面后仍绿**。
- **自测** `pnpm -F @w3/editor test SceneEffectsPanel && pnpm test:e2e -g postfx`
- **变异检验** ① 把背景色 onChange 改成空操作 → UI 入口测试红；
  ② 把 T-205 的体检覆盖面从「可编辑字段」退回「动作 / 事件」→ **必须证明它看不见这个缺口**
  （背景色不是动作也不是事件），据此把覆盖面钉死在字段级。

### [ ] T-243 · 剖切承载体 + `SectionLayer` + 渲染器接线
- **依赖** T-225 · T-235 · **预估** 2.0d · **实际** —
- **独占** `packages/core/src/runtime/section-layer.ts`(新) · `packages/core/src/runtime/carrier-types.ts` ·
  `packages/core/src/runtime/scene-graph.ts` · `packages/core/src/runtime/apply-patch.ts`（node patch 三 case）·
  `packages/core/test/runtime/section-layer.test.ts`(新)
- **做** `createObject` 的 section 分支（**节点的第四种承载体**）；`applyNodePatch` 加三个 case
  （`section` / `explode` / `explodeOffset`）与 `resyncNode` 同步；`attachRenderer` 与 `dispose` 接线；
  `MAX_SECTION_PLANES = 3` 且按文档序取前 3；**启停复用 `node.visible`，零新增动作**
  （X-03 / X-05 的裁决：剖切自动继承 transform gizmo、层级树、撤销、`setVisible` 动作、
  退出预览还原，成本从 5 个 core 文件降到 1 个）。
- **验收** 带**非单位旋转**的 section 节点 → `renderer.clippingPlanes` 恰好 1 条，法线与常数等于
  手算值（**在 Node 里跑，three 的矩阵 / Plane 不需要 GL**——这条依赖 T-200 的注入缝）；
  `visible:false` → 平面数 0；父节点隐藏 → 也变 0（世界可见性）；拖到被移动的父节点下 → 平面跟着走；
  4 条启用只取文档序前 3；**接缝防线**：一条断言真实 section 工厂已在 `new SceneRuntime(...)` 的
  **生产组装路径**上被装上的测试（不是工厂自己的测试）；连续 100 次改平面 transform，
  `fullRebuildCount === 0`；`dispose()` 后 `clippingPlanes.length === 0`。
- **自测** `pnpm -F @w3/core test section-layer`
- **变异检验** ① 删掉 `renderer.clippingPlanes = kept` 那行 → 平面数必须红。
  **若测试读的是 `layer.livePlanes` 而不是 `renderer.clippingPlanes`，这条变异是绿的**——
  这正是 v0.5 M11「断言渲染器而不是文档」的第四次同形；
  ② 删 `case 'section'` → `fullRebuildCount` 红；③ `worldVisible` 换成 `object.visible` →
  父节点隐藏那条红。
- ⚠ 两条已知耦合**必须在本卡注释里登记**，并由 T-284 度量：three 把裁剪平面**数量**放进 shader
  program 的 cache key → 开 / 关剖切让每个材质重编译；`Material.copy()` 会连 `clippingPlanes` 一起
  复制，而 `MaterialRegistry` 的克隆走 clone/copy → 逐材质剖切一旦启用，每次高亮克隆都会继承裁剪状态。

### [ ] T-244 · `ExplodeLayer` + tick 接线 + `resetScene` 第 10 步
- **依赖** T-238 · T-243（共享 `scene-runtime.ts` → 排其后，列 R）· **预估** 1.5d · **实际** —
- **独占** `packages/core/src/runtime/explode-layer.ts`(新) · `packages/core/test/runtime/explode-layer.test.ts`(新)
- **做** 叠加层含过渡（`ease()`）、中断冻结 + reject、每组偏移缓存与「批次里出现 `nodes` 路径就清
  缓存」的失效、`reset()`；`tick()` 里插在 `clips.update` 之后；`resetScene` 加 `explode.reset()`。
- **验收** `factor=1` 后 `graph.objectFor(childId).position` 等于文档值 + 偏移（**断言渲染器手上的
  对象，不是文档**）；补间与爆炸同时作用一个节点 → 位置 = 补间采样值 + 爆炸偏移（先各自单独测
  再测复合）；收到 `/nodes/{i}/transform` patch 后再 tick 一帧位置仍正确（不塌）；
  `1→0` 后位置**逐位等于**文档值（`toEqual`）；中断时**停在中途**（既不等于起点也不等于终点）
  且 reject `AbortError`；`resetScene()` 后回文档值且**再 tick 十帧仍不动**；嵌套两组叠加正确。
- **自测** `pnpm -F @w3/core test explode-layer`
- **变异检验** ① `base = position − 上一帧` 改成 `base = position` → 「与补间复合」和
  「patch 之后不塌」红；② 删 `resetScene` 里的 `explode.reset()` → 「再 tick 十帧不动」红——
  **只断言「回到文档值」是不够的**：重建之后第一帧位置本来就是对的，坏的是第二帧；
  ③ 中断改成回零 → 「停在中途」红；④ 缓存失效改成永不失效 → 需要一条「改了子件 `transform.p`
  之后偏移跟着变」的测试才抓得到。

### [ ] T-245 · `RuntimeContext.setExplode` 双实现 + 契约套件扩展
- **依赖** T-244 · T-203 · **预估** 1.0d · **实际** —
- **独占** `packages/core/src/eca/types.ts`（列 T）· `packages/core/src/eca/headless.ts` ·
  `packages/core/test/runtime-contract.ts`
- **做** 双实现；**headless 的 `getNodeProp('positionY')` 改为加上爆炸偏移**；
  `ContractHarness` 加 `explodeOf`；**`engine.ts` 一行不改**（ADR-0018 的第一次实战检验）。
- **验收** 两运行时同跑——起始 factor 为 0；`setExplode(1,{durationS:0.5})` 在 499ms 未完成、
  500ms 完成；完成后 `explodeOf === 1`；**完成后两侧 `getNodeProp(id,'positionY')` 逐位相等**；
  目标不是爆炸分组 → 不抛、`explodeOf` 为 0、两侧 error 日志**措辞相同**；`resetScene` 后归 0
  且 positionY 回文档值；`git diff --stat packages/core/src/eca/engine.ts` **为空**。
- **自测** `pnpm -F @w3/core test runtime-contract`
- **变异检验** ① headless 的 positionY 改回只读文档 → 「两侧 positionY 相等」必须红。
  **这条变异如果是绿的，说明测试是在 factor=0 时读的**——必须在爆炸完成之后读；
  ② 删 headless 的 `resetScene` 清 factor 那行 → 红。
- ⚠ **`getNodeProp('positionY')` 两个运行时读的不是同一个东西**：`SceneRuntime` 读活的
  `object.position.y`，Headless 读文档的 `node.transform.p[1]`——静止时相等、动过就分叉，
  而 parity 脚本里没有 tween 之后读 positionY 的步骤。爆炸视图大规模移动 transform，
  正好把这条踩响。

### [ ] T-246 · `explode` 动作（ECA 三文件法）
- **依赖** T-245 · **预估** 0.5d · **实际** —
- **独占** `packages/core/src/eca/actions/scene.ts` · `packages/core/src/eca/actions/scene.test.ts`
- **做** 动作名 **`explode`**（不是 `setExplode`）；`refs()` 返回 `[{kind:'node', id}]` 并带
  `expectType:'explodeGroup'`——**爆炸是按分组的，`refs()` 返回 `[]` 会让删掉分组节点时前置检查失明**。
- **验收** 动作覆盖率门槛 100%（17 个）；`await:true` 时后续步骤在过渡结束后才跑（假时钟）；
  `await:false` 时立即返回**且中断不产生未处理拒绝**（`process.on('unhandledRejection')` 探针）；
  `describe()` 三种措辞各一条；**规则编辑器零改动**（diff 为空）。
- **自测** `pnpm -F @w3/core test eca`
- **变异检验** ① 删 `else void done.catch(...)` → 未处理拒绝那条红；
  ② 拿掉 `expectType` → T-226 的生产解析器那条 integrity 必须红。

### [ ] T-247 · 编辑器：爆炸分组的创建入口与参数面板
- **依赖** T-225 · **预估** 1.5d · **实际** —
- **独占** `packages/editor/src/lib/explode-edit.ts`(新) ·
  `packages/editor/src/panels/PropertiesPanel.tsx`（爆炸分区）+ 其测试
- **做** 选中任意节点时出现「设为爆炸分组」按钮（一次 commit 写默认配置）；已是分组时显示模式下拉
  （中文标签取自 `EXPLODE_MODE_LABELS`）、gain / axis / spacing / easing 与「取消爆炸分组」。
  **每个数值控件都要有 min/max**（v0.5 T-176 抓到过 `rotationDeg` 与灯光 intensity 的
  「存得下、打不开」）。
- **验收** **一条走到 UI 事件入口的测试**——点「设为爆炸分组」→ `explode !== null` 且撤销栈**恰好 +1**；
  改任一参数 → 恰好一条 commit 且 500ms 内连续改被合并；输入超范围 → 控件挡住、文档值始终通过
  `validate()`；「取消爆炸分组」→ `explode === null` 且子件的 `explodeOffset` **保留**
  （不顺手删别人的数据）。
- **自测** `pnpm -F @w3/editor test properties-explode`
- **变异检验** 把「设为爆炸分组」的 onClick 改成空操作 → UI 入口测试必须红。
  **这是新纪律 2 的直接防线：测被调用的那一半是不够的，要有一条问过「这个函数有人调吗」。**
  ⚠ `History` 有 **500ms 同标签合并窗口**（v0.5 T-144 复盘明写这条会盖住变异），
  所以两次 commit 的标签必须不同，或测试注入固定时钟。

### [ ] T-248 · 编辑器：爆炸预览工具态（滑块 + 与 gizmo/拖放的互锁）
- **依赖** T-244 · T-247 · T-241 · **预估** 1.5d · **实际** —
- **独占** `packages/editor/src/viewport/explode-tool.ts`(新) ·
  `packages/editor/src/viewport/ExplodeToolbar.tsx`(新) + 其测试（与 T-251 共享 `Viewport.tsx` → 排不同波次）
- **做** 模块级会话 store（抄 `viewport/snap.ts:35-52`），滑块驱动 `runtime.setExplode(id, f, {durationS:0})`；
  开启时 gizmo 不 attach（改 `Viewport.tsx:179-183` 那个 effect 的条件）、拖放放置禁用、
  属性面板 transform 只读并给中文提示；退出预览 / 节点增删时自动关闭并归零。
- **验收** 开工具态 → 滑到 1 → 选中一个被炸开的件 → 断言 gizmo **未附着**，再断言该件的
  `transform.p` **一字未变**；关闭工具态 → 渲染器上的位置回文档值；进入预览模式时自动关闭
  （**断言渲染器位置，不是断言 store 的布尔量**）；工具态既不进文档也不进 localStorage
  （grep 断言 + 刷新后为关闭态）。
- **自测** `pnpm -F @w3/editor test explode-tool`
- **变异检验** ① 去掉 gizmo attach 条件里那一项 → 「gizmo 未附着」红；
  ② 删「进入预览时关闭」→ 对应红。**断言必须读渲染器位置**——读 store 布尔量的话这条变异是绿的。

### [ ] T-249 · 编辑器：单零件 `explodeOffset` 的记录与清除
- **依赖** T-248（`explode-edit.ts` 同文件 → 排其后）· **预估** 1.0d · **实际** —
- **独占** `packages/editor/src/lib/explode-edit.ts` · `packages/editor/src/panels/PropertiesPanel.tsx`（偏移分区）
- **做** 工具态下拖动某个零件后点「记录当前偏移」→ 写 `node.explodeOffset = 位移 / factor`；
  「清除」→ 置 null 回派生值；工具态关闭时按钮 disabled。**这是「锚点重合时径向爆炸无效果」
  的唯一一条兜底出路**，完整性检查的中文提示逐字引用了它。
- **验收** 记录后把 factor 归零再拉回 1，该件回到刚才那个位置（**误差 < 1e-5，断言渲染器位置**）；
  清除后回派生位移；一次记录 = 撤销栈 +1。
- **自测** `pnpm -F @w3/editor test explode-offset`
- **变异检验** 删「除以 factor」→ 在 `factor=0.5` 记录再拉到 1 的那条必须红。
  **测试必须用 factor ≠ 1 记录一次**，否则这条变异是绿的。

### [ ] T-250 · Picker 的剖切感知
- **依赖** T-243 · **预估** 0.5d · **实际** —
- **独占** `packages/core/src/runtime/picker.ts` · `packages/core/test/runtime/picker-clip.test.ts`(新)
- **做** 射线命中点逐一与活跃裁剪平面比较，被裁掉的命中丢弃（容差 `−1e-6`）。
- **验收** 一面墙 + 后面一个球，剖切切掉墙的前半 → 射线命中球而不是墙；关闭后命中墙；
  `pickAll` 顺序仍按距离；无剖切时既有 picker 测试全绿（零回归）。
- **自测** `pnpm -F @w3/core test picker`
- **变异检验** ① `isClipped` 恒 false → 「命中球」红；
  ② 容差 `−1e-6` 改成 `0` → 需要一条「命中点恰好落在平面上」的测试才抓得到，**必须专门造这个样本**。
- ⚠ 不做则「点击被剖掉的墙仍会选中墙」，观感很差。

### [ ] T-251 · 编辑器：剖切平面的创建入口、helper 与参数面板
- **依赖** T-243 · T-248（共享 `Viewport.tsx`）· **预估** 2.0d · **实际** —
- **独占** `packages/core/src/runtime/section-helpers.ts`(新) ·
  `packages/editor/src/panels/SectionPanel.tsx`(新) · `packages/editor/src/panels/HierarchyTree.tsx`（新建入口）
- **做** 层级树 / 工具栏「新建剖切平面」（与「新建灯光」同位置，一次 commit，落在相机前方一段距离）；
  `SectionHelperLayer`（半透明矩形 + 边框 + 法线箭头，**沿 +n 偏移 1mm**，挂 `editorAux` 下，
  play 模式不构建，抄 `light-helpers.ts` 全部范式含「记住建构时的对象、身份变了就重建」那条
  v0.5 M9 教训）；属性面板 `size` 两框 +「对齐 X/Y/Z」+「翻转」+「暂时关闭剖切」会话开关。
- **验收** **一条走到 UI 事件入口的测试**——点「新建剖切平面」→ 多一个 `section !== null` 的节点、
  撤销栈 +1、Ctrl+Z 后消失；「对齐 X」后法线 = ±X（**断 `livePlanes`，不是断 `transform.r`**）；
  「翻转」两次回原状（四元数用点积绝对值比，避免 q 与 −q 的假红）；helper 在 play 模式不构建；
  `resetScene` 之后 helper 仍指向活着的对象（M9 同形回归）；「暂时关闭剖切」→ `clippingPlanes` 空
  **且** picker 恢复，不进文档不进 localStorage。
- **自测** `pnpm -F @w3/editor test section-panel && pnpm -F @w3/core test section-helpers`
- **变异检验** ①「新建剖切平面」onClick 空操作 → UI 入口红；② 删 helper 的 1mm 偏移 →
  需要一条「helper 世界位置与平面常数相差 ≈1mm」的断言；③ 删 `resetScene` 后的 helper 重建 → 对应红。

### [ ] T-252 · 剖切 × 描边的交互实测（观测卡）
- **依赖** T-243 · T-240 · **预估** 0.5d · **实际** —
- **独占** `e2e/tests/section-outline.spec.ts`(新) · `docs/IMPL_NOTES.md`（登记，人工回写）
- **做** **这不是一张实现卡，是一张观测卡。** 剖切与后处理两份设计**互相完全不知道对方存在**
  （explode-clip 全文零处提及 composer，postfx 全文零处提及 clip），两处需要实测：
  ① `OutlinePass` 内部替换材质（mask / depth）时，全局裁剪是否被这些材质吃进去——
  **如果不吃，被剖掉的那一半仍然会有描边**；② composer 的 RenderTarget 路径上，剖切平面数变化
  触发的 shader 重编译代价是否翻倍（pass 材质也进缓存键）。
  开剖切 + 开描边，截图 + 记录 `renderer.info.programs`；结论写进 IMPL_NOTES §2。
- **验收** 测试跑得出数字并断言一个**明确的**结论（哪一种都行，但必须断言其中一种，
  **不许写 `expect(true)`**）；若结论是「描边不吃裁剪」，本卡额外产出一条中文提示接进效果面板
  （「同时开启剖切与描边时，剖面处的描边可能不正确」）或一条 warn 级完整性检查。
- **自测** `pnpm test:e2e section-outline`
- **变异检验** 把断言的阈值方向反过来 → 必须转红（**证明这条测试真的在读像素 / 读计数器，
  而不是在读一个恒真的表达式**）。

### [ ] T-253 · `restart` 参数的语义收口
- **依赖** T-216 · **预估** 0.3d · **实际** —
- **独占** `packages/core/src/eca/actions/animation.ts`（仅 restart 分支）· `packages/core/test/eca/actions.test.ts`
- **做** `restart:false` 今天是一条**从未被执行过**的分支，且真实语义（两个播放器的 `play()` 都
  无条件先停上一次）与 UI 文案「若正在播放则从头开始」对不上。改为与文案一致：`restart:false`
  且 `isAnimationPlaying(id)` 为真 → 记一条 debug、**本步立即结束，不打断也不重播**
  （`await` 与否都不再等待已在跑的那一次，因为我们没有持有它的 promise ——**这一句必须写进
  ECA_SPEC §4.2**，由 T-296 回写）。
- **验收** 一条**真的传 `restart:false`** 的测试：动画在播 → 再跑一次 → `isAnimationPlaying` 仍 true
  **且开始时刻未变**（不是只断言「还在播」）。
- **自测** `pnpm -F @w3/core test eca`
- **变异检验** 把 `if (p.restart)` 改成恒真 → 新测试红。**对照组**：今天那条叫
  「restarts by default, and can be told not to」的测试（`actions.test.ts:76-80`）在同一变异下
  **是绿的**——**卡片提交信息里要把这个对照写出来**，它是 v0.5 教训 (a) 最好的现成反面教材。

### [ ] T-254 · 动画面板：imported 建条目与编辑期预览播放（断链兑现）
- **依赖** T-234 · T-237 · **预估** 0.8d · **实际** —
- **独占** `packages/editor/src/panels/AnimationPanel.tsx` + 其测试 ·
  `packages/editor/src/viewport/runtime-registry.ts`（预览播放的只读钩子）
- **做** 整条 `ClipPlayer` 栈（含 glTF 重名对象重绑算法、完整性检查、打包收集）建得很完整，
  **零生产调用者**——T-068 卡面明写要做「imported 类型可选 clip 与参数 + 预览播放」，两样都没落地，
  卡却标 `[x]`。本卡只兑现**断链**，区间 / 速度 / 淡变的编辑控件随 v1.2 的 T-321：
  ① **新建导入动画**入口：选模型资产 → 从 `asset.stats.animations` 选 clip → 造记录
  （调 `createImportedAnimation`，**它今天全仓零生产调用者**）；
  ② imported 行可编辑 `speed` / `loop` / `clampWhenFinished`；
  ③ **编辑期预览播放 / 停止**（调 `runtime.playAnimation`，**不进文档**，走运行时瞬态）；
  ④ **不做时间轴**：无拖拽刻度、无关键帧、无曲线。
- **验收** 从 UI 事件入口（真实点击 / 输入）走完「建 imported → 点预览 → 对象动起来 → 点停止」；
  一次新建 = 撤销栈**恰好一条**；`checkIntegrity` 零 error；**面板 DOM 里不存在任何刻度 / 关键帧
  元素**（结构断言，防以后有人「顺手加个时间轴」）；`createImportedAnimation` 有生产调用者
  （T-205 的守卫从候选表里去掉它）。
- **自测** `pnpm -F @w3/editor test && pnpm test:e2e`
- **变异检验** ① 把「新建 imported」的 commit 改成空操作 → **数量前后对比断言**红
  （**不许用 `.first()` 或 `not.toBeNull()`**，v0.5 T-115 与 E18 各栽过一次）；
  ② 预览播放的 `runtime.playAnimation` 改成空操作 → 「对象动起来」红。

### [ ] T-255 · `AssetLoader.retainOnly`
- **依赖** 无 · **预估** 0.8d · **实际** —
- **独占** `packages/core/src/runtime/loader.ts` · `packages/core/test/runtime/loader.test.ts`
- **做** 换文档时贴图会被淘汰（`TextureCache.retainOnly`），模型不会（`AssetLoader` 只增不减），
  且 `AssetLoader.evict()` **零调用点**——同一个 runtime 的两条资产链行为相反。
  `retainOnly(assetIds): string[]`（返回被淘汰的 id），逐字照抄 `texture-cache.ts:176-196` 的形状与注释纪律。
- **验收** load 两个 model → `retainOnly(new Set([a]))` → `has(a) === true`、`has(b) === false`、
  返回值 `=== [b]`、b 的 geometry `dispose` 被调用（spy）。
- **自测** `pnpm -F @w3/core test loader`
- **变异检验** ① 改成空实现 → `has(b) === false` 红；② 改成「全清」→ `has(a) === true` 红。
  **两个方向都要有断言，只测一个方向的话「全清」会假绿。**

### [ ] T-256 · `MaterialRegistry.retainOnly`（已实测的 clone 泄漏）
- **依赖** 无 · **预估** 0.8d · **实际** —
- **独占** `packages/core/src/runtime/material-registry.ts` · `packages/core/test/runtime/material-registry.test.ts`
- **做** 对 `owned` 里不在集合内的 nodeId，`dispose()` 掉 clone、从 `owned` 与 `sources` 删除。
- **验收** 对文档 A 建 clone（`cloneCount === 1`）→ `retainOnly(B 的 nodeIds)` → `cloneCount === 0`
  且 `isCloned('nd_aaaaaaa1') === false`；再对 B 建 clone → `cloneCount === 1`（**不是 2**）。
- **自测** `pnpm -F @w3/core test material-registry`
- **变异检验** 不调 `retainOnly` → 「再对 B 建 clone 后 `cloneCount === 1`」会变成 2，必须红。

### [ ] T-257 · 删材质 / 删资产入口（未认领缺口补齐）
- **依赖** T-227 · **预估** 1.0d · **实际** —
- **独占** `packages/editor/src/panels/MaterialPanel.tsx`（删除入口）· `packages/editor/src/panels/AssetPanel.tsx`
  （删除入口）· `packages/editor/src/panels/removal.ts`(新，与 T-290 共用) ·
  `packages/editor/test/removal-material.test.ts`(新)
- **做** 「删材质 / 删资产」在 13 份设计里**零命中**。样板工程要求 16 个零件 + 4 条材质 + 内置纹理，
  用户建错一条材质就永远删不掉，而 `.w3p` 会一直带着它的贴图字节。
  ① `describeRemoval(doc, target): RemoveRequest` 纯函数（Node 可测），复用 `refsTo` 做引用前置检查；
  ② 材质与资产各一个删除入口，被引用时对话框列出引用数与前三条引用者名字；
  ③ 删材质时，引用它的节点回落到 `ensureDefaultMaterial(doc)`（不留悬空引用）。
- **验收** `describeRemoval` 的三种文案（被引用 / 未被引用 / 是默认材质不可删）各一条 Node 单测；
  删一条被 3 个 mesh 用的材质 → 确认框文案含「3」→ 确认后三个节点的 `materialId` 指向默认材质
  且 `checkIntegrity` 零 error；删一张被引用的贴图 → 被拒并给出中文原因；
  删一张无人引用的贴图 → `.w3p` 里不再有它的字节。
- **自测** `pnpm -F @w3/editor test removal-material && pnpm -F @w3/storage test package`
- **变异检验** ① 删掉引用前置检查 → 「被引用时被拒」红；
  ② 删材质后不回落到默认材质 → `checkIntegrity` 那条红（**若只断言「材质少了一条」则不会红**）。

### [ ] T-258 · 改父保持世界位姿 + 拖拽改父的 E2E
- **依赖** 无 · **预估** 2.0d · **实际** —
- **独占** `packages/schema/src/transform-math.ts`(新) · `packages/schema/test/transform-math.test.ts`(新) ·
  `packages/editor/src/panels/tree-dnd.ts` · `packages/editor/test/editor-logic.test.ts` · `e2e/tests/reparent.spec.ts`(新)
- **做** `reparentPreservingWorld` 并接进 `applyDropPlan`；`sheared` 时给中文提示。
  **这条与外部数据源没有任何耦合**（纯数学 + 一处 `applyDropPlan` 调用），且是合同表里标为
  「完全一致」的条目之一，因此留在 v1.0 而不随数据源滑到 v1.5。
- **验收** 随机 200 组 TRS 链，`reparentPreservingWorld` 后 `worldMatrixOf` 与原值逐元素误差 < 1e-6；
  非均匀缩放 + 旋转的父 → `sheared === true`；`applyDropPlan` 之后 `parent`/`order`/`transform`
  三者同时正确；E2E：**真指针拖拽**把泵盖拖进带偏移 + 旋转的泵组 → 断言屏幕位置不变 → Ctrl+Z →
  完全还原 → `fullRebuildCount === 0`。
- **自测** `pnpm -F @w3/schema test && pnpm -F @w3/editor test && pnpm test:e2e reparent`
- **变异检验** ① `reparentPreservingWorld` 改成「原样返回旧 transform」→ E2E 的「位置不变」必须红。
  **这一条最关键**：如果 E2E 只断言「拖完之后 parent 变了」，它对位置跳变完全无感，那就是
  IMPL_NOTES §2 那条「未验证」原封不动地留着；② `sheared` 恒 false → 对应红。
- ⚠ 顺带登记（不在本卡范围）：gizmo 多选拖拽**不应用旋转 delta**（只加 position、乘 scale），
  但 UI 上旋转模式按钮可用。

### [ ] T-259 · 源单位 / 上方向声明这条断链接上
- **依赖** T-217 · **预估** 0.8d · **实际** —
- **独占** `packages/editor/src/panels/ImportDialog.tsx`(新) · `packages/editor/src/panels/AssetPanel.tsx` ·
  `packages/editor/src/lib/library.ts` · `packages/editor/test/import-flow.test.ts`
- **做** 文件选定后、`importAsset` 之前弹 `ImportDialog` 让用户声明 `sourceUnit` / `sourceUpAxis`，
  用 `suggestUnit(bounds)` 预填（**从 `readGlbHeader` 的 accessor min/max 直接取，不需要解析几何**）；
  三条入口（`AssetPanel` / `drop-controller` / `library.ts`）**全部透传**。
- **验收** 导入一份 mm 单位（bounds > 500）的 GLB 选「毫米」→ `asset.normalized.scaleApplied === 0.001`
  且节点在视口里是米制尺寸；**`suggestUnit` 有非测试调用者**（grep 断言，它是 11 条零调用者之一）；
  三条入口都传（三条测试各一）。
- **自测** `pnpm -F @w3/editor test import-flow`
- **变异检验** ① `ImportDialog` 不传 `sourceUnit`（回到今天的行为）→ `scaleApplied === 0.001` 红；
  ② `suggestUnit` 阈值改掉 → 预填红；③ **只接一条入口** → 另外两条的测试必须红
  （**三条入口各写一条，不许写成一条参数化测试跑同一个入口**）。

### [ ] T-260 · 体检报告呈现增强
- **依赖** T-234 · **预估** 1.0d · **实际** —
- **独占** `packages/editor/src/panels/AuditReport.tsx`(新) · `packages/editor/src/lib/audit-markdown.ts`(新) ·
  `packages/editor/src/panels/AssetPanel.tsx` · `packages/editor/test/audit-report.test.tsx`(新)
- **做** 把 `ImportReport`（`AssetPanel.tsx:160-240`）抽成 `AuditReport`，参数化「导入前确认」与
  「只读查看」；首列改 `label`（中文），实测 / 上限列走 `formatMetric`；
  **渲染 `AuditResult.summary`（全仓第一次，它是 11 条零调用者之一）**；`origin` 存在时表格变
  「送检 / 处理后」两列 + 处理说明 +「文件 X → Y」（v1.5 转码用，此处先建）；「复制为 Markdown」。
- **验收** 表格首列全部中文（正则断言不含 `/^[a-z][A-Za-z]+$/` 的裸标识符）；数值列不含
  `/^\d{4,}$/` 的裸数字；`summary` 出现在 DOM 里；`origin` 缺席时**只有一列「实测」**；
  Markdown 输出能被解析回同样的行数与结论。
- **自测** `pnpm -F @w3/editor test audit-report`
- **变异检验** ① 首列改回 `finding.metric` → 中文断言红；② `formatMetric` 换成 `toLocaleString` →
  裸数字红；③ 删 `summary` 那行 → 红。**⚠ 这三条正是最容易写成假绿的地方**：
  「表格渲染出来了」和「表格渲染的是对的东西」在今天的实现下**都成立**。

### [ ] T-261 · 重新体检（只读）+ 附件A 机械校验
- **依赖** T-260 · **预估** 1.0d · **实际** —
- **独占** `packages/editor/src/panels/AssetPanel.tsx`（`AuditBadge` 可点击）·
  `packages/core/src/assets/audit.ts`（增 `regrade`）· `packages/core/test/assets/regrade.test.ts`(新) ·
  `scripts/check-annex-a.mjs`(新) · `scripts/check-constitution.mjs` · `docs/附件A_数字资产规范_草案.md`
- **做** （合并卡：两件事都改附件A 与体检口径，分开做必然打架）
  ① `regrade(stats, storedAudit, policy)` **只用已存的 stats 重新判级**（不重读字节——资产字节可能
  已不在本地）；`AuditBadge` 点击 → 只读模式，顶部两句（收检时结论 / 当前阈值重算结论）；**不写文档**；
  ② `check-annex-a.mjs` 五条检查挂进 `GUARDS`：附件A 的每个数值上限必须等于 `DEFAULT_POLICY`
  的对应值 · 每条 METRICS 必须在附件A §2 有一行 · 送检清单条数与代码一致 · §7 的机器状态列格式合法 ·
  文档里不出现已废弃的格式名；
  ③ 回写附件A——§1 的「几何压缩 / 贴图压缩」两行改成事实（**「解码器已自托管」不等于「能用」——
  现文案正是这种误读的成品**，T-218/T-219 已给出真实状态）；§2 增三条新 metric 行；§5 增 KTX2 与
  色彩空间一段；§8 送检清单增两条；转码上线后的边界先写进去但标 `[v1.5]`。
  **⚠ 按 A4/X-34，附件A 的 KTX2 白名单不动**（单独 `.ktx2` 由 T-219 支持，「诚实拒绝 + 改附件A」
  整条作废）。
- **验收** 改 `DEFAULT_POLICY.maxTriangles` 后「收检时」结论不变、「重算」结论变；提交后
  `doc.assets[i].audit` **逐字节未变**（快照断言）；临时把 `DEFAULT_POLICY.maxBytes` 改成 61MB →
  `pnpm check:constitution` **红**且报错指出附件A 第几行（验后还原）；临时加一条 METRICS 而不写进
  附件A → 也红。
- **自测** `pnpm -F @w3/core test regrade && pnpm -F @w3/editor test && pnpm check:constitution`
- **变异检验** ① `regrade` 里偷偷写回 `asset.audit` → 「未变」红；
  ② 两句结论共用同一个 policy → 「重算结论变」红；
  ③ 上面两条「临时改 → 必须红」本身就是守卫的变异检验，**逐条记进提交信息**。

**M16 小计：27 张 / 32.2 人日**

---

## M17 · 渲染出图与嵌入 SDK（T-262 ~ T-281）

> 这一段对应产品负责人 A2「**能被嵌进别人的系统**」那个词。
> 「能被嵌进」在部署层面**现在就可用**——全仓一个 `X-Frame-Options` / `frame-ancestors` 都没设。
> 缺的不是能力，是 **API 和策略**。

### [ ] T-262 · 能力探针扩展 + `planCapture`（出图的全部防线）
- **依赖** T-214（`CaptureLimits.pixelRatio`）· **预估** 1.0d · **实际** —
- **独占** `packages/core/src/runtime/capability.ts` · `packages/core/src/runtime/image-export.ts`(新，仅 plan 部分) ·
  `packages/core/test/runtime/image-export.test.ts`(新)
- **做** `CapabilityReport` 加 `maxRenderbufferSize` / `maxViewportDim`（探针失败一律 0 = 未知，
  按保守值走——**`detectCapability` 早就采集了 `MAX_TEXTURE_SIZE` 然后原样丢弃**，探针早在，
  只是没接消费端）；实现 `planCapture` + 五个常量 + `CaptureRequest` / `CapturePlan` / `CaptureRejection`；
  钳位链读 `limits.pixelRatio`（T-214 已加）与 `limits.postFxActive`；
  **接线 `maxScaleFor(mode)`**——`MAX_SCALE_DIRECT=4` / `MAX_SCALE_COMPOSED=2` 由 T-263 提供，
  `planCapture` 调它降倍率（**X-19：两张卡各交付一半、中间没有接线卡的话，用户在 composed 模式下
  仍然能选 4×，撞的就是算出来的 2.2 GB 显存**）；全部中文文案逐字写进代码。
- **验收** （全纯 Node） 拒绝矩阵四条各一测且 `reason` **逐字断言**；钳位矩阵五条 + 两条
  `pixelRatio: 2` 的用例；**每条钳位都断言 `notice` 非空且含目标尺寸的数字**（防静默钳位）；
  任意输入下 `abs(w/h − vw/vh) < 0.01` 且 `Number.isInteger(w) && w >= 1`；
  `longEdge` 与 `scale` 同给时 `longEdge` 胜出且 notice 说明。
- **自测** `pnpm -F @w3/core test runtime/image-export`
- **变异检验** ① `MAX_EXPORT_SCALE` 4→999 → 钳位红；② 删 `notice` 赋值 → 「钳位必有说明」红
  （专防「测了行为没测报错措辞」）；③ 纵横比里 `vh` 换 `vw` → 红；④ jpeg × transparent 的拒绝改成
  warn → 拒绝矩阵红；⑤ **把 `limits.pixelRatio` 从公式里删掉 → 那两条 `pixelRatio: 2` 用例必须红**
  （这条是 X-17 的机器落点：**桩 limits 在真实 2× 屏上仍然全绿**，不加这两行就永远发现不了）。

### [ ] T-263 · 出图相容性：透明背景降级、倍率上限、显存预估
- **依赖** T-235 · **预估** 1.0d · **实际** —
- **独占** `packages/core/src/runtime/render-pipeline.ts`（导出约束段）·
  `packages/core/test/runtime/export-constraints.test.ts`(新)
- **做** 纯函数 `estimateExportVram({width,height,mode,outlinePasses})`（direct ≈ 0 额外；
  composed ≈ 48·W·H + 19·W·H×passes）；纯函数 `resolveExportPipeline({transparent,scale,docMode})`
  → `{ mode, droppedOutline, reason }`（reason 中文）；`MAX_SCALE_DIRECT=4`、`MAX_SCALE_COMPOSED=2`。
  **X-18 的裁决：透明背景 × 后处理 → 降级，不是拒绝。** 用户拿到一张图 + 一句解释
  （「透明背景导出不包含描边效果」），好过拿到一个禁用的按钮。**且雾不受影响**——雾画在物体像素上，
  背景像素仍然 alpha 0，中文文案里不许把雾一起列进去。
- **验收** `transparent:true` → 恒 `mode:'direct'`、`droppedOutline:true`、reason 非空且**不含「雾」字**；
  `scale:4` 且 composed → 降到 2，reason 非空；1920×1080 / composed / 2 passes 的显存预估落在
  170–190 MB（**用公式校验，不是硬编码一个数**）。
- **自测** `pnpm -F @w3/core test runtime`
- **变异检验** ① 删 `transparent` 判断 → 第一条红；② `MAX_SCALE_COMPOSED` 改 4 → 第二条红；
  ③ reason 断言写成 `not.toBeNull()` → **必须证明它对 `undefined` 也成立**（E18 教训 3），
  改成断言具体措辞；④ 把「雾」加回文案 → 文案断言红。

### [ ] T-264 · 热点视觉规范 + `style.label` + DOM 侧改读同一份
- **依赖** T-225 · **预估** 1.2d · **实际** —
- **独占** `packages/core/src/runtime/hotspot-visual.ts`(新) · `packages/core/src/runtime/hotspot-layer.ts` ·
  `packages/core/test/runtime/hotspot-visual.test.ts`(新) · `packages/editor/src/panels/HotspotPanel.tsx`（编号输入框）
- **做** 热点的视觉表现**从来没有 CSS**（全仓一行都没有，靠内联样式活着），DOM 版本身就是一个
  没有外观的 button——「把 DOM 热点转成 sprite」在当前代码里没有可对齐的目标。
  ① `HOTSPOT_MARKER_SPEC` / `markerGeometry` / `markerLabel` / `hotspotDrawOrder` / `panelLayout`
  （含翻边）/ `HOTSPOT_OCCLUDED_OPACITY`；
  ② `DomHotspotRenderer.markerFor`（`:215-235`）改为从 `markerGeometry()` 写内联样式，
  **修掉 `:223` 那条两个分支都是空串的死代码**让 number 标记真的显示编号；
  ③ `:202` 的 `0.25` 与 `:204` 的排序改读常量 / `hotspotDrawOrder`；
  ④ `HotspotProjector.update` 加 `{forceOcclusion?}`；
  ⑤ **编辑器热点面板加「编号」输入框（写 `hotspot.style.label`）——这一环在本卡内，不许推给别的卡**。
- **验收** 三种 marker 的 `markerGeometry` 半径 / 字号**互不相同（逐值断言，不是 `not.toBeNull()`）**；
  jsdom 断 number 标记 `textContent === '3'`（第三个热点无显式 label）与 `=== 'A1'`（有显式 label）；
  `hotspotDrawOrder` 对距离 `[5,1,9]` 返回 `[9,5,1]`；`panelLayout` 在锚点靠右边界时翻到左侧
  （`x+w <= canvas.w`）；`forceOcclusion:true` 让 `lastRaycastCount > 0` 即使 `frame%3 !== 1`；
  编号输入框改值 → 文档 `style.label` 变且一次撤销。
- **自测** `pnpm -F @w3/core test runtime/hotspot && pnpm -F @w3/editor test hotspot-panel`
- **变异检验** ① `markerLabel` 的 `?? String(ordinal+1)` 改成 `?? ''` → DOM 编号红；
  ② 排序方向反过来 → 顺序红；③ 删 `forceOcclusion` 判断 → raycast 计数红；
  ④ 删 `panelLayout` 翻边分支 → 边界红；⑤ 把编号输入框的 onChange 改成空操作 → UI 入口红。

### [ ] T-265 · `HotspotSpriteLayer`（栅格化 + overlay pass）
- **依赖** T-264 · **预估** 1.5d · **实际** —
- **独占** `packages/core/src/runtime/hotspot-sprite.ts`(新) · `packages/core/src/runtime/font-provider.ts`(新) ·
  `packages/core/test/runtime/hotspot-sprite.test.ts`(新) · `vendor/fonts/README.md` ·
  `docs/adr/0025-出图新增一次-overlay-pass.md`(新)
- **做** `createCanvas` / `decodeImage` / `font` 三处注入照抄 `thumbnail.ts:45` 的模式；
  `ops: DrawOp[]` 是**可观测输出**（这是 parity 第一次覆盖到渲染层：`tick()` 先更新热点层再
  `renderer?.render(...)`，热点层的更新与 renderer 是否存在无关 → **sprite 的栅格化可以在纯 Node
  的 parity 里真跑**）；`compose()` 的材质必须 `toneMapped:false` + `depthTest:false` +
  `transparent:true`，贴图 `colorSpace = SRGBColorSpace`。
  **ADR-0025**：`compose()` 是 `autoClear=false` 的 overlay pass，在 `drawScene()` **之后**——
  这是 v1.0 唯一一条主动破例的渲染出口，`scene-runtime.ts` 里会出现第二处 `renderer.render(...)`，
  **必须留 `CONSTITUTION-EXCEPTION` 注释并带过期版本号**（走 T-205 的 `readExemptions`）。
  ADR 里同时作废「热点 sprite 是场景内对象、会吃雾、进 composer」那条假设，并写明连带后果：
  **雾对热点无效、描边对热点无效**（合理，但要写进面板文案）。
- **验收** （全纯 Node，注入假 2D context 记录调用） 三个热点（onScreen / offScreen / occluded）→
  ops 恰好两条 marker，occluded 那条 `alpha === 0.25`；marker 的 `x/y` 与 `placement.x/y`
  **逐字相等**（防「画了但位置错」）；ops 顺序与 `hotspotDrawOrder` 一致；`openPanel` 过的热点 →
  ops 含 `panel` + `panel-text(title)` + `panel-text(body)` 且 text 与 `hotspot.content` **逐字相等**；
  媒体解析失败 → `placeholder === true` + `onWarn` 一次且**其余 ops 不变**；`font.ready()` reject →
  退回系统栈、ops 照常、warn 一次；`dispose()` 后 ops 为空且贴图被 dispose；
  `CONSTITUTION-EXCEPTION` 白名单里有这一条且带过期版本号。
- **自测** `pnpm -F @w3/core test runtime/hotspot-sprite && pnpm check:constitution`
- **变异检验** ① `update()` 空操作 → 全部 ops 红；② `alpha` 恒 1 → 遮挡红；
  ③ `panel-text` 的 text 改成 `hotspot.id` → 逐字断言红（**专防「断言调用了 fillText 但不断言参数」
  的假绿**）；④ 删 `toneMapped:false` → 材质属性断言红（**这条只能断材质属性不能断像素，
  如实写在卡里**）；⑤ 把过期版本号从白名单条目里删掉 → `check:constitution` 必须红。

### [ ] T-266 · `captureImage` 主链路与还原保证
- **依赖** T-235 · T-262 · T-265 · **预估** 2.0d · **实际** —
- **独占** `packages/core/src/runtime/image-export.ts`（编排部分）· `packages/core/src/util/filename.ts`(新) ·
  `packages/core/src/runtime/scene-runtime.ts`（`captureImage` 段，列 R）·
  `packages/core/test/runtime/image-export-flow.test.ts`(新)
- **做** `CaptureSurface` 接口 + 私有实现 + 八步链路；还原栈；`webglcontextlost` 监听；
  `capturing` 重入拒绝；`sanitiseFilename` 从 `packages/editor/src/publish/publish.ts:184-189`
  **上移**到 `@w3/core/util/filename.ts`，编辑器改引；`captureFilename()`；打开中的面板重放；
  `Viewport.tsx:148` 的 gizmo 改走 T-235 的 `registerChrome`。
- **验收** **故障注入矩阵**——`for (k of 1..8) { 第 k 步抛 → 断言 surface 的
  size / chromeVisible / background / running / capturing 五项与进入前逐字段相等 }`，八条；
  `drawScene` 被调用的那一刻 `surface.size()` 返回**目标分辨率**；overlay `compose()` 在
  `drawScene()` **之后**被调用（断调用顺序数组）；打开一个面板 → 导出 → `spriteLayer.ops` 含该面板
  （重放断言）；出图期间 `resize(9,9)` 不生效、还原后生效；第二次 `captureImage` 返回
  `ok:false, reason:'上一次导出还没完成。'`；**任何注入故障下都 resolve、从不 reject**；
  `grep -c "function sanitiseFilename" packages/editor/src` **为 0**（一份实现）。
- **自测** `pnpm -F @w3/core test runtime/image-export-flow && pnpm -F @w3/editor test && pnpm -r typecheck`
- **变异检验** ① 还原栈弹栈改成只还原尺寸 → 故障矩阵至少 4 条红；② 删面板重放 → 重放断言红；
  ③ `compose()` 挪到 `drawScene()` 之前 → 顺序断言红；④ 删重入守卫 → 并发红；
  ⑤ 删 `resize` 的 `capturing` 分支 → pending 尺寸红。

### [ ] T-267 · 编辑器出图对话框
- **依赖** T-266 · **预估** 1.0d · **实际** —
- **独占** `packages/editor/src/dialogs/ExportImageDialog.tsx`(新) · `packages/editor/src/App.tsx`（列 A）·
  `packages/editor/test/dialogs/export-image-dialog.test.tsx`(新)
- **做** 模态框（倍率 1/2/4 · 长边 1920/2560/3840 · 格式 PNG/JPEG · 背景 跟随场景/透明/不透明 ·
  含热点 · 含已打开面板 · 文件名）；实时显示 `planCapture` 的预计尺寸与 notice；被拒时禁用导出
  并显示 reason；**透明背景 + 描边时显示降级提示而不是禁用**（T-263 的裁决）；
  显示当前字体来源；导出后**不关闭对话框**。
- **验收** JPEG + 透明 → 按钮 disabled 且显示逐字中文 reason；透明 + 描边 → 按钮**可用**且显示
  「透明背景导出不包含描边效果」；视口 1280×720 选 ×4 → 显示「3840×2160」且 notice 提示已钳位；
  点导出 → `captureImage` 被调一次且参数与 UI 选择逐项一致；
  **对话框不自己算尺寸**——把 `planCapture` 打桩返回 `999×888`，UI 必须显示 999×888。
- **自测** `pnpm -F @w3/editor test dialogs/export-image-dialog`
- **变异检验** ① 让 UI 自己算 `vw*scale` → 打桩断言红；② 删 disabled 条件 → JPEG × 透明红；
  ③ 把透明 + 描边改成 disabled → 降级提示那条红（**两种行为互相排斥，必须各有一条断言**）。

### [ ] T-268 · `exportImage` 动作 + `RuntimeContext` 双实现 + 契约
- **依赖** T-266 · T-203 · **预估** 0.8d · **实际** —
- **独占** `packages/core/src/eca/actions/scene.ts` · `packages/core/src/eca/types.ts`（列 T）·
  `packages/core/src/eca/headless.ts` · `packages/core/test/eca/actions/export.test.ts`(新) ·
  `packages/core/test/eca/runtime-contract.test.ts`
- **做** 三文件法注册 `exportImage`；headless 侧返回同形的 `CaptureResult`（blob 为空）。
- **验收** 动作覆盖率 100%（18 个）；`git diff --stat packages/core/src/eca/engine.ts` **为空**
  （ADR-0018 的 Proxy 兑现，C5 的验收证据）；`rule-editor.test.tsx` 的「规则编辑器源码里不许出现
  动作类型名」守卫仍绿且规则编辑器 diff 为空；契约测试两侧 `CaptureResult` 除 blob 外逐字段相等
  （含 notice 与 filename）；`await:false` 立即 resolve；`await:true` 且失败时不抛只 warn。
- **自测** `pnpm -F @w3/core test eca && pnpm -F @w3/editor test rule-editor`
- **变异检验** ① `HeadlessRuntime.captureImage` 返回硬编码 `1280×720` → 契约红；
  ② **把 headless 侧的 `planCapture` 换成自己抄一份的算法（同一份数字）→ 契约测试仍然绿**——
  这就是「冗余实现让变异失灵」（E18 教训 1）。**因此本卡额外加一条断言：headless 与 SceneRuntime
  必须引用同一个 `planCapture` 符号**（`expect(headlessPlanFn).toBe(planCapture)`）。

### [ ] T-269 · 接通发布缩略图（并收口视点缩略图字段形状）
- **依赖** T-266 · **预估** 0.5d · **实际** —
- **独占** `packages/editor/src/dialogs/PublishDialog.tsx` · `packages/editor/src/publish/publish.ts`
- **做** 发布前调 `captureImage({longEdge:512, includeHotspots:false, background:'opaque', format:'jpeg'})`
  把 bytes 传给 `publish({thumbnail})`——**接通 `publish.ts:41` / `package.ts:24/135/213` 这条铺好
  没人走的路**（`publish()` 的 thumbnail 参数今天是死代码，缩略图字节从不进发布包）；
  出图失败**不阻断发布**；视点缩略图改读 `thumbnailAssetId`（schema 侧已由 T-225 改名）。
- **验收** `.w3p` 用 `unpackScene` 读出 `thumbnail` 非空且是合法 JPEG（魔数 `FFD8FF`）；
  打桩返回 `ok:false` 时发布仍成功且 `thumbnail` 为 undefined；
  `grep -rn "thumbnailUrl" packages/` 零命中。
- **自测** `pnpm -F @w3/editor test publish && pnpm -F @w3/schema test`
- **变异检验** ① 删 thumbnail 透传 → `.w3p` 断言红；②「出图失败不阻断发布」改成抛错 → 降级红。

### [ ] T-270 · `openLink` 注入口与嵌入语义
- **依赖** T-235 · T-271 · **预估** 0.7d · **实际** —
- **独占** `packages/core/src/runtime/scene-runtime.ts`（仅 options + `openLink` 方法，列 R）·
  `packages/core/test/runtime/open-link.test.ts`(新)
- **做** `SceneRuntimeOptions` 加 `openLink?(url, target)`；`SceneRuntime.openLink` 改为
  `(this.options.openLink ?? defaultOpenLink)(url, target)`，**默认实现逐字保留今天的行为**
  （`:926-932`）；播放器嵌入版实现：拒绝非 http(s) / 相对路径（warn）、一律发 `openLink` 事件、
  `_blank` 额外执行原行为、`_self` 不导航。
- **验收** **老行为回归**——不注入时调用 `globalThis.open(url, target, 'noopener,noreferrer')`
  参数逐字相同；注入后 `_self` 不导航且事件发出一次。
- **自测** `pnpm -F @w3/core test runtime/open-link`
- **变异检验** 把 `OpenLinkParams.url` 顺手改成 `z.string().url()` → 「含 `javascript:` 的历史文档
  仍能 validate」那条必须红。**这条变异存在的意义是把 C4 的边界钉死。**
- ⚠ 登记：`openLink` **早已让文档携带任意外部 URL 且零校验**——「我们从不让文档决定外部地址」
  是错的，v0 就让了。v1.5 的白名单讨论要从这个既成事实出发。

### [ ] T-271 · 嵌入控制器（core，传输无关）
- **依赖** 无（与表现力线并行）· **预估** 2.0d · **实际** —
- **独占** `packages/core/src/embed/**`(新) · `packages/core/test/embed/**`(新) ·
  `packages/core/src/index.ts`（一行导出）· `packages/core/src/runtime/playback-session.ts`（`onEvent`）·
  `packages/core/test/runtime/playback-session.test.ts`
- **做** （含会话事件观测口，两者不可分：控制器的全部事件来源就是它）
  ① `PlaybackSessionOptions.onEvent?`（JSDoc 一句「进入引擎的每一条事件，**恰好一次**」）；
  定义 `const fire = e => { options.onEvent?.(e); engine.dispatch(e) }`，把现有 **5 处**
  `engine.dispatch(...)` 与 `runtime.onEvent(...)` 回调**全部**改成 `fire`
  （**`createPlayerSession` 早就支持 `onResult`，编辑器预览接了、播放器没接**——同一形状的断链）；
  ② `protocol.ts`（`EMBED_PROTOCOL=1`、`CommandSchema`、`Ack`/`Evt`、`EmbedErrorCode`、
  `RuntimeEventSchema` 逐字转写 `eca/types.ts:21-30` 的联合）；
  ③ `commands.ts` 命令注册表——`screenshot` / `goToStep` / `goToScene` 的 `run` 经**可选注入的依赖**
  调用，**注入缺失时该命令不进注册表**（`ready.commands` 自动少一项，宿主 `can()` 立刻能检测到，
  绝不会变成一条「存在但永远失败」的命令）。**这一条同时解决 X-53**：`goToScene` 在 v1.0 无实现，
  协议里保留但不出现在 `ready.commands` 里，v1.5 接上时**无需升协议版本**；
  ④ `scene-summary.ts` 纯函数；`embed-controller.ts`（`handle` 返回 `null` = 不是我们的消息 /
  `notify` 订阅位图过滤 / `dispose`）。
- **验收** 注入收集器后依次 `start()`/`click`/`pointerOver(a)`/`pointerOver(b)`/`pointerOver(null)`/
  `hotspotClick`/`dispatch(timer)`/`runtime.setVar`，断言收集序列与 engine 实际收到的序列
  **逐项相等且长度相等**（同时挡住漏发与重发）；`stop()` 之后不再被调用；
  每个命令至少一条测试 + 一条**遍历 `Object.keys(COMMANDS)` 比对测试清单**的门槛测试；
  `ready.commands` 断言等于 `Object.keys(COMMANDS)`（**不是等于一个手写数组**）；
  `getVariable('stpe')`（打错字）返回 `unknown-variable` 而**不是** `{value:0}`；
  `setVariable` 写同值 → ack `ok:true` 且 `onEvent` 里**没有** `variableChange`；
  全部跑在**纯 Node**（无 jsdom 无 canvas），套件 < 2s；`pnpm test:parity` 仍绿。
- **自测** `pnpm -F @w3/core test embed && pnpm -F @w3/core test runtime/playback-session && pnpm test:parity && pnpm -r typecheck`
- **变异检验** ① 把 `hotspotClick` 那处改回 `engine.dispatch` → 长度断言红；
  ② 把 `onEvent?.(e)` 放到 dispatch 之后并额外调一次 → 长度断言红（**防 double-fire，
  是「多一条」这类最难发现的缺陷**）；③ `getVariable` 改成直接透传 `runtime.getVar` → 打错字那条红；
  ④ `ready.commands` 改成手写数组并少一项 → 门槛红；⑤ 注入缺失时仍注册（返回
  `unsupported-capability`）→ 「注入缺失则命令不出现」红；⑥ `unknown-command` 改成静默返回 null → 对应红。

### [ ] T-272 · postMessage 传输层与 origin 策略
- **依赖** T-271 · **预估** 1.5d · **实际** —
- **独占** `packages/player/src/embed/policy.ts`(新) · `transport.ts`(新) · `boot.ts`(新) ·
  `packages/player/test/embed-policy.test.ts`(新) · `scripts/check-embed-layering.mjs`(新) ·
  `scripts/check-constitution.mjs`（一行）
- **做** `parsePolicy`（坏 JSON → 空白名单 + warn）与 `isAllowed`（精确 / 最左单标签通配 /
  显式 `"*"` / scheme 限制 / localhost 例外），**纯函数零 DOM**；
  `installTransport({controller,getPolicy,addListener,postTo})` **四个都是注入口**，握手、
  `(source,origin)` 记账、每个 source 只回一次 `denied`、多实例区分；
  `boot.ts` 仅在 `?embed=1` 时动态 import；`check-embed-layering.mjs` 两条静态断言挂进 `GUARDS`。
- **验收** `policy.test.ts` **≥ 30 条**，照 `source.test.ts:46-78` 的对抗风格写，**必须含**：
  大小写不同的 host、带 / 不带默认端口、末尾斜杠、`null` origin（sandbox 无 `allow-same-origin` 时
  浏览器给的就是字符串 `"null"`）、`data:` origin、`https://customer.example.evil.com`、
  `https://evil.com#.customer.example`、`https://evil.com?.customer.example`、`http://` 非 localhost、
  `https://*.com`（必须拒）、`*` 出现在中间（必须拒）、条目本身是坏字符串；
  transport 用注入假件在**纯 Node** 跑：非白名单 origin 收到**恰好一条** `denied` 且第二条消息不再回；
  回发用的 target origin **等于协商 origin，且全仓不出现 `postMessage(x,'*')` 除握手那一处**
  （**源码扫描断言，不是行为断言**）；不认识的消息零回复零 warn。
- **自测** `pnpm -F @w3/player test && node scripts/check-embed-layering.mjs && pnpm check:constitution`
- **变异检验** ① `isAllowed` 直接 `return true` → 至少 5 条红；② 通配从 `endsWith('.'+suffix)` 改成
  `endsWith(suffix)` → `customer.example.evil.com` 那条红；③ 去掉「只回一次」→ 放大器那条红；
  ④ 回发 target origin 改成 `'*'` → 源码扫描红；
  ⑤ **守卫自身的变异**：在 `packages/core/src/embed/protocol.ts` 临时写 `const _ = window` →
  `check-embed-layering` 必须 fail（**守卫本身也要做一次变异检验**，v0.5 T-117 教训）。

### [ ] T-273 · Player 生命周期与嵌入模式接线
- **依赖** T-272 · **预估** 1.5d · **实际** —
- **独占** `packages/player/src/app.ts` · `packages/player/src/main.ts`
- **做** `pause()` / `resume()` + 内部 `shouldRun` 与门（`hostWantsPlay && documentVisible && onScreen`），
  `visibilitychange` + `IntersectionObserver` **各自只改一个输入量**；构造参数 `onSession?`
  （**不要**把 `session` / `runtime` 变成 public getter，那会让任何人绕过控制器）；
  **`capability.level === 'unsupported'` 的分支也要走握手**（今天 `app.ts:47-51` 直接 return，
  嵌入时宿主看到一个黑框）；`?embed=1` 时仍保留 `?src` 与拖放，`fail()` 的错误同时喂给 boot 的
  `error` 通道。
  **C3 口径**：本卡对 `packages/player/src` 的改动**只允许出现在 `app.ts` 的装配段与 `main.ts`**，
  逐行在提交信息里点名，改动行数记进 METRICS（新纪律 7）。
- **验收** `pause()` 后 `runtime.start` 不再被调用；**`visibilitychange → hidden → visible` 之后
  仍然是暂停的**；`unsupported` 时 boot 回调收到 `ready` 与 `error` 各一次；
  无 `?embed=1` 时动态 import **一次都没发生**。
- **自测** `pnpm -F @w3/player test && pnpm -r typecheck`
- **变异检验** ① 把 `shouldRun` 三个输入拆成三处各自 start/stop → 「hidden 再 visible 之后仍暂停」红；
  ② `unsupported` 改回直接 return → capability 那条红；③ 去掉 `?embed=1` 判断 →
  「不带参数时不加载」红。

### [ ] T-274 · 宿主 SDK（单文件 + npm 包 + 版本闸门 + 构建接线）
- **依赖** T-271（可与 T-272 / T-273 **并行**）· **预估** 1.5d · **实际** —
- **独占** `packages/player/src/embed-sdk/**`(新) · `packages/player/vite.embed.config.ts`(新) ·
  `packages/player/package.json` · `Dockerfile`
- **做** `mount()` / `player.*` 全套，**零依赖，自己写 `SUPPORTED_PROTOCOLS = [1]` 字面量**；
  `build.lib`（IIFE 全局 `W3Player` + ESM）、`emptyOutDir:false`、输出 `dist/embed.js` 与 `dist/embed.mjs`；
  `build:app` / `build:embed` / `build`；`Dockerfile:28` 改为
  `build:app --base=/player/ && build:embed`；`embed-sdk/package.json`（`@w3/player-embed`）。
  **SDK 不做成 workspace 包**（`check-deps-direction.mjs` 的白名单是硬编码的，SDK 是依赖图叶子）。
- **验收** 协议一致性测试——**读 SDK 源文件文本**用正则抠出 `SUPPORTED_PROTOCOLS` 的字面量与
  `EMBED_PROTOCOL` 比，**不许 import 同一个常量**；`dist/embed.js` 存在、非空、**< 12 KB 未压缩**；
  `dist/index.html` 的 `<script src>` 以 `--base` 前缀开头；`check-size-budget` 仍 PASS；
  `check-no-external --require-build` 绿。
- **自测** `pnpm -F @w3/player build:app --base=/player/ && pnpm -F @w3/player build:embed && node scripts/check-size-budget.mjs && node scripts/check-no-external.mjs --require-build && pnpm -F @w3/player test embed-sdk`
- **变异检验** ① SDK 的 `SUPPORTED_PROTOCOLS` 改成 `[2]` → 一致性红；
  ② **把一致性测试改成 `import { EMBED_PROTOCOL }` 两边比 → 它会永远绿**，这本身就是这张卡要
  证明的东西；**提交信息里记录这次「变异不转红」的观察与改法**；
  ③ `build` 写回 `vite build && vite build -c …` 并用 `--base` 跑 → base 断言红。

### [ ] T-275 · 部署侧：`frame-ancestors`、策略文件示例、bench 页封堵
- **依赖** T-221 · **预估** 0.5d · **实际** —
- **独占** `deploy/nginx.conf.template` · `deploy/embed-policy.example.json`(新) ·
  `docs/DEVELOPMENT.md`（部署一节）· `scripts/check-deploy-headers.mjs`(新)
- **做** `location /player/` 加 `add_header Content-Security-Policy "frame-ancestors 'none'" always;`
  （注释写明怎么改成客户宿主域、为什么不用 `X-Frame-Options`）；
  `location = /player/bench.html { return 404; }` + 临时开启方法（**`bench.html` 随 dist 一起部署到
  `/player/bench.html`，是第二个公开入口且无任何访问控制**）；
  `deploy/embed-policy.example.json`（**不在 `packages/player/public/`**）；部署文档四段。
- **验收** 脚本测试解析 nginx 模板文本，断言 `/player/` 块含 `frame-ancestors`、默认值是 `'none'`、
  `bench.html` 有 404 规则、模板里**零 `X-Frame-Options`**。
- **自测** `node scripts/check-deploy-headers.mjs`
- **变异检验** ① 默认值改成 `*` → 红；② 删 bench 的 404 规则 → 红。

### [ ] T-276 · E2E：真跨源宿主页面套 iframe
- **依赖** T-273 · T-274 · **预估** 1.5d · **实际** —
- **独占** `e2e/tests/embed.spec.ts`(新)
- **做** 用 `page.route` + `route.fulfill` **凭空造一个真正的外部 origin**（`https://host.example`），
  不加第三个 dev server；策略文件也由路由伪造（**这样「策略在不在」本身成为被测对象**）；
  `HOST_HTML` 用 `<script src="http://127.0.0.1:5274/player/embed.js">`（与 `https://host.example`
  **是不同 origin**，握手是真跨源的）。四条用例：正路 / 策略缺失(404) / origin 不在白名单 / 无 `?embed=1`。
- **验收** 四条全绿连跑 3 次零 flaky；用例 1 断言 `blocked` 数组为空（复用
  `golden-path-2.spec.ts:455-470` 的拦截手法）——**嵌入没有引入任何新的外部请求（C6）**；
  `screenshot` 返回字节 **> 1000** 且解出的宽高与请求一致（**不许只断言「有返回」**）；
  用例 3 断言**第二条命令没有再收到 `denied`**。
- **自测** `pnpm test:e2e embed`
- **变异检验** ① 去掉 transport 的 origin 校验 → 用例 3 红；② 去掉 `?embed=1` 判断 → 用例 4 红；
  ③ `screenshot` 返回一张全透明空图 → 字节数断言必须红（若不红说明断言写在「有没有返回」上，
  要改成像素内容）。

### [ ] T-277 · 对外 API 文档 + 样板宿主页
- **依赖** T-274 · **预估** 1.0d · **实际** —
- **独占** `docs/EMBED_API.md`(新) · `samples/host-demo/index.html`(新) · `README.md`（一行）·
  `docs/DEVELOPMENT.md`（一节）
- **做** 快速开始 + 命令表 + 事件表 + origin 策略配置 + 版本协商说明。
  `packages/player/src/index.ts` 第一行 JSDoc 已写「供任何把播放器嵌进别的页面的人使用」，
  但 package.json 里没有任何字段让这句话可执行——**承诺已写下，调用方从未存在**，本卡兑现它。
- **验收** 一条测试断言 `EMBED_API.md` 第 1 章的代码块与 `samples/host-demo/index.html` 的对应片段
  **逐字相同**（用 `<!-- doc:quickstart:start/end -->` 标记切片）；一条测试断言文档里每个命令名与
  事件名都在 `Object.keys(COMMANDS)` / 事件表里（**反向也要查：注册表里有而文档里没有的也 fail**）；
  样板页零 `http(s)://` 外链。
- **自测** `pnpm -F @w3/core test embed/docs-sync && node scripts/check-no-external.mjs --require-build`
- **变异检验** ① 给 `COMMANDS` 加一个 `foo` 不写文档 → 双向一致性红；
  ② 改样板页里的快速开始片段 → 文档同步红。

### [ ] T-278 · bench 页浏览器级 E2E
- **依赖** T-208 · **预估** 0.6d · **实际** —
- **独占** `e2e/tests/bench.spec.ts`(新) · `packages/player/src/bench/main.ts`（只加 `?fast=1`）
- **做** 四条断言；`?fast=1` 把 `durationMs 6000→600`、ramp 各档 `900/1200→200`。
- **验收** E2E 绿且整条用例 < 30s；报告表行数 ≥ 12 且每行有 `data-verdict`。
- **自测** `pnpm test:e2e bench`
- **变异检验** ① 把软渲警告那段从 `renderReport` 删掉 → 第 3 条红（**保护的是「这段话删不掉，
  是刻意的」这条纪律**）；② 让 `run()` 在解包后直接 return → 第 2 条红。
  **最容易假绿**：只断言「页面上有一个 table」——把 `rows` 换成空数组也会有 table。

### [ ] T-279 · bench 增首屏加载时间、阴影四档与 JSON 报告
- **依赖** T-278 · **预估** 1.0d · **实际** —
- **独占** `packages/player/src/bench/metrics.ts` · `packages/player/src/bench/main.ts` ·
  `packages/player/test/bench-metrics.test.ts` · `docs/BENCHMARK.md`（指标说明段）
- **做** `SHADOW_MODES` 加 `'low'`（**今天是 `['off','medium','high']` 而 schema 的三档是
  low/medium/high —— 测的档必须等于文档能表达的档**）；`gradeLighting` 补 low/medium/high 三行
  ceiling（今天只有 off 与 medium）+ 一行「建议出厂默认档」；新纯函数
  `recommendShadowDefault(levels)`（四种情形单测）；首屏加载时间三段计时 + 合计，`limit` 列写 `—`；
  阴影贴图显存估算行（`castingLights × mapSize² × 4B`）；`toJsonReport()` 与 `toMarkdown()` 同源 +
  「下载 JSON」按钮。
- **验收** 单测 ≥ 40 条全绿；JSON 含 `capability` / `rows` / `scene` / `takenAt` / `machine`；
  bench 页人工跑一次三档 ceiling 都出现。
- **自测** `pnpm -F @w3/player test bench-metrics && pnpm test:e2e bench`
- **变异检验** ① `recommendShadowDefault` 恒返回 `'medium'` → 四条情形至少红三条；
  ② `ceilingFor('high')` 用了 `'medium'` 的数据 → 必须红（**要求测试数据里三档的数字互不相同**，
  否则这条变异是绿的——正是 v0.5 T-184「基准文档恰好已排好序，排序是空操作」的同一个坑）；
  ③ `t_firstFrame` 恒为 0 → 必须红。
- ⚠ 债：阴影三档在 bench 页里测了三档，但**结论行只有 off 与 medium 两条，high 只落在明细里**——
  遗留决议 S3（旧称 H3，见规划 §1）要求的「确定出厂默认档」在现有报告格式下拿不到可比较的第三个数。

### [ ] T-280 · bench 报告回填脚本
- **依赖** T-279 · **预估** 0.8d · **实际** —
- **独占** `scripts/apply-bench-report.mjs`(新) · `docs/附件A_数字资产规范_草案.md` §7 ·
  `docs/BENCHMARK.md`（当前状态段）· `docs/bench-reports/.gitkeep`
- **做** 回填规则逐字；`--check` 模式重生成后逐字节比对；**软渲报告
  （`capability.level === 'software'`）拒绝用于附件A 回填并给出中文原因**；挂进 `pnpm verify`。
- **验收** 用一份人造的 M1/M2/M3 报告跑一次，附件A §7 四行被正确改写且状态列变成
  `[实测] M2 · <代号> · <日期>`；`--check` 绿；把附件A 手改一个字 → `--check` 红。
- **自测** `node scripts/apply-bench-report.mjs docs/bench-reports/*.json && node scripts/apply-bench-report.mjs --check`
- **变异检验** ① 删软渲判定 → 「软渲报告不许进附件A」红；
  ② `--check` 写成「文件存在即通过」→ 手改一个字那条红（**这是本卡最容易假绿的地方，
  `--check` 天生容易写成空转**）。

### [ ] T-281 · 爆炸 / 剖切 benchmark 档位与性能预警
- **依赖** T-243 · T-279 · **预估** 0.5d · **实际** —
- **独占** `packages/player/src/bench/main.ts` · `packages/player/src/bench/metrics.ts` ·
  `docs/BENCHMARK.md`（新章节）
- **做** 两档——「剖切开 / 关的首帧代价」（**shader 重编译，`renderer.info.programs` 的变化也记**，
  T-243 与 T-252 登记的那两条耦合在这里被量化）与「爆炸进行中的稳态帧率」；报告文案照 BENCHMARK.md 体例。
- **验收** bench 页能出这两档数字；软件渲染时同样打「不可作为验收依据」的警告；
  **断言的是形状不是毫秒**（同 `scale.test.ts` 的做法）。
- **自测** `pnpm -F @w3/player test bench-metrics`
- **变异检验** 把首帧代价改成复用上一次的数字 → 需要一条「开 / 关两次得到两组不同数字」的断言
  才抓得到，**必须专门写这条**。

**M17 小计：20 张 / 22.1 人日**

---

## M18 · 样板工程 · 编辑器打磨 · v1.0 出口（T-282 ~ T-296 · T-299）

> 这一段对应产品负责人 A2「**能演示**」那个词。
> ⚠ **样板工程在 v1.0 只做到「爆炸 + 剖切 + 出图 + 动画」**；流程与覆盖层的编排随 v1.2 的 T-328 增补
> （A1 的版本切分决定了这一点，不是遗漏）。黄金路径 III 同理：v1.0 12 步不含 flows/pages，
> v1.2 的黄金路径 IV 才补齐。

### [ ] T-282 ★ · 项目生命周期：新建 / 列表 / 打开 / 重命名 / 删除
- **依赖** T-202 · **预估** 1.7d · **实际** —
- **独占** `packages/editor/src/project/project-lifecycle.ts`(新) · `NewProjectDialog.tsx`(新) ·
  `ProjectListDialog.tsx`(新) · `packages/editor/src/project/session.ts` · `packages/editor/src/main.tsx` ·
  `packages/editor/src/App.tsx`（列 A）· `packages/editor/test/project-lifecycle.test.ts`(新)
- **做** 编辑器**根本没有「新建项目」**，冷启动永远是「恢复最近一份 或 打开泵组样例」；
  `deleteProject` 有接口、两个实现、契约测试，**零业务调用者**；`listProjects` 只有一个调用点。
  「项目管理」在 v0/v0.5 是一组从未被 UI 触达的 API。
  ① `materialiseSample` 的判据改为**内置文档表**（今天硬编码 `projectId === 'prj_a1b2c3d4'`）；
  ② `open()` 用 `replaceDocument(doc, {keepHistory:false})` 并 `loader.dispose()`；
  ③ 顶栏加「项目」按钮（新建 / 列表 / **重命名** / 删除）；
  ③′ **重命名**（拍板项 **P-20**：v1.0 就做完整项目层，含重命名）。
  `ProjectSummary.name` 是从 `document.name` 派生的（`idb-provider.ts:89`），
  **所以重命名不是新增 `StorageProvider` 方法，是改文档的一个字段**——本卡因此
  **不触发新纪律 8 的 provider 三件套**，也不触发铁律 4。两条路径共用同一个纯函数
  `renameProject(doc, name): SceneDocument`：
  **当前打开的工程走 `commit('重命名工程', …)`（落撤销）**，
  列表里对**未打开**的工程走 `loadDocument → renameProject → saveDocument`（不落本端撤销栈，
  因为那份文档的历史不在本端）。空名与纯空白名被输入框挡住，重名允许（`projectId` 才是主键，铁律 3）；
  ④ **把冷启动写成一份显式的 boot 步骤表**（`main.tsx:86-108` 这 20 行在 v1 有四个所有者：
  本卡 · T-288 崩溃恢复横幅 · v1.5 的 provider 探测 · v1.5 的多场景入口场景），
  后续三张卡只允许往表里加步骤、不许重排。
- **验收** `createEmptyDocument` **有生产调用者**（grep 断言）；`deleteProject` 同理；
  新建 → 保存 → 列表里出现 → 打开另一份 → **撤销按钮 disabled 且 `canUndo === false`**，切回来仍如此；
  **两头断言**——切走之前先做一次编辑使 `canUndo === true`，切换后 `canUndo === false`
  （只比较两端的测试对「中间什么都没发生」完全无感）；删除当前打开的工程 → 落到新建对话框不崩；
  **重命名两条路径各一条断言**——改当前打开的工程 → 列表里的名字变了 **且 Ctrl+Z 能改回去**；
  改列表里另一份未打开的工程 → 列表名字变了 **且当前工程的撤销栈深度一格未变**
  （只测前一条时，后一条把别人的编辑塞进本端撤销栈也不会有人知道）；
  全程只经 `StorageProvider`，`packages/editor/src` 里零 `indexedDB` 字样。
- **自测** `pnpm -F @w3/editor test project-lifecycle && pnpm check:constitution`
- **变异检验** ① `keepHistory:false` 改成 `true` → 「切换后 `canUndo === false`」红；
  ② 删 `loader.dispose()` → 「切到另一份工程后视口画的是新工程的几何」红（**需要一条断言渲染器
  手上是什么的测试，不是断言文档**）；
  ③ 把重命名当前工程的 `commit` 换成直接 `saveDocument` → 「Ctrl+Z 能改回去」必须红
  （**只断言「列表里的名字变了」时这次变异是绿的**——两条路径都能让名字变，
  区别只在撤销栈，这是本卡新增那半格最可能假绿的地方）。
- ⚠ 债：`createRuntimeBridge.reload` 与 `DocumentStore.replaceDocument` 都是死代码，且 `SnapshotPanel`
  的注释已把坑写清楚：`keepHistory` 保留上一份文档的撤销栈，Ctrl+Z 重放属于已不存在文档的逆补丁
  会**静默损坏当前文档**。「换文档」在这个仓库里已被踩过一次，那次的结论是绕开它。

### [ ] T-283 · 泵组样板工程文档与冷启动物化
- **依赖** T-222 · T-282 · T-246 · **预估** 1.2d · **实际** —
- **独占** `packages/schema/src/pump-demo.ts`(新) · `packages/schema/test/fixtures/v3/pump-demo.json`(新) ·
  `packages/editor/src/project/session.ts`（仅内置文档表）
- **做** 16 个零件 + 4 条材质 + 内置纹理 + 3 个视点 + 5 个热点 + 一条 imported「拆装」动画 +
  一个爆炸分组 + 一个剖切平面；样例工程的 `projectId` 不再硬编码，走 T-282 的内置文档表。
  **v1.0 版不含 flows / pages**（随 T-328 增补）。
- **验收** `validate` ok + `checkIntegrity(doc, {actionRefs})` 零 error；v3 fixture 自动进
  `fixtures.test.ts` 的三条回归并全绿；从「新建项目 → 泵组拆装样板」进入后**资产被物化、
  `hasBlob(hash)` 为真、发布闸门通过**（这是 v0 栽过的坑，`session.ts:69-91`）。
- **自测** `pnpm -F @w3/schema test && pnpm test:parity`
- **变异检验** ① 删内置文档表里样板那一行 → 「发布闸门通过」必须红；
  ② 把物化步骤改成空操作 → `hasBlob` 那条红（**只断言「文档打开了」不会红**）。

### [ ] T-284 · 泵组样板里的爆炸 + 剖切编排
- **依赖** T-283 · T-246 · T-251 · **预估** 1.0d · **实际** —
- **独占** 样板工程的文档 JSON（`packages/schema/src/pump-demo.ts` 的规则段）与其说明
- **做** 六条规则——开场飞位 / 点泵组三级拆开（`sequence` + `reentry:ignore`）/ 复原 /
  剖开看内部（**零新增动作，`setVisible(剖切面, true)` 就是「打开剖切」**）/ 合上（两条互斥规则
  形成开关）/ **剖面扫掠（tween 的 `targets[].nodeId` 直接指向剖切平面节点，一行新代码都不需要——
  这是「剖切作为第四种承载体」最有说服力的演示）**。
- **验收** 样板 `migrate → validate → checkIntegrity` 零 error；**径向爆炸在真实泵组模型上确实有
  可见效果**（E2E 截图 `colourBuckets` 前后不同）；「剖开 → 合上」两次往返后
  `renderer.clippingPlanes.length` 回到 0。
- **自测** `pnpm -F @w3/schema test fixtures && pnpm test:e2e`
- **变异检验** ① 删样板里的 `explode` 规则 → E2E 那一步必须红；
  ② 把「剖开」改成 `setVisible(剖切面, false)` → 平面数断言红。
- ⚠ **验收现场客户看到的那句中文**：由于剖切不新增动作，自动生成的验收用例措辞会是
  「显示对象「剖切面 A」」。**这一句必须在 T-212 的合同措辞里被产品负责人确认过**，
  否则剖切要多花一张卡（`setSection` 动作 + RefKind 扩容 + 规则编辑器改动）。

### [ ] T-285 · 样板工程能力覆盖体检
- **依赖** T-283 · **预估** 0.6d · **实际** —
- **独占** `packages/core/test/pump-demo-coverage.test.ts`(新)
  ⚠ **文件名不许写成 `pump-demo.test.ts`**：T-222 已在 `packages/core/test/assets/pump-demo.test.ts`
  建了同名文件，两份同包同名会让 G1.0-19 的过滤器 `pump-demo` 同时命中两份，证据面模糊。
- **做** 三条测试 + 两张豁免表（每条豁免必须写理由与到期版本号，走 T-205 的 `readExemptions`）：
  ① 遍历 `allActions()`，断言每个动作都在样板工程里被演示过；
  ② 遍历 `EVENT_TYPES`，同理；
  ③ 遍历 T-205 的「可编辑字段」清单，断言样板工程用到了其中的 N 个（防止样板退化成一堆几何）。
- **验收** 三条在当前注册表下全绿；**反向证明**：临时注册一个假动作 `__probe`（不加豁免）→
  覆盖测试红，删掉即恢复。**这条必须在提交信息里记录，否则这张卡本身就是假绿。**
- **自测** `pnpm -F @w3/core test pump-demo-coverage`
- **变异检验** ① `actionsUsedIn` 改成只看 `rules[].then` → 至少一个只在 `sequence` 嵌套里出现的
  动作必须红；② 豁免表清空 → 必须有若干条红（**证明豁免表真的在生效，而不是遍历本来就是空的**）。
- ⚠ v1.2 加 8 个编排动作 + 3 个新事件时，本卡的三条测试**必须变红**——那正是它存在的意义，
  由 T-329 复跑并把样板补齐。

### [ ] T-286 · `StorageProvider` v2：接口 + facets 声明机制 + 两实现 + 契约扩展
- **依赖** T-202（列 S）· **预估** 1.0d · **实际** —
- **独占** `packages/storage/src/provider.ts` · `memory-provider.ts` · `idb-provider.ts` ·
  `packages/storage/test/contract.ts` · `packages/editor/src/project/session.ts`
- **做** **统一一条扩张纪律：凡是不是所有 provider 都能实现的，一律 optional facet**
  （X-27：一份设计把「零改动既有实现」当作选 facet 方案的最强论据，另两份要求既有实现补方法，
  加起来那条论据就不成立了）。
  ① 加 `DocumentRev` / `Identity` / `DocumentRecord` / `SaveOptions` / `SaveReceipt` /
  `PutBlobOptions` / `Page<T>` / `ProjectRole` / `Lease` / `ProjectMember` / `AuditEntry` 与
  **五个 facet 接口**（`locks` / `members` / `audit` / `revisions` / `assets`，**全是类型，无实现**）；
  ② `readDocument`；`saveDocument` / `putBlob` 加宽（`putBlob` 加 `PutBlobOptions` 允许调用方传入
  已算好的 hash——**HTTP 实现要么把全部字节读进内存再算（大模型不可行），要么让客户端先算好再传**）；
  ③ `StorageError` 加四码 + `retryable` + `userMessage`；
  ④ **`facets: readonly string[]` 显式声明机制**——`MemoryProvider` 声明 `facets: []`，
  契约套件按声明跑子套件（**没有它，「MemoryProvider 悄悄长出 scenes」这类假绿抓不到**）；
  ⑤ `ProjectSession.save()` 里调 `touch(doc)`（接上零调用者——`meta.updatedAt` 自创建后永不前进，
  而 `listProjects` 与 `restoreLastDocument` 都按它排序）。
- **验收** `pnpm -F @w3/storage test` 用例数 73 → 79+；
  `grep -c "saveDocument" packages/editor/src` 与改前相同（证明调用方未被迫改）；
  给 `MemoryProvider` 挂一个空的 `locks` 但不改 `facets` → 契约套件必须 fail。
- **自测** `pnpm -F @w3/storage test && pnpm -F @w3/editor test && pnpm -r typecheck`
- **变异检验** ① `expectedRev` 比较恒真 → 冲突用例红；② `readDocument` 返回 clone 后 mutate →
  「两者相等」红；③ 删 `touch()` → updatedAt 红；④ 给 MemoryProvider 挂空 `locks` →
  `facets:[]` 断言红。
- ⚠ **新纪律 8**：改 `StorageProvider` 形状 = 接口 + 两实现 + 契约测试（三件套）。
  铁律 4 完全覆盖不到这类变更（它不在 `SceneDocument` 里，不 bump `schemaVersion`）。

### [ ] T-287 · 崩溃恢复 · 存储侧（草稿槽 + 会话租约）
- **依赖** T-202 · T-286（同一批文件，列 S 串行）· **预估** 1.2d · **实际** —
- **独占** `packages/storage/src/provider.ts` · `idb-provider.ts` · `memory-provider.ts` ·
  `packages/storage/test/contract.ts` · `packages/storage/test/lease.test.ts`(新)
- **做** 六个方法 + `DraftRecord` / `SessionLease` / `HEARTBEAT_MS` / `LEASE_STALE_MS` /
  `classifyLease` 纯函数；IndexedDB 的 `drafts` 与 `leases` 两个 store **在 T-202 已升到的
  DB_VERSION 2 的 upgrade 事务里落地，不再动版本号**；契约套件加草稿三方法与租约四方法
  （作为 `drafts` facet 声明）。
- **验收** 契约套件两侧同时绿；`classifyLease` 四种判定（self / live-elsewhere / crashed / closed）
  各一条穷举单测，**边界值 `nowMs − heartbeat === staleMs` 明确断言归哪一类**；
  `acquireLease` 在已有活跃租约时返回 `{ok:false, heldBy}` 而**不是抛异常**
  （抛异常会让调用方被迫用 try/catch 表达一个正常分支）。
- **自测** `pnpm -F @w3/storage test`
- **变异检验** ① `classifyLease` 忽略 `closedCleanly` → 「干净退出不算崩溃」红；
  ② `acquireLease` 无条件成功 → 「第二个会话拿不到」红；③ `clearDraft` 空实现 →
  「清后 load 返回 null」红。**⚠ 最容易假绿**：`loadDraft` 返回 `undefined` 而断言写
  `not.toBeNull()` —— **前置断言要断形状（`toBeNull()` 或 `toMatchObject`），不要断「不是 null」。**

### [ ] T-288 · 崩溃恢复 · 编辑器侧（草稿通道 + 崩溃检测 + 三选一横幅）
- **依赖** T-287 · **预估** 1.2d · **实际** —
- **独占** `packages/editor/src/project/autosave.ts` · `useAutoSave.ts` · `packages/editor/src/main.tsx` ·
  `packages/editor/src/App.tsx`（两条横幅，列 A）· `packages/editor/test/autosave-draft.test.ts`(新)
- **做** AutoSaver 草稿通道（`saveDraft → save → clearDraft`）与编辑计数；开机租约判定与心跳；
  崩溃三选一横幅与另一标签页黄横幅；`pagehide` 释放租约；配额错误的中文展示与「清理本地数据」入口；
  DEV-only 的 `__w3SimulateCrash` 与 `?w3LeaseStaleMs=`。**boot 步骤按 T-282 的步骤表插入，不重排。**
- **验收** （AutoSaver 部分全部在纯 Node 里用注入时钟） **顺序断言**——一次 flush 里三个调用的次序是
  `saveDraft, save, clearDraft`；`save` 抛错时 `clearDraft` **未被调用**且状态为 `error`；
  `save` 抛 `quota-exceeded` 时 UI 文案是那句中文而不是 DOMException 文本；写入中再变脏时
  **草稿也被重写**（不能只重写文档）。
- **自测** `pnpm -F @w3/editor test autosave-draft project-session`
- **变异检验** ① 顺序改成 `save → saveDraft` → 顺序断言红；② `save` 失败时仍 `clearDraft` → 第二条红；
  ③ 心跳间隔改成 0 → 需要一条「心跳次数在 N 毫秒内等于 N/HEARTBEAT_MS」的断言，否则绿；
  ④ 崩溃判定恒返回 `'closed'` → 横幅红。

### [ ] T-289 · 崩溃恢复 E2E 三条
- **依赖** T-288 · **预估** 0.6d · **实际** —
- **独占** `e2e/tests/crash-recovery.spec.ts`(新)
- **做** 崩溃 → 提示 → 恢复；干净退出 → **不该提示**；两个标签页 → 黄横幅 → A 的文档没被 B 覆盖。
- **验收** 三条全绿各自 < 30s；第一条断言横幅文案含「多 N 处修改」的**真实数字**（不是写死的字符串）。
- **自测** `pnpm test:e2e crash-recovery`
- **变异检验** ① `classifyLease` 恒 `'closed'` → 第 1、3 条红；② AutoSaver 顺序倒过来 → 第 1 条红；
  ③ 删 `pagehide` 监听 → 第 2 条红。**⚠ 最容易假绿的是第 2 条**：如果它只断言「没有横幅」，
  那么把整个横幅组件删掉也会绿——所以它必须**同时**断言编辑内容还在（正向）**和**横幅不存在（反向）。

### [ ] T-290 · 编辑器交互收口：删除 / 重命名纯函数 + 快捷键表化 + 速查面板
- **依赖** T-224 · T-257（`removal.ts` 同文件）· **预估** 1.9d · **实际** —
- **独占** `packages/editor/src/panels/removal.ts` · `packages/editor/src/panels/HierarchyTree.tsx` ·
  `packages/editor/src/App.tsx`（对话框上提，列 A）· `packages/editor/src/shortcuts/**`(新目录) ·
  `packages/editor/src/shortcuts.ts`（改为 re-export + 查表）· `packages/editor/src/project/useAutoSave.ts` ·
  `packages/editor/src/shortcuts/ShortcutHelp.tsx`(新) · `packages/editor/test/{shortcuts,docs-blocks,clipboard}.test.ts` ·
  `docs/验收材料/用户手册.md`（快捷键节占位）
- **做** （三合一合并卡：三者都改 `HierarchyTree.tsx` + `App.tsx`，且删除入口正是 Delete 快捷键的消费端）
  ① 把 `HierarchyTree.tsx:79-92` 的 `askRemove` 计算部分提成 `describeRemoval(doc, nodeIds)`
  （**纯函数，Node 可测**，与 T-257 共用同一个文件）；确认对话框上提到 `App.tsx` 渲染一次；
  树上的「✕」与 Delete 快捷键都只调 `ui.requestRemoval(describeRemoval(...))`；重命名同理；
  ② `SHORTCUTS` 12 条 + `chordOf` / `renderChord` + 查表式 `handleShortcut` +
  **`Ctrl+S` 迁回表内并删掉 `useAutoSave.ts:63-72` 的第二个 keydown 监听**——
  `Ctrl+S` 今天不住在 `shortcuts.ts` 而在 `useAutoSave.ts` 的第二个监听里，**因此不经过
  `isTypingInto` 文本框守卫**，而 `shortcuts.ts` 的注释恰恰自称是「唯一定义」；
  ③ 三道机械检查；速查面板从 `SHORTCUTS` 渲染、按 group 分组、`?`/`F1` 开、`Esc` 关；
  ④ 生成块机制（`<!-- GENERATED:shortcuts -->` + `UPDATE_DOCS=1` 重写 + 默认比对）。
- **验收** `describeRemoval` 的三种文案（被引用 / 有子树 / 单节点）各一条 Node 单测；
  `grep -c "describeReferences" packages/editor/src` **只命中 `removal.ts` 一处**；
  表内 chord ∪ alias 无重复（重复时报错点名两个 id）；每个 chord 匹配规定正则且修饰键顺序固定；
  表内不含九个浏览器保留键；**`grep -c "addEventListener('keydown'" packages/editor/src` 等于 1**；
  在 `<input>` 里按 `Ctrl+S` **不触发保存**（今天会触发）；`SHORTCUTS` 每个 id 都出现在面板渲染结果里。
- **自测** `pnpm -F @w3/editor test shortcuts removal docs-blocks && pnpm test:e2e golden-path`
- **变异检验** ① `describeRemoval` 在被引用时不带引用描述 → 文案测试红；
  ② 对话框仍留在 `HierarchyTree` 里一份 → grep 断言红（**「只有一处」这条断言本身要写成测试，
  否则重构完两份并存也没人知道**）；③ 把 `save` 从表里删掉 →
  `golden-path.spec.ts:176-192`「Ctrl+S 后状态栏变已保存」必须红（**现成的红灯来源**）；
  ④ `allowInTextField` 恒 true → 「输入框里按 Ctrl+S 不保存」红；⑤ 加第 13 条快捷键但不改面板 →
  面板覆盖那条红；⑥ `UPDATE_DOCS=1` 写成「什么都不做」→ 需要一条「改坏后用 `UPDATE_DOCS` 能修好」
  的断言，否则这条变异绿。

### [ ] T-291 · 目标机器 benchmark 实测手册与三机采集（人工供给项）
- **依赖** T-279 · T-280 · **预估** 0.5d 代码侧 + 人工实测另计 · **实际** —
- **独占** `docs/BENCHMARK.md`（实测手册段）· `docs/bench-reports/**`
- **做** 写一页「拿到机器之后的 30 分钟」：机器代号（M1 主力 / M2 最低配 / M3 关硬件加速）·
  前置检查（`chrome://gpu` 硬件加速是否开）· 每台机器要跑的两个场景 · 每次跑完点「下载 JSON」
  按 `<代号>-<日期>.json` 命名 · 执行回填脚本 · 什么算通过（四条程序性硬门槛 + 商务建议线）。
- **验收** **一个没参与过本项目的人照这页能独立跑完一台机器并产出合规命名的 JSON**；
  三份报告入库后 `apply-bench-report --check` 绿。
- **自测** `node scripts/apply-bench-report.mjs --check` + 人工评审
- **变异检验** 不适用（文档卡）。**替代验收**：找一个没参与的人照做一遍，做不通就是手册的问题。
- ✅ **挂载方式已拍板（P-2，采纳 [ADR-0022](adr/0022-G0.5-8-目标机器-benchmark-的挂载方式.md) 的选项二）**：
  **G0.5-8 不再是 v1 的入口前置**，改挂为 **v1.0 的出口人工验收项 H1**（规划 §7.2，归属 v1.0，
  **不是 G 系列**——机器判据只能核对报告 JSON 入库，核对不了帧率本身）。
  因此：**本卡的人工实测部分归属 v1.0 收尾**，与 T-292 一起在 v1.0 收口前闭合，回填位在附录 D 的 H1 行；
  没拿到机器**不阻塞任何一张 v1.0 编码卡开工**，只阻塞 v1.0 出口。

### [ ] T-292 · 遗留决议 S3 · 阴影三档实测与出厂默认裁决
- **依赖** T-291 · **预估** 0.4d 代码侧 + 人工实测另计 · **实际** —
- **独占** `docs/IMPL_NOTES.md`（S3 记录）· `docs/附件A_数字资产规范_草案.md`（v0.5 增补段）·
  `packages/schema/src/light.ts`（**仅当推荐档 ≠ medium**）· `docs/adr/0038-阴影出厂默认档.md`
  （**本版改号**：原定 0031 已被 [ADR-0031 减面移出 Out of Scope](adr/0031-减面移出-Out-of-Scope.md) 占用）
- **做** 在 M2（最低配）上跑实验设计；结论 + 三档阴影边缘截图写进 IMPL_NOTES；若结论 ≠ `medium`
  则改 `ShadowSchema.quality` 的 `.default()` 并写 ADR（**不 bump schemaVersion**）+ 一条 fixture
  断言老文档的 `quality` 值未被改动。
- **验收** IMPL_NOTES 里有三档的数字与截图；附件A 的 v0.5 增补段写明出厂默认；
  若改了 `.default()`，v1/v2/v3 fixture 全部 `migrate → validate → checkIntegrity` 仍零 error。
- **自测** `pnpm -F @w3/schema test`
- **变异检验** 改 `.default()` 之后跑一遍老 fixture 回归 → **必须仍然绿**（改 default 不该影响历史
  文档）；再故意把迁移函数写成「强制覆盖 quality」→ 那条 fixture 断言必须红。
- ✅ **随 P-2 一起归 v1.0 收尾**：本卡的人工实测部分与 T-291 同属出口人工验收项 H1，
  **不是 v1 的入口前置**。

### [ ] T-293 · 纯进程部署 + 离线安装包
- **依赖** T-221 · T-210 · **预估** 1.8d · **实际** —
- **独占** `deploy/serve.mjs`(新) · `deploy/w3-web.service`(新) · `deploy/install-windows-task.ps1`(新) ·
  `tools/deploy-test/serve.test.mjs`(新) · `scripts/pack-offline.mjs`(新) ·
  `deploy/offline/{载入与启动.md,load.sh,load.ps1}`(新) · `.github/workflows/ci.yml`（offline job 追加）·
  `docs/DEPLOY.md`（纯进程 + 离线两节）
- **做** （合并卡：离线包的 `--verify` 第 3 步就是起 `serve.mjs` 并 curl，分开做会各写一份 MIME 表）
  ① 零依赖 Node 静态服务器 + systemd / Windows 任务模板；
  ② `pack-offline.mjs` 产出物与 `--verify` 九步；CI 的 offline job 追加「打包 → 载入 → 运行 → curl」；
  `载入与启动.md` 给 podman 的等价命令；**镜像内不含 `*.w3p` 的断言**。
- **验收** （全部机器可验证，无浏览器无 Docker 也能跑前半） `/healthz` → 200 `ok`；
  `/player/whatever` → 200 且返回 `/player/index.html` 的内容；`/whatever` → 200 且返回 `/index.html`；
  `.glb` 的 Content-Type 是 `model/gltf-binary`；`/assets/x.js` 带 `immutable`、`.html` 带 `no-cache`；
  **四种穿越路径（`/../../etc/passwd`、`/%2e%2e/%2e%2e/`、含 `\0`、Windows 的 `\..\`）全部 403**；
  **MIME 键集合等于 `deploy/nginx.conf.template` 的 `types` 块列出的扩展名集合**；
  SIGTERM 后端口在 2s 内释放；`node scripts/pack-offline.mjs --verify` 在 CI 上**绿过一次**；
  tar 里含 `image.tar` / `manifest.json` / `SHA256SUMS` / 三份文档脚本。
- **自测** `node --test tools/deploy-test/serve.test.mjs && node scripts/pack-offline.mjs --verify`
- **变异检验** ① 穿越判断改成 `path.includes('..')`（而不是 resolve 后比前缀）→ `%2e%2e` 那条红；
  ② nginx 模板里加一个 `types` 条目不同步 `serve.mjs` → MIME 锁红；
  ③ SPA fallback 对 `/player/` 也返回根 `index.html` → 第 2 条红（**要求两个 index.html 的内容
  可区分**，否则这条变异是绿的）；④ 往 `editor/index.html` 临时插一条
  `<link href="https://fonts.googleapis.com/...">` → 离线包第 7 步必须红
  （**这是 C6 在部署产物上的最后一道复检，它必须真的会响**）；
  ⑤ `SHA256SUMS` 里改一位哈希 → 第 1 步红。

### [ ] T-294 · parity v1.0 全域扩展
- **依赖** T-246 · T-254 · T-265 · T-268 · T-283 · T-240 · **预估** 2.5d · **实际** —
- **独占** `test/parity/parity.test.ts` · `test/parity/event-script.json` ·
  `test/parity/event-script-pump.json`(新) · `packages/core/src/assets/sample.ts` ·
  `packages/editor/src/viewport/runtime-registry.ts` · `e2e/tests/postfx.spec.ts`(新) ·
  `e2e/tests/explode-section.spec.ts`(新)
- **做** （本卡把 7 张原卡对 `parity.test.ts` 的争用一次性解掉，是全表省时最多的一次合并）
  1. **动画**：`parityDocument()` 加一条带区间的 imported 段落 + `playAnimation(await:true)`；
  2. **表现力**：输入文档加雾与一条 outline 高亮规则；轨迹比较加 `highlightOf` 与 `scene.fog` 快照；
  3. **出图**：两侧构造 `SceneRuntime` 时都传一个 `HotspotSpriteLayer`（注入同一个假 canvas 工厂，
     **这在无 GPU 下真能跑**）；每步 tick 后收集 `spriteLayer.ops` 逐项比对；脚本加一步
     `exportImage`，比对两侧 `CaptureResult`（除 blob）；
  4. **爆炸剖切**：输入文档加一个爆炸分组与一个剖切平面；脚本加
     `click → explode(泵组,1,await:true) → setVariable` 与 `click → setVisible(剖切面,true)`；
     DEV 只读探针 `__w3DevSectionPlanes()` 与 `__w3DevPositionOf(nodeId)`（照抄 `__w3DevLightOf`
     的形状与注释纪律）；
  5. **样板工程作为第二份 parity 输入**（`event-script-pump.json`）；
  6. **E2E 两条新 spec**：`postfx.spec.ts`（用既有 `colourBuckets` 断言开雾 / 开描边 / 选中描边
     前后画面确实变了）· `explode-section.spec.ts`（新建剖切面 → 拖 gizmo → 探针返回的法线 / 常数
     变了 → 点击被剖掉的区域断言选中的是后面的对象；设为爆炸分组 → 滑到 1 → `__w3DevPositionOf`
     变了 → 关掉 → 回原位）；
  7. **bench 页增「后处理 off / outline 1 pass / outline 2 pass」三档**，走 `setPostFxEnabled`。
- **验收** `pnpm test:parity` 绿且两侧 `ExecResult` 序列、`spriteLayer.ops` 序列、结束态变量逐项相等；
  **新增五条以上「防空转自检」**——轨迹里必须出现 `playAnimation` / `explode` / `exportImage` /
  `highlight`，`explode` 那条 `endedAt − startedAt ≥ 过渡时长`，`ops` 数 ≥ 1 且含 `openPanel` 之后的
  panel op（**今天 `parity.test.ts:333-338` 只守 `setLight` 与 `playMedia`**）；
  `pnpm size` ≤ 400 KB 且主包增量 < 3 KB；**`packages/player/src` diff 为空**；
  E2E 全绿且 `fullRebuildCount === 0`。
- **自测** `pnpm test:parity && pnpm size && pnpm test:e2e`
- **变异检验** 本卡最重要的产出，四组：
  1. **单边变异**：只把播放器一侧的 `occludedOpacity` 改成 0.5 / `explode` 的 easing 改掉 /
     `highlightOf` 返回值改掉 → parity 三次都必须红（照抄 v0.5「`.w3p` 往返丢 media」的做法）；
  2. **对称变异**：两侧**同时**关掉 outline / 同时把 `occludedOpacity` 改成 0.5 / 单边把
     `ExplodeLayer.update` 改成空操作（**两侧都是 `SceneRuntime`，会对称地错**）→ 双向比较仍绿，
     **必须由自检那几句抓到**。这一点必须写进注释：**双向比较看不见对称的错误**（ADR-0019 的教训逐字）；
  3. **自检本身的变异**：把 `spriteLayer.update` 两侧同时改成空操作 → **自检（ops 非空）必须转红**；
     把 parityDocument 里的动画规则删掉 → 防空转断言必须红；
  4. **E2E 的探针变异**：把 E2E 里的探针换成读文档 → E2E 必须**仍然红**（因为 `setExplode` 从不
     写文档，读文档的断言在功能整个删掉时也成立 —— 与 v0.5 T-176 抓到的 setLight 假绿逐字同形）。

### [ ] T-295 · E2E：出图链路与「图里真的有热点」+ 透明背景边缘实测
- **依赖** T-266 · T-267 · T-268 · T-294 · **预估** 2.0d · **实际** —
- **独占** `e2e/tests/image-export.spec.ts`(新) · `e2e/tests/image-export-alpha.spec.ts`(新) ·
  `docs/IMPL_NOTES.md`（透明背景结论，人工回写）
- **做** ① 编辑器打开黄金路径 II 工程 → 导出对话框 → ×1/PNG/含热点 → 导出 → Playwright download
  事件拿文件 → 解析 PNG IHDR 断言宽高；
  **「图里真的有热点」的不假绿断言（三重）**——先把某个热点的 `style.color` 改成场景里绝不会出现的
  `#ff00ff`；导出**两张**（含热点 / 不含热点）；两张都解回 2D canvas，用 `__w3DevLocate` + projector
  给出的屏幕坐标取 ±3px 小窗；断言含热点那张在窗内存在 `#ff00ff`（容差 ±16/通道）的像素簇
  （≥5 像素）、不含热点那张在**同一坐标**上没有任何接近的像素、且全图 `#ff00ff` 像素数为 0；
  透明背景断四角 `alpha === 0`、模型中心 `alpha === 255`，不透明的断四角 `alpha === 255`；
  还原断言（canvas 宽高回到导出前、`fullRebuildCount` 未变、再点一次对象规则仍触发）；
  播放器侧点配了 `exportImage` 的对象断言 download 触发且文件名匹配 `^设备展台_\d{8}-\d{6}\.png$`；
  ② **观测卡部分**：`premultipliedAlpha` 默认 true 且从未被覆盖，`alpha:true` 无条件开启，
  transparent 时 `clearAlpha=0`——**理论上会出现边缘发灰，但仓库里零观测，连「已登记的未验证」
  都不是**。导出一张透明 PNG（纯白球在透明背景上）→ 沿轮廓采样 200 个像素记录 `(r,g,b,a)` →
  对每个 `0<a<255` 的边缘像素断言 `r/255` 与 `a/255` 的关系（`r≈255` = 非预乘正确；`r≈a` =
  预乘泄漏发灰）→ 结论与采样摘要写进 IMPL_NOTES §2。
- **验收** 全绿连跑 3 次零 flaky；软件渲染分支照 `golden-path-full.spec.ts:373-379` 先关性能提示；
  透明背景那条断言一个**明确的**结论（**不许写 `expect(true)`**）；若结论是「发灰」，
  额外产出一条中文提示接进导出对话框。
- **自测** `pnpm test:e2e image-export image-export-alpha`
- **变异检验** ① `HotspotSpriteLayer.update` 改空操作 → 第 3 步必须红；
  ② 把 sprite 的 x/y 全部 +40px → 「同一坐标」断言必须红（**证明它测的是位置不只是存在**）；
  ③ **把 `scene-runtime.ts:362` 的 `preserveDrawingBuffer` 改成 `false` → 出图 E2E 必须转红**。
  这条同时回答勘察提出的假绿嫌疑：现有 `golden-path-full.spec.ts` 的 `drawImage` 路径在 `false` 下
  可能照样绿，本卡是第一条真正验证这个配置的测试。**若改成 false 之后本 E2E 仍然绿，说明本 E2E
  也是假绿，必须重写而不是放行**；④ 删 `setChromeVisible(false)` → 加一条「导出图里不含网格颜色」
  的断言并确认它转红；⑤ 透明背景那条把阈值方向反过来 → 必须转红。

### [ ] T-296 · 黄金路径 III + SPEC/ADR/IMPL_NOTES 回写 + v1.0 晋级门槛核对
- **依赖** **全部 v1.0 卡** · **预估** 2.5d · **实际** —
- **独占** `e2e/tests/golden-path-3.spec.ts`(新) · `docs/SCHEMA_SPEC.md` · `docs/ECA_SPEC.md` ·
  `docs/IMPL_NOTES.md` · `docs/METRICS.md` · `docs/TASK_BACKLOG_V1.md`（收尾段）·
  `docs/adr/0032-prefab-占位形状.md`(新) · `docs/adr/0033-样板工程资产程序化生成.md`(新)
- **做** ① **黄金路径 III**（12 步，v1.0 版，**逐步逐字见规划 §2.1，两处必须一字不差**：
  新建项目 → 从泵组样板进入 → 导入 Draco → 材质 → 雾 + 描边 → 爆炸与复位 → 剖切与关闭 →
  动画 → 热点 → 出图 → **发布并在 Player 打开** → **断网刷新**）+ **能力入口体检表**。
  ⚠ **「发布」与「Player 打开」合并为第 11 步，第 12 步是断网刷新**——与黄金路径 IV（T-330）
  的末步同形，验收里那句「第 12 步」指的就是它。
  **嵌入 SDK 的跨源握手不在本路径内**（由 T-276 的 `embed.spec.ts` 覆盖），崩溃恢复同理（T-289）；
  两者都进 `pnpm test:e2e`，因此都在 G1.0-1 的范围内。
  缺步骤时照 `golden-path-2.spec.ts:31-45` 的做法在文件头把缺口写清楚，**不许静默跳过**；
  ② **SCHEMA_SPEC 回写**：§1 顶层结构；§2 ID 前缀表加 `ov`/`scn`/`pfb`/`ds`；§4 nodes 加
  `explode`/`explodeOffset`/`section`/`prefabRef`；§6 新增 pages / flows / dataSources / prefabs 四节
  （标注「字段已冻结，消费者在 v1.2 / v1.5」）；**§7「定义但不实现的结构」改写**（照 media 出列
  的写法）并记录 `constraints` 的最终裁决；§9 检查表加 30 行；§10 加 v2→v3 段；
  ③ **ECA_SPEC 回写**：§4.2 新动作（`explode` / `exportImage`）与 `restart` 的新语义（T-253）；
  §6 新 ctx 方法；§9.2 加边界 B18（churn 上限，含 T-204 的实测数字）；
  ④ **IMPL_NOTES 登记 v1.0 的已知盲区**——「prefab 在 v1.0/v1.2 无任何生产写入路径」·
  「parity 仍无 canvas，描边像素与热点 sprite 的渲染器侧行为只由 E2E 保障」·「透明背景边缘行为」
  （T-295 的结论）·「KTX2 内容在 parity 中不可覆盖」·「剖切 × 描边的交互结论」（T-252）；
  ⑤ 两条 ADR；METRICS 记 v1.0 快照与 v3 的体积差值；
  ⑥ **逐条跑 G1.0-1 ~ G1.0-22，每条记命令与输出**（22 条以规划 §7.1 的表行数为准，
  含 G1.0-22 变异检验登记锁，由 T-297 交付）。
- **验收** 12 步全绿连跑 3 次零 flaky，全程 `fullRebuildCount === 0`；能力入口体检表逐条
  `toBeEnabled()`；**第 12 步（断网刷新 Player）**断言**被拦截的请求数 == 0**；SPEC 里出现的每个字段名都能在
  `packages/schema/src/` 里 grep 到；**一条测试断言 `allActions().length === 18` 且与 SPEC 表行数
  一致**（写进 `pnpm verify`）；22 条门槛逐条有证据，**未过的条目不许标绿**，按 v0.5 的先例如实写
  「未过，且原因是什么」。
- **自测** `pnpm verify && pnpm test:e2e && node scripts/check-docs.mjs`
- **变异检验** ① 把能力入口表里某条选择器改成一个必然存在的元素（如 `body`）→ **必须能说明这条
  断言变得毫无约束**（这是本表最容易退化的方式，写进注释）；
  ② 给 `allActions()` 加一个动作不改 SPEC → 动作数断言必须红；
  ③ 把黄金路径 III 的 `fullRebuildCount` 断言从**末尾**挪到中间 → 必须说明它为什么失去意义
  （v0.5 T-115 的教训：断言点全在回落之前，等于没断言）。

### [ ] T-299 · AI provider 插座：接口 + 默认关闭的空实现
- **依赖** T-205 · **预估** 0.2d · **实际** —
- **独占** `packages/core/src/ai/ai-provider.ts`(新) · `packages/core/test/ai/ai-provider.test.ts`(新) ·
  `packages/core/src/index.ts`（一行导出）· `docs/DEAD_EXPORTS_ALLOWLIST.md`（一行）
- **做** 拍板项 **P-18**：**v1 只留插座，不接任何模型，不引任何依赖。**
  ① `AiProvider` 接口——`readonly kind: string` · `readonly enabled: boolean` ·
  `suggest(input: AiSuggestInput, signal?: AbortSignal): Promise<AiSuggestion[]>`（铁律 10：
  返回 Promise 且收 `AbortSignal`）。**形状照 `StorageProvider` 的写法**：一个字都不提模型名、
  厂商名、端点、鉴权；
  ② 唯一实现 `NullAiProvider`：`enabled === false`，`suggest()` 一律
  `throw new Error('AI 能力未启用')`——**不是返回空数组**。返回空数组会让调用方读成
  「问过了，没结果」，那是最难查的一类静默失败；
  ③ `resolveAiProvider(override?: AiProvider): AiProvider` 默认返回 `NullAiProvider`，
  **没有任何读环境变量 / 读配置文件 / 探测端点的分支**；
  ④ 本目录零 `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / 动态 `import(`，
  与 T-209 的 C7 网络原语守卫同批被扫（**插座本身不许有网络能力**，接不接得上是 v2 的事）；
  ⑤ **进 `docs/DEAD_EXPORTS_ALLOWLIST.md` 一行**（T-205 的四列豁免表，四列全填）：
  `symbol: @w3/core#AiProvider` · `reason: AI 能力的唯一插座，v1 只留接口不接模型，第一个消费者在 v2` ·
  `owner: T-299` · `expires: v2`。**没有这一行，T-205 的成员级零调用者守卫会当场把它判红**
  ——这正是本卡不能悄悄留一个「预留接口」的原因。
- **验收** **一条测试证明这个插座存在且默认关闭**，两个断言写在**同一条测试**里：
  `resolveAiProvider().enabled === false`
  **且** `await expect(resolveAiProvider().suggest({kind:'rule', prompt:'x'})).rejects.toThrow('AI 能力未启用')`；
  `grep -rc "fetch\|XMLHttpRequest\|WebSocket\|EventSource" packages/core/src/ai/` 等于 0；
  `node scripts/check-dead-exports.mjs` exit 0 且打印里能看到这条豁免（`E` 计数 +1）；
  `pnpm check:constitution` 绿；`pnpm size` delta ≈ 0（**接口是类型，`NullAiProvider` 是三行**）。
- **自测** `pnpm -F @w3/core test ai-provider && node scripts/check-dead-exports.mjs && pnpm check:constitution`
- **变异检验** ① 把 `NullAiProvider.enabled` 改成 `true` → 「默认关闭」那条必须红；
  ② 把 `suggest()` 从 throw 改成 `return []` → **同一条测试的第二个断言必须红**。
  **这是本卡唯一会假绿的地方**：只写 `enabled === false` 的话，②这次变异是绿的，
  而「插座默认关闭」就退化成一个布尔字段的自证——**布尔字段自证不了任何行为**；
  ③ 删掉豁免表那一行 → `check-dead-exports.mjs` 必须红且点名 `AiProvider`。
- ⚠ **本卡不做任何 AI 功能。** 它存在的唯一理由是：v2 接模型时不必改 `@w3/core` 的公共 API 形状。
  **一个没有 owner、没有到期日的「预留接口」就是下一条死导出**——第 ⑤ 步是本卡与
  「又一条预留了但没人接」之间的全部差别，`expires: v2` 到期时 T-298 的守卫会来收账。

**M18 小计：16 张 / 20.3 人日**

**v1.0 合计：100 张 / 111.0 人日**（T-297 / T-298 是门槛可执行性两张插卡，**T-299 已用于 P-18 的 AI provider 插座；T-2xx 段自此用满**）

---

# 第二部分 · v1.2「编排与复用」（T-300 ~ T-359）

> 目标一句话：**把一串对象变成一条能被讲述的流程。**
> schema 字段在 v1.0 已全部冻结（T-225），本台阶**一个字段都不加**——`schemaVersion` 保持 3。
> 若开工后发现漏字段，**登记 v2，不追加**（A2）。

## M19 · 编排运行时（T-300 ~ T-317）

### [ ] T-300 ★ · `flow-runtime.ts` 纯逻辑
- **依赖** v1.0 收口 · **预估** 1.0d · **实际** —
- **独占** `packages/core/src/runtime/flow-runtime.ts`(新) · `packages/core/test/runtime/flow-runtime.test.ts`(新)
- **做** 五个纯函数（`chainOf` / `progressOf` / `stepAt` / `nextOf` / `prevOf`）+ `createFlowBridge`
  （从 `variableChange` 派生 `flowStepEnter`）。**零 three、零 DOM、零 engine import。**
  `chainOf` 与 `getStepPrev` 复用 T-227 已放在 schema 的实现，**「上一步」的判断只写一次**。
- **验收** `chainOf` 对成环流程**返回截断结果且不死循环**（用 `toHaveLength(2)` 而不是靠测试超时）；
  `progressOf` 对不在链上的步骤返回 `{index:0,total:N}`；`derive` 对 `to === ''`、非步骤字符串、
  非本流程变量各返回 `[]`。
- **自测** `pnpm -F @w3/core test flow-runtime`
- **变异检验** ① 去掉 `seen` 集合 → 环用例红（会超时 → **断言写成长度断言 + `vi.setConfig` 短超时**，
  否则它不是转红是挂住）；② 让 `derive` 对 `to === ''` 也发事件 → 「endFlow 不派生 flowStepEnter」红。

### [ ] T-301 ★ · `page-layer.ts` + `overlay-renderers.ts`
- **依赖** v1.0 收口 · **预估** 1.5d · **实际** —
- **独占** `packages/core/src/runtime/page-layer.ts`(新) · `packages/core/src/runtime/overlay-renderers.ts`(新) ·
  `packages/core/test/runtime/page-layer.test.ts`（纯 Node）· `packages/core/test/runtime/page-dom.test.ts`（jsdom）
- **做** `PageRenderer` 接口、`overlayBox` 与 `interpolate` 两个纯函数、`DomPageRenderer`
  （内联样式、**逐元素 pointerEvents**、`textContent`、image overlay 的 objectURL 建立与撤销）、
  `NullPageRenderer`、`createOverlayRenderers`。
  ⚠ 热点面板**全仓没有一行 CSS**，靠内联样式活着——「pages 复用热点那套样式机制」的假设不成立，
  那套机制不存在，是从零建外观系统（T-264 已把热点侧的规范建好，本卡照它的形状写）。
- **验收** `overlayBox` 对九个 anchor **各一条给出期望数字的断言**（不要断「大于 0」）；
  `interpolate` 对四个占位符 + 一个未知占位符（原样保留）各一条；jsdom 断 button 的
  `style.pointerEvents === 'auto'`、text 的是 `'none'`、根容器是 `'none'`；
  `page-layer.ts` 全文不含 `innerHTML`；隐藏页后 `liveObjectUrls === 0`。
- **自测** `pnpm -F @w3/core test page`
- **变异检验** ① button 的 `pointerEvents` 改成 `'none'` → jsdom 断言红；
  ② `bc` 锚点公式抄成 `bl` 的 → 对应**数字**断言红（**只断言 left 在 0..W 之间就不会红**）。
- ⚠ **播放器缺 `.viewport__overlay > * { pointer-events:auto }`（编辑器有）**。热点标记能点是因为
  `DomHotspotRenderer` 每帧逐个内联写 pointerEvents，**面板从未被写过**——pages 的 button 会在
  播放器里**静默失效**，正是 C3 分叉的教科书形状。本卡是它的一半，另一半在 T-309 / T-315。

### [ ] T-302 · `RefKind` 四项扩容（在 T-203 的注册表上加四行）
- **依赖** T-203 · **预估** 0.4d · **实际** —
- **独占** `packages/core/src/eca/ref-kinds.ts` · `packages/core/src/eca/types.ts`（`RefKind` 段）·
  `packages/schema/src/index-builder.ts`（`flowById`/`pageById`/`stepById`）
- **做** `RefKind` 加 `'flow' | 'step' | 'page' | 'dataSource'`，在 `REF_KINDS` 注册表里**各加一行**；
  `DocIndex` 加 `flowById` / `pageById` / `stepById`（全局，依赖 T-226 的步骤 id 文档级唯一性检查）。
  **`executor.ts` 与规则编辑器的 diff 必须为空**——这正是 T-203 做那次结构改造要买到的东西。
- **验收** `git diff packages/core/src/eca/executor.ts` **为空**；
  `git diff packages/editor/src/rule-editor/` **为空**；`pnpm check:constitution` 绿；
  `refExists(index,'step','已删步骤')` 为 false 且引用它的动作被 skip。
- **自测** `pnpm -F @w3/core test ref-kinds && pnpm check:constitution && pnpm -F @w3/editor test`
- **变异检验** ① `'step'` 那条 `exists` 改成恒 true → 「引用已删步骤的 goToStep 被跳过」红；
  ② **在 `executor.ts` 里手写一个 `case 'step'`（模拟没做 T-203 的世界）→ `check-core-purity`
  必须红**——这条变异证明 T-203 的结构改造真的把扩容从 Q4 降级了，**结果记进提交信息**。

### [ ] T-303 · 编排相关的完整性检查 14 条（接 T-226 的编号）
- **依赖** T-302 · **预估** 1.2d · **实际** —
- **独占** `packages/schema/src/integrity.ts` · `packages/schema/test/integrity-flow-page.test.ts`(新)
- **做** T-226 已落 30 条，本卡补 14 条：flow 链完整性（`startStepId` 存在 / `next` 指向本流程内的
  步骤 / 环检测 warn）· 步骤 id **文档级**唯一（把 I1 的流程内去重升级为文档级）· overlay id 唯一 ·
  overlay 引用（`mediaId` / `flowId` / `bind.variableId`）· `isPageVisible` 条件的 pageId 存在 ·
  编排动作的 refs 悬空 · `overlay.props` 里 URL 类字段的 `javascript:` 拦截（error）。
- **验收** 14 条各一条正例一条反例；`action-refs-gate` 覆盖率仍 100%（新增 8 个动作全部声明 refs）；
  一份含 `javascript:` 的历史文档仍能 `migrate → validate` 成功（C4）。
- **自测** `pnpm -F @w3/schema test integrity`
- **变异检验** ① 把文档级去重改回流程内 → 「跨流程同 id」必须红（**这条最容易写成只测同流程，
  那样改回去也不红**）；② `javascript:` 那条改成 warn → 级别断言红；
  ③ 两条都会对坏的 `flow.variableId` 报错（一个报格式一个报不存在）→ **断言收紧到报错措辞**，
  让两条分得开（照 I4 的先例，防互相掩护）。

### [ ] T-304 · 五个 flow 动作
- **依赖** T-302 · T-300 · **预估** 1.0d · **实际** —
- **独占** `packages/core/src/eca/actions/flow.ts`(新) · `packages/core/test/eca/actions/flow.test.ts`(新) ·
  `packages/core/src/eca/actions/index.ts`（`BUILTIN_ACTIONS` 一行）
- **做** `startFlow` / `goToStep` / `nextStep` / `prevStep` / `endFlow`，五项齐全
  （schema / handler / ui / refs / describe）。**不许新增任何 `RuntimeContext` 方法**——
  五个动作只写变量，落在分诊 Q2；发现需要就停下来报告。
- **验收** 动作总数 **23**（18+5），覆盖率门槛 100%；`nextStep` 在末步且 `wrap:false` 时变量不变
  且有一条 debug；`startFlow` 产生的值序列**恰好是 `['', startStepId]`**。
- **自测** `pnpm -F @w3/core test eca`
- **变异检验** 删 `startFlow` 的第一次写入（写 `''`）→ 「已停在第一步时 startFlow 仍会重新进入」红。
  **这条最容易假绿**：若用例初始状态就是 `''`，删掉那行也照样绿——**用例必须先
  `goToStep(第一步)` 再 `startFlow`。**

### [ ] T-305 · 三个新事件接线（`pageEnter` / `flowStepEnter` / `overlayClick`）
- **依赖** T-300 · T-227 · **预估** 1.2d · **实际** —
- **独占** `packages/core/src/eca/events.ts` · `packages/core/src/eca/types.ts`（`RuntimeEvent` 段）·
  `packages/core/src/eca/conditions.ts`（`isPageVisible`）· `packages/core/src/eca/testgen.ts`（`describeTrigger`）·
  `packages/editor/src/panels/RulePanel.tsx`（`EVENT_LABELS` / `defaultEvent` / `EventTarget`）
- **做** `RuntimeEvent` 三个成员；`triggerMatches` 三个 case；`describeTrigger` 三个 case；
  `RulePanel` 三处（`EVENT_LABELS` 是 `Record<EventType,string>`，**漏填即编译错——利用它**）；
  `EventTarget` 三个分支（`flowStepEnter` 是流程 → 步骤的级联下拉，步骤按 `chainOf` 顺序）。
- **验收** 一条**由 `EVENT_TYPES` 驱动**的表格测试遍历全部 11 个事件类型，每个构造一条规则 +
  一个合成事件，断言 `candidateRules` 返回该规则；`generateTestCases` 对三种新触发各产出一句
  可读中文（**不得是 `default` 分支的「触发规则」**）。
- **自测** `pnpm -F @w3/core test eca && pnpm -F @w3/editor test`
- **变异检验** 删 `triggerMatches` 里 `case 'flowStepEnter'`（落到 `default: return false`）→
  表格测试红。**验证这条变异确实红是本卡的验收项**，因为这个 `default` 是全领域最大的假绿源。
- ⚠ v1.0 遗留：`validate.test.ts:81-84` 有一条断言 `pageEnter`/`flowStepEnter` 必须被 validate
  **拒绝**——它是唯一钉住事件封闭性的断言。T-225 已把它改写成**双向**（新形状被接受 +
  缺字段 / 错前缀被拒），本卡验收时要确认那条改写在。
- ⚠ **T-227 的附件C 事件描述锁必须在本卡上真的变红过**（那把锁的全部价值就在这里），
  由 T-317 复核并记录。

### [ ] T-306 · `FlowBridge` 装配进 `createPlaybackSession`
- **依赖** T-300 · T-305 · T-271 · **预估** 0.5d · **实际** —
- **独占** `packages/core/src/runtime/playback-session.ts` · `packages/core/test/runtime/playback-flow.test.ts`(新)
- **做** `onEvent` 里的派生转发 + `onDocumentChanged` 里的 `setDocument` + `overlayClick(overlayId)` 方法。
- **验收** 一条 **session 级**测试——建一条 `flowStepEnter → setVisible` 规则，
  **通过 `runtime.setVar` 写流程变量**（不是直接 dispatch 事件），断言 `onResult` 收到该规则的
  `ExecResult`；一条自激环测试断言 16 层后 abort + 一条 error；一条「预览中改 `next` 后 `nextStep`
  走新链」。
- **自测** `pnpm -F @w3/core test playback`
- **变异检验** 删掉 `for (const derived of ...)` 那一行 → session 级测试必须红。
  **这条是「零调用者」同形缺陷的唯一防线**（`flow-runtime.test.ts` 全绿而没人调用它）。

### [ ] T-307 · `RuntimeContext` 三方法（`showPage`/`hidePage`/`isPageVisible`）双实现 + 契约
- **依赖** T-301 · T-302 · **预估** 0.8d · **实际** —
- **独占** `packages/core/src/eca/types.ts`（`RuntimeContext` 段，列 T）· `packages/core/src/eca/headless.ts` ·
  `packages/core/src/runtime/scene-runtime.ts`（列 R）· `packages/core/test/eca/runtime-contract.test.ts`
- **做** 三方法双实现；`SceneRuntimeOptions.pageRenderer?`；`resetRuntimeState` 里清空并 `update([])`。
  **`engine.ts` 的 diff 必须为空**（ADR-0018 的 Proxy 已保证，验收时看一眼）。
- **验收** 契约对两个实现跑同一批断言；「对已可见的页再 `showPage` 不发第二次 `pageEnter`」两侧都过；
  「`resetScene` 后 `isPageVisible` 全为 false」两侧都过；`git diff packages/core/src/eca/engine.ts` 为空。
- **自测** `pnpm -F @w3/core test contract`
- **变异检验** **只在 `HeadlessRuntime` 里去掉去重守卫 → 契约测试必须红**
  （这正是契约存在的意义：两侧各自自洽但互相不同）。

### [ ] T-308 · 两个 page 动作 + `isPageVisible` 条件
- **依赖** T-307 · **预估** 0.6d · **实际** —
- **独占** `packages/core/src/eca/actions/page.ts`(新) · `packages/core/test/eca/actions/page.test.ts`(新) ·
  `packages/core/src/eca/actions/index.ts`（一行）
- **做** `showPage`（含 `exclusive`）/ `hidePage`（支持 `all`）两个动作按三文件法注册；
  `isPageVisible` 进条件注册表。**不新增 `RuntimeContext` 方法**——三个方法已在 T-307 落地。
- **验收** 动作总数 **25**；`hidePage('all')` 的 `refs` 返回 `[]`；`showPage` 的 `exclusive:true`
  使其余页全部不可见；条件 `isPageVisible` 进条件注册表且规则编辑器零改动。
- **自测** `pnpm -F @w3/core test eca`
- **变异检验** 让 `hidePage('all')` 也返回一条 `{kind:'page', id:'all'}` →
  「用了 all 的文档完整性零 error」必须红。

### [ ] T-309 · `apply-patch` pages 接线 + 两个宿主装配（pointer-events 收口）
- **依赖** T-301 · T-307 · T-230 · **预估** 0.6d · **实际** —
- **独占** `packages/editor/src/viewport/Viewport.tsx` · `packages/player/src/app.ts`
  （`apply-patch.ts` 的钩子已在 T-230）
- **做** 两个宿主改用 `createOverlayRenderers` 并接 `onActivateOverlay → session.overlayClick`。
  **C3 口径**：`packages/player/src` 的改动只允许出现在 `app.ts` 的装配段，逐行在提交信息里点名。
- **验收** **`packages/player/src` 新增文件数为 0**（`git diff --stat` 只显示 `app.ts` 改动）；
  一条测试断言 `/pages/0/overlays/0/props/text` 的 patch 触发了 `applyPages` 且 `fullRebuildCount`
  保持 0。
- **自测** `pnpm -F @w3/core test apply-patch && pnpm -r build`
- **变异检验** 把 `case 'pages'` 改回裸 `return true` → 上面那条必须红。
  **注意 `fullRebuildCount` 不会替你报警**（它只在路径不认识时才响），**断言必须直接看
  `applyPages` 被调用**。

### [ ] T-310 · FlowPanel
- **依赖** T-304 · T-306 · **预估** 2.0d · **实际** —
- **独占** `packages/editor/src/panels/FlowPanel.tsx`(新) · `packages/editor/test/FlowPanel.test.tsx`(新) ·
  `packages/editor/src/App.tsx`（列 A，与 T-311 串行）
- **做** 流程列表 + 步骤列表（按 `chainOf` 顺序）+ 新增 / 删除 / 上移 / 下移 / 绑定变量 +
  「设为起始步骤」；删除步骤时用 `describeReferences` 列出引用者。**不做流程图画布**（范围防线）。
- **验收** 四种步骤操作（新增 / 删除 / 上移 / 绑变量）各一条测试，断言 `historyDepth` **恰好 +1**
  且一次 `undo` 完全还原；步骤列表按 `chainOf` 顺序渲染（**构造一个数组顺序与链序不同的流程**，
  断言渲染顺序跟链）；删除被引用的步骤时确认文案含引用数。
- **自测** `pnpm -F @w3/editor test FlowPanel`
- **变异检验** 把「新增步骤」拆成两次 commit → `historyDepth +1` 红。
  **⚠ 警告**：`History` 有 **500ms 同标签合并窗口**（v0.5 T-144 复盘明写这条会盖住变异），
  所以两次 commit 的标签必须不同，或测试注入固定时钟。

### [ ] T-311 · PagePanel
- **依赖** T-310（`App.tsx` 串行）· T-309 · **预估** 2.0d · **实际** —
- **独占** `packages/editor/src/panels/PagePanel.tsx`(新) · `packages/editor/test/PagePanel.test.tsx`(新) ·
  `packages/editor/src/App.tsx`（列 A）
- **做** 九宫格锚点选择器 + 尺寸 + 偏移 + 按 type 分支的 props 表单（四支穷尽 switch，
  **判别联合让漏一支即编译错**）。
- **验收** 四种 overlay 各能新建并出现在文档里，id 匹配 `^ov_[0-9a-z]{8}$`；改一个 props 字段 =
  一条撤销；**面板里没有任何 canvas / 拖拽事件监听**（源码级断言，防「顺手做成自由画布」）。
- **自测** `pnpm -F @w3/editor test PagePanel`
- **变异检验** 把新建 overlay 的 id 改成 `String(Date.now())` → id 格式断言红。

### [ ] T-312 · `check-page-scope.mjs`（范围机械防线）
- **依赖** v1.0 收口 · **预估** 0.4d · **实际** —
- **独占** `scripts/check-page-scope.mjs`(新) · `scripts/check-constitution.mjs`（一行）
- **做** 断言 `OVERLAY_TYPES.length === 4`、`OVERLAY_TOKENS.length === 4`、四个 props schema 各自
  key 数 ≤ 5、`page-layer.ts` 源码不含 `innerHTML`、`OverlaySchema` 每一支都调了 `.strict()`。
- **验收** `pnpm check:constitution` 含本项且为绿；手工加第五种 type 后脚本 fail。
- **自测** `node scripts/check-page-scope.mjs`
- **变异检验** 临时把 `OVERLAY_TYPES` 加到 5 项 → 脚本必须 exit 1。
  **这条探针必须真跑一次并把输出贴进提交信息**——一个从没失败过的检查脚本与没有脚本无法区分。

### [ ] T-313 · timer 的 `startOn` 选择器（顺带修同形断链）
- **依赖** T-305 · **预估** 0.5d · **实际** —
- **独占** `packages/editor/src/panels/RulePanel.tsx`（timer 表单段）
- **做** timer 表单加 `startOn` 单选（场景加载后 / 手动）；接一个「手动启动」的调用点
  （复用 `engine.startTimer`，`engine.ts:291`——**不改 engine.ts，只是调用它**）。
- **验收** 新建一条 `startOn:'manual'` 的 timer 规则，预览中不触发；调用后触发。
- **自测** `pnpm -F @w3/editor test`
- **变异检验** 删 `startTimers()` 的 `startOn === 'sceneReady'` 过滤 → 「manual 不自动触发」红。
- ⚠ 登记：`startOn:'manual'` 是**完整断链**（schema 有值、engine 有 public 方法、UI 无控件、
  零调用者），且恰好是 v1.5「手动启停轮询」最自然的落点。

### [ ] T-314 · `ChurnGuard` 在 flows 上的可达性回归
- **依赖** T-204 · T-306 · **预估** 0.5d · **实际** —
- **独占** `packages/core/test/eca/churn-flow.test.ts`(新) · `docs/ECA_SPEC.md` §9.2（B18 补实测数字）
- **做** **本卡的存在理由**：T-204 修的是「跨 await 的变量循环」，而 v1.2 的 flows 把它的可达性
  放大了一个量级——`nextStep` → 变量变 → `flowStepEnter` → 规则 → 可能又 `nextStep`，
  **流程自跳是最容易写出死循环的地方，比 `variableChange` 还容易**。
  造三个样本：① 一条 `flowStepEnter → nextStep` 的自跳流程（同步链，应由 `MAX_CHAIN_DEPTH` 拦）；
  ② 同上但 `then` 里加 `wait(1ms)`（跨 await，应由 `ChurnGuard` 拦）；
  ③ 一条正常的三步流程被用户连点 20 次（**不许误伤**）。
- **验收** 样本 ① 恰好一条「连锁深度超过 16」；样本 ② 恰好一条「1 秒内变化超过」且流程变量停止增长；
  样本 ③ **零告警**；三条的错误措辞逐字断言。
- **自测** `pnpm -F @w3/core test eca`
- **变异检验** ① `CHURN_LIMIT` 改成 `MAX_SAFE_INTEGER` → 样本 ② 红而样本 ① **保持绿**；
  ② `MAX_CHAIN_DEPTH` 改成 `MAX_SAFE_INTEGER` → 反之。
  **两条守卫必须能被分开测出来**——这是 v0.5 T-186「两条守卫互相掩护」的直接对策。

### [ ] T-315 · E2E：流程与页面片段
- **依赖** T-310 · T-311 · T-309 · **预估** 1.5d · **实际** —
- **独占** `e2e/tests/flow-page.spec.ts`(新)
- **做** 一条连续剧本——建流程（3 步）→ 建页（一个 panel 带进度条 + 两个 button）→ 建三条规则
  （`overlayClick→nextStep` / `overlayClick→prevStep` / `flowStepEnter→setVisible`）→ 预览点「下一步」
  断言 DOM 进度文字从「1 / 3」变「2 / 3」且对应对象显隐正确 → **预览中改 overlay 文字，断言视口
  DOM 随之变** → 发布 → 播放器打开 → **在播放器里点同一个按钮，断言同样的进度变化**
  （pointer-events 的捕手）→ 断言只被 overlay 引用的图片显示出来 → 全程 `全量重建 = 0`。
- **验收** 每一步一条断言；`fullRebuildCount === 0` 在**末尾**断言（v0.5 T-115 的教训：
  断言点全在回落之前，等于没断言）。
- **自测** `pnpm test:e2e flow-page`
- **变异检验** 把 `DomPageRenderer` 里 button 的 `pointerEvents` 改成 `'none'` →
  **播放器那一步必须红而编辑器那一步仍绿**（因为编辑器 CSS 兜住了）。
  **这条不对称本身就是断言的价值证明，要写进提交信息。**

### [ ] T-316 · 编排的 parity 增量
- **依赖** T-294 · T-304 · T-308 · **预估** 1.0d · **实际** —
- **独占** `test/parity/parity.test.ts` · `test/parity/event-script.json`
- **做** 脚本加入 `startFlow → nextStep ×2 → prevStep → showPage → overlayClick`
  （`overlayClick` 经 `session.overlayClick` 注入，与 `hotspotClick` 同形）；
  轨迹比较加流程变量与 `isPageVisible` 的快照。
  **T-294 是 parity fixture 的所有者，本卡以「追加步骤」的方式并入，不重排既有步骤**
  （`event-script.json` 是一条脚本，插入位置会改变后续步骤的可比状态）。
- **验收** `pnpm test:parity` 绿且两侧轨迹逐项相等；**防空转自检增两条**——轨迹里必须出现
  `nextStep` 与 `showPage`，且 `startFlow` 之后流程变量非空串。
- **自测** `pnpm test:parity`
- **变异检验** ① 单边把 `nextStep` 的 `wrap` 默认值改掉 → parity 红；
  ② 两侧**同时**把 `showPage` 改成空操作 → 双向比较仍绿，**必须由自检抓到**；
  ③ 把新增的步骤从脚本里删掉 → 防空转断言红。

### [ ] T-317 · 附件C 三把锁在三个新事件上的兑现
- **依赖** T-305 · T-227 · **预估** 0.8d · **实际** —
- **独占** `packages/core/src/eca/testgen-manual.ts`（`CONTRACT_FEATURES` 补编排两项）·
  **`scripts/gen-appendix-c.mjs`(新)** · **`packages/core/test/eca/testgen-coverage.test.ts`(新)** ·
  `docs/验收材料/附件C_验收测试用例.md`（§3 覆盖矩阵重生成）
- **做** **本卡是 T-227 那三把锁的兑现现场**：v1.0 时锁装好了但从未见过一次真实的新增事件。
  ① 复核「事件描述锁」在 T-305 落地过程中**真的红过**（提交信息里有记录），没有就是锁失效，
  必须当场修；② `CONTRACT_FEATURES` 补「流程管理」「覆盖层」两项；③ 重生成覆盖矩阵；
  ④ **交付 `scripts/gen-appendix-c.mjs`（含 `--check`）与 `packages/core/test/eca/testgen-coverage.test.ts`**
  ——**G1.5-8 的两条命令今天在全仓一个都不存在，也不在任何一张卡的独占清单里**，这张卡是它们
  唯一合理的落点（它已经独占附件C 的重生成产物）。`--check` 的形态照抄 `sync-vendor.mjs --check`：
  生成到临时目录 → 与已提交的附件C 逐行比对 → 不一致时列出差异行号并 exit 1。
- **验收** 18+2 项功能每项 ≥ 1 条用例，缺项时报错**点名功能编号与名称**；
  遍历 `EVENT_TYPES`，`describeTrigger` 对每一种返回 ≠ `'触发规则'`；
  每个注册动作出现在 ≥ 1 条生成用例里，或列入 `NOT_IN_SAMPLE` 并带理由与到期版本号。
- **自测** `pnpm -F @w3/core test testgen-coverage && node scripts/gen-appendix-c.mjs --check`
- **变异检验** ① 从 `MANUAL_CASES` 删掉覆盖「流程管理」的那条 → 覆盖锁必须红且点名该功能编号；
  ② 把覆盖锁写成「用例总数 > 0」→ 变异 ① 会绿，**所以断言必须是逐功能的**。

**M19 小计：18 张 / 17.5 人日**

---

## M20 · 动画序列编排增强（T-318 ~ T-322 · T-337 · T-338）

> v1.0 已把动画的**断链与泄漏**清完（T-216 / T-237 / T-253 / T-254）。本段只做**增强**。
> **T-337（相机路径巡游，拍板项 P-19）与 T-338（动画倒放，拍板项 P-6）用的是 v1.2 段的留白位**
> ——插在编号末尾而不是塞进 `T-318 ~ T-322`，是为了不动已经排好的波次与依赖链
> （形状与 M14 的 T-297 / T-298 两张插卡一致）。

### [ ] T-318 · 动画区间播放（运行时 + 双实现 + 契约）
- **依赖** T-237 · **预估** 1.0d · **实际** —
- **独占** `packages/core/src/runtime/animator/clip.ts` · `packages/core/src/eca/headless.ts` ·
  `packages/core/test/runtime/clip.test.ts` · `packages/core/test/runtime-contract.ts`（列 T）
- **做** `ClipPlayer` 计算 `start/end/segS` 并钳定（越界 warn，每个 id 每次会话至多一条）；
  loop 在区间内绕回；`clampWhenFinished` 钉在 `end`；`segS <= 0` 立即完成 + warn（不 reject）；
  `seek` 的相对语义；`HeadlessRuntime.durationMsOf` 从 `clipDurations` 推 `segS`（缺失回落 + debug）；
  契约新增区间用例。
- **验收** 4 秒 clip 的 `[1,3]` 段：await 恰好 2000ms（1999 未 resolve / 2000 已 resolve）；
  `t=0.5s` 时位姿等于整条 clip 在 `1.5s` 的位姿**且不等于**在 `0.5s` 的；loop 时 `t=2.5s` 等于 `1.5s`；
  `seek(0.5)` 落在 clip 的 1.5 秒。
- **自测** `pnpm -F @w3/core test runtime && pnpm -F @w3/core test eca`
- **变异检验** ① `local` 里的 `+ start` 去掉 → 「等于整条 clip 在 1.5s 的位姿」必须红
  （**只断言「完成时刻对」是抓不到的——这是本卡最容易的假绿**）；
  ② loop 的 `% segS` 改成 `% clipDuration` → 绕回红；
  ③ headless 的 `segS` 改回整条时长 → 契约里那条精确毫秒断言在 headless 侧红。

### [ ] T-319 · 动画速度参数（动作 + 双实现 + await 公式）
- **依赖** T-318 · **预估** 0.7d · **实际** —
- **独占** `packages/core/src/eca/actions/animation.ts` · `packages/core/src/runtime/animator/tween.ts` ·
  `animator/clip.ts` · `packages/core/src/runtime/scene-runtime.ts` · `packages/core/src/eca/headless.ts` ·
  `packages/core/src/eca/types.ts` + 对应测试
- **做** `playAnimation` 加 `speed`；`RuntimeContext` 选项袋加 `speed?` 两侧实现；
  `TweenPlayer.play` `durationMs = duration*1000/speed`；`ClipPlayer` 用 speed 缩放；
  **`headless.durationMsOf` 统一走公式（顺带修掉它今天完全无视 imported 文档 speed 的错）**；
  契约新增速度用例。
- **验收** 同一条 1.2 秒 tween，`speed:2` 的 await 恰好 600ms、`speed:0.5` 恰好 2400ms，
  **两个断言在同一条测试里**；imported 的 `speed` 文档值在无参数时生效、有参数时被覆盖；
  `speed:0.01` 被 zod 拒绝，该步 `status:'failed'`。
- **自测** `pnpm -F @w3/core test eca && pnpm -F @w3/core test runtime && pnpm test:parity`
- **变异检验** ① 删 `durationMs` 里的 `/ speed` → 两个速度的断言必须**各自**红
  （只留一个速度的测试会退化成「最终会 resolve」）；
  ② headless 的 speed 换成常数 1 → 契约的 imported 速度用例在 headless 侧红。

### [ ] T-320 · 淡入淡出与 `crossFadeAnimation` 动作
- **依赖** T-319 · **预估** 1.0d · **实际** —
- **独占** `packages/core/src/eca/actions/animation.ts` · `animator/clip.ts` · `scene-runtime.ts` ·
  `packages/core/src/eca/headless.ts` · `packages/core/src/eca/types.ts` ·
  `packages/core/test/eca/actions.test.ts` · `packages/core/test/runtime/clip.test.ts` ·
  `packages/core/test/runtime-contract.ts`
- **做** `playAnimation` 加 `fadeInS`、`stopAnimation` 加 `fadeOutS`；两侧实现（真实侧
  `action.fadeIn/fadeOut` + 到点真停；headless 侧 `clock.schedule` + 到点发事件）；
  新增 `crossFadeAnimation`（`defineAction` 五项齐全，`refs` 带 `expectType:'imported'`）；
  `ANIMATION_ACTIONS` 加一项；`reset:true` 压过 `fadeOutS`、重复 fadeOut 后者胜、
  `resetScene` 硬停不等淡出——三条边界各一条测试。
- **验收** 动作总数 **26**（**这是本卡交付当时的值**；v1.2 出口的终值是 **27**，第 27 个是
  T-337 的 `flyToView`，出口断言在 T-331）；`executor.ts` / `engine.ts` / 规则编辑器组件 diff **为空**（三文件法）；
  动作单测覆盖 100%；淡出中点 `isAnimationPlaying(from) === true`、`t0+d+1ms` 为 false 且事件时刻精确；
  **真实侧** `action.getEffectiveWeight()` 在淡入中点 ∈ (0,1)、终点 ≈ 1；
  混一条 tween 的规则被 `checkIntegrity` 报 error。
- **自测** `pnpm -F @w3/core test eca && pnpm -F @w3/core test runtime && pnpm -F @w3/schema test && pnpm check:constitution`
- **变异检验** 把 `action.fadeIn(d)` 与 `fadeOut(d)` 两行都删掉（只保留延迟停止）→ 权重断言必须红。
  **若只写了 headless 侧断言，这次变异会全绿——本卡最重要的一次变异就是它。**
  ② 拿掉 `expectType` → 生产解析器那条 integrity 红；③ 删 `reset:true` 压过 `fadeOutS` 的分支 →
  对应边界红。

### [ ] T-321 · 动画面板：区间编辑与「按当前区间复制为新段落」
- **依赖** T-318 · T-254 · **预估** 0.5d · **实际** —
- **独占** `packages/editor/src/panels/AnimationPanel.tsx`（区间段）+ 其测试
- **做** imported 行加 `startS` / `endS` 两个数字输入，量程取自 `stats.clipDurations[clipName]`；
  「按当前区间复制为新段落」（一次 commit 一条撤销）。**仍然不做时间轴**：
  区间是两个数字输入 + 一条**只读**位置条，无拖拽刻度、无关键帧、无曲线。
- **验收** 从 UI 事件入口走完「设区间 → 点预览 → 对象只在区间内动」；一次复制 = 撤销栈恰好一条；
  超出 clip 时长的输入被控件挡住；**面板 DOM 里仍不存在任何刻度 / 关键帧元素**（结构断言）。
- **自测** `pnpm -F @w3/editor test AnimationPanel`
- **变异检验** ① 把「复制为新段落」的 commit 改成空操作 → 数量前后对比断言红；
  ② 量程改成写死 `[0, 100]` → 「超出 clip 时长被挡住」红。

### [ ] T-322 · 动画增强的 parity 与契约增量
- **依赖** T-320 · T-316 · T-338 · **预估** 0.7d · **实际** —
- **独占** `test/parity/parity.test.ts`（动画段）· `test/parity/event-script.json`（追加三步）
- **做** 脚本追加 `playAnimation(speed:2, await:true)` → `crossFadeAnimation` →
  **`playAnimation(speed:-1, await:true)`** 三步；轨迹比较加 `isAnimationPlaying` 快照。
  第三步是 T-338 的 parity 落点：**倒放是「同一条 clip 的第二种时间方向」，两个运行时各算一遍
  就是两次分叉机会**，而 headless 侧的 `durationMsOf` 与真实侧的 mixer 是两套完全不同的实现。
- **验收** `pnpm test:parity` 绿；**防空转自检增三条**——轨迹里必须出现 `crossFadeAnimation`，
  带 `speed:2` 的那条规则挂起时长 ≈ `segS/2`，带 `speed:-1` 的那条挂起时长 ≈ `segS`
  **且它的 `positionY` 轨迹与正放那条逐点镜像**（只断挂起时长的话，倒放实现成「正放但等同样久」也绿）。
- **自测** `pnpm test:parity`
- **变异检验** ① 单边把 `speed` 换成 1 → parity 红；
  ② 把追加的三步从脚本里删掉 → 防空转断言红（**不加自检的话，脚本漂成空的也不会有人知道**）；
  ③ **单边**把 `speed:-1` 当成 `speed:1` 处理 → 镜像断言必须红。
- ⚠ **本卡由 W22 移到 W23**：它要覆盖 T-338 的负 speed，而 T-338 在 W22。
  与 T-330 / T-335 / T-336 同波次，独占文件零相交。

### [ ] T-337 · 相机路径巡游：视点间插值飞行 + `flyToView` 动作
- **依赖** T-319 · **预估** 1.0d · **实际** —
- **独占** `packages/core/src/runtime/camera-path.ts`(新) ·
  `packages/core/test/runtime/camera-path.test.ts`(新) ·
  `packages/core/src/runtime/scene-runtime.ts`（列 R）· `packages/core/src/eca/types.ts`（列 T）·
  `packages/core/src/eca/headless.ts`（列 T）· `packages/core/test/runtime-contract.ts`（列 T）·
  `packages/core/src/eca/actions/camera.ts` · `packages/core/src/eca/actions/index.ts`（一行）·
  `packages/core/test/eca/actions.test.ts`
- **做** 拍板项 **P-19**。今天 `moveCamera` 只能飞到**一个**视点（`camera.ts:22`，
  参数 `viewpointId` + `duration`），三个视点连着看就是三条规则各自 await，**接缝在中间停一下**。
  ① **纯函数 `sampleCameraPath(stops, t)`**（`packages/core/src/runtime/camera-path.ts`，
  零 three 依赖、Node 可测）：对 N 个视点的 `position` / `target` 各做 Catmull-Rom
  （首尾端点各重复一次），返回 `{ position, target }`；**N === 2 时退化为线性插值**；
  `t` 钳在 `[0,1]`；stops 少于 2 个时抛中文错；
  ② `SceneRuntime.flyToView(viewpointIds, opts)`：按 `sampleCameraPath` 逐帧驱动相机，
  返回 Promise 并接 `AbortSignal`（铁律 10）；`resetScene` 与 `swapDocument` 必须能中断它；
  ③ `RuntimeContext.flyToView` 双实现（真实侧 + headless 侧，headless 侧只走时钟不动几何）+ 契约用例；
  ④ **动作 `flyToView`（ECA 三文件法）**：`defineAction` 五项齐全，
  参数 `viewpointIds`（`ref[]`，`refKind:'viewpoint'`，至少 1 项）· `duration`（总时长，秒）·
  `await`；`CAMERA_ACTIONS` 加一项。**`executor.ts` / `engine.ts` / 规则编辑器一行不改**。
- **验收** **动作总数 27**（第 27 个就是本卡；出口断言在 T-331）；
  `executor.ts` / `engine.ts` / 规则编辑器组件 diff **为空**（三文件法）；动作单测覆盖 100%；
  **`flyToView` 与 `moveCamera` 的分工写死并被一条测试钉住**——单视点时
  `flyToView([v], {duration:d})` 的逐帧采样与 `moveCamera({viewpointId:v, duration:d})`
  **逐帧相等**（容差 1e-6）。**这条是本卡的承重断言**：不写它，仓库里就有了两份相机插值实现，
  下一次改缓动会只改一处，症状是「用巡游看和用视点按钮看，位置不一样」；
  三个视点、总时长 3 秒：`t=1.5s` 时相机**不在**任何一个视点上（证明是路径不是三段跳）、
  `t=3s` 落在第三个视点（容差 1e-6）、全程 `fullRebuildCount === 0`；
  悬空 `viewpointIds` 被 `checkIntegrity` 报 error（走 T-302 已注册的 `viewpoint` refKind）。
- **自测** `pnpm -F @w3/core test camera-path && pnpm -F @w3/core test eca && pnpm -F @w3/core test runtime && pnpm check:constitution`
- **变异检验** ① 把 Catmull-Rom 换成「按段线性」→ **`t=1.5s` 不在任何视点上**那条**不会红**
  （线性也不在视点上），**必须另加一条断言中间点的切线连续性**（相邻两段在接点的一阶差分之差 < 阈值）
  ——**这是本卡最容易假绿的一处**，先写变异再写断言；
  ② 把单视点退化分支删掉（永远走 Catmull-Rom）→ 「与 `moveCamera` 逐帧相等」必须红；
  ③ 不接 `AbortSignal`（`resetScene` 时不中断）→ 「复位后相机停在复位位姿」必须红；
  ④ 把 `duration` 当成**每段**时长而不是总时长 → `t=3s` 落点那条必须红。
- ⚠ **与 T-317 同波次（W21）**：T-317 的覆盖锁要求「每个注册动作出现在 ≥1 条生成用例里，
  或列入 `NOT_IN_SAMPLE` 并带理由与到期版本号」。**本卡完成后回读一次 T-317 的覆盖锁**，
  `flyToView` 要么进 `MANUAL_CASES`、要么进 `NOT_IN_SAMPLE`——两张卡谁后落地谁负责补，
  锁会自己红，不要靠人记得。

### [ ] T-338 · 动画倒放：负 speed 与倒放时 `startS` / `endS` 的语义
- **依赖** T-318 · T-319 · T-320 · **预估** 1.2d · **实际** —
- **独占** `packages/core/src/eca/actions/animation.ts` · `packages/core/src/runtime/animator/clip.ts` ·
  `packages/core/src/runtime/animator/tween.ts` · `packages/core/src/eca/headless.ts`（列 T）·
  `packages/core/test/runtime-contract.ts`（列 T）· `packages/core/test/runtime/clip.test.ts` ·
  `packages/core/test/eca/actions.test.ts`
- **做** 拍板项 **P-6**。**本卡不加任何字段、不 bump `schemaVersion`**（v1.2 的铁律：
  `schemaVersion` 保持 3）——改的是 `playAnimation.speed` 的**取值域**与 `ClipPlayer` 对
  **已冻结的 `startS` / `endS`** 的**解释**。取值域从 `[0.1, 10]` 放宽为
  `[-10, -0.1] ∪ [0.1, 10]`，`0` 仍被拒。
  **倒放语义一次写死，五条，逐条进 ECA_SPEC（T-331 回写）**：
  ① **`startS` / `endS` 永远是片段边界，不随方向调换**，`startS < endS` 恒成立——
  倒放**不是**把两个字段对调。对调的写法会让同一份文档在正放与倒放下 zod 校验结果不同，
  那是把方向偷偷编码进了区间字段；
  ② `speed < 0` 时**起播位置 = `endS`**，向 `startS` 走；完成条件是 `t <= startS`；
  ③ `loop` 倒放时从 `startS` **绕回 `endS`**；
  ④ `clampWhenFinished` 倒放时**钉在 `startS`**（不是 `endS`）；
  ⑤ **await 时长公式取绝对值**：`durationMs = segS * 1000 / Math.abs(speed)`，
  两侧实现（真实侧 `action.timeScale` + headless 侧 `durationMsOf`）**共用同一个公式函数**。
  `TweenPlayer` 同理：负 speed 从终值走向初值。
  **组合矩阵翻倍**：既有维度是 `{tween, imported} × {整条, 区间} × {loop 开, loop 关} ×
  {clampWhenFinished 开, 关} × {await 真, 假}`，加上方向维度后**全部翻一倍**。
  卡面明确：**不做 2ⁿ 全排**，只补下面 **6 格**，理由是它们各自对应一条上面写死的语义，
  其余格子由既有正放用例 + 公式共用覆盖：
  倒放×区间（起播在 `endS`）· 倒放×loop（绕回方向）· 倒放×clamp（钉在 `startS`）·
  倒放×await（绝对值公式）· 倒放×headless（`durationMsOf`）· 倒放×`isAnimationPlaying`。
- **验收** 6 格各一条测试，**逐格点名它验证的是上面五条语义里的哪一条**（写进测试名）；
  4 秒 clip 的 `[1,3]` 段、`speed:-1`：`t=0.1s` 的位姿等于整条 clip 在 `2.9s` 的位姿
  **且不等于**在 `1.1s` 的（**方向真的反了，不只是「也会结束」**）；await 恰好 2000ms；
  `speed:-2` 恰好 1000ms；`loop` 时 `t=2.5s` 等于 `2.5s` 处绕回后的位姿；
  `clampWhenFinished` 终点位姿等于 `startS` 处；`speed:-0.01` 被 zod 拒绝且该步 `status:'failed'`；
  **一条 v3 fixture 回归断言正放行为逐帧未变**（放宽取值域不许改变任何既有文档的行为）；
  契约套件两侧同时绿。
- **自测** `pnpm -F @w3/core test runtime && pnpm -F @w3/core test eca && pnpm -F @w3/schema test`
- **变异检验** ① **`durationMs` 里的 `Math.abs` 去掉** → await 断言必须红，
  **且 headless 侧那条要单独红**。**这是本卡最可能假绿的一处**：真实侧的 mixer 自己会钳定，
  负时长可能表现为「立即完成」而测试只断言「会 resolve」；headless 侧则是拿负数去
  `clock.schedule`，事件排到「过去」——两种症状完全不同，**所以两侧各要一条独立断言，
  不许只写契约的公共那条**；
  ② `clampWhenFinished` 仍钉 `endS` → 倒放终点位姿断言必须红
  （**只断言「完成事件发了」是抓不到的**）；
  ③ loop 的绕回写成「从 `startS` 绕回 `startS`」→ 绕回断言红；
  ④ 起播位置仍用 `startS` → 「`t=0.1s` 的位姿等于整条 clip 在 `2.9s`」红；
  ⑤ zod 取值域放宽成「`speed !== 0`」（丢掉 `|speed| ≥ 0.1` 下限）→ `speed:-0.01` 被拒那条红。

**M20 小计：7 张 / 6.1 人日**

---

## M21 · 复用机制与 v1.2 出口（T-323 ~ T-336）

### [ ] T-323 ★ · 模板占位符机制 `template-tokens`
- **依赖** v1.0 收口 · **预估** 0.7d · **实际** —
- **独占** `packages/editor/src/lib/template-tokens.ts`(新) · `packages/editor/test/template-tokens.test.ts`(新)
- **做** 三个纯函数与三个正则。深度处理数组 / 对象 / 字符串 / 数字 / 布尔 / null；
  **整串匹配才替换 id**；`@@name:x@@` 作为子串替换任意次；认不出的原样保留并计入 `unresolved`。
- **验收** 嵌套 5 层里数组第 3 元素的 `params.nodeId` 被正确替换；`'前缀@@nd:a@@'` **不**被当 id
  位置替换；`'第@@name:a@@步与@@name:a@@'` 两处都替换；`firstResidualToken` 能找到未解析槽位。
- **自测** `pnpm -F @w3/editor test template-tokens`
- **变异检验** ① 递归限成 1 层 → 嵌套那条红；② 整串匹配改子串 → `'前缀@@nd:a@@'` 那条红；
  ③ `unresolved` 恒空 → 对应红。

### [ ] T-324 · 规则模板数据与 plan/apply
- **依赖** T-323 · **预估** 1.2d · **实际** —
- **独占** `packages/editor/src/lib/rule-templates.ts`(新) · `packages/editor/test/rule-templates.test.ts`(新)
- **做** 类型 + `planRuleTemplate` 十一步 + `applyTemplatePlan` + 六条出厂模板；
  变量 id 用 `uniqueVariableId`（避开既有 id 与 `RESERVED_VARIABLE_IDS`）。
  **`rules[].template` 字段**（T-225 已冻结）在套用时回写，供体检与统计使用——
  **本卡是它唯一的写入者**，若不写就该在 T-206 的裁决表里删掉这个字段。
- **验收** 六条模板每一条：合法绑定 → `plan.ok` → apply 到真实文档 → `validate` ok +
  `checkIntegrity` 零 error + **整份文档** `firstResidualToken === null`；六种问题码各一条；
  **每条模板** `findTokens(creates.map(c=>c.seed))` 的槽位集合 == `binds ∪ creates` 的 key 集合
  （**双向相等**）；`JSON.parse(JSON.stringify(RULE_TEMPLATES))` 深等于原对象；
  同一模板套两次 → 两组记录 id 互不相同、变量退化为 `step2`；`planRuleTemplate` **不修改**传入的 doc
  （深比对前后）；套用后 `rules[i].template` 非空。
- **自测** `pnpm -F @w3/editor test rule-templates`
- **变异检验** ① 删 `applyTemplatePlan` 的 hotspots 分支 → 「新增 1 热点 1 规则」与 `checkIntegrity`
  两条**都**必须红（**若只红一条，说明 checkIntegrity 那条被 I3 掩护，要收紧到报错措辞**）；
  ② 某条模板的 token 拼错一个字母 → `undeclared-slot` 红；③ 删 `expectType` 检查 → `wrong-type` 红；
  ④ 把「整份文档零残留」的断言对象改成「只查产物」→ 构造一条把 token 写进 `hotspot.content.text`
  的模板，必须能看出差别。

### [ ] T-325 · 规则模板对话框与规则面板入口
- **依赖** T-324 · T-313 · **预估** 0.8d · **实际** —
- **独占** `packages/editor/src/panels/RuleTemplateDialog.tsx`(新) ·
  `packages/editor/src/panels/RulePanel.tsx`（仅按钮与挂载点）· `packages/editor/src/styles.css`（仅新增类）
- **做** 「＋ 从模板」按钮 + 模板选择 + 槽位绑定表单（目标节点 / 变量 / 文案）+ 预览将要新增的
  记录数 + 「套用」；套用走 `planRuleTemplate` → `applyTemplatePlan`，**一次 commit**。
- **验收** **一条走到 UI 事件入口的测试**——模拟点「＋ 从模板」→ 选模板 → 选目标 → 点「套用」，
  断言 store 的文档多了对应记录、**撤销栈深度恰好 +1**；未填必填槽位时按钮 disabled；
  `RulePanel.tsx` 的 diff 里不含任何动作表单逻辑改动。
- **自测** `pnpm -F @w3/editor test rule-template-dialog`
- **变异检验** 把 `commit` 换成 `preview` → 撤销栈深度断言必须红。
  **若不红，说明断言的是文档而不是撤销栈**——正是 v0.5 M10 那条「一次粘贴一条 commit 改成逐节点
  提交也不转红」的坑。

### [ ] T-326 · 场景模板数据与从模板建项目
- **依赖** T-323 · T-282 · **预估** 1.0d · **实际** —
- **独占** `packages/editor/src/lib/scene-templates.ts`(新) · `packages/editor/test/scene-templates.test.ts`(新) ·
  `docs/adr/0023-场景模板从-v2-提前到-v1.2.md`(新)
- **做** 类型 + 十步流程 + `empty` / `showcase` 两条模板（`inspection` 归 T-327）；
  资产一律经 `importLibraryItem`。**先写 ADR-0023**：NORTH_STAR §3 把场景模板定在 v2，
  本裁决把它放 v1.2——「代价」与「撤销条件」两栏不许留空。
- **验收** 两条模板各跑一遍完整流程（注入的 `fetch` 从 `packages/editor/public/library/` **真读字节**）：
  `validate` ok + `checkIntegrity` 零 error + **整份文档零残留 token**；`showcase` 引入
  `hdri-daylight` 后 `meta.environment.hdriAssetId` 指向真实 assetId 且 `background.type === 'hdri'`；
  同一模板连建两个项目 → 第二次 `deduplicated === true` 且存储里 blob 数不变；
  内置库 fetch 失败时 `required:false` 的槽位静默跳过、文档仍合法；
  ADR-0023 的两栏非空且 `grep -n '场景模板' docs/NORTH_STAR.md` 只在 v1.2 清单里出现一次。
- **自测** `pnpm -F @w3/editor test scene-templates && node scripts/check-docs.mjs`
- **变异检验** ① 删 `applyHdri` 那一步 → 「`background.type === 'hdri'`」红；
  ② 删 `validate` 闸门 → 故意造一条非法模板，必须有测试看得见（**否则闸门是装饰**）。

### [ ] T-327 · `inspection` 模板（含 flows / pages）
- **依赖** T-326 · T-311 · **预估** 0.4d · **实际** —
- **独占** `packages/editor/src/lib/scene-templates.ts`（仅追加一条）
- **做** 第三条模板 `inspection`：泵组 + 一条 3 步流程 + 一个 page（进度条 + 两个按钮）+
  两条规则模板实例。资产一律经 `importLibraryItem`。
- **验收** 与 T-326 同形（`validate` ok + `checkIntegrity` 零 error + 整份文档零残留 token）；
  额外断言模板产出的 flow 链能被 `chainOf` 完整展开且 T-303 的 14 条编排检查零 error。
- **自测** `pnpm -F @w3/editor test scene-templates`
- **变异检验** ① 删掉模板里的 page 定义 → 「产出含一个 page」断言红；
  ② 把 flow 的 `next` 指向不存在的步骤 → T-303 的链完整性检查必须红（**证明模板产物真的过了体检，
  而不是只过了 `validate`**）。

### [ ] T-328 · 样板工程编排增补：`flowStepEnter` 四步 + 覆盖层进度
- **依赖** T-283 · T-304 · T-308 · T-311 · **预估** 1.0d · **实际** —
- **独占** `packages/schema/src/pump-demo.ts`（flows / pages / 规则段）·
  `packages/schema/test/fixtures/v3/pump-demo.json`
- **做** **X-14 的落点**：`flows[].steps[].onEnter` 裁为**永不实现**，因此样板工程的第 10 步
  「流程 4 步，每步播动画 + 移相机 + 改覆盖层文案」**必须改用 `flowStepEnter` 规则**——
  这会多出 4 条规则，样板工程的规则数与自动生成的验收用例数都随之变化。
  ① 一条 4 步流程 + 4 条 `flowStepEnter` 规则；
  ② 一个 page：panel（进度「N / 4」）+ 两个 button（上一步 / 下一步）+ 一个 image；
  ③ **X-38 的落点**：**黄金路径 IV 第 7 步**「点覆盖层「展开」→ 爆炸到 100%」改用 `overlayClick` 规则。
  （X-38 原文写的是「黄金路径 III 第 3 步」，那是 A1 把 pages 切进 v1.2 **之前**的编号：
  v1.0 的路径 III 里没有任何覆盖层，这一步只可能落在 T-330 的路径 IV 上。）
- **验收** 样板 `migrate → validate → checkIntegrity` 零 error；`chainOf` 展开为 4 步；
  自动生成的验收用例里四条 `flowStepEnter` 各有一句可读中文；`fullRebuildCount === 0`。
- **自测** `pnpm -F @w3/schema test fixtures && pnpm test:e2e`
- **变异检验** ① 删一条 `flowStepEnter` 规则 → 黄金路径 IV 对应那一步必须红；
  ② 把 `onEnter` 数组填上动作（模拟有人以为它能用）→ T-303 的 warn 检查必须报出
  「这些动作不会被执行」。

### [ ] T-329 · 样板工程能力覆盖体检复跑
- **依赖** T-328 · T-320 · **预估** 0.4d · **实际** —
- **独占** `packages/core/test/pump-demo-coverage.test.ts`
- **做** T-285 的三条体检在 v1.2 新增 8 个动作 + 3 个新事件之后**必然变红**——那正是它存在的意义。
  本卡把样板补齐或往豁免表加行（每条带理由与到期版本号）。
- **验收** 三条全绿；豁免表每行三列非空；**26 个动作里被样板演示过的比例 ≥ 80%**，
  未演示的逐条在豁免表里有理由。
- **自测** `pnpm -F @w3/core test pump-demo-coverage`
- **变异检验** 临时注册一个假动作 `__probe`（不加豁免）→ 覆盖测试红，删掉即恢复。
  **本卡还要记录一件事：T-285 在 v1.2 开工时是不是真的红了。** 如果它一直是绿的，
  说明那三条体检从建成起就没有约束力，必须当场重写。

### [ ] T-330 · 黄金路径 IV：流程 + 页面 + 模板的 12 步 E2E
- **依赖** T-315 · T-325 · T-327 · T-328 · **预估** 1.5d · **实际** —
- **独占** `e2e/tests/golden-path-4.spec.ts`(新)
- **做** 12 步（**逐步逐字见规划 §2.2，两处必须一字不差**）：新建项目（从 `inspection` 模板）→
  建流程 → 建页 → 从模板套一条规则 → 预览走三步 → 改 overlay 文案 → 覆盖层按钮触发爆炸 →
  出图 → 发布 → 播放器打开 → 播放器里走完整条流程 → 断网重载仍能走。
  **能力入口体检表在本卡扩到编排与模板两组。**
  **动画区间 / 速度 / `crossFadeAnimation` 不在本路径内**——它们由 T-318 / T-319 / T-320 / T-322
  的契约与 parity 覆盖（规划 §2.2 表末已逐条登记假绿形状）。
- **验收** 12 步全绿连跑 3 次零 flaky，全程 `fullRebuildCount === 0`（**末尾断言**）；
  第 4 步（套用规则模板）断言撤销栈 +1、新增记录数、`checkIntegrity` 零 error；
  能力入口体检表逐条 `toBeEnabled()`；末步断言**被拦截的请求数 == 0**。
- **自测** `pnpm test:e2e golden-path-4`
- **变异检验** ① 把「＋ 从模板」按钮的 onClick 改成空操作 → 第 4 步红；
  ② 把能力入口表里某条选择器改成一个必然存在的元素（如 `body`）→ **必须能说明这条断言变得
  毫无约束**（这是本表最容易退化的方式，写进注释）。

### [ ] T-331 · v1.2 的 SPEC 回写
- **依赖** T-303 · T-308 · T-320 · T-337 · T-338 · **预估** 1.0d · **实际** —
- **独占** `docs/SCHEMA_SPEC.md` · `docs/ECA_SPEC.md`
- ⚠ **本卡由 W22 移到 W23**：它现在依赖 T-338（W22，倒放语义要写进 ECA_SPEC §4.2）与
  T-337（W21，`allActions().length === 27` 要等 `flyToView` 注册完）。留在 W22 就是
  「同波次卡互相依赖」——那不是并行，是一个隐藏的串行。
- **做** **SCHEMA_SPEC**：§6.8 pages / §6.9 flows 从「字段已冻结，消费者在 v1.2」改成正式描述；
  §9 检查表加 14 行。**ECA_SPEC**：§2.1 把 `pageEnter`/`flowStepEnter` 从「v1」改成「✅」并加
  `overlayClick` 及其签字来源；§3.1 载荷键 + §3.2 `isPageVisible`；§4.2 新动作（flow 五个 +
  page 两个 + `crossFadeAnimation` + **`flyToView`**）；§6 新 ctx 方法（含 **`flyToView`**）；
  §9.2 加边界 B15（流程环）/ B16（重复 showPage）/ B17（`startFlow` 的两次写入）；
  **§4.2 的 `playAnimation` 那一行补 T-338 的倒放语义五条**（`startS`/`endS` 不随方向调换 ·
  负 speed 起播于 `endS` · loop 绕回方向 · `clampWhenFinished` 钉 `startS` · await 取 `|speed|`）
  ——**这是已冻结字段的语义补充，不是新字段**，写在 §4.2 而不是 SCHEMA_SPEC。
- **验收** SPEC 里出现的每个字段名都能在 `packages/schema/src/` 里 grep 到；
  `docs/` 里不再有「v0 未实现」字样指向 pages/flows；
  **一条测试断言 `allActions().length === 27` 且与 SPEC 表行数一致**（写进 `pnpm verify`；
  **26 → 27 的那一个是 T-337 的 `flyToView`**，T-338 不加动作）；
  随机抽 5 个字段与源码 diff 为零。
- **自测** `pnpm -r test && node scripts/check-docs.mjs`
- **变异检验** 不适用（文档卡）。**替代**：动作数断言已在 `pnpm verify` 里，
  动作数与 SPEC 表行数不符即 fail；把 SPEC 表删一行 → 必须红。

### [ ] T-332 · v1.2 的 ADR 与 IMPL_NOTES 收尾回写
- **依赖** T-330 · **预估** 0.6d · **实际** —
- **独占** `docs/IMPL_NOTES.md` · `docs/METRICS.md` · `docs/adr/0034-模板占位符机制.md`(新)
- **做** 一条 ADR（ADR-0034 模板占位符机制）。**ADR-0035（X-14 `onEnter` 永不实现）不在本卡**
  ——那条裁决在 v1.0 的 **T-225** 就落进 schema，按铁律 12 必须由 T-225 先写，本卡只在
  IMPL_NOTES 里引用它。IMPL_NOTES 登记 v1.2 的新盲区——「overlay 的像素外观在 parity 中不可观测，
  只由 jsdom + E2E 保障」·「prefab 仍无生产写入路径」；METRICS 记 v1.2 快照与体积差值。
- **验收** ADR-0034 的「代价」「撤销条件」两栏非空；`node scripts/check-docs.mjs` 绿。
- **自测** `node scripts/check-docs.mjs`
- **变异检验** 不适用（纯文档卡）。**替代**：把某条 ADR 的「撤销条件」清空 →
  `check-docs.mjs` 的 ADR 规则必须红（本卡要顺手给该规则补上这一项）。

### [ ] T-333 · v1.2 晋级门槛核对
- **依赖** **全部 v1.2 卡** · **预估** 0.3d · **实际** —
- **独占** `docs/TASK_BACKLOG_V1.md`（v1.2 收尾段）· `docs/METRICS.md`（v1.2 快照）
- **做** 逐条跑 G1.2-1 ~ G1.2-9，每条记命令与输出（9 条以规划 §7.1 的表行数为准，
  含 G1.2-9 豁免表棘轮，由 T-205 交付）。
- **验收** 每条有证据；**未过的条目不许标绿**，如实写「未过，且原因是什么」。
- **自测** `pnpm verify && node scripts/milestone-close.mjs v1.2`
- **变异检验** 不适用（核对卡）。

### [ ] T-334 · `check-backlog-conflicts.mjs`（台账自身的机械守卫）
- **依赖** v1.2 中段 · **预估** 0.5d · **实际** —
- **独占** `scripts/check-backlog-conflicts.mjs`(新) · `scripts/check-constitution.mjs`（一行）
- **做** 「独占文件」这个字段在 v0.5 是人工维护的，v1 有 199 张卡、约 630 个文件声明——
  **靠人核对 38 条冲突这次已经很吃力，下一版会失控**。
  从 `TASK_BACKLOG_V1.md` 解析出「波次 → 卡 → 独占文件」，断言**同一波次内无文件相交**；
  另断言每张卡的七个字段（依赖 / 预估 / 实际 / 独占 / 做 / 验收 / 自测 / 变异检验）都存在；
  **再加一条：附录 B 每一行「波次」列里的每个 `Wn`，必须等于该行承接卡在 §1 波次表里的波次**
  （§1 波次表是唯一真源，附录 B 那一列是派生的；本版起草时 28 行里错了 22 行，
  且全部是「派生列没跟着真源一起改」这一种形状；`T-0xx` 这类 v0 / v0.5 历史卡不参与比对）。
- **验收** 当前台账 PASS；把两张同波次的卡改成声明同一个文件 → FAIL 并点名两张卡与那个文件；
  删掉某张卡的「变异检验」栏 → FAIL 并点名卡号；
  把附录 B 任一行的波次改错一位 → FAIL 并同时打印「附录 B 写的」与「§1 表里的」两个值。
- **自测** `node scripts/check-backlog-conflicts.mjs && pnpm check:constitution`
- **变异检验** 上面两条「临时改 → 必须 FAIL」本身就是探针，**逐条真跑并把输出贴进提交信息**。

### [ ] T-335 · 编排线体积复核与 METRICS 快照
- **依赖** T-330 · **预估** 0.3d · **实际** —
- **独占** `docs/METRICS.md`（v1.2 体积段）
- **做** 跑一次 `pnpm size`，把 v1.0 → v1.2 的 gzip delta 按卡归因（每张卡提交信息里都记了自己的
  delta，本卡只做加总与对账）。
- **验收** `pnpm size` ≤ **400 KB**（A7：口径维持 400，不上调）；加总 delta 与实测差值 < 2 KB
  （**差值大说明有卡没记 delta，要回去补**）。
- **自测** `pnpm build && pnpm size`
- **变异检验** 不适用（度量卡）。**替代**：临时把 `size-budget.json` 改成当前值 −1 KB →
  `pnpm size` 必须 FAIL（验后还原）。

### [ ] T-336 · 中期估算校准回填
- **依赖** T-333 · **预估** 0.3d · **实际** —
- **独占** `docs/TASK_BACKLOG_V1.md`（汇总表三）· `docs/IMPL_NOTES.md`（校准段）
- **做** **本卡的存在理由写在文末汇总表三里**：v0.5 的校准样本只覆盖 0.5~0.8 人日的小卡，
  而 v1 有大量 ≥1.5 人日的大卡完全没有校准数据，1.3× 是**外推不是实测**。
  拿 M14 ~ M21 的实际耗时（尤其是 T-225 / T-235 / T-294 这三张 ≥2.5 人日的卡）回填，
  重算 ≥1.5 人日档的修正系数，据此**修正 v1.5 的全部预估**并写进汇总表。
- **验收** 汇总表三的修正系数由实测得出且注明样本量；若实测系数与 1.3× 相差 > 20%，
  v1.5 的人日合计必须重算一遍并在 IMPL_NOTES 里记录前后对比。
- **自测** 人工核对 + `node scripts/check-docs.mjs`（合计行等于条目之和那条规则）
- **变异检验** 不适用（校准卡）。**替代**：把某个里程碑的合计行改错 1 →
  `check-docs.mjs` 规则 4 必须红。

**M21 小计：14 张 / 10.0 人日**

**v1.2 合计：39 张 / 33.6 人日**（T-337 = 相机路径巡游 · T-338 = 动画倒放，两张都归 **M20**；
**T-339 ~ T-359 留白供插卡**）

---

# 第三部分 · v1.5「合同交付」（T-400 ~ T-459）

> 目标一句话：**从一台开发机上的演示，变成一份能签字的交付。**
> v1.5 的卡在原稿里成熟度低于 v1.0（后端与转码有多处「具体命令由后端卡定义」），此处保留全部
> 必填字段但描述更紧。**schema 仍是 3，一个字段都不加**——v1.5 要用的字段在 T-225 已冻结。

## M22 · 后端地基（T-400 ~ T-412）

### [ ] T-400 ★ · `@w3/server` 包骨架 + 依赖方向守卫认识第六 / 第七个包
- **依赖** T-286 · **预估** 1.0d · **实际** —
- **独占** `packages/server/{package.json,tsconfig.json,src/{main,app,config}.ts}` ·
  `scripts/check-deps-direction.mjs` · `pnpm-workspace.yaml`
- ✅ **`fastify` 已由 [ADR-0030](adr/0030-批准-v1-新增第三方依赖.md) 批准**（MIT，纯 JS，无原生依赖，
  amd64 / arm64 同一份镜像层）。**本卡不再需要停下来问人**，本卡就是它的引入卡；
  `preHandler` 统一鉴权钩子在 T-404。落地纪律照 ADR-0030：精确锁版本、许可证进
  `docs/LICENSES_LIBRARY.md`、断网 job `offline` 的预热 store 同批更新。
- **做** Fastify 骨架、可注入 db / objectStore 的 `createApp()`、zod 解析的 `config.ts`
  （缺环境变量即拒绝启动并打印中文说明）、`/api/v1/health`；`@w3/storage` 加 `./pure` subpath export；
  `ALLOWED_EDGES` **一次加两个包**（`@w3/server` = 第六、`@w3/asset-pipeline` = 第七），
  `DIRS` 同步，注释里就地说明 `@w3/asset-pipeline` 是唯一允许 `node:fs` / `child_process` 的包
  （**两份设计各加一个包、都自称「第六个」，一次加完避免白名单改两处两次**）。
- **验收** `pnpm -F @w3/server test` 起停一次真 app 并 200；`pnpm check:constitution` 绿；
  `ALLOWED_EDGES` 的键数 = 7。
- **自测** `pnpm -F @w3/server test && node scripts/check-deps-direction.mjs`
- **变异检验** 往 `packages/server/src/app.ts` 临时写 `import 'three'` → 守卫必须红
  （**若不红说明第六个包仍在盲区**——`check-deps-direction.mjs` 今天硬编码五个包，
  新增包不会被扫，别的包 import 它也不会被判非法边）。

### [ ] T-401 · SQL 方言层 + 迁移运行器 + `0001_init.sql`
- **依赖** T-400 · **预估** 1.5d · **实际** —
- **独占** `packages/server/src/repo/{dialect,pg,sqlite}.ts` · `packages/server/migrations/**`
- ✅ **`pg` 已由 [ADR-0030](adr/0030-批准-v1-新增第三方依赖.md) 批准**（MIT，纯 JS 实现的 wire protocol
  客户端；另一侧方言走 Node 内置 `node:sqlite`，零依赖）。**本卡不再需要停下来问人**，本卡就是它的引入卡。
  ⚠ **硬约束，不是建议**：**不许安装 `pg-native`**（要系统 `libpq` + node-gyp，会把服务端镜像
  绑死到构建架构，同时撞 v3 的 ARM / 信创目标与 C6 的断网构建）。
  **`pg-native` 出现在任何一份 lockfile 里即视为 ADR-0030 被违反**——本卡顺手加一条 grep 守卫。
- **做** `dialect.ts` 只暴露占位符、`RETURNING` 兼容与时间类型三处差异；迁移运行器按文件名序执行
  并记进 `schema_migrations` 表；`0001_init.sql` 建 users / projects / members / documents /
  revisions / locks / snapshots / audit 八张表，**只用通用 SQL 子集**。
- **验收** 同一套 repo 单测**在 `node:sqlite` 与 `pg` 两个方言上各跑一遍全绿**；一条测试扫
  `migrations/*.sql` **禁止出现 `JSONB|SERIAL|IDENTITY|BOOLEAN|ARRAY|ON CONFLICT|UPSERT|::`
  任何一个字样**（这是「通用 SQL 子集」唯一可机器验证的形态）。
- **自测** `pnpm -F @w3/server test repo`
- **变异检验** ① 把一列改成 `JSONB` → 子集扫描红；② 方言占位符写反 → pg 侧红而 sqlite 侧仍绿
  （**两个方言必须都跑，只跑一个的话方言层等于没有**）。

### [ ] T-402 · `ObjectStore` 抽象 + Fs / S3 实现
- **依赖** T-400 · **预估** 1.0d · **实际** —
- **独占** `packages/server/src/store/{object-store,fs-store,s3-store}.ts`
- **做** `FsObjectStore` 用 `hashToPath` 的两级分片（**从 `@w3/storage/pure` import，不重写**）；
  `S3ObjectStore` 用 `fetch` + 手签 SigV4（**不引任何云 SDK**，C6）。
- **验收** 两实现跑同一套 `describeObjectStoreContract`；`FsObjectStore` 算出的 key 与
  `hashToPath(hash)` **逐字相等**。
- **自测** `pnpm -F @w3/server test store`
- **变异检验** 分片改成一级 → key 相等断言红（**若两边各写一份分片算法，这条变异是绿的**，
  所以必须 import 同一个符号并断言 `toBe`）。

### [ ] T-403 · 认证：scrypt + 不透明会话 + 限速
- **依赖** T-401 · **预估** 1.5d · **实际** —
- **独占** `packages/server/src/auth/**` · `packages/server/src/routes/{auth,users}.ts`
- **做** scrypt 口令哈希（参数进配置）；不透明会话 token 存表、Cookie 只放 token；
  登录 / 登出 / 改口令三条路由 + 按 IP 与按账号两档限速。**不引任何鉴权框架。**
- **验收** `Set-Cookie` 同时含 `HttpOnly` 与 `SameSite=Lax`；**错误口令与不存在用户返回逐字相同的
  响应体与状态码**；6 次失败后第 6 次 429 且带 `Retry-After`；改口令后旧会话 401。
- **自测** `pnpm -F @w3/server test auth`
- **变异检验** ① 去掉 `HttpOnly` → 红；②「用户不存在」改成 404 → 「响应相同」红；
  ③ 限速阈值改 999 → 红。

### [ ] T-404 ★ · 权限：静态表 + 纯函数判定 + 路由全覆盖测试
- **依赖** T-403 · **预估** 1.5d · **实际** —
- **独占** `packages/server/src/authz/**` · `packages/server/src/routes/index.ts`
- **做** `ROUTE_PERMISSIONS` 静态表（路由 → 所需权限）+ 纯函数 `decide(role, permission)`；
  Fastify 的 `preHandler` 统一查表；**鉴权不许下沉到 repo 层**（SQL 里不许出现 role/permission）。
- **验收** ① 枚举 Fastify **实际注册**的全部路由，逐条断言在 `ROUTE_PERMISSIONS` 中出现**恰好一次**；
  ② `路由数 × {viewer,editor,owner,platformAdmin,匿名}` 的矩阵**逐格实跑**并断言状态码；
  ③ 一条测试断言 repo 层**没有任何 SQL 含 role/permission 字样**（鉴权不许下沉）。
- **自测** `pnpm -F @w3/server test authz`
- **变异检验** ① 新增一条不配权限的路由 → 覆盖测试红；② `decide()` 的 viewer 分支改成 allow →
  矩阵红**且红的格子数 == viewer 的写类路由数**（**数字对不上说明矩阵有洞**）。

### [ ] T-405 · 项目 CRUD + 成员 + 分页
- **依赖** T-404 · **预估** 1.5d · **实际** —
- **独占** `packages/server/src/routes/projects.ts` · `packages/server/src/repo/{projects,members}.ts`
- **做** 软删；**游标分页**（游标 = `updated_at|id` 的 base64，避免 OFFSET 深翻页）；
  `projects.updated_at` 用服务端时钟。
- **验收** 分页在 250 条数据上翻完**无重无漏**（断言 id 集合与全量相等）；删掉最后一个 owner → 422；
  软删后 `GET /projects` 不含它、`GET /projects/:id` 404。
- **自测** `pnpm -F @w3/server test projects`
- **变异检验** 游标改成 OFFSET 且在翻页中途插入一条新项目 → 「无重无漏」必须红
  （**不插入新数据的话 OFFSET 也是对的，这条变异会绿**）。

### [ ] T-406 · 场景文档读写：ETag / If-Match / rev / 修订历史
- **依赖** T-405 · T-402 · **预估** 1.5d · **实际** —
- **独占** `packages/server/src/routes/documents.ts` · `packages/server/src/repo/revisions.ts`
- **做** 文档进 ObjectStore；`project_revisions` + 保留策略；**`migrate` + `validate` 只做闸门不改字节**。
- **验收** ① **字节级往返**——上传一份 v2 文档 → `GET` 回来 → `Buffer.equals` 为真；
  ② 缺 `If-Match` → 428；③ 陈旧 `If-Match` → 412 且响应含当前 rev；④ rev 严格单调；
  ⑤ 上传 `projectId` 不匹配 → 422。
- **自测** `pnpm -F @w3/server test documents`
- **变异检验** ① 让服务端在存之前 `JSON.stringify(migrate(doc))` → 字节级往返红；
  ② 把 428 改成「缺 If-Match 就当 `*`」→ ② 红。**这条尤其重要**：如果只在客户端测，
  客户端与服务端会**一致地错**（E18 对称性教训）。
- ⚠ 债：`SceneDocumentSchema` 与 `MetaSchema` 都是 `.strict()` ——「服务端顺手加个 ownerId 到文档上」
  是**硬失败**，且失败点在编辑器打开文档的瞬间。

### [ ] T-407 · 编辑锁（服务端）
- **依赖** T-405 · **预估** 1.0d · **实际** —
- **独占** `packages/server/src/routes/locks.ts` · `packages/server/src/repo/locks.ts`
- **做** `acquire` / `renew` / `release` / `force` 四条路由；锁表用条件 UPDATE
  （`WHERE expires_at < ? OR holder = ?`）保证并发下只有一个赢家；时钟可注入。
- **验收** ① 两个会话**用 `Promise.all` 真并发** `acquire` 同一项目，**恰好一个** 200 一个 409；
  ② TTL 过期后可被他人取得（**时钟注入，不 sleep**）；③ `renew` 用别人的 token → 409；
  ④ `force` 由 viewer 发起 → 403；⑤ 登出连带释放。
- **自测** `pnpm -F @w3/server test locks`
- **变异检验** ① 去掉条件 UPDATE 的 `expires_at < ?` → ② 红；
  ② **把并发用例改成串行调用 → ① 仍绿**（证明串行版本是假绿的，所以必须写并发版，
  **这条观察要写进提交信息**）。

### [ ] T-408 · 资产：项目作用域 blob 端点 + 流式哈希校验
- **依赖** T-406 · **预估** 1.5d · **实际** —
- **独占** `packages/server/src/routes/blobs.ts` · `packages/server/src/repo/blobs.ts`
- **做** `putBlob(bytes) -> hash` 今天**由 provider 自己算哈希**——HTTP 实现要么把全部字节读进内存
  再算（大模型不可行），要么让客户端先算好再传。T-286 已给 `PutBlobOptions` 加了 `expectedHash`，
  本卡服务端**边收边算**并与之比对，不一致 422。
- **验收** 上传 200 MB 流时进程 RSS 增量 < 50 MB（**这条是本卡存在的理由，必须真测**）；
  `expectedHash` 不匹配 → 422 且不落盘；同 hash 重传 → 200 且不重复写。
- **自测** `pnpm -F @w3/server test blobs`
- **变异检验** ① 改成先 `await request.body()` 再算 → 内存断言红；
  ② 删 `expectedHash` 比对 → 422 那条红。

### [ ] T-409 · 快照与发布
- **依赖** T-408 · **预估** 1.5d · **实际** —
- **独占** `packages/server/src/routes/snapshots.ts` · `packages/server/src/repo/snapshots.ts`
- **做** 快照存的是完整文档副本无 diff，`SnapshotSummary` 里连 `publishedBy` 都没有位置——
  本卡补 `publishedBy` / `note` 并接上审计。
- **验收** 发布一次 → 快照可下载且字节与 `packScene` 产物逐位相等；
  `SnapshotSummary` 含 `publishedBy`；越权发布 403。
- **自测** `pnpm -F @w3/server test snapshots`
- **变异检验** 服务端重新打包一次而不是原样存字节 → 「逐位相等」必须红。

### [ ] T-410 · 审计日志
- **依赖** T-404 · **预估** 1.0d · **实际** —
- **独占** `packages/server/src/routes/audit.ts` · `packages/server/src/repo/audit.ts`
- **做** 五类写操作（项目改名 / 成员变更 / 文档保存 / 发布 / 锁强夺）各写一条审计记录；
  审计表**只增不改**；查询走游标分页。
- **验收** 五类写操作各产生恰好一条审计记录；审计表**只增不改**（UPDATE / DELETE 语句扫描断言）；
  查询分页无重无漏。
- **自测** `pnpm -F @w3/server test audit`
- **变异检验** 某类写操作漏记 → 「五类各一条」必须红（**断言必须逐类，写「总数 ≥ 1」时漏一类也绿**）。

### [ ] T-411 ★ · `HttpApiProvider` + 五个 facet 实现 + 错误映射
- **依赖** T-286 · T-403 ~ T-410 · **预估** 2.5d · **实际** —
- **独占** `packages/storage/src/http-api-provider.ts`(新) · `packages/storage/test/http-provider.test.ts`(新)
- **做** 实现 `StorageProvider` 全部必选成员 + 五个 facet；HTTP 状态码 → `StorageError.code` 的
  映射表（**`StorageError` 的四个错误码从未被判别过，消费侧只把 message 塞进 title**——
  本卡是它第一次真正被用上）；`facets` 声明为全五项。
- **验收** 通过与两个本地 provider **同一份契约套件**（含草稿 / 租约 / 配额）；
  错误映射表逐码有一条测试；`packages/core/src` 的 diff **为空**（对照 v1.2 tag）。
- **自测** `pnpm -F @w3/storage test && node scripts/check-core-frozen.mjs`
- **变异检验** ① 把 412 映射成 `unknown` → 冲突分诊那条红；
  ② 声明 `facets` 全五项但漏实现一个方法 → 契约子套件必须红。

### [ ] T-412 ★ · 契约三跑 + facet 子套件 + 真服务器夹具 + `check-core-frozen.mjs`
- **依赖** T-411 · **预估** 1.0d · **实际** —
- **独占** `packages/storage/test/contract-runner.ts` · `scripts/check-core-frozen.mjs`(新) ·
  `scripts/check-constitution.mjs`（一行）
- **做** **G1.5-1 的门槛今天是恒真命题**：「后端接入没有修改 `@w3/core` 一行」被
  `check-deps-direction.mjs` 保证为永真（core 根本不许依赖 storage），**证明力为零**。
  按 **ADR-0026** 换成有证明力的门槛：`check-core-frozen.mjs` 比对
  `git diff --stat v1.2..HEAD -- packages/core/src`，**允许清单式**列出确实需要改动的文件
  （每条带理由与到期版本号），其余为 0；同时断言 `HttpApiProvider` 与两个本地 provider 跑的是
  **同一个 `describeProviderContract` 符号**（`toBe` 断言，不是「都调用了一个叫这名字的函数」）。
- **验收** 契约套件在 Memory / IndexedDb / HttpApi 三侧全绿；`check-core-frozen` 绿且清单为空或每条
  有理由；写 ADR-0026 说明为什么旧门槛证明力为零。
- **自测** `pnpm -F @w3/storage test && node scripts/check-core-frozen.mjs && pnpm check:constitution`
- **变异检验** ① 往 `packages/core/src` 随便加一行注释 → `check-core-frozen` 必须红（探针，验后还原）；
  ② 让 HttpApi 侧跑一份自己抄的契约 → `toBe` 断言必须红
  （**这正是旧门槛失效的同一形状：看起来一样，实际是两份**）。

**M22 小计：13 张 / 18.0 人日**

---

## M23 · 在线模式编辑器（T-413 ~ T-419）

### [ ] T-413 · 编辑器装配点：`storage-factory` + 启动探测 + 单机 / 在线模式
- **依赖** T-411 · **预估** 1.0d · **实际** —
- **独占** `packages/editor/src/project/storage-factory.ts`(新) · `packages/editor/src/main.tsx`
- **做** 按 T-282 定下的 **boot 步骤表**插入一步「provider 探测」，不重排既有步骤；
  `/api/v1/health` 200 → 在线模式，其余 → 单机模式并给中文横幅。
- **验收** `/api` 全 404 时自动落回单机模式且功能不减；`packages/editor/src` 里 provider 构造点
  **恰好一处**（`check-provider-swap.mjs` 的规则 1）。
- **自测** `pnpm -F @w3/editor test storage-factory && pnpm check:constitution`
- **变异检验** ① 在 `App.tsx` 里再 new 一个 provider → 规则 1 必须红；
  ② 探测失败时抛错而不是降级 → 「全 404 仍能用」红。

### [ ] T-414 · 编辑器：登录页 + 项目列表 / 新建 / 重命名 / 删除 / 切换
- **依赖** T-413 · T-282 · **预估** 2.0d · **实际** —
- **独占** `packages/editor/src/project/{LoginDialog,ProjectListDialog}.tsx` ·
  `packages/editor/src/project/project-lifecycle.ts`（在线分支）
- **做** 在 T-282 建好的本地项目生命周期上加在线分支。**注意这不是「本地已有，换个 provider」**：
  `deleteProject` 与 `listProjects` 在 v0/v0.5 是**从未被 UI 触达的 API**，T-282 才第一次接上。
- **验收** 登录 → 列表 → 新建 → 重命名 → 删除全走 `StorageProvider`；
  401 时回登录页且不丢未保存内容；`editor/src` 里零 `fetch(`。
- **自测** `pnpm -F @w3/editor test project-lifecycle && pnpm check:constitution`
- **变异检验** ① 401 时直接 reload → 「不丢未保存内容」红；② 列表改成本地缓存不刷新 →
  「另一端删除后本端列表更新」红。

### [ ] T-415 · 编辑器：编辑锁心跳、只读降级、抢锁、冲突对话框
- **依赖** T-414 · T-288 · **预估** 1.5d · **实际** —
- **独占** `packages/editor/src/project/lock-controller.ts`(新) · `packages/editor/src/App.tsx`（横幅）
- **做** 心跳定时器（`HEARTBEAT_MS`，复用 T-287 的常量）；拿不到锁时整个编辑面切只读；
  「抢锁」按钮 + 中文冲突对话框（显示持有人与最后心跳时间）；`pagehide` 释放。
- **验收** 两个人抢同一个项目 → 后者只读降级并给出中文冲突对话框；心跳停止后 TTL 到期可被抢；
  只读态下所有 commit 入口 disabled（**遍历入口清单断言，不是抽查三个**）。
- **自测** `pnpm -F @w3/editor test lock-controller`
- **变异检验** ① 只读态只 disable 工具栏不 disable 快捷键 → 遍历断言必须红；
  ② 心跳失败后不降级 → 「TTL 到期被抢后本端变只读」红。

### [ ] T-416 · 错误分诊与中文文案
- **依赖** T-411 · **预估** 1.0d · **实际** —
- **独占** `packages/editor/src/lib/error-messages.ts`(新) + 其测试
- **做** `StorageError.code` → 中文 `userMessage` 的穷尽映射（`Record<StorageErrorCode, string>`，
  **漏一个即编译错**）；消费侧不再把 message 直接塞进 title。
- **验收** 每个 code 一条测试断言文案；`grep -rn "err.message" packages/editor/src` 在错误展示路径上
  零命中。
- **自测** `pnpm -F @w3/editor test error-messages`
- **变异检验** 给 `StorageErrorCode` 加一个成员不改映射 → **必须编译错**（用 `@ts-expect-error` 钉住）。

### [ ] T-417 · 双 provider E2E 轴 + CI job `offline-single-user` + E2E 清理 helper
- **依赖** T-414 · T-415 · **预估** 1.5d · **实际** —
- **独占** `e2e/helpers/reset-storage.ts`(新) · `e2e/playwright.config.ts`（projects 轴）·
  `.github/workflows/ci.yml`
- **做** E2E 六个 spec 硬编码 `indexedDB.deleteDatabase('w3-editor')`、DB_NAME 字符串被复制七份——
  T-202 已把常量导出，本卡把清理逻辑收成一个 helper 并**按 provider 分派**
  （**切 provider 后前置清理静默变 no-op，测试仍绿但清的已不是被测系统在用的东西**）；
  ② **新增 CI job，job 名逐字为 `offline-single-user`**（`.github/workflows/ci.yml` 今天只有一个
  job `verify`，`offline` 由 T-210 加）：起前端**不起后端**，断言 `/api/**` 全 404，
  跑 E2E 的 `local` 轴。**这个 job 名是 G1.5-13 的全部实现**——没有它，那条门槛就是一句空话，
  且 T-207 规则 6 (e)「`CI job <name>` 必须在 `ci.yml` 里存在」落地当天必红。
- **验收** 同一套 E2E 在 `local` 与 `http` 两个 project 上各跑一遍全绿；
  `grep -c "deleteDatabase" e2e/` **为 1**（只在 helper 里）；
  **`.github/workflows/ci.yml` 里能 grep 到 `offline-single-user` 这个 job 且它在 CI 上绿过一次**，
  该 job 内 `/api` 全 404 时 `local` 轴不减一条用例。
- **自测** `pnpm test:e2e --project=local && pnpm test:e2e --project=http`
- **变异检验** ① 把 helper 的 http 分支改成空操作 → `http` 轴上「新建项目后列表只有一条」必须红
  （**若不红，说明清理从来没起过作用**）；
  ② 在 `offline-single-user` job 里把后端也起起来 → 「`/api` 全 404」那条断言必须红
  （**否则这个 job 与 `verify` 没有区别，「单机版没退化」就没有被证明**）。

### [ ] T-418 · 部署三件套 + nginx `/api` 反代 + 注释纠正
- **依赖** T-400 · T-221 · **预估** 1.5d · **实际** —
- **独占** `deploy/nginx.conf.template` · `Dockerfile` · `docs/DEPLOY.md`（v1.5 段）
- **做** nginx 模板加 `/api` 反代块（`proxy_pass` 指向内网地址，注释写明怎么改）；
  Dockerfile 分前后端两阶段；**纠正 vite.config 那条「由 sync-vendor.mjs 拷进构建输出」的错误注释**
  （T-220 若保留 vendor，此处一并写清它服务于哪种形态）。
- **验收** `check-deploy-headers.mjs` 扩两条：`/api` 块存在且 `proxy_pass` 指向内网地址；
  前端产物里**不含任何绝对 API 地址**（`check-no-external` 覆盖）。
- **自测** `node scripts/check-deploy-headers.mjs && node scripts/check-no-external.mjs --require-build`
- **变异检验** 在前端写死一个 `https://api.example.com` → `check-no-external` 必须红
  （**含模板字符串的那种写法也要红**——T-209 已收窄逃逸口，本卡复核）。

### [ ] T-419 · v1.5 部署形态升级（前后端两服务）
- **依赖** T-418 · **预估** 1.0d · **实际** —
- **独占** `deploy/docker-compose.yml`(新) · `scripts/pack-offline.mjs`（三容器）· `docs/DEPLOY.md`
- **做** `docker-compose.yml` 三服务（web / api / db）+ 健康检查 + 启动顺序；
  `pack-offline.mjs` 的 `--verify` 从单容器扩到三容器。
- **验收** CI job `offline`（由 **T-210** 建）扩展到三容器（web / api / db）并绿过一次；
  **三种部署形态各自被验证过一次（云托管 / 离线 tar / 纯进程），逐形态在 `docs/DEPLOY.md` 里
  留一条验收记录（命令 + 输出 + 日期）**——这是 G1.5-7 的全部证据面，**不另起 CI job 名**。
- **自测** `node scripts/pack-offline.mjs --verify`
- **变异检验** 把 db 容器的健康检查删掉 → `--verify` 必须在 api 起不来时失败
  （**不是超时挂住，是明确报错**）。

**M23 小计：7 张 / 9.5 人日**

---

## M24 · 服务端资产转码（T-420 ~ T-426）

### [ ] T-420 · 服务端资产转码（Draco）异步作业
- **依赖** T-408 · **预估** 2.0d · **实际** —
- **独占** `packages/server/src/jobs/**`
- ✅ **ADR 前置已闭合**：`sharp: false` 的处置与 `meshoptimizer` / `draco3dgltf` 的引入
  **已由 [ADR-0030](adr/0030-批准-v1-新增第三方依赖.md)（P-15）与
  [ADR-0031](adr/0031-减面移出-Out-of-Scope.md)（P-14 / P-17）一次裁完**，**本卡不再需要停下来问人**。
- **做** `pnpm-workspace.yaml` 的 allowBuilds 里 `sharp: false`，注释写「我们在浏览器里跑
  gltf-transform（C6：无服务端 GPU / 原生步骤）」——**「上传即转码」要么改这个开关（引原生依赖 +
  跨架构构建，直接撞 v3 的 ARM / 信创），要么改用不依赖 sharp 的路径**。本卡走后者：
  `@gltf-transform/functions` **已在 package.json 躺了一个版本周期、零 import**，不用新引依赖。
  ⚠ **范围已被 P-14 收窄**：本条转码线的产出**只有两项——Draco 几何压缩（必做）+ 可选减面
  （默认关闭）**，两者都是纯 WASM。**KTX2 服务端编码不做**（Khronos `ktx` 原生二进制 +
  amd64 单架构，与 `sharp: false` 是同一把尺子）。原 T-423 已随之改写为减面卡。
- **验收** 作业队列在进程重启后不丢任务；同一 blob 重复提交幂等；`sharp` 仍为 `false`（守卫断言）；
  **作业类型枚举里没有任何 KTX2 / basis 字样**（grep 断言——防「先留个枚举值，反正不实现」）。
- **自测** `pnpm -F @w3/server test jobs`
- **变异检验** 把 `sharp: false` 改成 true → 守卫必须红（**这条守卫要在本卡建起来**）。

### [ ] T-421 ★ · `AssetPipeline` 接口与假实现
- **依赖** T-225 · **预估** 0.6d · **实际** —
- **独占** `packages/core/src/assets/pipeline-contract.ts`(新) · 其测试
- **做** `AssetPipeline` 接口（`ingest(bytes, opts) -> {hash, origin}`）+ 假实现（原样返回并填
  `origin.hash = hash`）+ 契约套件。**接口先行、假实现先行**，让 T-424 的编辑器侧能在真实现之前开工。
- **验收** 假实现跑通契约；`AssetPipeline` 是 optional facet（T-286 的纪律）。
- **自测** `pnpm -F @w3/core test pipeline-contract`
- **变异检验** 把假实现的 `ingest` 改成原样返回 → 契约里「`origin` 被填」必须红。

### [ ] T-422 ★ · `@w3/asset-pipeline` 新包：转码编排与保序契约
- **依赖** T-217 · T-218 · T-421 · **预估** 1.8d · **实际** —
- **独占** `packages/asset-pipeline/**`(新，**`src/simplify.ts` 除外——那是 T-423 的**)
- ✅ **`meshoptimizer` 已由 [ADR-0030](adr/0030-批准-v1-新增第三方依赖.md) 批准**（MIT，
  WASM base64 内嵌 + JS API，无原生构建步骤）。本卡是它的落地卡：写进
  `packages/asset-pipeline/package.json` 并精确锁版本，**消费者是 T-423**。
  ⚠ ADR-0030 的边界逐字照抄：**引入本包不等于支持 `EXT_meshopt_compression` 的输入**
  ——`meshopt` 压缩的送检件仍然拒收（附件A §1 只允许 Draco）。**我们用它做简化，不用它做解码。**
- **做** **内容哈希是对上传原始字节算的，转码会当场破坏三条不变量**：url 解析
  （`pathToHash → getBlob`）、去重语义（`hasBlob`）、`.w3p` 打包
  （`files[asset.url] = blobs.get(asset.hash)`）。本包用 `asset.origin.hash` 记原件、
  `asset.hash` 记产物，三处调用点改读 `origin?.hash ?? hash`。
- **验收** **转码前后 `indexObjects` 键集合逐项相等**，且保序自检**内建在生产代码里**（不只在测试里）；
  三条不变量各一条回归。
- **自测** `pnpm -F @w3/asset-pipeline test`
- **变异检验** ① 打乱一个 mesh 的顺序 → 保序自检必须在**生产路径**上抛错（把自检只放测试里的话，
  真实转码出错时没人知道）；② 去重键改回 `hash` → 「同一原件两次上传只存一份」红。

### [ ] T-423 · 可选减面档位（`MeshoptSimplifier`，默认关闭）
- **依赖** T-422 · **预估** 1.0d · **实际** —
- **独占** `packages/asset-pipeline/src/simplify.ts`(新) · 其测试
- ⚠ **本卡是原「KTX2 编码（`KtxEncoder` 抽象 + 逐槽位 OETF）」的改写件，不是新增卡。**
  拍板项 **P-14 不做 KTX2 服务端转码**（Khronos `ktx` 是原生二进制 + amd64 单架构，
  撞 `sharp: false` 的既有决定与 v3 的 ARM / 信创目标）；拍板项 **P-17** 把「减面」
  显式移出 Out of Scope 清单。两条裁决逐字见 [ADR-0031](adr/0031-减面移出-Out-of-Scope.md)，
  其中「台账侧的连带处置」一段点名了本卡。原卡 1.5d → 现 1.0d，**差额 0.5d 是真省下来的**：
  没有子进程管理、没有 CLI 存在性探测、没有逐槽位 OETF、没有渲染侧 `texture.colorSpace` 断言。
  **KTX2 的解码路径（T-219）不受影响，不许一起砍**——读 KTX2 与生成 KTX2 是两件事。
- **做** ① `simplifyGlb(doc, { ratio, error })`：把 `MeshoptSimplifier`（ADR-0030 已批，
  纯 WASM）注入 `@gltf-transform/functions` 的 `simplify()` 算子；
  ② **档位默认关闭**（v1 规划 §1.3「减面默认档位 = 默认关闭」）：转码档位枚举是
  `原样 / 几何压缩 / 几何压缩+减面`，**第三档要用户显式选**；
  ③ **算子白名单**：本卡只允许 `simplify()`，**明令不许接 `join()` / `dedup()` / `weld()` 改名类算子**
  ——ADR-0031 第 2 节写死了理由：那一类算子是「保数量、改名字」，
  **数量断言看不见它们，`indexObjects` 键集合断言看得见**，而键就是稳定 id（C9）；
  ④ 面数变化（送检 / 处理后）写进 `AssetOrigin`，由 T-260 已建好的双列报告呈现。
- **验收** **减面前后 `indexObjects` 键集合逐项相等**（复用 T-422 已建的保序契约，
  **本卡是它第一个真正会改几何的调用方**）；默认档位下 `simplify()` **一次都没被调用**
  （spy 断言，不是断言「结果和输入一样」——原样返回也可能是算子跑了但没效果）；
  显式选第三档时三角面数下降且键集合仍逐项相等；WASM 初始化失败时给中文错并**降级为原件**
  （不 fail 整批）；`packages/asset-pipeline/src` 里零 `child_process` / 零 `ktx` 字样（grep 断言）。
- **自测** `pnpm -F @w3/asset-pipeline test simplify`
- **变异检验** ① 把默认档位改成第三档 → 「默认档位下 `simplify()` 一次都没被调用」必须红
  （**这是本卡最关键的一条**：减面是有损且不可逆的，默认开会在某一天变成「我们的模型细节没了」
  而没人记得系统动过手）；
  ② 在算子链里插一个 `join()` → **保序契约必须红**。若绿，说明契约根本没读键集合，
  **要先修契约再继续，不许放宽契约**（ADR-0031 的撤销条件逐字写了这一条）；
  ③ 把 WASM 初始化失败的降级分支改成抛错 → 「降级为原件」那条红。

### [ ] T-424 · 导入流程接上 `ingest`
- **依赖** T-259 · T-421 · **预估** 1.2d · **实际** —
- **独占** `packages/editor/src/panels/ImportDialog.tsx`（转码档位段）· `packages/editor/src/lib/library.ts`
- **做** `ImportDialog`（T-259 已建）加「转码档位」选择器
  （**原样 / 几何压缩 / 几何压缩+减面**——**三档，第三档默认不选中**）。
  ⚠ **原稿第三档写的是「几何+贴图压缩」，那半句已随 P-14 出局**：贴图压缩就是 KTX2 服务端生成，
  ADR-0031 已裁不做。**档位文案与 T-423 的枚举逐字一致**，两处不许各写一份；
  在线模式走 `provider.assets.ingest`，单机模式走假实现（原样）。**两条路径共用同一个调用点。**
- **验收** 在线模式下导入 → `asset.origin` 被填且体检报告显示「送检 / 处理后」两列（T-260 已建好该列）；
  单机模式下 `origin` 缺席且报告只有一列。
- **自测** `pnpm -F @w3/editor test import-flow`
- **变异检验** 单机模式也填 `origin` → 「只有一列」必须红。

### [ ] T-425 · 后端 ingest 端点与幂等表 + `HttpApiProvider.assets`
- **依赖** T-422 · T-423 · T-424 · T-411 · **预估** 1.5d · **实际** —
- **独占** `packages/server/src/routes/ingest.ts` · `packages/storage/src/http-api-provider.ts`（assets facet）
- **做** `POST /api/v1/projects/:id/assets/ingest` + 幂等表（`origin_hash` 唯一索引）；
  `HttpApiProvider` 实现 `assets` facet 并声明进 `facets`。
- **验收** 同一原件重复 ingest 幂等（返回同一 `origin.hash`）；转码失败时资产仍可用（降级为原件）。
- **自测** `pnpm -F @w3/server test ingest && pnpm -F @w3/storage test`
- **变异检验** 删幂等表 → 「重复 ingest 只产生一条作业」必须红。

### [ ] T-426 · 转码回归、parity 与盲区登记
- **依赖** T-424 · T-425 · **预估** 1.0d · **实际** —
- **独占** `test/parity/parity.test.ts`（资产段）· `docs/IMPL_NOTES.md`
- **做** parity 用一份转码后的资产跑一遍；IMPL_NOTES 登记盲区。**本卡不新增功能，只补证据。**
- **验收** parity 用一份转码后的资产跑一遍，两侧 `indexObjects` 与轨迹逐项相等；
  IMPL_NOTES 登记「KTX2 内容在 parity 中不可覆盖」这条盲区。
- **自测** `pnpm test:parity`
- **变异检验** 单边用未转码资产 → parity 必须红（**若绿，说明 parity 根本没读资产内容**，
  要补一条断言 `indexObjects` 键集合）。

**M24 小计：7 张 / 9.1 人日**（P-14 砍掉 KTX2 服务端编码，T-423 改写为减面卡：1.5d → 1.0d）

---

## M25 · 多场景与 `goToScene`（T-427 ~ T-440）

> **A3(c) 的落点**：文档里只有 `sceneId` 与 `variables[].scope` 两个活字段（T-225 已冻结），
> **没有 `sceneRefs` 顶层集合**；场景的枚举与加载全部走 `StorageProvider` 的 `scenes` facet。
> **A3(b) 的落点**：`scene` **不进 `RefKind`**，走 `FieldRefKind = RefKind | 'scene'` + 宿主注入
> `sources`，`goToScene.refs()` 返回 `[]`。硬理由：`integrity.ts` 的 `sets['scene'] === undefined`
> 会把每条 `goToScene` 报成 error 并**阻断发布**。

### [ ] T-427 ★ · `StorageProvider` 的 `scenes` facet + `MemoryProvider` + 契约套件
- **依赖** T-225 · T-286 · **预估** 1.0d · **实际** —
- **独占** `packages/storage/src/provider.ts`（scenes facet）· `memory-provider.ts` · `packages/storage/test/contract.ts`
- **做** 七个方法作为 **optional facet**（不是必选组——T-286 定下的扩张纪律）；
  `ProjectSummary` 扩展 + `SceneSummary` + `Snapshot.documents`。
- **验收** 契约子套件按 `facets` 声明跑；`MemoryProvider` 声明 `facets: ['scenes']` 后子套件全绿；
  未声明时子套件被跳过且**打印一条「已跳过」**（不是静默）。
- **自测** `pnpm -F @w3/storage test`
- **变异检验** 给 `MemoryProvider` 实现了 scenes 但不声明 → 子套件被跳过 → **必须有一条元测试
  断言「实现了却没声明」会 fail**（否则「悄悄长出 scenes」这类假绿抓不到）。

### [ ] T-428 · `IndexedDbProvider` 的 `scenes` store
- **依赖** T-427（列 S）· **预估** 1.5d · **实际** —
- **独占** `packages/storage/src/idb-provider.ts` · `packages/storage/test/idb-upgrade.test.ts`
- **做** **不动 `DB_VERSION`**——`scenes` store 已由 T-202 在版本 2 的 upgrade 事务里建好，
  本卡只填实现与索引使用。若确需升到 3，**必须回到 ADR-0027 追加一行并说明为什么**。
- **验收** 一份 v1 库 → 打开 → `scenes` store 存在且旧数据一条不少；`byProject` 索引查询正确；
  `DB_VERSION` 仍为 2（源码断言）。
- **自测** `pnpm -F @w3/storage test`
- **变异检验** 把 `DB_VERSION` 改成 3 而不改 ADR → 需要一条守卫测试断言「版本号与 ADR-0027 记录一致」
  才抓得到，**本卡要把这条守卫建起来**。

### [ ] T-429 ★ · `SceneSource` 接口 + `SceneRuntime.swapDocument` 清场
- **依赖** T-255 · T-256 · T-237 · **预估** 2.0d · **实际** —
- **独占** `packages/core/src/runtime/scene-source.ts`(新) · `packages/core/src/runtime/scene-runtime.ts`（列 R）·
  `packages/core/test/runtime/swap-document.test.ts`(新)
- **做** `PlaybackSession` **已具备安全换文档的全部机制**（generation 计数器、`engine.detach` 清 timer
  与在途规则、闭包 document 可经 `onDocumentChanged` 更新），**只是没有任何代码走过
  `stop → onDocumentChanged → start` 这条序列**——一条已建成、从未通电的线路。本卡给它通电。
  清场顺序：`clips.clearMixers()` → `explode.reset()` → `section.dispose()` →
  `loader.retainOnly(新文档资产)` → `materials.retainOnly(新文档节点)` → `textures.retainOnly` →
  `graph.build(新文档)`。
- **验收** 连续 swap 20 次，`mixerCount` / `cloneCount` / `renderer.info.memory.textures` 均不随次数增长；
  swap 后旧文档的节点不再被驱动（断旧对象 y 不变）；swap 中途抛错时运行时仍可用（不半死）。
- **自测** `pnpm -F @w3/core test swap-document`
- **变异检验** ① 漏掉 `retainOnly` 中的任意一个 → 对应计数器的「不增长」断言必须红
  （**三个计数器要分别断言，写「内存没涨」抓不到是哪一个漏了**）；
  ② 把清场顺序里的 `graph.build` 提到最前 → 「旧对象不再被驱动」红。

### [ ] T-430 · `PlaybackSession.goToScene` + 切换编排
- **依赖** T-429 · T-271 · **预估** 1.5d · **实际** —
- **独占** `packages/core/src/runtime/playback-session.ts` · `packages/core/test/runtime/goto-scene.test.ts`(新)
- **做** `goToScene(sceneId)`：`stop()` → `sceneSource.load(sceneId)` → `onDocumentChanged` →
  `swapDocument` → `start()`；切换期间到达的事件按 generation 计数器丢弃；失败时回原场景。
- **验收** `stop → onDocumentChanged → start` 序列被真正走过（spy 断言三步顺序）；
  切换期间到达的事件被丢弃且计数为 0；切换失败时回到原场景并给中文错。
- **自测** `pnpm -F @w3/core test goto-scene`
- **变异检验** 把 `engine.detach()` 删掉 → 「切换期间旧场景的 timer 不再触发」必须红。

### [ ] T-431 · `goToScene` 动作注册（三文件法）
- **依赖** T-430 · **预估** 0.5d · **实际** —
- **独占** `packages/core/src/eca/actions/scene.ts` · 其测试
- **做** **`refs()` 返回 `[]`**（A3(b)：scene 不进 RefKind）；`ui` 字段声明 `fieldRefKind: 'scene'`
  供规则编辑器从宿主注入的 sources 取选项。
- **验收** 动作总数 **27**，覆盖率 100%；一份含 `goToScene` 的文档 `checkIntegrity` **零 error**
  （**这是本卡最关键的一条**：若 `refs()` 返回 `[{kind:'scene'}]`，`sets['scene'] === undefined`
  会把它报成 error 并阻断发布）；`executor.ts` / `engine.ts` / 规则编辑器 diff 为空。
- **自测** `pnpm -F @w3/core test eca && pnpm -F @w3/schema test integrity`
- **变异检验** 把 `refs()` 改成返回 `[{kind:'scene', id}]` → **`checkIntegrity` 零 error 那条必须红**。
  这条变异是 A3(b) 裁决的可执行证据，**结果必须贴进提交信息**。

### [ ] T-432 · `FieldRefKind` + 规则编辑器可注入 `refSources`
- **依赖** T-431 · T-203 · **预估** 1.0d · **实际** —
- **独占** `packages/editor/src/rule-editor/ActionFields.tsx` · `packages/editor/src/rule-editor/RuleEditor.tsx`
  （props 透传）· 其测试
- **做** `FieldRefKind = RefKind | 'scene'`；`ActionFields` 加 `refSources?: Partial<Record<FieldRefKind, Option[]>>`，
  宿主（编辑器）注入场景列表。**`packages/core` 的 diff 为空**——这是 A3(b) 的全部意义：
  文档外引用的解析责任在宿主，不在引擎。
- **验收** 规则编辑器里 `goToScene` 的目标下拉能列出同项目的其余场景；未注入时下拉为空并显示
  中文提示（不是崩溃）；`git diff packages/core/src` 为空。
- **自测** `pnpm -F @w3/editor test rule-editor && node scripts/check-core-frozen.mjs`
- **变异检验** 把 `refSources` 改成从 `doc` 里读 → `check-core-frozen` 不会红，
  但**必须有一条测试断言「文档里没有场景列表」**（构造一个 `sceneRefs` 不存在的文档，
  断言下拉仍能填满）——否则这条设计裁决在代码里没有落点。

### [ ] T-433 · 多场景 `.w3p` 打包 / 解包 + `createPackageSceneSource`
- **依赖** T-233 · T-429 · **预估** 1.5d · **实际** —
- **独占** `packages/storage/src/package.ts` · `packages/storage/test/package-multi.test.ts`(新)
- **做** manifest 的 `entrySceneId` / `scenes`（T-233 已冻结形状）真正写入与读取；
  `createPackageSceneSource(bytes)` 按需解出第 N 个场景。
- **验收** 三场景包 → 打开后只解入口场景（**断言解压调用次数为 1**）→ `goToScene` 后为 2；
  单场景老包仍能打开（T-233 的 fixture 回归）。
- **自测** `pnpm -F @w3/storage test package`
- **变异检验** 改成一次性解全部 → 「解压调用次数为 1」必须红（**按需加载是本卡的全部卖点，
  只断言「能打开」测不出来**）。

### [ ] T-434 · 编辑器场景列表 UI
- **依赖** T-427 · T-428 · T-282 · **预估** 2.0d · **实际** —
- **独占** `packages/editor/src/panels/SceneListPanel.tsx`(新，**注意不叫 `ScenePanel.tsx`——
  那个名字在 v1.0 被效果面板占用过，已按 X-44 改名为 `SceneEffectsPanel.tsx`；两者语义无关**)·
  `packages/editor/src/main.tsx`（boot 步骤表加一步「打开入口场景」）· 其测试
- **做** 新建 / 重命名 / 删除 / 设为入口 / 拖拽排序 / 切换。
  **boot 改为打开项目的入口场景而不是 `updatedAt` 最新的文档**——`restoreLastDocument` 是
  「取 updatedAt 最新的那一个」，一旦一个项目有多份文档，它变成「打开最近改过的那个场景」，
  而这从未被当作产品决策做过。按 T-282 的 boot 步骤表插入，不重排。
- **验收** 新建第二个场景 → 列表出现 → 切换 → 撤销栈重置（`canUndo === false`，两头断言）；
  删除入口场景时强制先改入口（不留悬空 `entrySceneId`）。
- **自测** `pnpm -F @w3/editor test scene-list`
- **变异检验** ① 切换场景时 `keepHistory:true` → 「切换后 canUndo === false」红；
  ② boot 仍按 updatedAt → 「打开的是入口场景」红。

### [ ] T-435 · 播放器接线 + 加载中 / 失败浮层（零新增源文件）
- **依赖** T-433 · T-430 · **预估** 0.8d · **实际** —
- **独占** `packages/player/src/app.ts`
- **做** **C3 口径**：`packages/player/src` **零新增文件**，改动只允许出现在 `app.ts` 的装配段，
  逐行在提交信息里点名，行数记进 METRICS。
- **验收** `git diff --stat packages/player/src` 只显示 `app.ts`；切换中显示中文浮层，失败时可重试；
  `pnpm size` ≤ 400 KB。
- **自测** `pnpm -F @w3/player test && pnpm size`
- **变异检验** 把浮层做成新组件文件 → 「零新增文件」断言必须红（**这条断言要写成 CI 里的
  `git diff --stat` 检查，不是靠人看**）。

### [ ] T-436 · project 变量的运行时作用域
- **依赖** T-430 · **预估** 1.2d · **实际** —
- **独占** `packages/core/src/eca/engine.ts`（**仅变量表分区**）· `packages/core/src/runtime/playback-session.ts` ·
  其测试 · `docs/adr/0036-project-作用域变量的运行时归属.md`(新)
- **做** `variables[].scope`（T-225 已冻结）在运行时生效：`scene` 作用域的变量在 `goToScene` 时重置，
  `project` 作用域的保留。**动 `engine.ts` = 分诊 Q4，ADR 先行**（这是 v1 第三次动它，
  前两次是 ADR-0018 与 T-204 的 ChurnGuard）。
- **验收** 切换场景后 `scene` 变量回默认值、`project` 变量保持；两个作用域同名变量互不干扰；
  ADR 的两栏非空。
- **自测** `pnpm -F @w3/core test eca && pnpm test:parity`
- **变异检验** 把 `project` 也重置 → 「切换后 project 变量保持」必须红；
  反向：把 `scene` 也保留 → 「切换后 scene 变量回默认」必须红。**两向都要断**。

### [ ] T-437 · bundle 级完整性检查 + 发布链路接入
- **依赖** T-431 · T-433 · **预估** 1.0d · **实际** —
- **独占** `packages/schema/src/bundle-integrity.ts`(新) · 其测试 · `packages/editor/src/publish/publish.ts`
- **做** 跨场景检查（`goToScene` 的目标 sceneId 在包内存在 / `entrySceneId` 存在 / 场景 id 唯一）——
  **这些检查不能放 `checkIntegrity`**，因为它是单文档的。
- **验收** 指向不存在场景的 `goToScene` → 发布被阻断且给出中文原因；单场景发布路径行为不变。
- **自测** `pnpm -F @w3/schema test bundle-integrity && pnpm -F @w3/editor test publish`
- **变异检验** 把跨场景检查跳过 → 「发布被阻断」必须红（**注意不要顺手把它塞进 checkIntegrity，
  那会让单文档场景下每条 goToScene 都报错——正是 A3(b) 要避免的**）。

### [ ] T-438 · parity 二段脚本：切换后的轨迹也要逐项相等
- **依赖** T-430 · T-433 · T-436 · T-294 · **预估** 1.2d · **实际** —
- **独占** `test/parity/event-script-scene-b.json`(新) · `test/parity/parity.test.ts`（多场景段）
- **做** 第二段脚本作用于切换后的场景；`parity.test.ts` 加一个多场景用例，两侧各自走完
  一段 → `goToScene` → 二段，逐项比对轨迹与结束态变量。
- **验收** 两侧在 `goToScene` 之后的轨迹逐项相等；**防空转自检**：轨迹里必须出现 `goToScene`
  且切换后的步骤数 ≥ 3。
- **自测** `pnpm test:parity`
- **变异检验** ① 单边不重置 `scene` 变量 → parity 红；
  ② 把二段脚本删空 → 防空转断言必须红（**不加这条，脚本漂成空的也会绿**）。

### [ ] T-439 · 多场景专项 E2E
- **依赖** T-434 · T-435 · T-437 · **预估** 1.5d · **实际** —
- **独占** `e2e/tests/multi-scene.spec.ts`(新)
- **做** 一条完整剧本：新建第二个场景 → 建 `goToScene` 热点 → 预览切换 → 断言按需加载 →
  发布多场景包 → 播放器打开 → 切换 → 退出预览回 A。
- **验收** 一个项目里建第二个场景 → 点热点 `goToScene` → **断言 B 的资产请求发生在切换之后**
  （按需加载的证据）→ 保持 project 变量 → 退出预览回到 A；全程 `fullRebuildCount === 0`（末尾断言）。
- **自测** `pnpm test:e2e multi-scene`
- **变异检验** 改成启动时预加载全部场景 → 「B 的请求发生在切换之后」必须红
  （**只断言「切换成功」是测不出按需加载的**）。

### [ ] T-440 · `dataSources` 从 placeholder 变成运行时（schema 侧）
- **依赖** T-225 · T-445 · **预估** 0.5d · **实际** —
- **独占** `packages/schema/src/data-source.ts`（`.describe()` 文案）· `docs/SCHEMA_SPEC.md` §6
- **做** 把「字段已冻结，消费者在 v1.5」的 describe 改成正式描述；SPEC 对应节从占位改成正文。
- **验收** `grep -rn "消费者在 v1.5" packages/schema/src` 零命中；SPEC 里该节的字段与源码逐字对得上。
- **自测** `pnpm -F @w3/schema test && node scripts/check-docs.mjs`
- **变异检验** 不适用（文档 / 文案卡）。**替代**：`check-docs.mjs` 加一条规则——
  schema 源码里不许残留「v1.5」「v2」这类未来版本标记而对应能力已交付，改坏后必须红。

**M25 小计：14 张 / 17.2 人日**

---

## M26 · 外部数据源（T-441 ~ T-448）

> **引擎侧的洞（`MAX_CHAIN_DEPTH` 跨 await 失效）已由 v1.0 的 T-204 修掉，v1.2 的 T-314 回归过。**
> 本段只做数据源的功能部分。

### [ ] T-441 · `readPath` / `castValue` 纯函数
- **依赖** T-225 · **预估** 0.5d · **实际** —
- **独占** `packages/core/src/data/read-path.ts`(新) · 其测试
- **做** `readPath(obj, "a.b[0].c")` 与 `castValue(raw, targetType)` 两个纯函数；
  路径解析**拒绝 `__proto__` / `constructor` / `prototype`**；转换失败返回 `{ok:false, reason}` 而不是抛。
- **验收** 点号路径、数组下标、缺失路径返回 undefined；`__proto__` / `constructor` / `prototype`
  三种路径**一律拒绝**（各一条测试）；四种目标类型的转换与失败分支各一条。
- **自测** `pnpm -F @w3/core test read-path`
- **变异检验** 去掉原型链拒绝 → 三条必须红（**分开写三条，写成一条 `expect(() => ...).toThrow()`
  时漏一种也绿**）。

### [ ] T-442 ★ · `DataSourceRunner`（轮询、退避、超时、abort、暂停、sample）
- **依赖** T-441 · T-204 · **预估** 3.0d · **实际** —
- **独占** `packages/core/src/data/runner.ts`(新) · 其测试
- **做** 全程注入时钟与 fetch（**纯 Node 可测，零真实网络**）；指数退避带上限；
  `AbortSignal` 贯穿；页面不可见时暂停。
- **验收** 连续失败 5 次的退避间隔序列逐值断言；abort 后**不再有任何 fetch 调用**（计数为 0）；
  暂停 → 恢复后立即拉一次；超时走失败分支而不是挂住。
- **自测** `pnpm -F @w3/core test data/runner`
- **变异检验** ① 退避改成固定间隔 → 序列断言红；② abort 后仍拉一次 → 计数断言红
  （**断言必须是「恰好 0 次」，写「不再增长」时多拉一次也可能绿**）。

### [ ] T-443 · `RuntimeContext` 四个方法 + 两个 runtime + 契约测试
- **依赖** T-442 · T-203 · **预估** 1.5d · **实际** —
- **独占** `packages/core/src/eca/types.ts`（列 T）· `packages/core/src/eca/headless.ts` ·
  `packages/core/src/runtime/scene-runtime.ts` · `packages/core/test/runtime-contract.ts`
- **做** `refreshDataSource` / `startDataSource` / `stopDataSource` / `dataSourceStateOf` 四个方法
  双实现；headless 侧用注入时钟推进，不发任何真实请求。
- **验收** 契约对两个实现跑同一批断言；headless 侧用注入时钟推进而不是真等待；
  `git diff packages/core/src/eca/engine.ts` 为空。
- **自测** `pnpm -F @w3/core test contract`
- **变异检验** 只在 headless 侧改掉 `refreshDataSource` 的语义 → 契约必须红。

### [ ] T-444 · 三个 ECA 数据源动作 + 数据源完整性检查 10 条（I60 – I69）
- **依赖** T-443 · T-302 · **预估** 1.8d · **实际** —
- **独占** `packages/core/src/eca/actions/data.ts`(新) · 其测试 · `packages/core/src/eca/actions/index.ts`（一行）·
  `packages/schema/src/integrity.ts` · `packages/schema/test/integrity-data-source.test.ts`(新)
- **做** ① `refreshDataSource` / `startDataSource` / `stopDataSource`，`refs` 带 `kind:'dataSource'`
  （T-302 已把它加进注册表）。**注意：这是「向注册表加一项」而不是「往 `executor.ts` 加一个 case」**
  ——后者的写法与 A3(a) 直接相悖。
  ② **I60 – I69 十条，级别逐字照规划 §4.2 的 v1.5 段表**（I60/I61/I62/I63 是 error，其余 warn）。
  接在 T-226（v1.0 段 30 条）与 T-303（v1.2 段 14 条）之后，编号连续到 I69。
  **这十条与运行时同版本落地**——v1.0 就写等于写十条永远拿不到非空 `dataSources` 的分支。
  I68（数据源与 `setVariable` 争用同一变量）要同时遍历 `dataSources[].map[]` 与
  `rules[].then[]`，是三条里唯一跨集合的一条。
- **验收** **一条测试断言 `allActions().length === 31` 且与 SPEC 表行数一致**（写进 `pnpm verify`，
  与 T-296 的 18、T-331 的 **27** 是同一条断言的三次收紧；**27 → 31 的四个是本卡的三个数据源动作
  加 T-431 的 `goToScene`**）；覆盖率 100%；
  `executor.ts` / `engine.ts` / 规则编辑器 diff 为空；
  **I60 – I69 各一条正例一条反例**，级别逐条断言；一份 `dataSources: []` 的文档十条全不触发。
- **自测** `pnpm -F @w3/core test eca && pnpm -F @w3/schema test integrity && pnpm check:constitution`
- **变异检验** ① 把 `refs` 改成返回 `[]` → T-303 的悬空引用检查必须红；
  ② 把 I62（`live` 缺 url）从 error 降成 warn → 级别断言必须红；
  ③ **把 I68 的遍历只做 `dataSources` 一侧** → 争用那条必须红
  （**只遍历一侧时它对「规则写、数据源也写」这种最常见的争用完全无感**）；
  ④ 把 I63 的 `JSON.parse` 试解析删掉只判非空 → 非法 JSON 那条必须红。
- ⚠ **动作数断言的落地顺序，本卡必须自己处理（这是台账里既有的一处顺序错位，本版点破）**：
  **31 是 v1.5 的出口终值**，而它由**两张卡**合起来达成——本卡的三个数据源动作（W28）
  与 **T-431 的 `goToScene`**（W29）。本卡在 W28 落地当天，`allActions().length` 只有 **30**。
  处置：**本卡把断言写成 `allActions().length === 31` 并在提交信息里点名它此刻是红的、
  由 T-431 关灯**；T-431 的 DoD 里回读本条。**不许为了当天变绿把数字写成 30**
  ——那会让「四份文档各自硬编码一个互不相容的数字」（G1.0-5 明令防的形状）在 v1.5 复发一次。
  终值由 **T-459** 在 v1.5 晋级门槛核对时复核。

### [ ] T-445 · `HttpDataSourceProvider` + 白名单 + C7 机器判据补洞
- **依赖** T-442 · T-209 · **ADR-0024 前置** · **预估** 2.0d · **实际** —
- **独占** `packages/player/src/data/http-provider.ts`(新) · `packages/editor/src/data/http-provider.ts` ·
  `scripts/check-provider-swap.mjs`（白名单条目）· `docs/adr/0024-运行时外部数据源与-C6-的边界.md`(新)
- **做** **ADR-0024 先行**：构建产物零外链不变 + 运行时按文档声明发请求，**白名单归部署配置**
  （不进文档、不进构建产物）。这与 `openLink` 早已让文档携带任意外部 URL 是同一个既成事实，
  ADR 要从这里出发论证，而不是假装「我们从不让文档决定外部地址」。
- **验收** 白名单外的地址被拒且给中文原因；**默认关闭时零外部请求**（拦截式断言）；
  `check-provider-swap.mjs` 的网络原语白名单里恰好多这一条且带到期版本号。
- **自测** `pnpm -F @w3/player test data && pnpm check:constitution`
- **变异检验** ① 白名单判断改成恒 true → 拒绝那条红；② 默认改成开启 → 「零外部请求」红。

### [ ] T-446 · `createDataSource` 与编辑器数据源面板
- **依赖** T-444 · T-445 · **预估** 3.0d · **实际** —
- **独占** `packages/editor/src/panels/DataSourcePanel.tsx`(新) · `packages/editor/src/lib/data-source-edit.ts`(新) · 其测试
- **做** 新建 / 编辑 / 删除数据源；字段映射编辑器（响应路径 → 变量）；「试拉一次」按钮显示样本响应。
  **凭据值不进文档**（T-225 已用 `.strict()` 兜住 `auth`，本卡的 UI 不提供输入凭据的入口，
  凭据走部署配置）。
- **验收** **一条走到 UI 事件入口的测试**——新建数据源 → 加一条映射 → 撤销栈恰好 +1；
  「试拉一次」用注入的 fetch，不发真实请求；`checkIntegrity` 零 error。
- **自测** `pnpm -F @w3/editor test data-source-panel`
- **变异检验** ① 新建按钮 onClick 空操作 → UI 入口红；
  ② 把凭据字段加进表单 → `.strict()` 必须让 `validate` 失败（**证明兜底真的在**）。

### [ ] T-447 · 数据源 parity 接入
- **依赖** T-444 · T-294 · **预估** 0.5d · **实际** —
- **独占** `test/parity/parity.test.ts`（数据源段）· `test/parity/event-script.json`（追加一步）
- **做** parity 脚本追加一步 `refreshDataSource`，两侧注入**同一个**假 fetch（返回固定 JSON）；
  轨迹比较加映射后的变量值。
- **验收** 两侧用同一个注入 fetch 跑 `refreshDataSource`，轨迹与变量逐项相等；
  **防空转自检**：轨迹里必须出现 `refreshDataSource`。
- **自测** `pnpm test:parity`
- **变异检验** 单边把 `castValue` 的目标类型改掉 → parity 红。

### [ ] T-448 · 泵组样板工程的数据源部分 + E2E
- **依赖** T-446 · T-445 · **预估** 1.5d · **实际** —
- **独占** `packages/schema/src/pump-demo.ts`（dataSources 段）· `e2e/tests/data-source.spec.ts`(新)
- **做** 样板工程加一个数据源（同源端点，5 秒轮询，映射液位 / 压力两个变量）+ 两条
  `variableChange` 规则（补间 + 高亮）；E2E 用 `page.route` 伪造端点。
- **验收** 泵组的液位 / 压力从一个**同源** HTTP 端点每 5 秒刷新一次，驱动一段补间与一次高亮；
  **关掉时零外部请求**（拦截式断言）；断网时给中文提示而不是白屏。
- **自测** `pnpm test:e2e data-source`
- **变异检验** ① 关掉数据源后仍轮询 → 「零外部请求」必须红；
  ② 把轮询间隔改成 0 → T-204 的 ChurnGuard 必须报出恰好一条告警（**这是 ChurnGuard 在真实
  数据源上的第一次实战**，结果记进提交信息）。

**M26 小计：8 张 / 13.8 人日**

---

## M27 · 分享链接与验收材料（T-449 ~ T-459）

### [ ] T-449 · `ShareProvider` 接口 + 后端 share 数据层与四条路由骨架
- **依赖** T-404 · T-401 · **预估** 2.0d · **实际** —
- **独占** `packages/server/src/routes/share.ts` · `packages/server/src/repo/share.ts` ·
  `packages/storage/src/provider.ts`（share facet）
- **做** `ShareProvider` 接口（作为 optional facet）+ `share_links` 表 + 四条路由骨架
  （创建 / 校验 / 撤销 / 列出）；token 用 `crypto.randomBytes(16)`，口令哈希复用 T-403 的 scrypt。
- **验收** 四条路由（创建 / 校验 / 撤销 / 列出）各有权限矩阵测试；token 不可枚举（随机 ≥ 128 bit）；
  过期与撤销两条拒绝路径各一条断言。
- **自测** `pnpm -F @w3/server test share`
- **变异检验** 把 token 改成自增 id → 「不可枚举」断言必须红（**断言要写成「连续创建 100 个 token
  的最长公共前缀 < 4 字符」这类可机器验证的形式**）。

### [ ] T-450 · 口令页、解锁流程与限流
- **依赖** T-449 · **预估** 1.5d · **实际** —
- **独占** `packages/player/src/share/**`(新，**属 C3 口径允许的 `embed/` 同级例外，须在提交信息
  里逐文件点名并记进 METRICS**)· 其测试
- **做** 播放器侧的口令页（纯 DOM，零框架）+ 解锁请求 + 失败限流提示；
  解锁后 token 只存内存，**不落 localStorage**。
- **验收** 输错一次 → 提示 → 输对 → 播放器起来；6 次失败后 429 且带 `Retry-After`；
  口令不落 localStorage（grep 断言）。
- **自测** `pnpm -F @w3/player test share`
- **变异检验** 限流阈值改 999 → 429 那条红；把口令存进 localStorage → grep 断言红。

### [ ] T-451 · 包代理路由 `/s/:token/scene.w3p`（同源，保住 `resolveSource`）
- **依赖** T-449 · T-450 · **预估** 1.0d · **实际** —
- **独占** `packages/server/src/routes/share-asset.ts` · `deploy/nginx.conf.template`
- **做** `resolveSource` **会拒绝任何跨源 src**——分享链接若指向另一个域，这条同源检查是拦路的
  第一块石头。用同源代理路由绕开它，**而不是放宽同源检查**。
- **验收** `/s/:token/scene.w3p` 与播放器同源；未解锁时 403；`resolveSource` 的同源检查**一行未改**
  （diff 断言）。
- **自测** `pnpm -F @w3/server test share-asset && node scripts/check-deploy-headers.mjs`
- **变异检验** 放宽 `resolveSource` 的同源检查 → 必须有一条测试红（**若没有，说明那条检查从来
  没被测过**，本卡顺手补上）。

### [ ] T-452 · 编辑器分享面板与离线降级
- **依赖** T-449 · T-269 · **预估** 1.5d · **实际** —
- **独占** `packages/editor/src/dialogs/ShareDialog.tsx`(新) · 其测试
- **做** 编辑器分享面板：创建链接（口令 / 有效期）+ 列出已有链接 + 撤销；
  单机模式下面板整体禁用并给中文提示。缩略图取自 T-269 已接通的发布缩略图。
- **验收** 创建带口令、7 天有效的链接 → 面板显示链接与二维码占位；单机模式下面板给中文提示
  「分享需要在线模式」而不是报错；缩略图取自 T-269 已接通的发布缩略图。
- **自测** `pnpm -F @w3/editor test share-dialog`
- **变异检验** 单机模式下不降级而是抛错 → 降级那条红。

### [ ] T-453 · 分享链接 E2E（含三条负路径）与 C6 复核
- **依赖** T-451 · T-452 · **预估** 1.0d · **实际** —
- **独占** `e2e/tests/share.spec.ts`(新)
- **做** 四条用例（正路 + 过期 + 撤销 + 口令错）；末条用 `page.route` 拦截所有非本机源请求，
  断言被拦截数为 0。
- **验收** 正路 + 三条负路径（过期 / 撤销 / 口令错）各一条；**掐断所有非本机源刷新仍能起来**
  （拦截式断言，被拦截请求数为 0）。
- **自测** `pnpm test:e2e share`
- **变异检验** 去掉过期校验 → 过期那条必须红（**三条负路径要分开写，合成一条时漏一种也绿**）。

### [ ] T-454 · 分享二维码（本地生成）
- **依赖** T-452 · **预估** 0.3d · **实际** —
- **独占** `packages/editor/src/lib/qrcode.ts`(新) · 其测试
- **做** 合同措辞里「受控链接、版本快照、**二维码**」三项，前两项已覆盖，二维码在 13 份设计里
  **零处提及**（T-212 已把它记进措辞表）。
  ✅ **拍板项 P-10：二维码补回来，本地生成。本卡就是它的落点，不另开卡。**
  **本地方案写死（不许换成"随便找个库"）**：仓库内自写 **QR Model 2 编码器**——
  字节模式（byte mode）· 纠错等级 **M** · 版本按内容长度自动选到能装下为止（分享链接约 60~120 字节，
  落在版本 4~7）· 输出 **纯 SVG 字符串**（`<rect>` 矩阵，无 `<image>`、无 canvas、无字体）。
  **零新增依赖、零 `fetch`、零 `<img src>`、零 canvas 光栅化**：C6 的判据不是「没调外部服务」，
  是**构建产物里一个外部主机名都没有**，而所有在线二维码方案都是往 URL 里塞内容再取图片。
- **验收** 生成的 SVG 能被一个**独立写的**纯函数解码器读回原字符串（自洽测试，见变异检验②）；
  `node scripts/check-no-external.mjs` 绿；`packages/editor/src/lib/qrcode.ts` 里零
  `fetch` / `XMLHttpRequest` / `document.createElement('canvas')` / `http`（grep 断言）；
  一份**固定期望 SVG 快照**（对一条写死的示例链接）逐字相等。
- **自测** `pnpm -F @w3/editor test qrcode && node scripts/check-no-external.mjs`
- **变异检验** 把纠错等级改掉 → 解码断言必须红（**若解码器与生成器共用同一份错误实现，
  这条变异会绿**——解码器必须独立写或用一份固定期望 SVG 快照）。

### [ ] T-455 · 附件B · 运行环境与部署（含二次开发）
- **依赖** T-419 · T-293 · **预估** 1.0d · **实际** —
- **独占** `docs/验收材料/附件B_运行环境与部署.md`(新) · 生成块脚本对应部分
- **做** 八节；沿用附件A 的 `[代码]` / `[规范]` / `[待实测]` 三类来源标注；第 4 节与第 7 节用生成块
  （从 DEPLOY.md 与 SDK 的 `.d.ts` 截取）。
- **验收** 每一行数值有来源标注；生成块与源同步（测试守着）；**一个没参与过的人照第 7 节能新增
  一个动作并跑通**（沿用 v0.5 T-175 的验收方式）。
- **自测** `pnpm -F @w3/editor test docs-blocks && node scripts/check-docs.mjs`
- **变异检验** 改 DEPLOY.md 的被截取段落但不重生成 → 生成块测试必须红。

### [ ] T-456 · 用户手册
- **依赖** T-290 · T-288 · **预估** 1.0d · **实际** —
- **独占** `docs/验收材料/用户手册.md`
- **做** 九节；快捷键 / 动作清单 / 体量上限三处用生成块（T-290 已建好机制）；
  **第 7 节必须写明「静默期最多丢 1.2 秒」**。
- **验收** 九节齐；三处生成块与源同步；第 9 节每条常见问题都指向一份可查的文档
  （附件A / bench 报告 / 风险登记项）。
- **自测** `pnpm -F @w3/editor test docs-blocks && node scripts/check-docs.mjs`
- **变异检验** 加一个快捷键但不重生成 → 生成块测试必须红。

### [ ] T-457 · 培训记录模板与交付物清单
- **依赖** T-455 · T-456 · **预估** 0.3d · **实际** —
- **独占** `docs/验收材料/{培训记录模板,交付物清单}.md`(新)
- **做** 培训记录模板（议程 / 参训人 / 签字栏）+ 交付物清单（每项三列：谁交付 / 何时 / 验收人），
  清单里的每一份文档路径都必须真实存在。
- **验收** 交付物清单每项三列（谁交付 / 何时 / 验收人）；每一份文档路径都存在
  （由 `check-docs.mjs` 的链接规则覆盖）。
- **自测** `node scripts/check-docs.mjs`
- **变异检验** 写一份不存在的文档路径 → `check-docs` 必须红。

### [ ] T-458 · 里程碑收尾脚本
- **依赖** T-207 · T-280 · **T-297**（第 10 步读的 `docs/MUTATIONS.md` 由它交付）· **预估** 0.6d · **实际** —
- **独占** `scripts/milestone-close.mjs`(新) · `docs/DEVELOPMENT.md`（收尾一节）
- **做** 十步；支持 `--dry-run`；第 9、10 步（对抗式审查确认 / 变异检验登记确认）没确认时 **exit 1**。
- **验收** 跑一次能打印出——未 `[x]` 的卡、非 Accepted 的 ADR、IMPL_NOTES 未验证行、
  **本里程碑内「变异未转红」的登记条数**、一段可粘进 METRICS 的指标表；不确认时 exit 1。
- **自测** `node scripts/milestone-close.mjs --dry-run M-x`
- **变异检验** ① 把某条 ADR 的状态改成 Accepted → 第 7 步的输出**必须变化**
  （证明它真的在读文件，不是打印一个写死的列表）；② 把一张卡的 `[x]` 去掉 → 第 6 步必须多打印一行。

### [ ] T-459 · v1.5 晋级门槛核对
- **依赖** **全部 v1.5 卡** · **预估** 0.3d · **实际** —
- **独占** `docs/TASK_BACKLOG_V1.md`（v1.5 收尾段）· `docs/METRICS.md`（v1.5 快照）
- **做** 逐条跑 G1.5-1 ~ G1.5-16，每条记命令与输出（16 条以规划 §7.1 的表行数为准，
  含 G1.5-13 `offline-single-user` 常设 job、G1.5-14 真实 v2 `.w3p` 字节、
  G1.5-15 转码保序、G1.5-16 `resetStorage` 断言）。
- **验收** 每条有证据；**未过的条目不许标绿**。
- **自测** `pnpm verify && node scripts/milestone-close.mjs v1.5`
- **变异检验** 不适用（核对卡）。

**M27 小计：11 张 / 10.5 人日**

**v1.5 合计：60 张 / 78.1 人日**（T-460 起留白；P-14 使 T-423 由 1.5d 收窄到 1.0d，**张数不变**
——它是改写不是删除）

---

# 附录 A · 独占文件冲突的消解清单

> 原始合并稿报告 **38 条独占文件冲突**，其中 12 条是「两个领域在做同一件事」而不只是碰同一个文件。
> 不处置就只能 30+ 卡串行，波次并行度会从 10 条线塌到 2~3 条。
> 下表是本台账实际做的处置：**11 组合并 · 5 组拆分 · 4 条串行列**。

## A.1 · 合并（11 组，原 41 张 → 现 13 张）

| # | 争用文件 / 主题 | 被合并的原卡 | 合成为 | 省下 |
|---|---|---|---|---|
| **C1** | `scene-runtime.ts:493/647` 渲染出口 + `RenderPipeline` + `editorAux`/`registerChrome` | 渲染出口收口 · 后处理管线 · chrome 归并（**X-21 / X-22**） | **T-235** | 1.0d |
| **C2** | `schema/src/**` 字段本体（八份稿子各写一份 `migrate.ts` / `factory.ts` 片段） | schema-v3 主卡 + 七个领域的字段片段（**C5/C6**） | **T-225** | 3.0d |
| **C3** | `integrity.ts`（**9 张卡声明独占，合计 44+ 条检查**） | 九份的完整性检查 | **T-226**（v1.0 段 30 条）+ **T-303**（v1.2 段 14 条）+ **T-444**（v1.5 段 10 条 I60–I69） | 1.2d |
| **C4** | `index-builder.ts`（3 张卡） | 三份的索引扩展 | **T-227** | 0.5d |
| **C5** | `apply-patch.ts`（**6 张卡在同一个 switch 里加 case**） | 五份的集合路径 | **T-230**（+ node patch 三 case 留在 T-243） | 0.6d |
| **C6** | `parity.test.ts`（**7 张卡**）+ `event-script.json`（6 张） | 六份的 parity 增量 | **T-294**（v1.0）· **T-316**（编排）· **T-322**（动画）· **T-438**（多场景）· **T-447**（数据源）——**T-294 是 fixture 的唯一所有者，其余以「追加步骤」并入，不重排既有步骤** | 2.6d |
| **C7** | `loader.ts` 的 `attachRenderer` vs `setRenderer`（**同一个修复被写成两张卡两个方法名，人日各算一遍**） | Draco / KTX2 两组 | **T-218** · **T-219**（方法名统一为 `attachRenderer`，与 `SceneRuntime.attachRenderer` 同名同义） | 0.9d |
| **C8** | `animator/clip.ts` 的 mixer 泄漏（两份各修一半） | action 缓存回收 + `clearMixers` | **T-237** | 0.2d |
| **C9** | `AssetStats` 白名单（体检指标与 clip 时长共用同一份） | 两张 | **T-234** | 0.2d |
| **C10** | 附件A（重新体检与机械校验都改它） | 两张 | **T-261** | 0.3d |
| **C11** | `HierarchyTree.tsx` + `App.tsx`（删除入口 / 快捷键 / 速查面板三方争用） | 三张 | **T-290** | 0.4d |
| **C12** | `deploy/**` + `Dockerfile`（纯进程与离线包各写一份 MIME 表） | 两张 | **T-293** | 0.2d |
| **C13** | `PlaybackSessionOptions.onEvent`（嵌入控制器的唯一事件来源） | 观测口 + 控制器 | **T-271** | 0.3d |
| **C14** | SPEC 回写（4 张卡都独占两份 SPEC） | 四份 | **T-296**（v1.0）+ **T-331**（v1.2） | 0.6d |

**合并省下 ≈ 12.0 人日。**

## A.2 · 拆分（5 组，为版本切分与假绿防护）

| # | 原卡 | 拆成 | 理由 |
|---|---|---|---|
| **S1** | 动画面板（ANIM-08） | **T-254**（v1.0：imported 建条目 + 预览播放，兑现断链）+ **T-321**（v1.2：区间编辑） | 区间播放本身是 v1.2 的增强，而「整条 `ClipPlayer` 栈零生产调用者」是 v0.5 的债，两者不同版本 |
| **S2** | 完整性检查 44 条 | **T-226** 30 条（v1.0）+ **T-303** 14 条（v1.2） | 那 14 条里有 9 条要解析 `goToStep`/`showPage` 的动作引用，而那些动作在 v1.0 不存在，提前写等于写一批永远走 `default` 的分支 |
| **S3** | 泵组样板工程 | **T-283 / T-284**（v1.0：爆炸 + 剖切 + 动画 + 出图）+ **T-328**（v1.2：flows / pages 编排增补） | 样板工程是 v1.0 的旗舰交付物，但它的第 10 步依赖 v1.2 的编排 |
| **S4** | `RefKind` 扩容 | **T-203**（v1.0：注册表结构改造，不加任何 kind）+ **T-302**（v1.2：加四项） | 结构改造与扩容是两件事；改造完成后扩容不再是 Q4，**T-302 的变异检验就是这条裁决的可执行证据** |
| **S5** | 黄金路径 | **T-296**（黄金路径 III，v1.0 12 步）+ **T-330**（黄金路径 IV，v1.2 12 步含流程 / 页面 / 模板） | 同上 |

## A.3 · 串行列（4 条，见 §1 波次表）

`scene-runtime.ts`（原 13 卡）· `eca/types.ts` + `headless.ts` + `runtime-contract.ts`（原各 10 / 10 / 8 卡）·
`App.tsx`（原 9 卡）· `storage/src/*.ts`（原 6 卡）。
**四条列合计原本构成一条 46 卡次的串行链。** 处置：
① 合并后卡数降到 9 / 7 / 6 / 5；
② **T-200 与 T-235 各交付一份「接缝清单」**——把后续卡要往 `scene-runtime` / `RuntimeContext`
上挂的方法签名一次性开好（空实现 + `throw new Error('未接线')` + 一条断言它们全部被接线的清单测试），
后续卡只在自己的 layer 文件里写实现。**这两笔预付各约 +0.5 人日，换回 30+ 卡次的串行解除。**

## A.4 · 改名（避免同名新增撞车）

| 原路径 | 改为 | 理由 |
|---|---|---|
| `packages/editor/src/panels/ScenePanel.tsx`（表现力用） | **`SceneEffectsPanel.tsx`**（T-239） | 两份设计**同名新增、内容完全无关**（一个是场景效果面板，一个是多场景列表）。若都落地，后一个会覆盖前一个 |
| `packages/editor/src/panels/ScenePanel.tsx`（多场景用） | **`SceneListPanel.tsx`**（T-434） | 同上 |

---

# 附录 B · 28 条 BLOCKER → 卡 全映射

> 债务分诊里标 **BLOCKER** 的 28 条，逐条找卡。**原本 5 条没有任何卡负责，已补开。**
> 「没有卡负责」正是 v0.5 T-137 那个洞的成因——**能力链每一环都要有卡认领**（新纪律 2）。

| # | 组 | BLOCKER | 承接卡 | 波次 |
|---|---|---|---|---|
| B1 | 数据源 | `MAX_CHAIN_DEPTH` 只挡同步链，跨 await 循环无上限 | **T-204**（改 `engine.ts` → Q4，ADR 先行）+ **T-314**（flows 可达性回归） | W0 / W20 |
| B2 | 数据源 | 运行期不能新建变量（`applyPatch` 对 `/variables/**` 显式空操作；`setVar` 对未声明变量静默忽略） | ⚠ **原本无卡 → T-231** | W7 |
| B3 | pages | 播放器缺 `.viewport__overlay > * { pointer-events:auto }` | **T-301** + **T-309** + **T-315**（不对称变异检验） | W16 / W19 / W22 |
| B4 | pages | `apply-patch` 已把 `/pages` `/flows` 当「已处理」return true | **T-230**（钩子计数断言，不只 `fullRebuildCount`） | W5 |
| B5 | flows | `execute()` 入参是 `Rule` 不是 `Action[]` | **T-225**（裁决：`onEnter` 改 describe 为「v1 未实现，请用 flowStepEnter 规则」，规避改 executor）+ **ADR-0035**（由 T-225 本卡写，铁律 12：先 ADR 后实现） | W4 |
| B6 | flows | 事件没有注册表，`EventDescriptorSchema` 是封闭 union → 加事件是 Q3 | **T-225**（挤进唯一一次 bump）+ **T-305** | W4 / W17 |
| B7 | 描边+雾 | `scene-runtime.ts:493` 那行 `renderer?.render(...)` → 换 composer = Q4 | **T-235** + **ADR-0021** | W6 |
| B8 | 描边+雾 | 渲染到 RenderTarget 会关掉 toneMapping 并退回线性色彩空间，G0.5-6 保护不到 | ⚠ **原本无卡 → T-236** | W7 |
| B9 | 描边+雾 | parity 从头到尾没有 canvas（renderer 全程 null） | **T-294**（自检 + `colourBuckets` E2E）—— ⚠ **只是部分覆盖**，描边像素在 parity 里**永远**不可观测，已登记为已知盲区（T-296） | W13 / W15 |
| B10 | 出图 | 热点的视觉表现从来没有 CSS，DOM 版是个没有外观的 button | **T-264** | W9 |
| B11 | 爆炸剖切 | `getNodeProp('positionY')` 两个运行时读的不是同一个东西 | **T-245**（契约断言「爆炸完成后两侧 positionY 逐位相等」） | W10 |
| B12 | 爆炸剖切 | **合同缺口**：爆炸与剖切在技术方案 §6.2 与 NORTH_STAR v1 清单里一行都没有 | ⚠ **原本无卡 → T-212** | W1 |
| B13 | 动画 | 整条 `ClipPlayer` 栈零生产调用者（T-068 标 `[x]` 但两样都没落地） | **T-254**（动画面板：imported 建条目 + 预览播放） | W11 |
| B14 | 动画 | 示例 GLB 不含动画通道，手写 `stats.animations` 被启动时实测覆盖成空数组 | **T-222**（`buildPumpDemoGlb` 加「拆装」clip）+ **T-234**（clip 时长测量接线） | W0 / W5 |
| B15 | 动画 | headless 与真实运行时在「重叠播放」上已分叉且可测量 | **T-216** | W1 |
| B16 | 后端转码 | 内容哈希对上传原始字节算，转码破坏三条不变量 | **T-225**（`asset.origin` 块）+ **T-422**（去重键改 `origin?.hash ?? hash`） | W4 / W26 |
| B17 | 后端转码 | `sharp: false` in allowBuilds，注释写「不在浏览器外跑原生步骤」 | **T-420 / T-423**（**P-14 已裁：不做 KTX2 服务端编码**，原 `KtxEncoder` 卡改写为减面卡，全线纯 WASM，`sharp` 与 Khronos `ktx` 都不引；`@gltf-transform/functions` 已在 lockfile 里零 import。逐字见 **ADR-0031**） | W32 / W27 |
| B18 | 后端转码 | **KTX2 解码器从来没有被创建过**，而附件A 已把「允许 KTX2」写进给客户的规范 | **T-219**（含「断言生产装配路径」的防线；按 X-34 采纳支持路线，**附件A 不动**） | W2 |
| B19 | 后端转码 | `AssetStats` 是 `.strict()` 而 `checkIntegrity` 不重跑 schema 校验（已炸过一次） | **T-234**（`AssetStatsSchema.strict().parse(result.stats)` 守护测试 + 新键进白名单 + 发布回归） | W5 |
| B20 | 后端转码 | `putBlob(bytes) -> hash` 由 provider 自己算哈希，HTTP 实现要么全读内存要么改接口 | **T-286**（`PutBlobOptions` 加宽）+ **T-408**（流式边收边算，RSS 断言） | W7 / W30 |
| B21 | 多场景 | ECA 引用体系彻底 per-document，加「场景」引用同时点亮 `executor.ts` 与规则编辑器 = Q4 | **T-203**（A3a：注册表化）+ **T-432**（A3b：`FieldRefKind` + 宿主注入 sources） | W0 / W30 |
| B22 | 多场景 | 「发布包只含被引用资产」不是 `packScene` 保证的，裁剪发生在编辑器 `publish()` | **T-233**（断言 **zip 产物**，不只断言 `referencedHashes` 的返回值） | W6 |
| B23 | 嵌入分享 | `createPlayerSession` 早就支持 `onResult`，编辑器预览接了、**播放器没接** | **T-271**（`onEvent` 观测口 + 控制器）+ **T-273**（Player 生命周期接线） | W11 / W12 |
| B24 | 复用样板 | **编辑器根本没有「新建项目」**，冷启动永远是恢复最近或打开样例 | **T-282** | W6 |
| B25 | 复用样板 | 两条黄金路径里的 `pump.glb` 都是同一个单四边形夹具改了文件名 | **T-222**（16 个物体 + `PUMP_DEMO_OBJECTS` 契约） | W0 |
| B26 | 全局 | `pnpm size-limit` 这个命令根本不存在，却被写进 NORTH_STAR §3 的 G0.5-7 | **T-207** | W0 |
| B27 | 全局 | schema 的 90% 覆盖率门槛配置存在但**从未真正执行过** | **T-208** | W1 |
| B28 | 全局 | `Dockerfile` / `railway.toml` / `deploy/` **三个文件从未提交** | **T-221**（`git add` + `docs/DEPLOY.md`） | W2 |

**另有三条「结论级」发现的承接**：

| 结论 | 承接卡 |
|---|---|
| **11 条「完整实现 + 零生产调用者」= 第 14 次同形复发，需要机械守卫而不是再写一条纪律** | ⚠ **原本无卡 → T-205**（**成员级**，符号级只抓得到 11 条里的 5 条）+ 逐条接上的卡：T-254（ClipPlayer 栈）· T-259（`suggestUnit`）· T-260（`AuditResult.summary`）· T-282（`deleteProject` / `createEmptyDocument` / `replaceDocument`）· T-286（`touch()`）· T-255（`AssetLoader.evict()`）· T-313（`startOn:'manual'`）· T-226+T-317（用例生成器）· T-222（`SAMPLE_OBJECT_PATHS`） |
| **三条规范滞后于代码**（`ECA_SPEC §5.1` 写 `allSettled` 实现是 `Promise.all` · `§6` 写 `waitForMediaEnd` 未播放立即 resolve · `playMedia` 的 await 默认值） | ⚠ **原本无卡 → T-211** |
| **三条门槛是空的** | T-207（`size-limit`）· T-208（覆盖率）· T-210（断网构建两边互指） |

**补开的五张卡**：T-205（零调用者守卫）· T-231（`/variables` 补丁路径）· T-236（后处理色调映射）·
T-211（SPEC 三处对拍）· T-212（合同措辞）。**外加两张本台账新开**：T-200（渲染器注入缝，
X-25——**五个领域的无 GPU 单测建立在一条不存在的缝上，没有任何一张卡负责建它**）与
T-206（schema v3 冻结裁决表，F-1）。

---

# 附录 C · 三张汇总表

## C.1 · 按里程碑

| 里程碑 | 版本 | 卡段 | 张数 | 人日 | 累计 | **可演示物（一句）** |
|---|---|---|---|---|---|---|
| **M14** | v1.0 | T-200 ~ T-224 · T-297 · T-298 | 27 | 23.4 | 23.4 | `pnpm verify` 全绿且多出 8 条新守卫（含变异检验登记锁与例外到期守卫）；**一份真 Draco 泵组在浏览器里被同源解码并出画**；断网 CI job 在 GitHub 上绿过一次 |
| **M15** | v1.0 | T-225 ~ T-234 | 10 | 13.0 | 36.4 | 打开一份 v1 老工程 → 自动升到 v3 → 30 条新完整性检查逐条有正反例 → 发布成功；`ID_COLLECTIONS` 有 5 个以上引用点 |
| **M16** | v1.0 | T-235 ~ T-261 | 27 | 32.2 | 68.6 | **泵组开雾 + 描边高亮 + 一键三级爆炸 + 拖动剖切面看内部流道**，全程 `全量重建 = 0` |
| **M17** | v1.0 | T-262 ~ T-281 | 20 | 22.1 | 90.7 | **导出一张 3840px 含热点的 PNG**；宿主页面用 `<script src=embed.js>` 嵌一个跨源 iframe，点按钮 / 读变量 / 截图 |
| **M18** | v1.0 | T-282 ~ T-296 · T-299 | 16 | 20.3 | **111.0（v1.0 完）** | **拔电重开编辑器 → 横幅提示「有 N 处未保存修改」→ 一键恢复**；黄金路径 III 一次不中断走完；项目层四件（新建 / 列表 / 重命名 / 删除）全通 |
| **M19** | v1.2 | T-300 ~ T-317 | 18 | 17.5 | 128.5 | **三步拆装流程 + 覆盖层进度条「2 / 3」+ 在播放器里点同一个按钮走下一步**（pointer-events 收口的端到端证据） |
| **M20** | v1.2 | T-318 ~ T-322 · T-337 · T-338 | 7 | 6.1 | 134.6 | 一条 4 秒 clip 切成四段各自可触发，两段之间淡变过渡，**其中一段能倒着放**；点一条规则，相机沿三个视点连贯巡游一圈 |
| **M21** | v1.2 | T-323 ~ T-336 | 14 | 10.0 | **144.6（v1.2 完）** | 从「泵组拆装」模板新建项目并套用一条规则模板；黄金路径 IV 一次走完 |
| **M22** | v1.5 | T-400 ~ T-412 | 13 | 18.0 | 162.6 | 起一个真服务器，`HttpApiProvider` 跑通与 `MemoryProvider` **同一份契约套件** |
| **M23** | v1.5 | T-413 ~ T-419 | 7 | 9.5 | 172.1 | 登录 → 新建项目 → 两个人抢同一个项目的编辑锁 → 后者只读降级并给出中文冲突对话框；`/api` 全 404 时自动落回单机模式 |
| **M24** | v1.5 | T-420 ~ T-426 | 7 | 9.1 | 181.2 | 上传一份未压缩 GLB → 服务端 Draco 压缩（**可选减面，默认关闭**）→ 体检报告显示「送检 / 处理后」两列 → 断网重载仍可见 |
| **M25** | v1.5 | T-427 ~ T-440 | 14 | 17.2 | 198.4 | 一个项目里建第二个场景 → 点热点 `goToScene` → 按需加载 B 并保持 project 变量 → 退出预览回到 A |
| **M26** | v1.5 | T-441 ~ T-448 | 8 | 13.8 | 212.2 | 泵组的液位 / 压力从一个同源 HTTP 端点每 5 秒刷新一次，驱动一段补间与一次高亮；关掉时零外部请求 |
| **M27** | v1.5 | T-449 ~ T-459 | 11 | 10.5 | **222.7（v1.5 完）** | 发一条带口令、7 天有效的分享链接（**带本地生成的二维码**），输错一次 → 输对 → 播放器起来 → 掐断所有非本机源刷新仍能起来 |

## C.2 · 按能力线

| 线 | 张数 | 人日 | 占比 | 主要卡段 |
|---|---|---|---|---|
| 表现力（雾 / 描边 / 爆炸 / 剖切 / 动画 / 相机） | 33 | 34.9 | 16% | T-235 ~ T-256 · T-318 ~ T-322 · **T-337 · T-338** |
| 存储与后端 | 23 | 31.2 | 14% | T-202 · T-286 · T-287 · T-400 ~ T-419 |
| 部署 / bench / 验收材料 / 过程纪律 | 32 | 24.8 | 11% | T-205 ~ T-213 · T-278 ~ T-281 · T-291 ~ **T-299** · T-331 ~ T-336 · T-455 ~ T-459 |
| 资产与解码器 | 17 | 19.1 | 9% | T-217 ~ T-220 · T-234 · T-257 ~ T-261 · T-420 ~ T-426 |
| 集成（嵌入 SDK + 分享） | 14 | 17.5 | 8% | T-270 ~ T-277 · T-449 ~ T-454 |
| 编排（flows / pages / 事件） | 18 | 17.5 | 8% | T-300 ~ T-317 |
| 多场景 | 13 | 16.7 | 8% | T-427 ~ T-439 |
| schema 与引用体系 | 13 | 15.5 | 7% | T-201 · T-203 · T-206 · T-225 ~ T-233 · T-440 |
| 外部数据源 | 9 | 15.3 | 7% | T-204 · T-441 ~ T-448 |
| 复用与样板工程 | 13 | 12.5 | 6% | T-222 · T-282 ~ T-285 · T-323 ~ T-330 |
| 渲染出图 | 9 | 11.0 | 5% | T-262 ~ T-269 · T-295 |
| 编辑器打磨与崩溃恢复 | 5 | 6.7 | 3% | T-224 · T-258 · T-288 ~ T-290 |
| **合计** | **199** | **222.7** | 100% | |

> **本版（2026-08-03 拍板落地）对本表的六处改动**，逐项可对账：
> **表现力** +2 张（T-337 相机路径巡游 1.0d · T-338 动画倒放 1.2d）+ T-322 的 +0.1d = **+2.3d**；
> **部署 / 过程纪律** +1 张（T-299 AI provider 插座 0.2d）；
> **资产与解码器** **−0.5d**（P-14 砍 KTX2 服务端编码，T-423 由 1.5d 改写为减面卡 1.0d，张数不变）；
> **复用与样板工程** **+0.2d**（P-20 给 T-282 补重命名，1.5d → 1.7d）。
> 净变化 **+3 张 / +2.2 人日**，196 / 220.5 → **199 / 222.7**。
> ⚠ 百分比列是逐行四舍五入，加起来是 102 而不是 100——**合计行的 100% 指的是整体，不是这一列的和**
> （上一版同样如此，四舍五入到整数就会这样，不许为了凑 100 去改某一行的数字）。

> **两个必须被看见的数字**：
> ① **测试 / 守卫 / 契约套件是主产出的卡有 45 张（23%）**——这是 v0.5 教训固化的结果，不是浪费，
> 但它必须被写进预算，不能继续当成「顺手做的」；
> ② **v0/v0.5 债务清偿占 M14 的 27 张卡 / 23.4 人日**，原技术方案对这部分预算为零。

## C.3 · agent 时钟换算（**校准依据与保守修正的理由**）

**直接换算**：v0.5 台账「实际」列显示，预估 **0.5~0.8 人日**的卡，实际 agent 耗时 **0.6~0.8 小时**
→ **1 人日 ≈ 1 小时 agent 时钟**。

**但这个换算不能直接外推。** v1 的卡分布与 v0.5 完全不同：

| 卡的预估区间 | v1 张数 | v1 人日 | 占比 | v0.5 有无校准数据 |
|---|---|---|---|---|
| ≤ 1.2 人日 | 132 | 101.4 | 46% | ✅ 有（1 人日 ≈ 1 小时） |
| **≥ 1.5 人日** | **67** | **121.3** | **54%** | ❌ **完全没有** |

> 本版三张新卡（T-299 0.2d · T-337 1.0d · T-338 1.2d）全部落在 ≤1.2 档；
> **T-423 因 P-14 收窄由 1.5d 降到 1.0d，从大卡档换到小卡档**——大卡数因此 68 → 67。
> 中间区间（1.2 < x < 1.5）仍然**一张卡都没有**，这不是巧合：预估是按 0.1 人日粒度手写的，
> 1.3 / 1.4 从来没有人写过。

**为什么按 1.3× 保守修正**（这一条必须写出来，否则下面三个数字只是外推）：

1. **上下文更长，返工面更大。** v0.5 的大卡最大只有 1.6 人日（T-120 schema v2）；v1 有 T-225
   （4.5d）· T-235（2.8d）· T-294（2.5d）· T-296（2.5d）· T-411（2.5d）· T-442（3.0d）· T-446（3.0d）
   七张 ≥2.5 人日的卡，**没有任何一张有可比样本**。
2. **变异检验的重写成本随卡的大小超线性增长。** v0.5 的 E18 复盘：31 次变异有 **8 次是绿的**（26%），
   每一次都要重写测试再跑一轮。13 份 v1 设计合计列出约 **377 次变异**，按同比例预期
   **≈97 次不转红**——按每次 15 分钟计，仅这一项就是 **≈3 人日**的显式成本，而且它集中落在大卡上。
3. **1.3× 是下界不是中值。** 它假设「大卡只比小卡低效 30%」，这是**乐观**的；真实系数由
   **T-336（中期估算校准回填）** 在 v1.2 收口时用 M14 ~ M21 的实测数据重算，
   **若实测系数与 1.3× 相差 > 20%，v1.5 的人日合计必须重算一遍**。

| | 人日 | 直接换算（1.0×） | **保守 agent 时钟**（≤1.2d 按 1.0× · ≥1.5d 按 1.3×） |
|---|---|---|---|
| v1.0 | 111.0 | ≈ 111 小时 | **≈ 129 小时**（精确 129.1） |
| v1.2 | 33.6 | ≈ 34 小时 | **≈ 36 小时**（精确 36.2） |
| v1.5 | 78.1 | ≈ 78 小时 | **≈ 94 小时**（精确 93.9） |
| **合计** | **222.7** | ≈ 223 小时 | **≈ 259 小时**（精确 259.1） |

**墙钟推算**：
- **单 agent 串行**：v1.0 ≈ 129 小时 ≈ **16 个 8 小时工作日**（129.1 / 8 = 16.1）；
  三个台阶合计 ≈ 259 小时 ≈ **32 个工作日**（259.1 / 8 = 32.4）。
  **取整口径与上一版一致：就近取整，不进位**——本版只换数字，不换口径。
- **按 §1 波次并行**（v1.0 平均 6 条线，关键路径 **16 波**；三个台阶合计 **36 波**）：
  理论墙钟 ≈ 16 波 × 每波最长卡（约 2.8~4.5 小时）≈ **58 小时**（v1.0）。
  但这假设并行度真能开到 6——**前提是附录 A 的 38 条独占文件冲突已按本表处置，尤其是 T-200 与
  T-235 的两份接缝清单**。若不处置，`scene-runtime` / `eca/types` 两条链会把关键路径拉到
  25 波以上，墙钟翻 2 倍。
  ⚠ **并行度的天花板不是波次表，是独占文件。** v1.0 的 W4（schema v3 单卡）与 W15（出口核对）
  各只有 1 张卡，这两个点上并行度必然塌到 1——**它们是设计出来的收敛点，不是排期失误。**
- **两个阀门写死**：`T-225` 完成后停下来汇报（单卡波次 W4）；`T-200` / `T-235` 交付时同步交付
  接缝清单。**这两个点是全 v1 并行度的两个阀门。**

---

# 附录 D · 收尾核对（各台阶完成后回填）

## v1.0 晋级门槛 G1.0-1 ~ G1.0-22

> 门槛表全文见 [MVP_V1_进化规划.md](MVP_V1_进化规划.md) §7。此处只留回填位。
> **未过的条目不许标绿**，按 v0.5 的先例如实写「未过，且原因是什么」。核对卡：T-296。

- [ ] G1.0-1 ~ G1.0-22 · 逐条记命令与输出
- [ ] **H1 · 目标机器 benchmark 三机实测**（原 G0.5-8，**P-2 已拍板采纳 ADR-0022 选项二：
  改挂为 v1.0 出口，不再是 v1 的入口前置**）。承接卡 **T-291**（手册与三机采集）+ **T-292**
  （阴影三档裁决）。**机器判据只能核对报告 JSON 入库，核对不了帧率本身**——所以它在 H 系列不在 G 系列。
  **v1.0 收口时必须闭合；没闭合就不许标绿，如实写「未过，且原因是什么」。**
- [ ] H2 ~ H7 · 其余人工验收（规划 §7.2 里归属 v1.0 的六项）

## v1.2 晋级门槛 G1.2-1 ~ G1.2-9 —— 核对卡：T-333

## v1.5 晋级门槛 G1.5-1 ~ G1.5-16 —— 核对卡：T-459

---

> ### ✅ 三条已拍板（2026-08-03，与文首重复，此处便于收尾核对）
> **P-1** v1 拆成 v1.0 / v1.2 / v1.5 三级台阶 —— **批准**（改 NORTH_STAR §3，依据 ADR-0020，由 T-212 写）
> **P-2** G0.5-8 的挂载方式 —— **批准 ADR-0022 的选项二**：改挂为 **v1.0 出口人工验收项 H1**，
> 不再是 v1 的入口前置；承接卡 T-291 / T-292，回填位在上面的 H1 行
> **P-3** 合同措辞四处差异 —— **逐项已裁**：特效收窄为「描边、雾等预设效果」·
> 二维码补回来且本地生成（T-454）· 明写「透明背景导出不含描边效果」· 出图长边上限 3840；
> 爆炸与剖切在技术方案 §6.2 缺席这条仍由 **T-212** 承接
>
> ⚠ **编号提醒**：以上是**台账自己的** P-1 / P-2 / P-3。拍板结果清单是另一套编号（P-1 ~ P-20），
> 其中台账的 P-3 对应拍板清单的 **P-9 / P-10 / P-11 / P-12**，**不是**拍板清单的 P-3。
> 本版落进台账的其余拍板项：**P-6**（T-338 动画倒放）· **P-14**（T-423 改写为减面卡）·
> **P-15**（T-217 / T-218 / T-400 / T-401 / T-420 / T-422 / T-423 的依赖审批闭合，ADR-0030）·
> **P-17**（ADR-0031）· **P-18**（T-299）· **P-19**（T-337）· **P-20**（T-282 补重命名）。

---

**全版本合计：199 张卡 / 222.7 人日 / ≈259 小时 agent 时钟。**
其中 **100 张 / 111.0 人日属 v1.0**——它对应产品负责人的三个词：**能演示、能卖、能被嵌进别人的系统。**

> **2026-08-03 拍板落地后的数字链，一次列全（附录 C 三张表逐格与它对齐）**：
> v1.0 **100 张 / 111.0d** · v1.2 **39 张 / 33.6d** · v1.5 **60 张 / 78.1d** ·
> 全书 **199 张 / 222.7d ≈ 259 小时**。
> 相对上一版（196 / 220.5 / ≈257）的**全部四笔改动**：
> **+T-337**（相机路径巡游 1.0d，P-19）· **+T-338**（动画倒放 1.2d，P-6）·
> **+T-299**（AI provider 插座 0.2d，P-18）· **T-282 +0.2d**（补重命名，P-20）·
> **T-322 +0.1d**（覆盖负 speed 的 parity 步）· **T-423 −0.5d**（P-14 砍 KTX2 服务端编码，改写为减面卡）。
> **动作数链的三个断言值：T-296 = 18 · T-331 = 27 · T-444 = 31。**
> 26 → 27 的那一个是 `flyToView`（T-337）；27 → 31 的四个是 `goToScene`（T-431）
> 加三个数据源动作（T-444）。**T-338 不加动作**——负 speed 是既有 `playAnimation` 的取值域放宽。
