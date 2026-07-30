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
| benchmark 实测（G0-7） | **未执行** | 需目标机器 | T-110 |

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

`@w3/schema` 中另加了两个规范未列出的文件：`selectors.ts`（纯查询，T-014 点名要 `getAncestors`
等）与 `rule.ts`（承载 EventDescriptor / Condition / Action 信封 / Rule 的数据形状——
它们被 `RuleSchema` 引用，而 schema 不能依赖 core）。

---

## 4. 任务卡状态

TASK_BACKLOG 已勾选：**61 张完成 / 12 张未开工**。

- **完成**：T-001 ~ T-006、T-010 ~ T-024、T-030 ~ T-041、T-050 ~ T-052、T-054、
  T-060 ~ T-072、T-080 ~ T-087、T-090 ~ T-093
- **未开工**：T-053（缩略图，需离屏 GL）、T-100 ~ T-105（发布与播放器）、
  T-110 ~ T-114（验收与文档）

### T-112 黄金路径 E2E —— 部分完成，未勾选

`e2e/tests/golden-path.spec.ts` 九步全绿、连跑 5 次零 flaky，全程断言
`fullRebuildCount === 0`。但卡片要求覆盖 [MVP 规划](MVP_V0_孵化规划.md) §2 的
**12 步，缺一步不算完成**，所以这张卡保持未勾选。逐步对照：

| 步 | 覆盖 | 说明 |
|---|---|---|
| 1 打开编辑器 | ✅ | 冷启动 + 像素断言（视口不是空网格） |
| 2 拖入 GLB → 体检报告 | ✅ | 内存生成 GLB，报告七项 |
| 3 确认导入 → 哈希入库 → 层级树 | ⚠️ 部分 | 缩略图未做（T-053） |
| 4 选中 → 属性面板 → gizmo 拖动落一次 undo | ⚠️ 部分 | 属性面板改值已覆盖；**gizmo 指针拖拽序列未覆盖** |
| 5 Ctrl+Z / Ctrl+Y | ✅ | 含历史面板的 patch 计数断言 |
| 6 改 roughness，共享材质的兄弟不变 | ❌ | 未覆盖，单测层面已绿（R08 专项） |
| 7 保存视点 | ❌ | 未覆盖 |
| 8 新建补间动画 | ❌ | 未覆盖 |
| 9 加热点并开启遮挡 | ❌ | 未覆盖 |
| 10 新建变量 + 新建规则 | ⚠️ 部分 | 规则可见可编辑已覆盖；**从零建规则未覆盖** |
| 11 预览 → 点击 → 动画/高亮/面板/变量 → 再点无反应 | ⚠️ 部分 | 预览进出与还原已覆盖；**完整规则链与条件复验未覆盖** |
| 12 发布 → .w3p → Player 打开 → 逐项一致 | ❌ | 播放器不存在（T-101/T-103） |

### 晋级门槛现状（NORTH_STAR §3）

| # | 门槛 | 状态 |
|---|---|---|
| G0-1 | 黄金路径 12 步 E2E 全绿 | ❌ 9 步全绿，12 步未齐（见上表） |
| G0-2 | `pnpm check:constitution` 全绿 | ✅ 四项 PASS |
| G0-3 | Schema 迁移回归 | ✅ schema 144 条全绿 |
| G0-4 | 编辑器预览 / 播放器 轨迹一致性 | ❌ 播放器不存在 |
| G0-5 | 已注册动作 100% 无 GPU 单测 | ✅ core 374 条全绿 |
| G0-6 | 二次上传重映射（含 orphan） | ✅ |
| G0-7 | benchmark 目标机器实测 | ❌ 未执行 |

三条未过的门槛全部指向同一件未开工的事：**播放器与发布链路（M5）**。
