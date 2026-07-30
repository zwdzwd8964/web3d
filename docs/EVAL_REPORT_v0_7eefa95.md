# Web3D 工具引擎 · v0 独立验收评测报告

> **性质**：独立评测员产出，**不是开发产出**。本轮未修改任何代码、未提交任何东西。
> **被测 commit**：`7eefa95` · 分支 `main`
> **产出时间**：2026-07-30
> **用途**：交给决策对话做方向性调整。文档自包含 —— 环境、commit、命令、原始输出都在里面。
> **结论标注约定**：`[实测]` = 跑了命令 / 点了界面，输出在文中 · `[读码推断]` = 只读代码得出 · `[主观]` = 使用体感
> **上位文档**：[NORTH_STAR.md](NORTH_STAR.md) · [MVP_V0_孵化规划.md](MVP_V0_孵化规划.md) · [TASK_BACKLOG.md](TASK_BACKLOG.md) · [METRICS.md](METRICS.md)

---

## 0. 本轮基准

| 项 | 值 |
|---|---|
| commit | `7eefa956eb354f6f874edd03fafae3ef091322bf` · 分支 `main` |
| 评测开始时的工作区 | `M packages/editor/vite.config.ts`（本轮开始**前**就存在的未提交改动：给 dev server 加 `allowedHosts: ['.trycloudflare.com']`。评测过程未触碰、未还原） |
| OS | Windows 11 · 10.0.26200 |
| Node / pnpm | v24.18.0 / 11.12.0 |
| 浏览器 | Chrome 150.0.7871.187 headless（`--use-gl=swiftshader`，软件渲染，无独显） |
| 评测范围 | v0 全量验收扫描 + 三个用户报告现象（按钮点不开 / 不能保存 / 放不了多个 object） |
| 工具说明 | 仓库未安装 Playwright/Puppeteer，安装会改 lockfile（越界）。改用 Node 内置 WebSocket 直连 Chrome DevTools Protocol 驱动浏览器；驱动脚本、测试用 GLB、截图、日志全部落在临时目录，未进仓库 |

### 最近提交（上下文）

```
7eefa95 feat(editor): 视口挂载、层级树、属性面板、gizmo 与各资产面板
6c02af4 feat(editor): 文档 store 与 commit/preview 双通道、撤销栈、四区外壳
1e5f4e0 docs: 底座层留档 —— METRICS 指标快照与晋级门槛核对
e1efc1f feat(runtime,assets): GLB 加载器、SceneRuntime、热点层与资产管线
62016ae feat(runtime): 场景图、材质写时复制、增量 patch、补间、相机与拾取
6bd3f9d feat(storage,eca): @w3/storage 与 ECA 引擎；修复导入扫描的失效缺陷
```

---

## 1. 结论先行

**不能用，且不是「差一点」。** 编辑器目前是一个「能改 JSON 树的面板集合」—— 它**从来没有在视口里渲染出过任何一个三维物体**，导入 GLB 也不会；同时**没有任何保存入口**，刷新即全部归零。

v0 的七条晋级门槛：**4 条通过、3 条不通过**，且 G0-1 的核心断言（`fullRebuildCount === 0`）在**正常操作路径上已经被打破** —— 实测导入资产、保存视点、删除节点各让它 +1。

底座层（schema / storage / core / ECA）质量确实高：608 条单测全绿、宪法检查全绿、类型零报错、12 条 ADR 齐备。**问题 100% 集中在编辑器的接线层和尚未开工的发布 / 播放器层。**

### 晋级门槛核对（NORTH_STAR §3）

| # | 门槛 | 状态 | 证据 |
|---|---|---|---|
| G0-1 | 黄金路径 12 步 E2E 全绿 | ❌ | `pnpm test:e2e` 命令不存在；`e2e/` 目录为空；Playwright 未安装 |
| G0-2 | `pnpm check:constitution` 全绿 | ✅ | 四项 PASS（见 §2.1） |
| G0-3 | Schema 迁移回归 | ✅ | schema 144 条测试全绿 |
| G0-4 | 编辑器预览 / 播放器 轨迹一致性 | ❌ | `pnpm test:parity` exit 1，无测试文件；播放器不存在 |
| G0-5 | 已注册动作 100% 无 GPU 单测 | ✅ | core 340 条测试全绿，含注册表遍历比对 |
| G0-6 | 二次上传重映射（含 orphan） | ✅ | schema 单测覆盖五种分类 |
| G0-7 | benchmark 目标机器实测 | ❌ | 未执行（本轮为软件渲染，数据无参考价值） |

---

## 2. 实测记录

### 2.1 只读命令

| 命令 | 期望 | 实际 |
|---|---|---|
| `pnpm check:constitution` | 全绿 | ✅ PASS（C2/C8、C7、依赖方向、C6 四项）。**脚本自己打印 `NOT built, therefore NOT checked: player`** |
| `pnpm -r typecheck` | 全绿 | ✅ 5 包全 Done，零错误 |
| `pnpm -r test` | 全绿 | ✅ schema 144 / storage 67 / core 340 / editor 57 = **608 通过**；player **0 个测试文件** |
| `pnpm -r build` | 产出 dist | ✅ exit 0。但 player 的 build 是 `node -e "console.log('[@w3/player] no sources yet …')"` |
| `pnpm verify` | 提 PR 前总闸 | ✅ exit 0 —— **但它只跑 constitution + typecheck + test** |
| `pnpm -r lint` | 通过（DoD 第 4 条） | ❌ 见下方原文 |
| `pnpm test:parity` | 通过（G0-4） | ❌ 见下方原文 |
| `pnpm test:e2e` | 12 步全绿（G0-1） | ❌ 见下方原文 |
| `pnpm dev` | 起编辑器（CLAUDE.md 命令表） | ❌ 命令不存在，实际叫 `pnpm dev:editor` |

**原始输出片段：**

```
$ pnpm -r lint
Scope: 5 of 6 workspace projects
[ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT] None of the selected packages has a "lint" script
```

```
$ pnpm test:parity
$ pnpm -F @w3/player test:parity
$ vitest run parity
 RUN  v4.1.10 C:/Users/zwdzw/.vscode/0729 3d engine/packages/player
No test files found, exiting with code 1
filter:  parity
include: test/**/*.test.ts
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @w3/player@0.0.0 test:parity: `vitest run parity`
Exit status 1
```

```
$ pnpm test:e2e
[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "test:e2e" not found
Did you mean "pnpm test"?
```

```
$ pnpm check:constitution
PASS  C2/C8 · core purity  (52 file(s) scanned)
PASS  C7 · storage abstraction  (57 file(s) scanned)
PASS  MVP §3 · dependency direction  (84 file(s) scanned)
  note: checked build output of: schema, storage, core, editor
  note: NOT built, therefore NOT checked: player
PASS  C6 · no external runtime dependency  (76 file(s) scanned)
[sync-vendor] vendor/ matches three@0.185.1.
=== CONSTITUTION: PASS ===
```

### 2.2 浏览器实操（黄金路径走查）

测试素材：用 `@gltf-transform` 生成三个真 GLB ——
`pump-a.glb`（7,968 B / 400 面）、`pump-b.glb`（与 a **字节完全相同**）、`flange.glb`（2,820 B / 114 面）。

#### ① 冷启动

```
[warning] [runtime] 资产加载失败：pump.glb
[warning] [runtime] 资产加载失败：pump.glb
[log:warning] WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost
[log] THREE.WebGLRenderer: Context Lost.
[log] THREE.WebGLRenderer: Context Restored.
状态栏：对象 3 · 历史 0 · 完整性 0 阻断 / 0 提示 · 全量重建 0
```

截图确认：视口里**只有网格，没有任何模型**。
像素采样（canvas 每 37 像素取样，颜色按高 4 位分桶）：

```
{"distinctColorBuckets":3,
 "top":[["1,1,1",19846],["1,2,2",578],["1,1,2",328]]}
```

即：背景 `#1a1a1a` + 两档网格线灰，别无他物。

#### ② 导入 `pump-a.glb`

体检报告正常弹出，7 项全「通过」，摘要「新增 4 个对象」。点「确认导入」后：

```
[warning] [runtime] applyPatch 回落到全量重建（第 1 次）：1 条 patch 未被识别
状态栏：对象 7 · 历史 1 · 全量重建 1
层级树：Root / Pump / Body / ValveCover / 泵组 / 泵体 / 阀盖
像素采样：{"distinctColorBuckets":3,"top":[["1,1,1",19846],["1,2,2",578],["1,1,2",328]]}
```

**这组像素数字与冷启动逐位相同 —— 导入之后视口一个像素都没变。**

#### ③ 再导入 `pump-b.glb`（字节相同）

报告写「该文件已在库中，直接复用，未重复占用存储」，确认后：

```
状态栏：对象 7 · 历史 1 · 全量重建 1     ← 一个新对象都没加
```

#### ④ 导入 `flange.glb`（不同文件）

```
[warning] [runtime] applyPatch 回落到全量重建（第 2 次）：1 条 patch 未被识别
状态栏：对象 11 · 历史 2 · 全量重建 2
资产列表：pump.glb v1 8.0MB 128,400面 [1 项超标]
          pump-a.glb v1 7.8KB 400面 [体检通过]
          flange.glb v1 2.8KB 114面 [体检通过]
像素采样：{"distinctColorBuckets":3,"top":[["1,1,1",19846],...]}   ← 仍然一字未变
```

#### ⑤ 找保存入口

页面上全部可点元素的文本：

```
["撤销","重做","编辑","预览","▾","·","◉","✕",…,
 "移动","旋转","缩放","世界","全览",
 "资产","材质","动画","视点","导入 GLB","更新","更新","更新"]

localStorage keys: []
indexedDB databases: []
```

**没有「保存 / 另存 / 发布 / 打开项目」任何一个。**

#### ⑥ 刷新页面

```
状态栏：对象 3 · 历史 0 · 全量重建 0
资产列表：只剩样例 pump.glb
```

三次导入、两条历史，全部消失。

#### ⑦ 交互细项（第三轮，真实鼠标 / 键盘事件）

| 动作 | 结果 |
|---|---|
| 点层级树「阀盖」 | ✅ 选中；属性面板显示 名称 / 位置 XYZ / 旋转（度）XYZ / 缩放 XYZ / 可见 / 锁定 / 资产路径 `Root/Pump/ValveCover` |
| 位置 X 输入 `1.5` 回车 | ✅ `历史 1`，`全量重建 0` |
| 撤销 → 重做 | ✅ `历史 1 → 0 → 1` |
| 双击重命名 | ✅ 弹出**浏览器原生 prompt**「重命名」，改名生效，`历史 2` |
| 删除被引用的节点 | ✅ 原生 confirm：`「阀盖改名」被 1 个动画、1 个热点、1 条规则 引用，删除后这些引用会失效。确认删除？`<br>删除后 `完整性 3 阻断`，**UI 里无处查看这 3 条** · `全量重建 1` |
| 视点面板「保存当前视角」 | ✅ 新增「视点 2」，`历史 1` · **`全量重建 1`** |
| 网络请求 | ✅ 全程只有 vite 本地模块 + 一个 `404 /favicon.ico`。**零外链**，C6 运行期成立 |

---

## 3. 缺陷清单

> 只定位，不给补丁、不给代码。行号对应 commit `7eefa95`。

### P0-1 · 视口永远不显示任何模型

- **严重度** P0（挡路，黄金路径第 1 步就断）
- **复现** 起编辑器 → 导入任意 GLB → 确认导入
- **期望** 视口出现模型 / **实际** 视口只有网格，层级树与资产列表却正常增长
- **证据** `[实测]` 截图 + 像素采样导入前后完全相同；控制台 `资产加载失败：pump.glb`
- **疑似归属** `@w3/editor`
- **`[读码推断]` 直接原因**：
  - [Viewport.tsx:45](../packages/editor/src/viewport/Viewport.tsx#L45) 给 `SceneRuntime` 的是 `createMemoryResolver(new Map())` —— 一个**永远为空**的 Map，此后再没人给它喂过字节
  - [AssetPanel.tsx:22-23](../packages/editor/src/panels/AssetPanel.tsx#L22-L23) 在模块级**另建**了一份 `MemoryProvider` + `AssetLoader`，导入解析出的几何体进了它、进不了视口那份
  - [runtime-bridge.ts:58](../packages/editor/src/viewport/runtime-bridge.ts#L58) 的 `reload()` 是**死代码，全仓无人调用**
- **命中** 铁律 12（`Viewport.tsx:45` 的注释写「资产从存储来，T-066 再说」，而 T-066 已落地，注释与现实脱节）

### P0-2 · 没有任何保存能力

- **严重度** P0
- **复现** 做任意编辑 → 找保存 → 刷新
- **期望** 至少能存回 `StorageProvider` / **实际** 无入口、无自动保存、`localStorage` 与 `indexedDB` 全空、刷新归零
- **证据** `[实测]` §2.2 ⑤⑥
- **疑似归属** `@w3/editor`
- **`[读码推断]`** `IndexedDbProvider` 在 `@w3/storage` 已实现且契约测试全绿，**编辑器一次都没 import 过它**；editor 下 `saveDocument` / `publish` / `snapshot` 零命中。对应 T-100 / T-104 未开工

### P0-3 · Parity 测试跑不起来（G0-4）

- **严重度** P0（CLAUDE.md「必须停下来问人」第 7 条点名的那一条）
- **证据** `[实测]` `pnpm test:parity` → `No test files found` → exit 1
- **含义** 宪法 C3「两个视图一份引擎」目前**完全没有验证手段**，播放器只有一个 `export const NOT_IMPLEMENTED`
- **疑似归属** `@w3/player`

### P0-4 · 黄金路径 E2E 不存在（G0-1）

- **证据** `[实测]` `pnpm test:e2e` 命令不存在；`e2e/` 目录为空；Playwright 未安装
- **疑似归属** 构建 / CI

### P1-1 · `fullRebuildCount` 在正常操作里就不是 0

- **严重度** P1（它是 D1 与铁律 11 的唯一机械保险；[METRICS.md](METRICS.md) 的「趋势观察点」第 2 条正好预言了这件事）
- **实测三条触发路径**：导入资产 +1 · 保存视点 +1 · 删除节点 +1
- **证据** `[实测]` 控制台 `applyPatch 回落到全量重建（第 N 次）：1 条 patch 未被识别`，状态栏「全量重建」变橙
- **疑似归属** `@w3/core`
- **`[读码推断]` 原因**：
  - [apply-patch.ts:81-97](../packages/core/src/runtime/apply-patch.ts#L81-L97) 的分发 switch 只有 `nodes` / `materials` / `rules` / `variables` / `pages` / `flows` / `media` / `name`，**缺 `assets` / `viewpoints` / `animations` / `hotspots` / `meta`**
  - 同文件 [:110](../packages/core/src/runtime/apply-patch.ts#L110) 对 `/nodes` 整体替换直接返回 false，而删除节点写的是 `draft.nodes = draft.nodes.filter(...)`（[HierarchyTree.tsx:91](../packages/editor/src/panels/HierarchyTree.tsx#L91)），必然整段替换
- **命中** 铁律 11

### P1-2 · 同一个 GLB 导入第二次得到 0 个对象

- **严重度** P1 —— **这是用户所说「放不了多个 object」的直接来源**
- **复现** 导入 pump.glb → 再导入同一个 pump.glb
- **期望**（规范未写死）再放一份实例 / **实际** 报告写「该文件已在库中，直接复用」，确认后一个对象都不加
- **证据** `[实测]` §2.2 ③
- **`[读码推断]`** [import-flow.ts:81-84](../packages/editor/src/lib/import-flow.ts#L81-L84) 命中 `existing` 就 `nodes: []` 早返回
- **说明** 内容哈希去重（D4）本身是对的，错的是「资产去重」被当成了「实例去重」。**导入不同文件是能加多个的**（实测 3 → 7 → 11）。真正缺的是「把已有资产再实例化一次」这个动作，编辑器里没有入口
- **疑似归属** `@w3/editor`

### P1-3 · lint 整条链不存在

- **证据** `[实测]` `pnpm -r lint` 报无脚本；仓库根没有 `eslint.config.js`、没有 `.prettierrc`
- **含义** CLAUDE.md DoD 第 4 条从第一天起无法执行。代码里已有 `// eslint-disable-next-line react-hooks/exhaustive-deps`（[Viewport.tsx:82](../packages/editor/src/viewport/Viewport.tsx#L82)）在压制一个**没人在跑的**规则
- **疑似归属** 构建（T-002 未做完）

### P1-4 · 绿灯是假的

- `pnpm verify` exit 0，但它 = constitution + typecheck + test。**不含 lint（不存在）、parity（失败）、e2e（不存在）**
- CLAUDE.md 常用命令表里的 `pnpm dev`、`pnpm test:e2e` 实际不存在
- **含义** 只跑 `pnpm verify` 的人会得到「全绿」的结论，而 G0-1 与 G0-4 是红的

### P1-5 · 完整性错误看得见数字、找不到条目

- **证据** `[实测]` 删除被引用节点后状态栏显示 `完整性 3 阻断`，页面上**没有 issue 列表**（`document.querySelector('[class*=issue]')` → false）
- **疑似归属** `@w3/editor`（T-092 未开工）。删除**前**的确认提示做得很好，删除**后**的善后完全没有

### P1-6 · 热点在编辑器里永远不出现

- **`[读码推断]`** [Viewport.tsx:23](../packages/editor/src/viewport/Viewport.tsx#L23) 建了 `overlayRef` 和 `<div className="viewport__overlay">`，**全文件再没有读过它**；`SceneRuntime` 没拿到 `hotspotRenderer`，于是默认 `NullHotspotRenderer`
- **含义** core 里 291 行的 `hotspot-layer.ts`（遮挡判定、视锥剔除、节流）在编辑器里一次都没跑过；黄金路径第 9 步的「拆卸提示」热点不可见
- **疑似归属** `@w3/editor`

### P1-7 · ECA 引擎在编辑器里从未挂载

- **证据** `[实测]` 编辑器全量 grep `EcaEngine` / `createPlaybackSession` / `attach(` → 零命中（只有 gizmo 的 `attach`）
- 预览按钮 `disabled`，title `预览模式：T-093`；规则编辑器没有按钮，只有一行灰字 `规则编辑器：T-091 · 当前 1 条`
- **含义** 13 个动作、执行器、引擎、条件求值全部只有 headless 单测，**没有任何一次端到端运行**。样例文档里那条规则（点击阀盖）无法查看、无法编辑、无法触发
- **疑似归属** `@w3/editor`

### P2-1 · `history.ts` 里有一个裸 NUL 字节，git 当二进制处理

- **证据** `[实测]` `git log --stat` 显示 `packages/editor/src/store/history.ts | Bin 0 -> 4876 bytes`；字节偏移 3937（第 124 行）`patch.path.join('<NUL>')` 是一个真实的 `0x00` 字符，而非 `'\0'` 转义
- **含义** 这个文件永远没有 diff、没有 blame、code review 看不见改了什么。撤销栈是最不该失去 diff 的文件
- **疑似归属** `@w3/editor`

### P2-2 · StrictMode 双挂载打掉一次 WebGL 上下文

- **证据** `[实测]` 冷启动必现 `WebGL: CONTEXT_LOST_WEBGL: loseContext` → `Context Lost.` → `Context Restored.`，同时 `资产加载失败` 打印两遍
- 本次恢复了，但「卸载第一份 runtime 会 dispose 掉共享 canvas 的上下文」是真实的时序脆弱点

### P2-3 · 重命名 / 删除用浏览器原生 `prompt` / `confirm`

- [HierarchyTree.tsx:89](../packages/editor/src/panels/HierarchyTree.tsx#L89) 与 [:149](../packages/editor/src/panels/HierarchyTree.tsx#L149)
- T-063 要求的是层级树内联重命名。原生对话框阻塞主线程、样式不可控、E2E 需单独处理（本轮驱动脚本被它卡住过一次）

### P2-4 · 任务台账与实现脱节

- [TASK_BACKLOG.md](TASK_BACKLOG.md) 里 **114 张卡全是 `[ ]`**，实际耗时一栏全是 `___`。CLAUDE.md DoD 最后一条从未执行过
- [IMPL_NOTES.md](IMPL_NOTES.md) §4 把 T-062~T-069 列为「未开工」，但它们已在 `7eefa95` 落地
- [METRICS.md](METRICS.md) 停在 `e1efc1f`，仍写着「编辑器与播放器尚未开工」

### P2-5 · 资产字节存在模块级变量里

- [AssetPanel.tsx:22-23](../packages/editor/src/panels/AssetPanel.tsx#L22-L23) 的 `const storage = new MemoryProvider()` 持有的是**可持久化的业务数据**（资产 blob），既不在文档里，也不在注入的存储层里，还跟着模块生命周期走
- 严格说踩到铁律 1 的边界。代码注释自己承认这是临时的，但它已经是 P0-1 的一半成因

---

## 4. 架构符合度

### 九条宪法

| 条款 | 判定 | 依据 |
|---|---|---|
| C1 单一真源 | ⚠️ 基本符合 | `[实测]` 所有编辑落文档、撤销重做正确。但资产字节在模块级变量里（P2-5） |
| C2 Core 框架无关 | ✅ 符合 | `[实测]` `check-core-purity` 扫 52 文件 PASS |
| C3 一份 Core 两个视图 | ❓ **无法判断** | `[实测]` parity 测试不存在、播放器不存在。这不是「符合」，是「没有证据」 |
| C4 Schema 向前兼容 | ✅ 符合 | `[实测]` schema 144 条测试含 fixture 回归全绿 |
| C5 扩展靠注册表 | ✅ 符合 | `[读码推断]` `executor.ts` 147 行内无任何动作类型名；13 个动作数据化注册（ADR-0008）。但规则编辑器不存在，C5 的实战检验（T-091）没做 |
| C6 零外链 | ✅ 符合 | `[实测]` 构建产物检查 PASS + 浏览器全程零外部请求；vendor 自托管且与 three 0.185.1 校验一致。**断网构建仍未实测** |
| C7 存储走抽象 | ✅ 符合 | `[实测]` 扫 57 文件 PASS。但编辑器压根没用存储 |
| C8 无 GPU 可测 | ✅ 符合 | `[实测]` core 340 条测试跑在纯 Node |
| C9 稳定 ID 唯一主键 | ✅ 符合 | `[读码推断]` 抽查未发现按 name 查找的引用路径 |

### 十二条铁律

| # | 铁律 | 判定 |
|---|---|---|
| 1 | 状态只进文档 | ⚠️ 见 P2-5 |
| 2 | 只走 commit / preview | ✅ 抽查通过，NumberField 的 scrub 走 previewStart/preview/previewCommit |
| 3 | 引用用 ID | ✅ |
| 4 | 改 schema 三件套 | ✅ 本轮无 schema 变更 |
| 5 | 加能力靠注册 | ✅ |
| 6 | ECA 无 GPU 无真实时间 | ✅ |
| 7 | 不引外部资源 | ✅ |
| 8 | 存储只见接口 | ✅ |
| 9 | 材质写时复制 | ✅ 有专项单测（ADR-0011 改为无条件克隆） |
| 10 | 动作返回 Promise | ✅ |
| **11** | **增量同步不全量重建** | ❌ **违反**，见 P1-1，实测三条路径 |
| 12 | 不静默做假设 | ✅ 12 条 ADR，差异登记完整。**这一条做得很好** |

---

## 5. 使用体感（`[主观]`，第一次上手的工程师视角）

**打开的头 30 秒我以为是我的显卡坏了。** 界面很像样 —— 四区布局、可拖分栏、深色配色、状态栏有指标 —— 但视口是纯黑加一片网格。左边层级树明明写着「泵组 / 泵体 / 阀盖」三个对象，中间什么都没有。第一反应是去点「全览」，还是没有。控制台里有 `资产加载失败：pump.glb`，但界面上**没有任何提示**告诉我「这个样例场景的模型文件是假的」。视口应该有一句话：没模型的时候说清楚为什么。

**然后我导入了自己的 GLB，以为终于能看到东西了。** 体检报告弹出来的那一刻体验是全场最好的 —— 7 项指标、实测值、上限、结论、建议，一目了然，这个对话框做得比很多商业工具认真。我点了「确认导入」，层级树多了 4 个对象……视口还是黑的。这一下比一开始更困惑，因为**所有反馈都在告诉我成功了**：进度条走完了、报告是绿的、树长出来了、资产列表有了、状态栏对象数从 3 变成 7。只有视口在沉默。这是最伤的一种失败 —— 不报错，只是不发生。

**接着我到处找保存。** 顶栏只有「撤销 / 重做 / 编辑 / 预览」。Ctrl+S 没反应。我以为是自动保存，刷新了一下，全没了。三次导入、两次编辑，白做。这里我停下来问自己「这个工具是给谁用的」—— 一个不能保存的编辑器，用户做的每一件事都是一次性的。

**「预览」按钮是灰的**，鼠标悬上去 tooltip 写「预览模式：T-093」。给用户看内部任务卡编号这件事本身就说明这个按钮不该出现在这里。下方面板右侧还有一行灰字「规则编辑器：T-091 · 当前 1 条」—— **它告诉我这个场景有 1 条规则，但没给我任何办法看它是什么。** 这比不显示更让人难受。

**做得确实好的地方，具体说**：删除「阀盖」时弹出的那句「「阀盖」被 1 个动画、1 个热点、1 条规则 引用，删除后这些引用会失效。确认删除？」—— 这是这轮见过最专业的一句提示，准确、有数字、在破坏发生**之前**。可惜删完之后状态栏跳出「完整性 3 阻断」，点它没反应；找了一圈没有任何地方能看到这 3 条断在哪。前半程做到了 A 级，后半程直接消失。

**属性面板拖数字调节很顺手**，一次拖拽落一条撤销，撤销重做严格对称。层级树的选中、锁定、隐藏图标响应都对。**双击重命名弹的是浏览器原生输入框** —— 功能是通的，但在一个自研深色 UI 里跳出一个 Windows 风格的白色小框，观感上像是穿帮了。

**一句话体感**：这东西的骨架（文档模型、撤销、体检、引用分析）明显是按生产级标准写的，但**它的「眼睛」（渲染）和「记忆」（保存）两根线都没接上**，导致所有这些好东西用户一个都感受不到。

### 「有的按钮点不开」的确切清单

| 控件 | 状态 | 原因 |
|---|---|---|
| 预览 | `disabled`，tooltip「预览模式：T-093」 | 功能未开工 |
| 规则编辑器 | **没有按钮**，只有一行灰字提示 | T-091 未开工 |
| 材质「新建并指定」 | 未选中对象时 disabled | 设计如此，但没有提示告诉用户「先选个对象」 |
| 动画「用选中对象新建补间」 | 未选中对象时 disabled | 同上 |
| 撤销 / 重做 | 栈空时 disabled | 正确 |
| 保存 / 发布 / 打开项目 | **根本不存在** | T-100 / T-104 未开工 |
| 变量面板 / 历史面板 | **根本不存在** | T-090 / T-071 未开工 |

除以上外，其余按钮均可点击且行为正确。

---

## 6. 未能验证

| 项 | 原因 |
|---|---|
| gizmo 一次拖拽 = 一条撤销（T-065 验收线） | 场景里没有任何几何体，gizmo 无处可附着；视口左键拖被相机轨道优先吃掉。**必须等 P0-1 修好后重测** |
| 射线拾取（点视口选中） | 同上，没有可命中的几何体 |
| 材质写时复制的**目视**验证（T-067 验收线） | 同上。单测层面已绿 |
| 层级树 1000 节点流畅度、多选 / Shift 范围选、拖拽改父 | 本轮只做了单选与删除 |
| 断网构建（C6 的另一半） | 断网会影响宿主机环境，未执行 |
| Draco / KTX2 解码器实际加载 | 测试用 GLB 未压缩；vendor 文件与 three 0.185.1 校验一致，但没真跑过解码 |
| 真实 GPU 性能 / benchmark（G0-7） | 本轮为 SwiftShader 软件渲染，帧率数据无参考价值 |
| IndexedDB 配额、跨标签页、超大 blob | 编辑器没接存储，无从触发 |
| imported clip 动画播放 | 代码明确 warn 未接入（T-037 部分完成），本轮未构造带动画的 GLB |
| `.w3p` 打解包在浏览器里的行为 | 编辑器没有发布入口 |
| 播放器全部能力 | 不存在 |

---

## 7. 给决策对话的一段话

> v0 底座（schema / storage / core / ECA）是硬的：608 测试全绿、宪法检查全绿、12 条 ADR 齐备。垮的是编辑器接线层和它下游。**三个 P0：视口永远不渲染模型（`Viewport.tsx:45` 给了空 resolver，资产面板另建了一份 loader，两条线从未接上）；没有任何保存入口（IndexedDbProvider 写好了、测好了、编辑器一次没 import）；parity 与 E2E 两个门槛的测试文件根本不存在。** 另有一条硬伤：`fullRebuildCount` 已在导入 / 存视点 / 删节点三条正常路径上非零，铁律 11 破了。下一步只该做三件事：接资产解析器、接存储、补 parity。规则编辑器、播放器、benchmark 全部往后排 —— 在「能看见、能存下来」之前加任何功能都是在扩大返工面。`pnpm verify` 目前不含 lint / parity / e2e 却退出 0，这个假绿灯建议第一时间堵上。

---

## 8. 收尾自检

评测执行期间（§2 全部命令与浏览器操作）工作区始终为：

```
$ git status --porcelain
 M packages/editor/vite.config.ts
```

与本轮开始时**逐字相同** —— 那一条是评测进场前就存在的未提交改动，未触碰、未 restore。

- 评测期间未新增 / 修改 / 删除仓库内任何文件
- 未执行任何写 git 的操作（无 commit / add / checkout / restore / reset / stash / branch）
- 未安装、删除或升级任何依赖，未改动 lockfile 与任何 config
- dev server 与评测启动的 headless Chrome 均已关闭
- `dist/` 与 `packages/schema/coverage/` 是 build / test 的副产物，已被 `.gitignore` 覆盖，未清理他人工作区

**唯一例外，且经人工授权**：评测结束后，本报告文件 `docs/EVAL_REPORT_v0_7eefa95.md` 被写入仓库（新增，未修改任何既有文件）。授权范围明确为「可以写文件，不能修改代码」。

---

## 附 · 证据文件

截图与原始日志留在本次会话的临时目录（未进仓库），需要时可索取：

| 文件 | 内容 |
|---|---|
| `01-boot.png` | 冷启动截图：空视口 |
| `02-import-report.png` | 体检报告对话框 |
| `03-after-import.png` | 导入 pump-a 后：树长了，视口没变 |
| `04-second-same-file.png` | 同字节文件二次导入 |
| `05-two-models.png` | 两个模型导入后：对象 11，视口仍空 |
| `06-after-reload.png` | 刷新后归零 |
| `run1.txt` / `run2.txt` / `run3.txt` | 三轮浏览器驱动的完整输出 |
| `cdp.mjs` / `run-editor*.mjs` | CDP 驱动脚本 |
| `make-glb.mjs` / `make-glb2.mjs` | 测试用 GLB 生成脚本 |
| `pump-a.glb` / `pump-b.glb` / `flange.glb` | 测试素材 |
