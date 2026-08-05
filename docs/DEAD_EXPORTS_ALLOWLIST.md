# 零调用者豁免表

`scripts/check-dead-exports.mjs` 读这个文件里的**三张表**：

| 表 | 收什么 | 受条数棘轮约束吗 |
|---|---|---|
| [豁免](#豁免)（四列） | 能归到某一张卡、但今天确实没人调的导出 | **是**，`MAX_EXEMPTIONS` 只降不升 |
| [冻结接口](#冻结接口接口先落消费者在后)（五列） | 规划 §4 / 两份 SPEC 里**逐字冻结**、而消费者排在后面版本的 API | **否**，改由「必须写在规范里」这把门锁把关（[ADR-0033](adr/0033-冻结接口与随手导出分表.md)） |
| [v0 / v0.5 遗留基线](#v0--v05-遗留基线)（裸清单） | 归不到卡的历史存量 | **是**，`MAX_LEGACY` 只降不升 |

**每一列都必填**，缺一即 exit 1。

| 列 | 规则 |
|---|---|
| `symbol` | 全限定名，`<包>:<导出名>` 或 `<包>:<类型名>.<成员名>` |
| `reason` | **谁**会用到它、**什么时候**。**少于 10 个汉字直接判红**——「以后要用」不是理由 |
| `owner` | 任务卡号（形如 `T-317`），且必须在台账里真实存在 |
| `expires` | 版本阶梯上的一级（`v1.2` / `v1.5` / `v2` …）。**到期未清即 CI 转红** |

**棘轮**：`MAX_EXEMPTIONS` 写在脚本头部，**只能降不能升**。它是晋级门槛 G1.2-9
（「豁免表条数只降不升」）的全部实现——没有这个常量，那条门槛没有落点，而
「把它加进豁免表」会成为让守卫变绿的最省力做法。

**抬高 `MAX_EXEMPTIONS` 时**：在提交信息里写明理由，并在下面的「棘轮变更记录」里加一行。

## 棘轮变更记录

| 日期 | 卡 | 从 | 到 | 理由 |
|---|---|---|---|---|
| 2026-08-03 | T-205 | — | 34 | 建表。当天实测孤儿数见提交信息。**原记作 24，与常量不符**——`MAX_EXEMPTIONS` 自 d7adf97 起就是 34，从未改过（`git log -S` 实测），是这一行写错了，T-225 订正 |
| 2026-08-04 | T-225 | 34 | 35 | **本表唯一一次上调**。`schema:EXPLODE_MODE_LABELS` 是规划 §4.1.1 逐字冻结的一项，v1.0 内没有任何消费者、v1.2 的 T-244 爆炸面板才用得上。三条路各自的代价：删掉它 = 偏离 §4 的冻结清单；假造一个 v1.0 调用点 = 正是本守卫要拦的东西；上调 1 并登记 = 守卫完整、可逆、到期自动转红。取第三条 |
| 2026-08-05 | T-235 | 35 | **33** | **第一次往下走。** 接线了 registerChrome / setChromeVisible / pipelineMode / setPostFxEnabled 四条接缝，四行豁免随之删除；同时为 beginCapture / endCapture 新增两行（owner T-266，出图链路才有调用方）。净 −2。**这就是棘轮该有的样子**：交付一张卡，表变短 |
| 2026-08-05 | T-240 | 33 | 35 | **第二次上调，与 T-225 同一种情形。** `highlightOf` 是规划 §4 冻结的 v1.0 三项 `RuntimeContext` 增量之一，而 v1 的条件表里没有一条读得到高亮状态——它与早就躺在遗留基线上的 `materialOf` 逐字同形：接口上有读者、规则里还没有。三条路：删掉它 = 偏离 §4 冻结清单且 T-294 的 parity 轨迹没了比对项；在 `highlight()` 里塞一句 `this.highlightOf(...)` 当调用点 = 假造调用点，正是本守卫要拦的（那处真正的去重守卫已经落在 `OutlineLayer.apply` 里，它不需要 `highlightOf`）；上调 2 并登记 = 守卫完整、到期自动转红。取第三条 |
| 2026-08-05 | T-237 | 35 | 36 | `mixerCount`。**同时把 `releaseFor` 接进了 `apply-patch` 的 `case 'animations'`**——不接的话本卡是 +2：改过 clipName 的动画会安静地继续播老片段（scoped clip 按 (animationId, objectUuid) 缓存之后才有的新缺陷），所以那不是为了守卫凑的调用点，是这次改动自己欠的。另订正 `activeCount` 一行：它的原理由（「T-237 靠它断堆积」）被本卡实测证伪。⚠ 连着三张卡都在往上走（33→35→36），原因是同一个：v1.0 在按 §4 冻结清单落 API，而消费者在 v1.2 之后。**这已经不是单卡问题，v1.0 收口前要单独裁决一次**（选项：把这类「接口先落、消费者在后」的行挪进遗留基线同级的第三张表 / 把 §4 的落地时机推迟到消费卡 / 维持现状并接受表变长） |
| 2026-08-05 | （裁决 ADR-0033） | 36 | **26** | **−10，且这一次不是靠接线换来的，是靠分表。** 十条「规划 §4 逐字冻结、消费者在 v1.2/v1.5」的行迁进新的冻结接口表，四列表回到只装「归得到卡但今天没人调」的东西。⚠ 迁移不是豁免：新表有一把四列表没有的门锁——符号名必须逐字出现在它自己 `spec` 列点名的那节规范的**代码跨度**里，写不进规范的进不来。第一版门锁只查「出现在这一节里」，被 `schema:touch` 当场击穿（规划 §4 的一段 JSDoc 里写着 "touch nothing that is already there"），所以 `touch` 留在四列表里 |
| 2026-08-05 | T-241 | 26 | **25** | 接线 `setSelectionOutline`（Viewport 的选择 effect 是它的生产调用者），那一行随之删除。分表之后第一张卡就把表变短了一格——这正是 ADR-0033 想要的形状：四列表里剩下的都是「归得到卡但今天没人调」，接线一张就少一行 |
| 2026-08-05 | T-243 | 25 | **23** | 接线 `clippingPlanes` 与 `localClippingEnabled`（`SectionLayer.sync` 与 `attachRenderer`），两行随之删除。⚠ 本卡还差点为了让一条测试有东西可断而新增 `SceneRuntime.sectionPlaneCount`——闸门当场判它是孤儿，而它读的是本层账本、与本卡自己定的「断渲染器」纪律正相反。删掉它、测试改读渲染器桩，**这一次闸门拦住的正是它该拦的东西** |

## 豁免

**能归到某一张卡的写在这里。** 四列全部必填，`owner` 必须是台账里真实存在的卡号。

| symbol | reason | owner | expires |
|---|---|---|---|
| core:captureDevicePixels | 出图按 CSS 像素下单、按设备像素分配，T-262 的 planCapture 用它算真实分辨率；本卡先落公式是因为桩 limits 让缺了它的公式全绿 | T-262 | v1.2 |
| core:maxCaptureScale | 纹理上限随像素比收紧倍率天花板，T-262 的钳位链调它；同上，本卡只落公式不落 planCapture | T-262 | v1.2 |
| schema:touch | T-282 的项目层要让 meta.updatedAt 在保存时真的往前走 | T-282 | v1.2 |
| storage:OBJECT_STORES | T-286 的草稿槽与 T-287 的租约按这份清单读写各自的 store | T-286 | v1.2 |
| storage:IndexedDbProvider.deleteProject | T-282 的项目层调用它，两个实现同批接上 | T-282 | v1.2 |
| storage:MemoryProvider.deleteProject | T-282 的项目层调用它，两个实现同批接上 | T-282 | v1.2 |
| storage:StorageProvider.deleteProject | T-282 的项目列表交付删除入口，接口这一侧先留着 | T-282 | v1.2 |
| core:renderTestCasesMarkdown | 验收用例生成器由 T-317 在 v1.2 接上，v1.0 明确不接 | T-317 | v1.2 |
| core:AuditResult.summary | T-260 的体检报告界面按中文标签与格式化数值渲染这一段 | T-260 | v1.2 |
| core:suggestUnit | T-260 的导入报告要在单位可疑时给出建议值 | T-260 | v1.2 |
| core:describePolicy | T-261 重写附件A 的机械校验时按策略表生成人读说明 | T-261 | v1.2 |
| core:buildPumpDemoGlb | T-283 把泵组样板物化成一份可打开的项目，它是那条链上唯一的字节来源 | T-283 | v1.2 |
| core:SAMPLE_OBJECT_PATHS | T-222 的泵组样板给它补断言，这是同一形状第三次零调用者 | T-222 | v1.2 |
| core:ClipPlayer.activeCount | **本行的原理由被 T-237 实测证伪**：它数的是在播的条数，每次 play 前的 stop 让它恒为 1，量不到堆积——量得到的是同批新增的 mixerCount。它今天的价值在「重播不叠加」那几条单测上；生产读者只可能是 bench 页那排运行时计数（T-279） | T-279 | v1.2 |
| core:ClipPlayer.mixerCount | T-237 的验收按它断言「连做 5 次排练峰值不涨」，这是 mixer 堆积唯一量得到的地方；与 activeCount 同一形状，生产读者同归 bench 页 | T-279 | v1.2 |
| core:AssetLoader.evict | T-429 换场景时按新文档收窄已加载资产，届时它是清场的一环 | T-429 | v1.5 |
| core:RendererLike.getPixelRatio | T-214 的像素比封顶要读回渲染器当前值来断言钳位生效 | T-214 | v1.2 |
| core:RendererLike.setClearColor | T-266 出图时改背景色，还原栈按进入前的值恢复 | T-266 | v1.2 |
| core:RendererLike.setClearAlpha | T-266 的透明背景导出要把清除透明度设为零 | T-266 | v1.2 |
| core:RendererLike.capabilities | T-262 的出图钳位公式要读 maxTextureSize 判上限 | T-262 | v1.2 |
| core:RendererLike.setRenderTarget | T-235 的 composer 需要它切换离屏目标与画布 | T-235 | v1.2 |
| core:SceneRuntime.beginCapture | T-266 的出图八步链路在开头调它：期间 tick 不画、resize 只记不改 | T-266 | v1.2 |
| core:SceneRuntime.endCapture | T-266 同批交付，它负责弹出被推迟的 resize | T-266 | v1.2 |

## 冻结接口（接口先落，消费者在后）

**规划 §4 与两份 SPEC 是逐字实现的冻结规范**（CLAUDE.md 停下来问人第 8 条）。v1.0 照它交付
API，而消费它们的卡排在 v1.2 / v1.5。这类行不计入 `MAX_EXEMPTIONS`——理由与代价见
[ADR-0033](adr/0033-冻结接口与随手导出分表.md)。

第五列 `spec` 是**封闭取值**：`规划§4` / `SCHEMA_SPEC` / `ECA_SPEC`。守卫会去那一节里
按**代码跨度**逐字找这个符号名，找不到就红。**这把门锁是这张表可以不受条数限制的全部理由**，
不要绕过它：一个「随手加的、没人用的」导出写不进冻结规范，也就进不来这张表。

| symbol | reason | owner | expires | spec |
|---|---|---|---|---|
| core:SceneRuntime.explodeOf | T-245 的契约套件按它断「结束后 explodeOf(id)===factor」，规划 §4 的 explode 动作行逐字点名了它；与 highlightOf 同一形状——接口上有读者、规则里还没有 | T-245 | v1.2 | 规划§4 |
| core:SceneRuntime.captureImage | T-266 的出图八步链路由它编排，含还原栈与重入拒绝 | T-266 | v1.2 | 规划§4 |
| core:SceneRuntime.flyToView | T-337 的相机路径巡游按采样函数逐帧驱动相机 | T-337 | v1.5 | 规划§4 |
| core:SceneRuntime.showPage | T-307 给覆盖层三方法做双实现与契约套件时接上 | T-307 | v1.5 | 规划§4 |
| core:SceneRuntime.hidePage | T-307 同批交付，语义与 closePanel 逐字同形 | T-307 | v1.5 | 规划§4 |
| core:SceneRuntime.isPageVisible | T-307 同批交付，它是条件求值那一侧的入口 | T-307 | v1.5 | 规划§4 |
| core:SceneRuntime.swapDocument | T-429 的多场景切换按七步清场顺序换文档 | T-429 | v1.5 | 规划§4 |
| schema:EXPLODE_MODE_LABELS | T-244 的爆炸叠加层要给两种模式显示中文名，标签表与 EXPLODE_MODES 同源才不会漏一支 | T-244 | v1.2 | 规划§4 |
| core:RuntimeContext.highlightOf | T-294 的 parity 轨迹按它逐步比对两侧高亮状态；生产读者要等到规则条件读得到高亮，v1 的条件表里没有这一条 | T-294 | v2 | 规划§4 |
| core:SceneRuntime.highlightOf | 同上，这是真运行时那一侧的实现；两侧必须同时在，否则契约套件跑不起来 | T-294 | v2 | 规划§4 |

## v0 / v0.5 遗留基线

**归不到卡的写在这里**，只列符号名、不写理由——写不出诚实的 owner 时，编一个比空着更坏。

2026-08-03 首次实测：全仓 **121** 个零调用者导出面，而不是勘察点名的 11 个。
棘轮常量 `MAX_LEGACY` 写在脚本头部，**只能降不能升**；这里任何一条一旦有了生产调用者，
守卫会点名要求删掉它并调低棘轮——**这张表只能变短**。

不在这两张表里的新孤儿一律判红。这是「第 15 次复发不可能发生」的机械保证，
而第 1 ~ 14 次留在这里：可数、可见、只减不增。

- `schema:CollectionSpec.idPrefix`
- `schema:CollectionSpec.patchPath`
- `schema:createEmptyDocument`
- `schema:createImportedAnimation`
- `schema:createVariable`
- `schema:createRule`
- `schema:isId`
- `schema:createSequentialIdFactory`
- `schema:Ref.targetKind`
- `schema:DocIndex.childrenOf`
- `schema:DocIndex.assetById`
- `schema:DocIndex.actionRefsResolved`
- `schema:hasErrors`
- `schema:formatIntegrityIssues`
- `schema:MEDIA_ASSET_TYPES`
- `schema:MigrationFailure.validation`
- `schema:needsMigration`
- `schema:IDENTITY_TRANSFORM`
- `schema:MigrationReport.total`
- `schema:MigrationReport.oldAssetId`
- `schema:MigrationReport.newAssetId`
- `schema:RemapResult.report`
- `schema:applyManualRemap`
- `schema:summarizeMigrationReport`
- `schema:PUMP_OBJECTS_V1`
- `schema:PUMP_OBJECTS_V2`
- `schema:getRootNodes`
- `schema:getDescendants`
- `schema:getDisplayPath`
- `schema:getPrimitiveNodes`
- `schema:assertValid`
- `storage:IndexedDbProvider.destroy`
- `core:EcaEngine.isEnabled`
- `core:EcaEngine.clearHistory`
- `core:EcaEngine.idle`
- `core:EventBus`
- `core:EventBus.on`
- `core:FakeClock.pendingCount`
- `core:FakeClock.cancelAll`
- `core:HeadlessRuntime`
- `core:HeadlessRuntime.setCurrentEvent`
- `core:HeadlessRuntime.highlightOf`
- `core:HeadlessRuntime.materialOf`
- `core:HeadlessRuntime.mediaState`
- `core:HeadlessRuntime.timeOf`
- `core:ActionUi.icon`
- `core:AuditResult.failing`
- `core:ImageMeasurements.imageBytes`
- `core:ImageMeasurements.hdriBytes`
- `core:ImageMeasurements.imageSize`
- `core:ImageMeasurements.nonPowerOfTwo`
- `core:MediaMeasurements.audioBytes`
- `core:MediaMeasurements.videoBytes`
- `core:InstantiateResult.collapsed`
- `core:NO_NORMALIZATION`
- `core:TweenPlayer.activeCount`
- `core:VENDOR_DRACO_PATH`
- `core:VENDOR_KTX2_PATH`
- `core:createMemoryResolver`
- `core:ApplyPatchResult.handled`
- `core:ApplyPatchResult.rebuilt`
- `core:ApplyPatchResult.unhandled`
- `core:CameraController.isFlying`
- `core:CameraController.frameNode`
- `core:EnvironmentController.disposedEnvironments`
- `core:EnvironmentController.hasEnvironment`
- `core:shadowMapSizeFor`
- `core:primitiveSegments`
- `core:CapabilityReport.webgl2`
- `core:HighlightLayer.activeNodeIds`
- `core:HighlightLayer.isHighlighted`
- `core:HighlightLayer.presetNames`
- `core:DomHotspotRenderer.liveObjectUrls`
- `core:MaterialRegistry.cloneCount`
- `core:MaterialRegistry.isCloned`
- `core:countUsers`
- `core:Picker.pickAll`
- `core:PlaybackSession.engine`
- `core:PlaybackSession.isRunning`
- `core:sameRotation`
- `core:IDENTITY_QUAT`
- `core:SceneRuntime.defaultLightRig`
- `core:SceneRuntime.setCurrentEvent`
- `core:SceneGraph.setPrimitiveFactory`
- `core:SceneGraph.setLightFactory`
- `core:Gizmo.isDragging`
- `core:Gizmo.snap`
