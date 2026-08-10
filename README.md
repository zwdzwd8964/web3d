# Web3D 工具引擎 · v1.0

把「三维资产 + 交互逻辑」表达为一份可版本化的 JSON 文档。**编辑器和播放器只是这份文档的两种视图。**

---

## 30 秒看懂

```
        一份 SceneDocument（JSON）
                  │
        ┌─────────┴─────────┐
        │                   │
   @w3/editor          @w3/player
   编辑这份文档          只读播放这份文档
        │                   │
        └────── @w3/core ───┘
           同一个运行时 · 同一个规则引擎
```

两个视图共用 `createPlaybackSession`，**并且这件事有自动化证据**——`pnpm test:parity`
拿同一份文档和同一串输入事件在两侧各跑一遍，逐条比对规则执行结果。这条不过，
说明架构分叉了。

## 现在能做什么

**v0（底座，12 步）**：打开编辑器 → 拖入 GLB → 自动体检 → 层级树 → 改变换/材质 →
存视点 → 做补间动画 → 加热点 → 建变量和规则 → 预览里点一下看规则跑 →
发布成 `.w3p` → 用播放器打开，行为一致。

**v0.5（表现力与体验，再 12 步）**：从资源库拖出原始体落到地面 → 拖模型贴到台面上 →
Ctrl+D 复制并网格吸附 → 套材质预设、挂贴图、调 UV → 建聚光灯、开阴影 → 选内置 HDRI 换环境 →
导入图片与音频 → 热点里显示图片 → 建一条「点击 → 播音频 → 灯变亮 → 高亮」的规则 →
预览验证、退出后完全还原 → 发布 → 播放器里逐项一致，且断网可用。

这 24 步就是产品的定义，也是 `pnpm test:e2e` **逐步覆盖**的内容
（两条黄金路径各连跑 5 次零 flaky）。

## 快速开始

```bash
pnpm install
pnpm dev                 # 编辑器 · http://127.0.0.1:5180
pnpm dev:player          # 播放器 · http://127.0.0.1:5181
pnpm verify              # 提 PR 前的总闸门
```

打开编辑器就能看到一个样例场景（一台泵的简化模型），不需要先准备资产。

---

## 包边界

**这是本项目最重要的一张图。** 违反它的改动会被 `pnpm check:constitution` 机械拦下。

```
        @w3/schema  ←──────────────┐
             ↑                     │
        @w3/storage                │
             ↑                     │
        @w3/core  ─────────────────┘
          ↑    ↑
   @w3/editor  @w3/player
```

| 包 | 是什么 | 允许依赖 | **禁止出现** |
|---|---|---|---|
| `@w3/schema` | 文档的形状与规则。zod 是唯一真源，类型由 `z.infer` 推出 | `zod` | three、react、任何 DOM API |
| `@w3/storage` | 持久化的接缝。业务代码只见 `StorageProvider` | `@w3/schema`、`idb`、`fflate` | three、react |
| `@w3/core` | 运行时核心 + ECA 规则引擎。**框架无关** | `three`、`@w3/schema` | react · `@w3/storage` · `indexedDB` · 任何云 SDK |
| `@w3/editor` | 编辑器 SPA（React） | 全部 | 直接 `import 'three'` 绕过 core 操作场景 |
| `@w3/player` | 播放器 SPA（**无 UI 框架**） | `@w3/core`、`@w3/schema`、`@w3/storage` | 任何编辑能力；体积超预算的依赖 |

播放器不用任何 UI 框架，不是抠体积——它是 `@w3/core` 框架无关这件事的**常设证明**。

> **商务用途**：底座（`@w3/schema` / `@w3/core` / `@w3/storage`）与定制层
> （`@w3/editor` / `@w3/player` 以及未来的客户定制包）是**目录级别可指的**边界。
> 谈判时「哪些是通用底座、哪些是本次定制」不需要靠描述，直接指目录。

---

## 九条宪法

任何情况下不得违反。完整表述见 [docs/NORTH_STAR.md](docs/NORTH_STAR.md)。

| | | 怎么保证 |
|---|---|---|
| C1 | 状态只进文档 | 人工评审 + 撤销一致性属性测试 |
| C2 | Core 框架无关 | `check-core-purity.mjs` 机械检查 |
| C3 | 一份 Core 两个视图 | **`pnpm test:parity`** |
| C4 | 老文件永远能打开 | 迁移链 + fixture 回归 |
| C5 | 加能力靠注册不靠改引擎 | `check-core-purity.mjs` 扫执行器分支 + 规则编辑器无动作类型名的测试 |
| C6 | 断网能跑 | `check-no-external.mjs` 扫构建产物 + E2E 断言零外部请求 |
| C7 | 存储只见接口 | `check-storage-abstraction.mjs` |
| C8 | 无显卡可测 | core 388 条测试跑在纯 Node |
| C9 | ID 是唯一主键 | `checkIntegrity` + 人工评审 |

---

## 常用命令

```bash
pnpm dev                 # 编辑器
pnpm dev:player          # 播放器
pnpm build               # 全部包
pnpm typecheck           # strict，零 any
pnpm lint                # 只开真能抓 bug 的规则，见 tools/lint/
pnpm test                # 单元测试
pnpm test:parity         # G0-4 · 编辑器预览 vs 播放器
pnpm test:e2e            # G0-1 · 黄金路径 12 步（真浏览器）
pnpm size                # 播放器体积预算
pnpm check:constitution  # C2 / C5 / C6 / C7 与依赖方向
pnpm verify              # 以上除 e2e 之外全部
pnpm verify:full         # 含 e2e
```

---

## 文档

| 读什么 | 什么时候 |
|---|---|
| [docs/NORTH_STAR.md](docs/NORTH_STAR.md) | 开工前。九条宪法与晋级门槛 |
| [docs/MVP_V0_孵化规划.md](docs/MVP_V0_孵化规划.md) | 开工前。范围、黄金路径、设计决策 D1–D10 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 上手开发。**含「如何新增一种动作」的操作版** |
| [docs/SCHEMA_SPEC.md](docs/SCHEMA_SPEC.md) | 动 `@w3/schema` 或任何文档字段之前 |
| [docs/ECA_SPEC.md](docs/ECA_SPEC.md) | 动 `packages/core/src/eca/` 之前 |
| [docs/IMPL_NOTES.md](docs/IMPL_NOTES.md) | **想知道哪些东西没验证过** |
| [docs/METRICS.md](docs/METRICS.md) | 指标快照与趋势 |
| [docs/BENCHMARK.md](docs/BENCHMARK.md) | 在客户机器上出性能报告 |
| [docs/EMBED_API.md](docs/EMBED_API.md) | 把播放器嵌进别人的页面，并从那个页面指挥它 |
| [docs/附件A_数字资产规范_草案.md](docs/附件A_数字资产规范_草案.md) | 和客户谈资产交付标准 |
| [docs/adr/](docs/adr/) | 40 条架构决策记录，每条都有代价与撤销条件 |

---

## v0.5 加了什么

一句话：**能力长在底座上，不是堆在旁边。** 主包因此只涨了 4.5 KB（gzip 230.1 → 234.6）。

- **对象库与放置**：7 种原始体 + 内置模型库；拖放落点按包围盒底面对齐命中面，
  未命中落地平面；网格 / 角度吸附；复制粘贴与 Ctrl+D
- **光照与环境**：5 种灯（灯就是节点，复用层级树 / gizmo / 撤销 / 增量补丁）、
  阴影贴图、HDRI 环境光与背景；没有灯也没有环境时才挂内置默认灯架，加了第一盏就退场
- **材质与纹理**：6 个贴图槽位 + UV 变换、physical 参数（玻璃 / 清漆）、
  10 种材质预设、共享材质分离
- **多媒体**：音视频导入与媒体库、热点里显示图片 / 播视频、
  `playMedia` / `stopMedia` 两个动作（动作总数 13 → 16）

## 边界

**这是一个底座，不是一个功能齐全的产品。** 刻意不做的东西见
[MVP_V0_孵化规划.md](docs/MVP_V0_孵化规划.md) §1.2 与
[MVP_V0_5_进化规划.md](docs/MVP_V0_5_进化规划.md) §1.2。几条最容易被问到的：

- 没有后端。文档与资产存在浏览器的 IndexedDB 里，发布产出一个可下载的 `.w3p` 文件
- 不支持 WebGL 1（[ADR-0013](docs/adr/0013-v0-不支持-webgl1.md)），旧内核浏览器会看到说明页
- **没有后处理**（描边、辉光）。v0.5 的「光线效果」边界是真实光源 / 阴影贴图 / IBL / 曝光，
  EffectComposer 不进依赖树（D20）
- 规则的条件是两个扁平数组（且 / 或），不是任意嵌套的布尔树
- 每个材质一套 UV 变换，不是每个槽位一套（灰区裁决）

晋级门槛与历次对抗式审查的当前状态见 [docs/IMPL_NOTES.md](docs/IMPL_NOTES.md) §4，
指标快照见 [docs/METRICS.md](docs/METRICS.md)。

## 许可

UNLICENSED · 内部项目。
