# v0 任务卡清单

**用法**：agent 一次领一张，做完跑自测命令，绿了改 `[x]` 并回填耗时，再领下一张。
**上位文档**：[MVP_V0_孵化规划.md](MVP_V0_孵化规划.md) · [CLAUDE.md](CLAUDE.md)（每张卡的 DoD 在那里）

每张卡的字段：
- **依赖**：必须先完成的卡
- **独占**：这张卡会创建/修改的文件。**多 agent 并行时，独占文件不重叠的卡才能同时开工**
- **验收**：怎么算做完
- **自测**：跑什么命令

标 ★ 的是**接口先行卡**——它只定义接口不写实现，完成后能同时解锁多条并行分支。多 agent 模式下优先做完所有 ★ 卡。

---

## 并行波次

单 agent 顺序模式可忽略本节，直接从 T-001 按编号做。

| 波次 | 可同时开工 | 前置 |
|---|---|---|
| W0 | T-001 → 完成后停下来人工确认 | — |
| W1 | T-002, T-003, T-004, T-005, T-006 | T-001 |
| W2 | ★T-010, ★T-020, ★T-030 | W1 |
| W3 | T-011→T-017 ｜ T-021→T-024 ｜ T-031→T-036 | W2 对应 ★ 卡 |
| W4 | T-050→T-054 ｜ T-060→T-062 ｜ T-037→T-041 ｜ T-080→T-083 | W3 |
| W5 | T-063→T-069 ｜ T-070→T-072 ｜ T-084→T-087 | W4 |
| W6 | T-090→T-093 ｜ T-100→T-102 | W5 |
| W7 | T-103, T-104, T-105, T-110→T-114 | W6 |

---

## E0 · 工程底座

### [ ] T-001 · monorepo 骨架与包边界 ★
- **依赖** 无 · **预估** 0.5d · **实际** ___
- **独占** `pnpm-workspace.yaml`, `tsconfig.base.json`, `package.json`, `packages/*/package.json`, `packages/*/tsconfig.json`, `packages/*/src/index.ts`, `.gitignore`, `.editorconfig`, `.npmrc`
- **做** 建 5 个包（schema / storage / core / editor / player），按 [MVP 规划](MVP_V0_孵化规划.md) §3 配置依赖方向与 `strict: true`。安装依赖，把实测版本号回填到 MVP 规划 §4 的《实测版本》表。写 `docs/adr/0001-monorepo-与包边界.md` 与 `0002-v0-不含后端.md`。
- **验收** 5 个包能互相 import；three/R3F/gltf-transform 在 package.json 中是精确版本无 `^`；`pnpm-lock.yaml` 已提交
- **自测** `pnpm -r typecheck`
- **⚠ 完成后停下来汇报，等人工确认再继续。** 包边界错了后面全错，且单测发现不了。

### [ ] T-002 · 工具链
- **依赖** T-001 · **预估** 0.5d · **实际** ___
- **独占** `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `packages/*/vite.config.ts|tsup.config.ts`, 根 `package.json` scripts
- **做** Vitest（core 的 eca 目录配 `environment: 'node'`）、ESLint、Prettier、构建配置、根 scripts（见 CLAUDE.md 常用命令表）
- **验收** `pnpm -r test` 空跑通过；`pnpm -r build` 产出 dist
- **自测** `pnpm -r lint && pnpm -r build`

### [ ] T-003 · 宪法检查：core 纯净度（C2）
- **依赖** T-002 · **预估** 0.3d · **实际** ___
- **独占** `scripts/check-core-purity.mjs`
- **做** 扫描 `packages/core` 的 package.json 依赖与全部 `import`/`require`，命中黑名单（`react` `react-dom` `@react-three/*` `@w3/storage` `vue`）即退出码 1。支持 `// CONSTITUTION-EXCEPTION: C2 · ADR-XXXX · 到期 vN` 白名单注释。
- **验收** 故意在 core 里加一行 `import React` → 脚本 fail；删掉 → pass
- **自测** `node scripts/check-core-purity.mjs`

### [ ] T-004 · 宪法检查：零外链（C6）
- **依赖** T-002 · **预估** 0.3d · **实际** ___
- **独占** `scripts/check-no-external.mjs`
- **做** 扫描 `packages/*/dist` 与 `packages/{editor,player}/dist` 全部文本产物中的 `http://` / `https://` 外链，排除注释与 `schema.org` 之类的 XML 命名空间。
- **验收** 故意引一个 CDN → fail
- **自测** `pnpm -r build && node scripts/check-no-external.mjs`

### [ ] T-005 · 宪法检查：存储抽象（C7）+ 总入口
- **依赖** T-003, T-004 · **预估** 0.3d · **实际** ___
- **独占** `scripts/check-storage-abstraction.mjs`, `scripts/check-constitution.mjs`
- **做** 在 core/editor/player 中扫 `indexedDB` `aws-sdk` `@aws-sdk` `node:fs` `require('fs')`；总入口串起三个检查。
- **验收** `pnpm check:constitution` 三项全绿
- **自测** `pnpm check:constitution`

### [ ] T-006 · 三方运行时自托管 + 离线构建验证
- **依赖** T-002 · **预估** 0.5d · **实际** ___
- **独占** `vendor/draco/**`, `vendor/basis/**`, `scripts/verify-offline-build.md`, editor/player 的静态资源配置
- **做** 把 Draco decoder 与 KTX2 transcoder 拷进 `vendor/`，配置 `DRACOLoader.setDecoderPath` / `KTX2Loader.setTranscoderPath` 指向本地。写一份离线构建验证步骤文档。
- **验收** 断开网络后 `pnpm build` 成功；构建产物中无外部域名
- **自测** `pnpm build && node scripts/check-no-external.mjs`

---

## E1 · `@w3/schema`

### [ ] T-010 · ID 生成器与基础类型 ★
- **依赖** T-002 · **预估** 0.3d · **实际** ___
- **独占** `packages/schema/src/id.ts`, `src/primitives.ts`, `test/id.test.ts`
- **做** [SCHEMA_SPEC](SCHEMA_SPEC.md) §2：前缀表、`Id()` 校验器、`newId(prefix, existingIds?)` 含碰撞检查、变量 ID 规则与保留字表、`Vec3` `Quat` `HexColor`
- **验收** 格式正确；碰撞时重生成；保留字被拒
- **自测** `pnpm -F @w3/schema test id`

### [ ] T-011 · SceneDocument 类型定义
- **依赖** T-010 · **预估** 1d · **实际** ___
- **独占** `packages/schema/src/document.ts`, `src/asset.ts`, `src/node.ts`, `src/material.ts`, `src/animation.ts`, `src/hotspot.ts`, `src/viewpoint.ts`, `src/variable.ts`, `src/deferred.ts`
- **做** [SCHEMA_SPEC](SCHEMA_SPEC.md) §1、§3–§7 全部 Zod schema。**类型一律 `z.infer`，不手写 interface。** `deferred.ts` 放 v0 不实现的 pages/flows/media。
- **验收** 无手写 interface；无裸 `z.string()` 当枚举用；`constraints` 字段不存在
- **自测** `pnpm -F @w3/schema typecheck`

### [ ] T-012 · 校验器
- **依赖** T-011 · **预估** 0.3d · **实际** ___
- **独占** `packages/schema/src/validate.ts`, `test/validate.test.ts`
- **做** `validate(input): Result<SceneDocument, ValidationError[]>`，用 `safeParse`，错误带 JSON 路径
- **验收** 合法文档通过；每类非法输入返回可定位的路径
- **自测** `pnpm -F @w3/schema test validate`

### [ ] T-013 · 迁移框架
- **依赖** T-012 · **预估** 0.5d · **实际** ___
- **独占** `packages/schema/src/migrate.ts`, `test/migrate.test.ts`
- **做** [SCHEMA_SPEC](SCHEMA_SPEC.md) §10。`MIGRATIONS` 数组（v0 为空）、`migrate()` 链式执行、`CURRENT_VERSION`。**即使是恒等函数也要写好并测试。**
- **验收** v1 文档原样通过；未来版本号报明确错误；迁移函数是纯函数
- **自测** `pnpm -F @w3/schema test migrate`

### [ ] T-014 · 文档构造器与选择器
- **依赖** T-012 · **预估** 0.5d · **实际** ___
- **独占** `packages/schema/src/factory.ts`, `src/selectors.ts`, `test/factory.test.ts`
- **做** `createEmptyDocument(name)`、`createNode` / `createMaterial` / … 各类工厂（带默认值与 ID 生成）、`getAncestors` `getDescendants` `getSiblingOrder` 等纯查询
- **验收** 工厂产物直接通过 `validate`
- **自测** `pnpm -F @w3/schema test factory`

### [ ] T-015 · 运行期索引
- **依赖** T-014 · **预估** 0.5d · **实际** ___
- **独占** `packages/schema/src/index-builder.ts`, `test/index-builder.test.ts`
- **做** [SCHEMA_SPEC](SCHEMA_SPEC.md) §8 的 `DocIndex`，含 `childrenOf`（按 order 排序）、`rulesByEvent`、`refsTo` 反向引用
- **验收** `refsTo` 能正确回答"删除 nd_x 会影响哪些规则/动画/热点"
- **自测** `pnpm -F @w3/schema test index-builder`

### [ ] T-016 · 引用完整性检查
- **依赖** T-015 · **预估** 0.8d · **实际** ___
- **独占** `packages/schema/src/integrity.ts`, `test/integrity.test.ts`
- **做** [SCHEMA_SPEC](SCHEMA_SPEC.md) §9 的 I1–I10 全部检查项
- **验收** **每项至少一条正例 + 一条反例单测**；环检测覆盖自环与长环
- **自测** `pnpm -F @w3/schema test integrity`

### [ ] T-017 · assetRef 重映射
- **依赖** T-015 · **预估** 0.8d · **实际** ___
- **独占** `packages/schema/src/remap.ts`, `test/remap.test.ts`
- **做** [SCHEMA_SPEC](SCHEMA_SPEC.md) §5.3 四级策略 + `MigrationReport`
- **验收** 五种结果分类（exact/byName/byPathScore/ambiguous/orphaned）各一条单测；**必须有一条断言"孤儿节点未被删除且 missing 被标记"**
- **自测** `pnpm -F @w3/schema test remap`

### [ ] T-018 · 黄金 fixture 与回归测试
- **依赖** T-016, T-013 · **预估** 0.3d · **实际** ___
- **独占** `packages/schema/test/fixtures/v1/golden-path.json`, `test/fixtures.test.ts`
- **做** 把 [SCHEMA_SPEC](SCHEMA_SPEC.md) §12 的完整示例落地为 fixture；写遍历所有 fixture 目录的回归测试
- **验收** fixture 通过 `migrate → validate → checkIntegrity` 且零 error
- **自测** `pnpm -F @w3/schema test fixtures`

---

## E2 · `@w3/storage`

### [ ] T-020 · StorageProvider 接口 ★
- **依赖** T-011 · **预估** 0.3d · **实际** ___
- **独占** `packages/storage/src/provider.ts`
- **做** 定义接口：`listProjects` `loadDocument` `saveDocument` `putBlob(bytes)→hash` `getBlob(hash)` `hasBlob(hash)` `listSnapshots` `saveSnapshot` `loadSnapshot`。**只定义，不实现。**
- **验收** 接口中不出现任何具体存储技术的词汇
- **自测** `pnpm -F @w3/storage typecheck`

### [ ] T-021 · 内容哈希与寻址
- **依赖** T-020 · **预估** 0.3d · **实际** ___
- **独占** `packages/storage/src/hash.ts`, `test/hash.test.ts`
- **做** WebCrypto SHA-256 → `sha256:<hex>`；`hashToPath(hash, ext)` → `assets/ab/12/ab12….glb`
- **验收** 同内容同 hash；路径分片正确
- **自测** `pnpm -F @w3/storage test hash`

### [ ] T-022 · MemoryProvider
- **依赖** T-020 · **预估** 0.3d · **实际** ___
- **独占** `packages/storage/src/memory-provider.ts`, `test/contract.ts`
- **做** 纯内存实现 + 一套 `describeProviderContract(makeProvider)` 共用测试套件（后续每个 Provider 都跑它）
- **验收** 契约测试全绿
- **自测** `pnpm -F @w3/storage test memory`

### [ ] T-023 · IndexedDbProvider
- **依赖** T-022 · **预估** 0.8d · **实际** ___
- **独占** `packages/storage/src/idb-provider.ts`, `test/idb.test.ts`
- **做** 用 `idb` 实现同一接口。三个 store：`projects`（元数据）、`documents`（整份 JSON）、`blobs`（按 hash）
- **验收** 跑同一套契约测试全绿；大文件（>50MB）读写正常
- **自测** `pnpm -F @w3/storage test idb`

### [ ] T-024 · `.w3p` 场景包打解包
- **依赖** T-021 · **预估** 0.5d · **实际** ___
- **独占** `packages/storage/src/package.ts`, `test/package.test.ts`
- **做** [MVP 规划](MVP_V0_孵化规划.md) D8 的 zip 结构（manifest / scene.json / assets / thumbnail），用 `fflate`
- **验收** 打包→解包→文档 `toEqual` 原文档；manifest 含 `coreVersion`
- **自测** `pnpm -F @w3/storage test package`

---

## E3 · `@w3/core` Runtime

### [ ] T-030 · RuntimeContext 接口与类型 ★
- **依赖** T-011 · **预估** 0.3d · **实际** ___
- **独占** `packages/core/src/eca/types.ts`, `src/types.ts`
- **做** [ECA_SPEC](ECA_SPEC.md) §6 的 `RuntimeContext` 完整接口 + `RuntimeEvent` + `AssetResolver`。**只定义，不实现。** 这张卡解锁 ECA 与 Runtime 两条并行分支。
- **验收** 接口中无 three 类型泄漏
- **自测** `pnpm -F @w3/core typecheck`

### [ ] T-031 · SceneRuntime 骨架
- **依赖** T-030 · **预估** 0.8d · **实际** ___
- **独占** `packages/core/src/runtime/scene-runtime.ts`, `src/runtime/render-loop.ts`
- **做** 构造（canvas / assetResolver / mode）、renderer + scene + 默认光照、渲染循环、resize 观察、`dispose()` 彻底释放
- **验收** 挂载/卸载 100 次无内存增长（用 `renderer.info` 断言 geometries/textures 归零）
- **自测** `pnpm -F @w3/core test scene-runtime`

### [ ] T-032 · GLB 加载与 AssetResolver
- **依赖** T-031, T-006 · **预估** 0.8d · **实际** ___
- **独占** `packages/core/src/runtime/loader.ts`
- **做** GLTFLoader + DRACOLoader + KTX2Loader，解码器路径指向 `vendor/`。`AssetResolver` 由外部注入（core 不碰存储）。加载结果缓存按 assetId。
- **验收** 能加载普通 GLB、Draco 压缩 GLB、含 KTX2 贴图的 GLB
- **自测** `pnpm -F @w3/core test loader`

### [ ] T-033 · 场景图构建与双向映射
- **依赖** T-032 · **预估** 1d · **实际** ___
- **独占** `packages/core/src/runtime/scene-graph.ts`
- **做** `doc.nodes` → three Object3D 树；维护 `nodeId ↔ Object3D` 双向 Map；空节点折叠规则见 [SCHEMA_SPEC](SCHEMA_SPEC.md) §5.1；`assetRef: null` 的节点建空 Group
- **验收** 层级、transform、可见性与文档一致；`objectPath` 记录完整原始路径（不受折叠影响）
- **自测** `pnpm -F @w3/core test scene-graph`

### [ ] T-034 · 增量应用 applyPatch
- **依赖** T-033 · **预估** 0.8d · **实际** ___
- **独占** `packages/core/src/runtime/apply-patch.ts`, `test/apply-patch.test.ts`
- **做** [MVP 规划](MVP_V0_孵化规划.md) D1。按 patch 路径分发：`/nodes/i/transform/*` `/nodes/i/visible` `/nodes/i/parent` `/nodes/i/overrides/materialId` `/materials/i/params/*` 等。无法识别 → 全量重建 + `warn` + 计数器 `fullRebuildCount++`
- **验收** 每类 patch 有单测；`fullRebuildCount` 在正常操作路径下恒为 0
- **自测** `pnpm -F @w3/core test apply-patch`

### [ ] T-035 · 射线拾取
- **依赖** T-033 · **预估** 0.5d · **实际** ___
- **独占** `packages/core/src/runtime/picker.ts`
- **做** 屏幕坐标 → Raycaster → 命中 Object3D → 回溯到 nodeId。跳过 `locked` 与不可见节点。hover 节流。
- **验收** 遮挡关系正确（取最近命中）；locked 节点不可拾取
- **自测** `pnpm -F @w3/core test picker`

### [ ] T-036 · 相机控制与视点
- **依赖** T-031 · **预估** 0.8d · **实际** ___
- **独占** `packages/core/src/runtime/camera-controller.ts`
- **做** 轨道控制、`captureViewpoint()` → Viewpoint、`moveCamera(vp, {duration, signal})` 返回 Promise、`frameNode(nodeId)` 聚焦
- **验收** `moveCamera` 到位后 resolve；abort 时停在当前位置并 reject `AbortError`
- **自测** `pnpm -F @w3/core test camera`

### [ ] T-037 · Animator：导入 clip
- **依赖** T-033, T-030 · **预估** 0.8d · **实际** ___
- **独占** `packages/core/src/runtime/animator/clip.ts`
- **做** AnimationMixer 播放 imported 动画。**Promise 语义按 [MVP 规划](MVP_V0_孵化规划.md) D6**：自然播完 resolve；`loop: true` 立即 resolve；中断 reject `AbortError`；发 `animationEnd` 事件带 `completed`
- **验收** loop 动画 `await` 不挂起（这是最容易漏的边界）
- **自测** `pnpm -F @w3/core test animator-clip`

### [ ] T-038 · Animator：tween
- **依赖** T-037 · **预估** 0.8d · **实际** ___
- **独占** `packages/core/src/runtime/animator/tween.ts`, `src/runtime/easing.ts`
- **做** [SCHEMA_SPEC](SCHEMA_SPEC.md) §6.2 的 tween。`from` 缺失时取播放开始那一刻的当前状态。四元数用 slerp。缓动函数表按 schema 枚举一一实现。
- **验收** 与 clip 动画共用同一套 Promise/abort 语义；yoyo 与 loop 组合正确
- **自测** `pnpm -F @w3/core test animator-tween`

### [ ] T-039 · MaterialRegistry（clone-on-write）
- **依赖** T-033 · **预估** 1d · **实际** ___
- **独占** `packages/core/src/runtime/material-registry.ts`, `test/material-registry.test.ts`
- **做** [MVP 规划](MVP_V0_孵化规划.md) D3。写时复制、引用计数、dispose、色彩空间按槽位固定处理
- **验收** **专项单测**：两个 mesh 共享材质 → 改其一 → 断言另一个的 `material` 引用未变、参数未变（技术方案 R08）
- **自测** `pnpm -F @w3/core test material-registry`

### [ ] T-040 · 高亮
- **依赖** T-039 · **预估** 0.5d · **实际** ___
- **独占** `packages/core/src/runtime/highlight.ts`
- **做** v0 用 emissive 叠加实现，走 clone-on-write 路径。preset 表：`outline_amber` `outline_cyan` `outline_red` 等。取消时精确还原。**不引 EffectComposer。**
- **验收** 高亮→取消后材质参数与高亮前逐字段相等
- **自测** `pnpm -F @w3/core test highlight`

### [ ] T-041 · 热点锚点与遮挡
- **依赖** T-033, T-035 · **预估** 1d · **实际** ___
- **独占** `packages/core/src/runtime/hotspot-layer.ts`
- **做** [MVP 规划](MVP_V0_孵化规划.md) D7。定义 `HotspotRenderer` 接口（**为 v1 的出图 sprite 实现预留，技术方案 R06**），v0 实现 DOM 版：世界坐标→屏幕坐标、`translate3d` 定位、射线遮挡判定、视锥剔除、节流
- **验收** 遮挡判定正确；1000 个热点时不掉帧（视锥外零射线）
- **自测** `pnpm -F @w3/core test hotspot`

---

## E4 · 资产管线

### [ ] T-050 · 体检
- **依赖** T-024 · **预估** 0.8d · **实际** ___
- **独占** `packages/core/src/assets/audit.ts`, `src/assets/policy.ts`, `test/audit.test.ts`
- **做** `@gltf-transform/core` 统计 tris / materials / textures / nodes / bytes / textureBytes（解压后估算）/ clip 名单。阈值集中在 `policy.ts`（**这些数值直接生成《附件A》草案**）。产出 `audit.findings`，每条含中文处理建议。
- **验收** 统计准确；超标项 advice 非空且具体（"4K 降 2K"而非"请优化"）
- **自测** `pnpm -F @w3/core test audit`

### [ ] T-051 · 归一化
- **依赖** T-050 · **预估** 0.5d · **实际** ___
- **独占** `packages/core/src/assets/normalize.ts`
- **做** [SCHEMA_SPEC](SCHEMA_SPEC.md) §5.2：单位缩放、up 轴旋转，记入 `asset.normalized`
- **验收** cm/mm 源模型归一后包围盒尺寸正确；Z-up 源模型朝向正确
- **自测** `pnpm -F @w3/core test normalize`

### [ ] T-052 · 实例化
- **依赖** T-051, T-033 · **预估** 0.8d · **实际** ___
- **独占** `packages/core/src/assets/instantiate.ts`
- **做** glTF 场景图 → `Node[]`。空节点折叠、`objectPath` 完整记录、`order` 按间隔 1000 分配
- **验收** 折叠后层级树可读；`objectPath` 未受折叠影响
- **自测** `pnpm -F @w3/core test instantiate`

### [ ] T-053 · 客户端缩略图
- **依赖** T-052, T-036 · **预估** 0.5d · **实际** ___
- **独占** `packages/core/src/assets/thumbnail.ts`
- **做** 离屏渲染 + 自动取景 → PNG blob。**不做服务端 headless WebGL**（技术方案 §1.5）
- **验收** 输出 256×256 PNG，模型完整入画
- **自测** 人工看图 + `pnpm -F @w3/core test thumbnail`

### [ ] T-054 · 导入编排
- **依赖** T-053, T-021 · **预估** 0.5d · **实际** ___
- **独占** `packages/core/src/assets/import-pipeline.ts`
- **做** 串起 [SCHEMA_SPEC](SCHEMA_SPEC.md) §5.1 全流程：hash → 查重 → 体检 → 归一 → 缩略图 → 存储 → asset 记录 → 实例化。返回进度事件流。
- **验收** 同文件二次导入命中缓存不重复存储
- **自测** `pnpm -F @w3/core test import-pipeline`

---

## E5 · 编辑器外壳

### [ ] T-060 · 应用骨架与布局
- **依赖** T-002 · **预估** 0.5d · **实际** ___
- **独占** `packages/editor/src/App.tsx`, `src/layout/**`, `src/main.tsx`
- **做** 四区布局（左层级树 / 中视口 / 右属性 / 下资产与规则），可拖拽分栏。引入 UI 组件库，**不自研设计系统**。
- **验收** 布局可用；无外部字体/图标 CDN
- **自测** `pnpm dev` 目视

### [ ] T-061 · 文档 store 与 commit/preview
- **依赖** T-014 · **预估** 1d · **实际** ___
- **独占** `packages/editor/src/store/document-store.ts`, `test/document-store.test.ts`
- **做** [SCHEMA_SPEC](SCHEMA_SPEC.md) §11 全部 API。Zustand + `produceWithPatches`。500ms 同 label 合并策略。选中集合（多选）也在这里。
- **验收** `commit` 落栈、`preview` 不落栈、`previewStart/Commit` 合并成一条；合并策略有单测
- **自测** `pnpm -F @w3/editor test document-store`

### [ ] T-062 · 视口与 Runtime 挂载
- **依赖** T-061, T-034 · **预估** 0.8d · **实际** ___
- **独占** `packages/editor/src/viewport/Viewport.tsx`, `src/viewport/runtime-bridge.ts`
- **做** 挂载 `SceneRuntime`；store patches → `applyPatch`；拾取结果 → 选中集合。**编辑模式下 ECA `enabled = false`**（[ECA_SPEC](ECA_SPEC.md) §7）
- **验收** 改文档视口跟随；`fullRebuildCount` 保持 0
- **自测** `pnpm dev` + 控制台断言计数

### [ ] T-063 · 层级树
- **依赖** T-062 · **预估** 1d · **实际** ___
- **独占** `packages/editor/src/panels/HierarchyTree.tsx`, `src/panels/tree-dnd.ts`
- **做** 虚拟滚动、展开折叠、多选（Ctrl/Shift）、重命名、拖拽改父与改序、`missing` 与 `locked` 图标
- **验收** 1000 节点流畅；**拖入自身子树被阻止**；改父/改序各落一条撤销
- **自测** `pnpm dev` 目视 + `pnpm -F @w3/editor test tree-dnd`

### [ ] T-064 · 属性面板
- **依赖** T-063 · **预估** 0.8d · **实际** ___
- **独占** `packages/editor/src/panels/PropertiesPanel.tsx`, `src/widgets/**`
- **做** transform（**UI 显示欧拉角，存四元数**）、name、visible、locked。多选时显示共同值，混合值显示 `—`。数字输入支持拖拽调节（走 preview/previewCommit）。
- **验收** 欧拉↔四元数往返无漂移；多选批量改生效
- **自测** `pnpm dev` 目视

### [ ] T-065 · gizmo
- **依赖** T-064 · **预估** 0.8d · **实际** ___
- **独占** `packages/editor/src/viewport/Gizmo.tsx`
- **做** translate/rotate/scale 三模式，世界/局部坐标系切换。**严格走 [MVP 规划](MVP_V0_孵化规划.md) D2 的 previewStart → preview×N → previewCommit**
- **验收** **一次拖拽在撤销栈里恰好一条记录**；多选时以包围盒中心为轴心
- **自测** `pnpm dev` + 拖一次看历史面板条数

### [ ] T-066 · 资产面板与导入 UI
- **依赖** T-054, T-063 · **预估** 1d · **实际** ___
- **独占** `packages/editor/src/panels/AssetPanel.tsx`, `src/dialogs/ImportDialog.tsx`, `src/dialogs/RemapReportDialog.tsx`
- **做** 拖入文件 → 进度 → **体检报告对话框（逐项 pass/warn/fail + 建议）** → 确认导入。二次上传时展示重映射报告：`已迁移 N / 需确认 M / 失效 K`，可逐条人工重指。
- **验收** 体检 fail 项醒目；重映射对话框可完成人工重指
- **自测** `pnpm dev` 走一遍导入 + 二次导入

### [ ] T-067 · 材质面板
- **依赖** T-039, T-064 · **预估** 0.8d · **实际** ___
- **独占** `packages/editor/src/panels/MaterialPanel.tsx`
- **做** color / roughness / metalness / opacity / emissive 编辑，贴图槽位指定。改动走 commit。
- **验收** 改一个节点材质，共享同源材质的其他节点不变（对应 T-039）
- **自测** `pnpm dev` 目视验证共享陷阱

### [ ] T-068 · 动画面板
- **依赖** T-038, T-064 · **预估** 1d · **实际** ___
- **独占** `packages/editor/src/panels/AnimationPanel.tsx`
- **做** 动画列表；imported 类型可选 clip 与参数；tween 类型编辑器：选目标节点 → "记录当前状态为起点/终点" 按钮 → 时长 → 缓动下拉 → 预览播放。**不做时间轴与曲线编辑**（技术方案 R03）
- **验收** 能创建黄金路径第 8 步的 anm_1；预览播放正确
- **自测** `pnpm dev`

### [ ] T-069 · 视点面板
- **依赖** T-036 · **预估** 0.3d · **实际** ___
- **独占** `packages/editor/src/panels/ViewpointPanel.tsx`
- **做** 保存当前视角为视点（附缩略图）、点击跳转、重命名、删除
- **验收** 黄金路径第 7 步可完成
- **自测** `pnpm dev`

---

## E6 · 撤销重做

### [ ] T-070 · 历史栈
- **依赖** T-061 · **预估** 0.5d · **实际** ___
- **独占** `packages/editor/src/store/history.ts`, `test/history.test.ts`
- **做** patches/inversePatches 双栈，上限 200 条，超出丢弃最旧。`undo()` `redo()` `canUndo` `canRedo` `clear()`
- **验收** undo → redo → 文档 `toEqual` 原文档；新操作清空 redo 栈
- **自测** `pnpm -F @w3/editor test history`

### [ ] T-071 · 快捷键与历史面板
- **依赖** T-070 · **预估** 0.3d · **实际** ___
- **独占** `packages/editor/src/shortcuts.ts`, `src/panels/HistoryPanel.tsx`
- **做** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y；历史面板列出带 label 的记录，可跳转到任意历史点
- **验收** 输入框聚焦时快捷键不误触发
- **自测** `pnpm dev`

### [ ] T-072 · 撤销与 Runtime 一致性测试
- **依赖** T-071, T-034 · **预估** 0.5d · **实际** ___
- **独占** `packages/editor/test/undo-runtime-parity.test.ts`
- **做** 随机生成 200 次编辑操作 → 全部 undo → 断言 three 场景图状态与初始状态一致（transform / visible / parent / material 引用）
- **验收** 属性测试稳定通过
- **自测** `pnpm -F @w3/editor test undo-runtime-parity`

---

## E7 · ECA 引擎

### [ ] T-080 · 事件总线
- **依赖** T-030, T-015 · **预估** 0.5d · **实际** ___
- **独占** `packages/core/src/eca/events.ts`, `test/events.test.ts`
- **做** [ECA_SPEC](ECA_SPEC.md) §2。事件表、`NodeTarget` 匹配（含 `includeDescendants` 与 `any`）、**基于 `rulesByEvent` 索引分发，不遍历全部规则**
- **验收** `includeDescendants` 匹配子树；100 条规则下 hover 事件分发耗时可忽略
- **自测** `pnpm -F @w3/core test eca/events`

### [ ] T-081 · 条件求值
- **依赖** T-080 · **预估** 0.5d · **实际** ___
- **独占** `packages/core/src/eca/conditions.ts`, `test/conditions.test.ts`
- **做** [ECA_SPEC](ECA_SPEC.md) §3。ValueExpr 求值（const / var / prop / event）、全部 op、AND/OR 组合规则
- **验收** **类型不匹配返回 false + warn，不抛异常也不隐式转换**（B6）；求值无副作用
- **自测** `pnpm -F @w3/core test eca/conditions`

### [ ] T-082 · 动作注册表
- **依赖** T-030 · **预估** 0.5d · **实际** ___
- **独占** `packages/core/src/eca/actions/registry.ts`, `test/registry.test.ts`
- **做** [ECA_SPEC](ECA_SPEC.md) §4.1。`registerAction` / `getAction` / `allActions`，五个必填项（schema / handler / ui / refs / describe）在注册时校验缺失即抛错
- **验收** 缺任一必填项注册失败；重复 type 注册报错
- **自测** `pnpm -F @w3/core test eca/registry`

### [ ] T-083 · 执行器
- **依赖** T-082, T-081 · **预估** 1d · **实际** ___
- **独占** `packages/core/src/eca/executor.ts`, `test/executor.test.ts`
- **做** [ECA_SPEC](ECA_SPEC.md) §5。sequence/parallel、三种 reentry、AbortSignal 逐级传递、onError、`ExecResult`
- **验收** **[ECA_SPEC](ECA_SPEC.md) §9.2 的 B1–B5、B7、B8、B12 逐条有测试**。executor.ts 中**不得出现任何具体动作类型名**
- **自测** `pnpm -F @w3/core test eca/executor`

### [ ] T-084 · HeadlessRuntime + 契约测试
- **依赖** T-030 · **预估** 0.8d · **实际** ___
- **独占** `packages/core/src/eca/headless.ts`, `test/runtime-contract.ts`
- **做** 纯 JS 实现 `RuntimeContext`：Map 记状态、假时钟（可手动推进）、动画按时长模拟。**同时写 `describeRuntimeContract(makeCtx)` 共用套件，SceneRuntime 与 HeadlessRuntime 各跑一遍**
- **验收** 两个实现跑同一套契约测试全绿（防止 headless 与真实行为漂移）
- **自测** `pnpm -F @w3/core test runtime-contract`

### [ ] T-085 · v0 动作实现集
- **依赖** T-084, T-083, T-037, T-038, T-039, T-040, T-036 · **预估** 1.5d · **实际** ___
- **独占** `packages/core/src/eca/actions/{animation,scene,camera,ui,state}.ts` 及各自 `.test.ts`
- **做** [ECA_SPEC](ECA_SPEC.md) §4.2 的 13 个动作，全部照 §4.3 的形状写（五项齐全）
- **验收** **每个动作至少一条单测**；覆盖率门槛脚本（遍历 `allActions()` 比对测试清单）通过
- **自测** `pnpm -F @w3/core test eca/actions`

### [ ] T-086 · EcaEngine
- **依赖** T-085 · **预估** 0.8d · **实际** ___
- **独占** `packages/core/src/eca/engine.ts`, `test/engine.test.ts`
- **做** [ECA_SPEC](ECA_SPEC.md) §7。attach/detach、`onDocumentPatch` 增量更新索引、`setEnabled`、`history` 环形缓冲（500）、**变量连锁深度上限 16**
- **验收** B9、B10、B11、B13、B14 逐条有测试。**B13（退出预览完全还原编辑态）必测**
- **自测** `pnpm -F @w3/core test eca/engine`

### [ ] T-087 · 验收用例生成器
- **依赖** T-086 · **预估** 0.5d · **实际** ___
- **独占** `packages/core/src/eca/testgen.ts`, `test/testgen.test.ts`
- **做** [ECA_SPEC](ECA_SPEC.md) §8。`generateTestCases(doc)` → Markdown 表格（技术方案 R14）
- **验收** golden-path.json 生成的用例措辞与实际行为一致、可直接用于演示
- **自测** `pnpm -F @w3/core test testgen`

---

## E8 · 规则编辑 UI

### [ ] T-090 · 变量面板
- **依赖** T-061 · **预估** 0.5d · **实际** ___
- **独占** `packages/editor/src/panels/VariablePanel.tsx`
- **做** 增删改变量，类型选择，enum 的 options 编辑，ID 合法性与保留字校验，预览模式下显示实时值
- **验收** 黄金路径第 10 步的 `step` 变量可创建
- **自测** `pnpm dev`

### [ ] T-091 · 规则编辑器
- **依赖** T-090, T-082 · **预估** 1.5d · **实际** ___
- **独占** `packages/editor/src/panels/RulePanel.tsx`, `src/rule-editor/**`
- **做** when（事件类型 + 目标，**目标支持"在视口中拾取"**）、if/ifAny 条件行、mode/reentry/onError、then 动作列表（可拖拽排序）。**动作表单完全由 `ActionDefinition.ui.fields` 生成，禁止为任何动作手写表单**
- **验收** 新注册一个动作后，规则编辑器**零改动**即可编辑它（这是 C5 的实战检验）
- **自测** `pnpm dev` + 临时注册一个假动作验证

### [ ] T-092 · 引用完整性提示
- **依赖** T-091, T-016 · **预估** 0.3d · **实际** ___
- **独占** `packages/editor/src/panels/IssuePanel.tsx`
- **做** 实时跑 `checkIntegrity`，问题列表可点击定位。删除节点前用 `refsTo` 弹确认："该节点被 2 条规则、1 个动画引用，确认删除？"
- **验收** 删除有引用的节点时提示准确
- **自测** `pnpm dev`

### [ ] T-093 · 预览模式与调试面板
- **依赖** T-086, T-091 · **预估** 0.8d · **实际** ___
- **独占** `packages/editor/src/preview/PreviewMode.tsx`, `src/panels/RuleLogPanel.tsx`
- **做** 预览开关（进入 reset + `sceneReady`，退出 reset 还原编辑态）；日志面板展示 `ExecResult` 流：规则名、状态、各步骤耗时、跳过原因
- **验收** 黄金路径第 11 步完整跑通，含"再次点击无反应"的条件验证；**退出预览后编辑态完全还原**
- **自测** `pnpm dev` 走黄金路径 10–11 步

---

## E9 · 发布与播放器

### [ ] T-100 · 发布流程
- **依赖** T-024, T-016 · **预估** 0.8d · **实际** ___
- **独占** `packages/editor/src/publish/publish.ts`, `src/dialogs/PublishDialog.tsx`
- **做** [MVP 规划](MVP_V0_孵化规划.md) D8。`validate` + `checkIntegrity` → **error 阻断并列出清单** → 收集引用到的资产 → 打包 `.w3p` → 下载
- **验收** 有 error 时无法发布且提示可定位；产出包只含被引用的资产
- **自测** `pnpm dev` 发布一次并解压检查

### [ ] T-101 · Player 应用
- **依赖** T-100, T-086 · **预估** 1d · **实际** ___
- **独占** `packages/player/src/**`
- **做** 读 `.w3p`（或 URL 参数指向的包）→ 解包 → 挂 `SceneRuntime`（`mode: 'play'`）→ `EcaEngine.attach` + `enabled: true` → 热点层 → 面板 UI。**只读，无任何编辑能力。**
- **验收** **`@w3/core` 零改动**；`manifest.schemaVersion` 高于当前时报明确错误
- **自测** `pnpm dev:player`

### [ ] T-102 · 编辑器预览复用同一路径
- **依赖** T-101, T-093 · **预估** 0.5d · **实际** ___
- **独占** `packages/editor/src/preview/preview-session.ts`
- **做** 抽出 `createPlaybackSession(doc, ctx)` 供两侧共用。**编辑器预览与 Player 走完全相同的初始化与事件路径**（宪法 C3）
- **验收** 两侧代码路径可追溯到同一函数
- **自测** `pnpm -r typecheck`

### [ ] T-103 · Parity 测试 ★关键
- **依赖** T-102 · **预估** 0.8d · **实际** ___
- **独占** `test/parity/parity.test.ts`, `test/parity/event-script.json`
- **做** [ECA_SPEC](ECA_SPEC.md) §9.3。golden-path.json + 固定事件脚本 → 两侧各跑 → 断言 `ExecResult` 序列逐项相等
- **验收** 通过。**不过就停下来修架构，不要继续加功能**
- **自测** `pnpm test:parity`

### [ ] T-104 · 本地版本快照
- **依赖** T-100 · **预估** 0.5d · **实际** ___
- **独占** `packages/editor/src/publish/snapshots.ts`, `src/panels/SnapshotPanel.tsx`
- **做** 发布时存快照到 `StorageProvider`；列表展示、预览、回滚到某快照
- **验收** 回滚后文档与快照 `toEqual`
- **自测** `pnpm -F @w3/editor test snapshots`

### [ ] T-105 · Player 体积预算
- **依赖** T-101 · **预估** 0.3d · **实际** ___
- **独占** `size-limit.config.js`, CI 配置
- **做** 配 size-limit，阈值 gzip 400KB（不含资产与 vendor 解码器）
- **验收** 超标 CI fail
- **自测** `pnpm size-limit`

---

## E10 · 验收与文档

### [ ] T-110 · benchmark 页面
- **依赖** T-101 · **预估** 0.5d · **实际** ___
- **独占** `packages/player/src/bench/**`
- **做** 技术方案 §3.2-5：WebGL2 检测、帧率、drawcall、三角形数、贴图显存估算、逐级加载压力测试。结果可一键复制成 Markdown。
- **验收** 能在客户机器上独立运行（单页，无需编辑器）
- **自测** 人工

### [ ] T-111 · WebGL1 降级
- **依赖** T-110 · **预估** 0.5d · **实际** ___
- **独占** `packages/core/src/runtime/capability.ts`
- **做** 检测 WebGL2 → 不可用则降级 WebGL1 + 关闭不兼容特性 + 页面顶部提示。**降级路径必须能跑通黄金路径**（国产浏览器内核偏旧）
- **验收** 强制降级模式下黄金路径可完成
- **自测** URL 参数 `?forceWebGL1=1` 走一遍

### [ ] T-112 · 黄金路径 E2E
- **依赖** T-103 · **预估** 1d · **实际** ___
- **独占** `e2e/golden-path.spec.ts`, `e2e/fixtures/pump.glb`
- **做** Playwright 覆盖 [MVP 规划](MVP_V0_孵化规划.md) §2 的 12 步。**同时断言 `fullRebuildCount === 0`**
- **验收** 12 步全绿且稳定（连跑 5 次不 flaky）
- **自测** `pnpm test:e2e`

### [ ] T-113 · 《附件A 数字资产规范》草案
- **依赖** T-050, T-110 · **预估** 0.5d · **实际** ___
- **独占** `docs/附件A_数字资产规范_草案.md`
- **做** 从 `policy.ts` 的阈值 + benchmark 实测结果反推出可写进合同的数值：格式、单文件大小、面数、贴图数量与分辨率、坐标系与单位、命名规范（技术方案 R01 与性能验收的唯一保险）
- **验收** 每个数值都有实测或阈值来源，不是拍脑袋
- **自测** 人工评审

### [ ] T-114 · README 与二次开发说明
- **依赖** T-112 · **预估** 0.5d · **实际** ___
- **独占** `README.md`, `docs/DEVELOPMENT.md`, `docs/METRICS.md`, `docs/BENCHMARK.md`
- **做** 架构概览、包边界图、本地开发、构建部署、**如何新增一种动作**（[ECA_SPEC](ECA_SPEC.md) §10 的操作版）。填 METRICS 表（北极星 §7）与 BENCHMARK 实测结果。
- **验收** 一个没参与过的人照着能新增一种动作并跑通
- **自测** 人工

---

## 收尾：v0 晋级门槛核对

全部任务卡完成后，逐条核对 [NORTH_STAR.md](NORTH_STAR.md) §3 的 G0-1 ~ G0-7：

- [ ] G0-1 黄金路径 12 步 E2E 全绿（T-112）
- [ ] G0-2 `pnpm check:constitution` 全绿（T-005）
- [ ] G0-3 schema fixture 回归通过（T-018）
- [ ] G0-4 parity 测试通过（T-103）
- [ ] G0-5 动作单测覆盖 100%（T-085）
- [ ] G0-6 重映射五种分类正确、孤儿不删除（T-017）
- [ ] G0-7 benchmark 在目标机器实测并记录（T-110 + T-114）

七条全过 → v0 完成，可以开工 v1。**任何一条不过，不许开工 v1。**

---

**预估总计**：约 42 人日（含测试与文档）。这与技术方案 §5.1 的 45 人日估算量级一致——差异在于 v0 砍掉了后端（−5）与 8 项功能（−10），但把质量基建（宪法检查、契约测试、parity、E2E）提到了前面（+12）。这个交换是刻意的：**底座的质量债务，是唯一在 v1、v2 会连本带利偿还的债务。**
