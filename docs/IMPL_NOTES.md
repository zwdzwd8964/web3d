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
| IndexedDB 的配额、跨标签页锁、超大 blob | **未验证** | fake-indexeddb 不模拟这些 | 浏览器 E2E（T-112） |
| `WebGLRenderer` 相关路径 | **未执行** | T-031/T-032 未实现，且需真实 GL | T-031 之后 + E2E |
| `--offline` 断网构建（C6 / T-006） | **未执行** | 未在断网环境实测 | 需人工断网后跑 `pnpm build` |
| `vendor/` 解码器实际加载 | **未执行** | 加载器（T-032）尚未实现 | T-032 之后 |
| Player 体积预算 gzip ≤ 400KB | **未测量** | Player 尚未实现 | T-105 |
| benchmark 实测（G0-7） | **未执行** | 需目标机器 | T-110 |

**Runtime 的可测边界**：three 的场景图、材质、Raycaster、相机数学都不需要 GL 上下文，
所以 T-033~T-040 是**真跑过的**（core 261 条测试），不是"看起来对"。
只有 `WebGLRenderer` 与 GLTFLoader 需要浏览器，那部分尚未实现。

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

TASK_BACKLOG 的勾选与耗时回填由人工执行。当前实现覆盖：

- **完成**：T-001 ~ T-006、T-010 ~ T-018、T-020 ~ T-024、T-030、
  T-033 ~ T-040、T-080 ~ T-087
- **部分**：T-037（导入 clip 的 AnimationMixer 未接，补间部分已完成）
- **未开工**：T-031、T-032（需 WebGL）、T-041（热点层，需 DOM）、
  T-050 ~ T-054（资产管线）、T-060 ~ T-072（编辑器外壳与撤销）、
  T-090 ~ T-093（规则编辑 UI）、T-100 ~ T-105（发布与播放器）、T-110 ~ T-114
