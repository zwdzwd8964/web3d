# 零调用者豁免表

`scripts/check-dead-exports.mjs` 读这张表。**四列全部必填**，缺一即 exit 1。

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
| core:ClipPlayer.activeCount | T-237 的 mixer 回收要靠它断言反复播放不再堆积 action | T-237 | v1.2 |
| core:AssetLoader.evict | T-429 换场景时按新文档收窄已加载资产，届时它是清场的一环 | T-429 | v1.5 |
| core:RendererLike.getPixelRatio | T-214 的像素比封顶要读回渲染器当前值来断言钳位生效 | T-214 | v1.2 |
| core:RendererLike.setClearColor | T-266 出图时改背景色，还原栈按进入前的值恢复 | T-266 | v1.2 |
| core:RendererLike.setClearAlpha | T-266 的透明背景导出要把清除透明度设为零 | T-266 | v1.2 |
| core:RendererLike.clippingPlanes | T-243 的剖切层把平面写到这里，断言也读这里 | T-243 | v1.2 |
| core:RendererLike.localClippingEnabled | T-243 同批，逐材质剖切的开关留在接口上先不启用 | T-243 | v1.2 |
| core:RendererLike.capabilities | T-262 的出图钳位公式要读 maxTextureSize 判上限 | T-262 | v1.2 |
| core:RendererLike.setRenderTarget | T-235 的 composer 需要它切换离屏目标与画布 | T-235 | v1.2 |
| core:SceneRuntime.beginCapture | T-266 的出图八步链路在开头调它：期间 tick 不画、resize 只记不改 | T-266 | v1.2 |
| core:SceneRuntime.endCapture | T-266 同批交付，它负责弹出被推迟的 resize | T-266 | v1.2 |
| core:SceneRuntime.setSelectionOutline | T-241 的场景效果面板把编辑器选中态接进描边通道 | T-241 | v1.2 |
| core:SceneRuntime.setExplode | T-244 的爆炸叠加层与 T-248 的滑块工具态调用它 | T-244 | v1.2 |
| core:SceneRuntime.captureImage | T-266 的出图八步链路由它编排，含还原栈与重入拒绝 | T-266 | v1.2 |
| core:SceneRuntime.flyToView | T-337 的相机路径巡游按采样函数逐帧驱动相机 | T-337 | v1.5 |
| core:SceneRuntime.showPage | T-307 给覆盖层三方法做双实现与契约套件时接上 | T-307 | v1.5 |
| core:SceneRuntime.hidePage | T-307 同批交付，语义与 closePanel 逐字同形 | T-307 | v1.5 |
| core:SceneRuntime.isPageVisible | T-307 同批交付，它是条件求值那一侧的入口 | T-307 | v1.5 |
| core:SceneRuntime.swapDocument | T-429 的多场景切换按七步清场顺序换文档 | T-429 | v1.5 |
| schema:EXPLODE_MODE_LABELS | T-244 的爆炸叠加层要给两种模式显示中文名，标签表与 EXPLODE_MODES 同源才不会漏一支 | T-244 | v1.2 |

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
