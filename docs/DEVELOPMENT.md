# 开发指南

面向第一次接手这个仓库的人。读完这一份 + [NORTH_STAR.md](NORTH_STAR.md)，应该能独立
新增一种交互动作并跑通。

---

## 1. 环境

| | 版本 | 为什么锁死 |
|---|---|---|
| Node | ≥ 20 | WebCrypto 的 `crypto.subtle` 与 `structuredClone` |
| pnpm | 11.x | workspace 配置读 `pnpm-workspace.yaml`，不是 `.npmrc` |
| three | **0.185.1 精确锁定** | three 的次版本带破坏性变更。`TransformControls` 在 0.185 已从 `Object3D` 改为 `Controls`，`WebGL1Renderer` 已删除 |

```bash
pnpm install
pnpm build          # 先构建一次：包之间用 dist 的 .d.ts 互相引用
pnpm dev
```

> 依赖一律**精确版本**，没有 `^` 和 `~`（`pnpm-workspace.yaml` 的 `saveExact`）。
> 加依赖前先看 [MVP_V0_孵化规划.md](MVP_V0_孵化规划.md) §4 有没有列，没列的要先问。

---

## 2. 目录里各是什么

```
packages/
  schema/    文档的形状。zod 是唯一真源，TS 类型全部由 z.infer 推出
    src/document.ts       顶层 SceneDocument
    src/migrate.ts        版本迁移链（C4 的全部实现）
    src/integrity.ts      I1–I10 悬空引用检查
    src/samples.ts        SCHEMA_SPEC §12 的样例文档，逐字转写

  storage/   持久化接缝。业务代码只见 StorageProvider
    src/provider.ts       接口本身
    src/idb-provider.ts   浏览器实现
    src/memory-provider.ts 测试实现
    src/package.ts        .w3p 打包 / 解包

  core/      运行时 + 规则引擎。框架无关，无 DOM 依赖（除渲染器本身）
    src/eca/              规则引擎。actions/ 是注册表
    src/runtime/          场景图、材质、动画、相机、拾取、热点
    src/runtime/playback-session.ts   ★ 两个视图共用的那一个函数
    src/assets/           导入管线：体检、归一化、实例化、缩略图

  editor/    编辑器 SPA（React + zustand + immer）
  player/    播放器 SPA（无框架，纯 DOM）

test/parity/ G0-4 的闸门。唯一允许同时 import editor 和 player 的地方
e2e/         G0-1 的闸门。Playwright
tools/lint/  隔离的 eslint 工具链（typescript-eslint 尚不支持 TS 7 的 API）
```

---

## 3. 核心心智模型

### 3.1 状态只进文档

所有可持久化的东西都在 `SceneDocument` 里。如果你发现自己在组件 state、ref 或模块级
变量里存业务状态，**停下来**——它一定会导致撤销失效、发布丢失、播放器不一致三个 bug
一起来。

运行时瞬态（当前播放进度、hover 中的对象、相机实时位置）不进文档，这是唯一例外。

### 3.2 改文档只有两条通道

```ts
commit('移动 阀盖', d => { d.nodes[i].transform.p = [0, 0.35, 0] })   // 落一条撤销
preview(d => { ... })                                                  // 不落撤销，拖拽中间态
previewCommit('移动 阀盖')                                             // 把整段拖拽收成一条
```

**永远不要**直接 mutate 文档对象，**永远不要**直接改 three 对象的 transform 来「实现」编辑功能。

一次 gizmo 拖拽产生几十帧，每帧一个 `preview`，松手时一个 `previewCommit` ——
历史面板里应该只多一条记录。历史面板会显示每条记录的 patch 数，这是检查它的方式。

### 3.3 文档变了怎么到屏幕上

```
commit → immer 产出 patches → onPatch → SceneRuntime.applyPatch(patches)
                                            └─ 认不出的 patch 才回落全量重建，并计数
```

状态栏那个「全量重建」计数器必须是 **0**。E2E 会断言它。它非零意味着某条正常操作
走上了全量重建路径，帧率会随模型变大而崩。

---

## 4. 如何新增一种交互动作

**这是本文档最重要的一节，也是 C5 的操作定义。** 目标：改 3 个文件，不改引擎、
不改规则编辑器、不改 schema。

下面用一个真实的例子走一遍：新增「让某个对象绕 Y 轴转到指定角度」。

### 第 1 步 · 写动作定义

在 `packages/core/src/eca/actions/scene.ts` 里加一个 `defineAction`：

```ts
const SpinToParams = z.object({
  nodeId: NodeIdSchema,
  /** 目标角度，度。 */
  degrees: z.number().finite(),
  duration: z.number().nonnegative().default(600),
})

export const spinTo = defineAction<z.infer<typeof SpinToParams>>({
  type: 'spinTo',
  schema: SpinToParams,

  // 五项缺一不可。它们看起来像样板，每一项都换来一个能力：
  async handler(ctx, p, signal) {
    await ctx.spinTo(p.nodeId, p.degrees, { duration: p.duration, signal })
  },

  // ui  → 规则编辑器据此生成表单，不需要写任何 UI 代码
  ui: {
    label: '旋转到角度',
    group: 'scene',
    fields: [
      { key: 'nodeId', type: 'ref', refKind: 'node', label: '对象', required: true },
      { key: 'degrees', type: 'number', label: '角度（度）', step: 15 },
      { key: 'duration', type: 'number', label: '时长（毫秒）', min: 0, default: 600 },
    ],
  },

  // refs → checkIntegrity 据此发现「这条规则指向一个已删除的对象」，
  //        反向索引据此回答「删掉这个对象会破坏什么」
  refs: (p) => [{ kind: 'node', id: p.nodeId }],

  // describe → 验收用例文档（R14）由此生成，不是手写的
  describe: (p, doc) => `把「${nodeName(doc, p.nodeId)}」转到 ${p.degrees}°`,
})
```

然后把它加进同文件的 `BUILTIN_ACTIONS` 数组。

> **为什么是数组而不是导入即注册**：见 [ADR-0008](adr/0008-动作以数据导出集中注册.md)。
> 宿主显式调用 `registerBuiltinActions()`，注册表内容不依赖 import 顺序。

### 第 2 步 · 如果需要新的运行时能力

上面的 `ctx.spinTo` 还不存在。加它需要动三处，**这三处必须一起动**：

1. `packages/core/src/eca/types.ts` 的 `RuntimeContext` 接口加方法签名
2. `packages/core/src/runtime/scene-runtime.ts` 实现它（真 3D）
3. `packages/core/src/eca/headless.ts` 实现它（无 GPU，供单测与 parity）

> **两个实现漂移是这类架构最隐蔽的失效方式。** `packages/core/test/runtime-contract.ts`
> 里的 `describeRuntimeContract` 会对两个实现跑同一套断言——新增方法记得也加进去。

耗时的方法必须**返回 Promise 并接受 `AbortSignal`**（铁律 10）。fire-and-forget 会让
「播完动画再弹面板」这种最常见的需求永远做不出来。

**ECA 里禁止 `Date.now()` / `performance.now()` / `setTimeout` / `requestAnimationFrame`**，
一律走 `ctx.now()` / `ctx.wait()`。`check-core-purity.mjs` 会扫。

### 第 3 步 · 加单测

在 `packages/core/test/eca/actions.test.ts` 里加至少一条。跑在纯 Node，秒级：

```bash
pnpm -F @w3/core test eca
```

### 结束

**不改 `executor.ts`，不改 `engine.ts`，不改规则编辑器组件，不改 schema。**

打开编辑器 → 规则面板 → 「＋ 添加动作…」里就有「旋转到角度」，表单已经生成好了。

如果你发现必须改上面任何一个文件，**停下来**——说明抽象漏了一块。按
[NORTH_STAR.md](NORTH_STAR.md) §4 的分诊 Q4 处理：先写 ADR，不要直接动手。

> 这条规矩有测试盯着：`packages/editor/test/rule-editor.test.tsx` 会把注册表里每个动作
> 的 type 名拿去比对规则编辑器的三个源文件，出现即失败。

---

## 4.5 如何新增一种材质预设 / 一种灯 / 一条库内容（v0.5）

这三件事被刻意做成了「改一处数据，不碰逻辑」。如果你发现自己在改逻辑，多半是走错路了。

### 4.5.1 新增一种材质预设

**改一个文件，加一个对象。** `packages/editor/src/lib/material-presets.ts` 的
`MATERIAL_PRESETS` 数组：

```ts
{
  id: 'anodised-aluminium',      // 稳定 key，会被写进 material.preset 做溯源
  label: '阳极氧化铝',            // 面板上的按钮文字，中文
  base: 'standard',              // 'standard' | 'physical'（后者才有玻璃/清漆参数）
  params: {
    ...blank(),                  // maps: {}，别漏
    color: '#c9ccd1',
    roughness: 0.35,
    metalness: 1,
    opacity: 1,
    transparent: false,
  },
}
```

**必须写全量参数。** 半套参数会从"它恰好被应用到的那个材质"继承剩下的，于是同一个预设
在不同物体上长得不一样——而预设存在的全部意义就是防止这件事。
`material-presets.test.ts` 里有一条测试逐个检查每个预设都写了 color / roughness /
metalness / opacity / transparent / maps，漏了会红。

**physical 专属参数只能出现在 `base: 'physical'` 上。** 写在 standard 上渲染器不读，
完整性检查 I15 会报 warn，测试也会红。

**透射 > 0 的必须 `transparent: true`。** three 的透射走单独的渲染目标，不透明材质
根本进不去，玻璃会渲染成一坨实心的。同样有测试盯着。

应用预设写的是**全量参数进文档**（D16），不是存一个预设名然后运行时去查库——
后者会让发布包在没有库文件的环境里渲染错误，且改一次预设、历史项目全变。
`preset` 字段只是溯源用的名字，**没有任何代码拿它反查参数**。

### 4.5.2 新增一种灯

**大概率你不需要**——五种灯（环境光 / 半球光 / 平行光 / 点光源 / 聚光灯）就是 three 提供的
全部常用类型。真要加（比如面光源），改动是：

1. `packages/schema/src/light.ts`：`LIGHT_KINDS` 加一项，`LightSchema` 加一个分支，
   `LIGHT_LABELS` 加中文名 → **这是改 schema，三件套走起**（§5）；
2. `packages/core/src/runtime/light-factory.ts`：`build()` 里加一个 case，造出对应的
   three 对象；`write()` 里把新字段写进去；
3. `packages/editor/src/lib/light-edit.ts`：`defaultLight()` 加一个 case。

编辑器面板、层级树图标、资源库分区、gizmo、撤销、拾取**全都不用改**——
灯是节点（D12），这些机制它本来就有。

方向由**节点自身的旋转**决定（局部 -Z，D13），文档里没有 target 对象，也不要加一个。

### 4.5.3 新增一条内置库内容

内置库是 **manifest 机制 + 内容包**（D17）：机制在代码里，内容不在。

- `packages/editor/public/library/manifest.json` 加一项，`license` 字段**必填**；
- 文件放进 `packages/editor/public/library/` 对应目录；
- 跑 `node scripts/check-library-manifest.mjs`（也已挂进 `pnpm check:constitution`）。

三条会当场 fail 的红线：**任何 `http(s)://`**（C6：内网部署会看到碎图）、
**缺 license**（版权风险 V1）、**总量超 40 MB**。

库内容**不进 bundle**：用户真的用到时才走既有导入管线成为项目资产（hash 查重、体检、
缩略图一样不少）。发布出去的 `.w3p` 完全不知道有个库存在。

---

## 5. 改 schema = 三件套

`schemaVersion` +1 **且** 一个 `Migration` **且** 一份 fixture。三者缺一不可。

理由是宪法 C4：**任何历史版本的已发布快照，必须永远能被当前代码打开。**
`.w3p` 与本地快照都经过迁移链再校验——少了迁移，客户上周发布的包就变砖。

---

## 6. 测试分层

| 层 | 跑在哪 | 证明什么 | 命令 |
|---|---|---|---|
| 单元 | 纯 Node | 零件对 | `pnpm test` |
| parity | 纯 Node | 编辑器预览与播放器行为一致（C3） | `pnpm test:parity` |
| E2E | 真浏览器 + SwiftShader | 零件**连着**，且画面上真有东西 | `pnpm test:e2e` |

**这个分层是有代价换来的。** 有过一个版本：608 条单测全绿、宪法检查全绿，而编辑器
打开是一片空白、导入的模型不显示、没有任何保存入口。三个 P0 没有一个被单测碰到。

**单测证明零件对，只有 E2E 证明它们连着。** E2E 的承重断言是像素级的——回读 canvas
数颜色桶，空视口永远只有三个（背景 + 两档网格灰），DOM 说什么都不改变这一点。

### parity 为什么不是自证

两侧最终都会进到 `createPlaybackSession`。如果 parity 只是把那个函数调两遍，它只证明了
自己确定性。所以两侧各走**真实入口**：

- 编辑器侧过 `PreviewController`，文档是内存里那一个
- 播放器侧的文档过完整的 `.w3p` 往返（序列化 → zip → 解压 → 迁移 → 校验），资产走 `createPackageResolver`

断言的是这些差异**不泄漏到行为**。写完之后做过两次变异检验确认它会红。

---

## 7. 提交规范

一张任务卡一个提交：

```
<type>(<scope>): <中文简述>

T-0XX
<为什么这么做，尤其是有取舍的地方>
```

`type`：`feat` `fix` `refactor` `test` `docs` `chore` `perf`
`scope`：`schema` `storage` `core` `eca` `editor` `player` `build` `ci`

提 PR 前：

```bash
pnpm verify        # build + lint + constitution + typecheck + test + parity + size
pnpm verify:full   # 再加 e2e
```

---

## 8. 什么时候必须停下来问人

不要自己拍板：

1. 需要修改 [SCHEMA_SPEC.md](SCHEMA_SPEC.md) 或 [ECA_SPEC.md](ECA_SPEC.md) 的字段定义
2. 需要修改 `executor.ts` / `engine.ts` 才能实现某个动作
3. 需要引入规划里没列的第三方依赖
4. 某条宪法挡住了唯一可行的实现路径
5. **任务卡的验收标准与 SPEC 冲突**
6. 一张卡实际耗时超出预估 2 倍以上
7. **parity 测试写不出来或持续不过**

第 7 条尤其重要：它意味着编辑器与播放器已经分叉，这时候继续加功能只会让返工面积变大。

---

## 9. 常见坑

| 现象 | 原因 |
|---|---|
| 改了 core，编辑器里没生效 | 包之间走 dist。先 `pnpm -F @w3/core build` |
| 导入模型后视口没变化 | 检查是不是又建了第二个 `AssetLoader`。全编辑器只能有一个 `ProjectSession` |
| 材质覆盖在某次操作后消失 | `MaterialRegistry` 按 nodeId 缓存克隆，而 `graph.build()` 会换掉 Object3D。它会自己核对，但新加的写入路径要走 `acquireWritable` |
| 状态栏「全量重建」变成非 0 | 有一条 patch 路径 `apply-patch.ts` 不认识。补分发，别回落 |
| 撤销之后场景不对 | 十有八九是绕过了 commit 通道 |
| StrictMode 下东西只工作一次 | effect 的清理函数销毁了本该活到会话结束的对象。React 挂载后会立刻清理一次 |

---

## 10. 部署：两道锁，只配一半等于没配

嵌入（把播放器放进客户页面的 iframe）由**两道互相独立的锁**把关。它们各管一半，配一半
的后果是另一半完全敞开——而两种半开状态都不报错、页面都照常打开。

### 10.1 第一道 · `frame-ancestors`：谁能把我们放进 iframe

`deploy/nginx.conf.template` 的 `location /player/` 块里：

```nginx
add_header Content-Security-Policy "frame-ancestors 'none'" always;
```

**模板里的默认值是 `'none'`，且 `scripts/check-deploy-headers.mjs` 盯着它。** 改成客户
宿主域是部署时的动作，不是模板的默认：模板里写一个宽松值，等于每一次新部署都默认敞开。

```nginx
add_header Content-Security-Policy "frame-ancestors https://customer.example https://*.customer.example" always;
```

**为什么不用 `X-Frame-Options`**：它只认 `DENY` / `SAMEORIGIN` / 单个 `ALLOW-FROM`，而
`ALLOW-FROM` 早已被主流浏览器移除（Chrome 从未支持）。写一个客户域进去的结果是「在
Chrome 上等于没写、在 Firefox 上等于 DENY」——两种失败方式都不报错。守卫因此断言模板里
**零** `X-Frame-Options`。

### 10.2 第二道 · `embed-policy.json`：谁能对我们说话

放在播放器部署目录里，与 `index.html` 同级。播放器在 `?embed=1` 时取它。
样例见 `deploy/embed-policy.example.json`（**它不在 `packages/player/public/`**——
那个目录的东西会被打进 dist，而白名单是一份**每次部署都不同**的运维文件）。

规则：精确 origin · 最左单标签通配（`https://*.customer.example` 不匹配
`a.b.customer.example`，也不匹配裸域）· 显式 `"*"` · scheme 必须 https（localhost 例外）。
**整份文件读不懂 → 谁都不许嵌，不是全通。**

### 10.3 bench 页默认封死

`bench.html` 随 dist 一起部署到 `/player/bench.html`，是**第二个公开入口且没有任何访问
控制**——任何知道地址的人都能让这台机器跑一轮压力测试。它只在验收时用一次，平时是纯风险。

```nginx
location = /player/bench.html { return 404; }
```

临时开启：把那一行注释掉，`nginx -s reload`，**用完改回来**。

### 10.4 机器校验

```bash
node scripts/check-deploy-headers.mjs
```

四条：`/player/` 块含 `frame-ancestors` · 默认值是 `'none'` · bench 有 404 规则 ·
模板里零 `X-Frame-Options`。它剥掉注释再判——一份好模板必然在注释里写示例，而第一版没剥
注释时，示例注释被当成了生效的指令。

---

## 11. 嵌入：改了协议要同时改哪几处

对外的嵌入 API 见 [EMBED_API.md](EMBED_API.md)，样板宿主页在
[`samples/host-demo/index.html`](../samples/host-demo/index.html)。下面这一节说的是**改它的时候**
要一起动哪几处——四处，少一处会有一处静静地不一致。

### 11.1 加一条命令

1. `packages/core/src/embed/commands.ts` 的 `COMMANDS` 加一项。**依赖注不进来时不要注册**——
   让它出现在 `ready.commands` 里然后永远失败，比不存在更难排查。
2. `packages/core/test/embed/embed-controller.test.ts` 的门槛测试里加名字（那条测试遍历
   `Object.keys(COMMANDS)` 比对，不加就红）。
3. `docs/EMBED_API.md` §2 的命令表加一行（`docs-sync.test.ts` **双向**查，不加就红）。
4. `packages/player/src/embed-sdk/index.ts` 的 `PlayerHandle` 加一个方法。

**协议版本号不用动**：新增命令不是不兼容变更，老宿主看不见它也不会调。

### 11.2 加一种事件

`packages/core/src/eca/types.ts` 的 `RuntimeEvent` 联合 → `protocol.ts` 的
`RUNTIME_EVENT_TYPES`（**漏了会编译不过**，那里有一行哨兵）→ `EMBED_API.md` §3。

### 11.3 改协议版本号

只在**不兼容**变更时 +1。改 `EMBED_PROTOCOL` 之后，`packages/player/src/embed-sdk/index.ts`
里那份手写的 `SUPPORTED_PROTOCOLS` 也要改——**它们是两份，故意的**（SDK 会被拷进客户页面、
与播放器分别升级）。一致性由 `embed-sdk.test.ts` 读源码文本比对，不由 import 保证。

### 11.4 三条守卫

```bash
node scripts/check-embed-layering.mjs   # core 的嵌入层零浏览器全局；无通配 postMessage target
node scripts/check-deploy-headers.mjs   # frame-ancestors 默认 'none'；bench 页 404
pnpm -F @w3/core test embed             # 控制器 + 事件恰好一次 + 文档双向一致
```
