# MVP v0.5 进化规划 · 表现力与体验

**上位文档**：[NORTH_STAR.md](NORTH_STAR.md)（宪法，冲突时以它为准）· [ADR-0015](adr/0015-插入-v0.5-表现力与体验版本.md)（本版本的合法性来源）
**配套规范**：[SCHEMA_SPEC.md](SCHEMA_SPEC.md) · [ECA_SPEC.md](ECA_SPEC.md) · [CLAUDE.md](../CLAUDE.md) · [TASK_BACKLOG_V0_5.md](TASK_BACKLOG_V0_5.md)
**读者**：负责实现的 coding agent，以及验收它的人

---

## 0. 一句话目标

> **让 v0 打穿的底座第一次"变宽"：对象库与放置、光照与环境、材质纹理、多媒体——四条能力全部以"schema 字段 + 注册项"的方式长出来，`executor.ts` / `engine.ts` / 包边界零改动。**

v0 证明了"一份 JSON + 一个 core + 两种视图"成立。v0.5 要证明的是北极星指标（NSM）：
**新能力是从注册表和文档字段里长出来的，不是从引擎缝里挤出来的。** 所以 v0.5 的成功
标准不是功能多，而是每条能力的接入方式都能对照 C4（一次迁移）与 C5（注册表）打勾。
任何一条能力如果发现"必须改执行器/引擎才能做"，立即停下（北极星 §4 分诊 Q4）。

**v0.5 不含后端**（沿 ADR-0002）。**零新增第三方运行时依赖**：HDR 解析（RGBELoader）、
PMREM、阴影、五种灯、原始几何体全部在已锁定的 three 0.185.1 之内；媒体播放用浏览器
原生 `<audio>` / `<video>`。这不是巧合，是选型时留下的余量，现在兑现。

---

## 1. 范围：做什么，不做什么

### 1.0 与 v0 遗留的关系（先还债，再进化）

v0 收尾的对抗式审查留下 11 条登记在 [IMPL_NOTES.md](IMPL_NOTES.md) §4，其中 5 条是
**假绿测试**（保护的功能改坏了也不会红）。v0.5 的第一批任务卡（T-115 ~ T-117）就是
清偿它们 + 落地 CI。理由：v0.5 要在这些测试保护的区域上继续施工，带着假绿的保护网
施工等于没有保护网。

两条**遗留决议项**需要人工裁决，登记在 §7.2 人工验收 H5，不阻塞开工：
T-102 文件位置偏差（ADR-0014 待销案）、T-111 WebGL1（ADR-0013，商务确认）。

### 1.1 做（v0.5 In Scope）

| 领域 | v0.5 交付内容 | 为什么现在做 |
|---|---|---|
| 对象库与放置 | 7 种参数化原始体；内置模型/纹理/HDRI 库的 manifest 机制与 starter 内容；拖拽放置（贴面/落地）；网格与角度吸附；复制/粘贴/Ctrl+D | "拖进来、摆出去"是编辑器的第一体验；v0 只能导入 GLB，空场景什么都摆不了 |
| 光照与环境 | 5 种灯光节点（ambient/hemisphere/directional/point/spot）；实时阴影；HDRI 环境与背景（IBL）；默认灯架条件退场；编辑态灯光 helper 与拾取；`setLight` 动作 | v0 光照是 core 里写死的三灯 rig，文档表达不了"这个场景该怎么亮"——违背 C1 精神的历史欠账 |
| 材质与纹理 | 纹理导入管线（图片/HDR）；6 个贴图槽位接通 + UV 变换；physical 参数（玻璃/清漆等）；材质预设库；共享材质分离 | v0 的 `params.maps` 六个字段一直空转；材质只有数值没有贴图 |
| 多媒体 | 图/音/视频导入为媒体资产；媒体库面板；热点面板媒体内容；`playMedia` / `stopMedia` 动作 | schema v1 早已预留 `media` 集合与 `hotspot.content.mediaId`，现在接通，零迁移成本的先见之明兑现 |
| 质量基建 | v0 假绿测试清偿；CI 工作流；黄金路径 II E2E；parity 扩展；对抗式审查制度化 | v0 的教训（METRICS 快照 3）：测试断言不到点上 = 没有测试 |

### 1.2 不做（v0.5 Out of Scope，明确列出防止发散）

后端服务 · 登录认证 · 权限 · 审计 · 编辑锁 · **后处理特效（Bloom / SSAO / 雾 / 粒子 / OutlineEffect）** ·
渲染出图 · 流程管理（`flows`）· 页面覆盖层（`pages`）· 分享链接与二维码 · 时间轴与曲线动画 ·
**视频作为场景纹理（VideoTexture）** · 音频空间化（PositionalAudio）· RectAreaLight / IES 灯 ·
约束关系对接 · 移动端适配 · 国际化 · **任何运行时发起网络请求的在线素材市场**

> （**减面与几何压缩**已由 [ADR-0031](adr/0031-减面移出-Out-of-Scope.md) 移出本清单，落在 **v1.5 的服务端资产转码**：Draco 几何压缩为必做、减面为**可选档位且默认关闭**。v0 / v0.5 期间浏览器侧只做 Draco **解码**，从来没有做过编码——这两个词此前被写在同一项里，掩盖了它们完全不同的成本。）

> **特别点名两条**：①"光线效果"= 真实光源 + 阴影 + IBL，**不是** Bloom 辉光——发现
> 自己在装 `postprocessing` 就是走错了（见 D20 与风险 V7）；② 内置库的一切内容
> 本地分发（宪法 C6），"接个免费素材站 API"这种念头直接掐掉。

### 1.3 灰区裁决（避免反复讨论）

| 项 | 裁决 | 理由 |
|---|---|---|
| RectAreaLight | **不做** | 需要额外初始化 uniforms 库、不支持阴影；五种灯覆盖绝大多数展示场景 |
| 音频 `await` 到播完 | **做** | 导入时把 `durationS` 写进 media 记录，无 GPU 环境用假时钟可测（D19）；没有它"响完铃再弹面板"做不出来 |
| `mediaEnd` 事件 | **不做** | 事件枚举是 schema 封闭集，加一种事件 = 再触发一次分诊 Q3；`playMedia` 的 `await: true` 已覆盖"播完再继续"的编排需求 |
| 视频进 ECA 动作 | **不做** | `playMedia` 只接受 `type: 'audio'` 的媒体（完整性检查 I14 挡住）；视频在热点面板里用原生 controls 播放，用户自己控制 |
| 贴图逐槽位独立 UV | **不做** | 一套 `uv` 变换作用于该材质全部槽位；逐槽位 UI 复杂度 ×6，实际需求 <5% |
| 复制节点是否带规则/热点 | **不带** | 规则里的 `nodeId` 指向原件还是副本没有无歧义答案；只复制节点子树 + 共享材质引用 |
| 拖放是否贴合命中面法线 | **不做**（垂直放置） | 斜面上的柜子该"立着"还是"贴着"语义歧义；v1 视需求加对齐开关 |
| HDRI 格式 | **仅 `.hdr`（RGBE）** | 解析器在 three 内置；EXR / KTX2 环境贴图推后 |
| 灯光参数渐变动画 | **不做** | `setLight` 立即生效；要渐变需扩展 tween 的 targets——那是 schema 变更，走分诊 Q3 再说 |
| 背景模糊（backgroundBlurriness） | **不做** | 纯锦上添花，字段以后加是零成本的 optional |

---

## 2. 黄金路径 II（v0.5 唯一新增的验收剧本）

这 12 步就是 v0.5 的定义。**E2E 必须逐步覆盖，缺一步不算完成。**
同时，**v0 的黄金路径 I 12 步保持全绿是回归门槛**——v0.5 不许弄坏 v0。

```
 1. 新建项目「设备展台」→ 资源库面板可见：对象 / 纹理 / 环境 三个页签
 2. 对象页签拖出「立方体」到视口空白处 → 落在地面 y=0 → 命名「展台」→ 属性面板改尺寸 2×0.2×2
 3. 导入 pump.glb（黄金路径 I 同款）→ 从资产面板拖到展台上表面 → 贴面放置
        （包围盒底面对齐命中点，不穿模不悬空）
 4. Ctrl+D 复制泵体 → 开网格吸附（0.5m 档）拖到旁边 → 复制与移动在撤销栈里各恰好一条
 5. 选中展台 → 材质面板应用预设「拉丝金属」→ 从纹理库挂一张 map 贴图 → uv.repeat 改 [2,2]
        → 共享同源材质的其他 mesh 不受影响（铁律 9 回归）
 6. 新建聚光灯节点 → gizmo 旋转对准泵体（局部 -Z 指向）→ 强度 3 / 暖白 / 开阴影（medium）
        → 展台表面出现泵体影子
 7. 环境页签选内置 HDRI「工业厂房」→ 背景切为 hdri → 金属反射明显变化，默认灯架退场
 8. 导入 warning.png 与 alarm.wav → 媒体面板出现两条记录，音频显示真实时长
 9. 在泵体上加热点 hs_x「运行警告」→ 内容挂 warning.png → 视口热点面板内显示图片
10. 新建规则 rl_x：when click 泵体 → mode sequence →
        playMedia(alarm, await: false) → setLight(聚光灯, intensity: 6) → highlight(泵体, outline_red)
11. 预览：点击泵体 → 音频播放态为真、聚光灯变亮、红色高亮 →
        退出预览 → 灯回到强度 3、音频停止（编辑态完全还原，B13 语义扩展到灯与媒体）
12. 发布 → 导出 .w3p → Player 打开 → 重复第 11 步逐项一致 →
        断网刷新 Player → 灯光 / 阴影 / HDRI / 图片 / 音频全部可用（C6）
```

**音频的 E2E 断言用运行时状态（`isMediaPlaying`），不断言声卡输出**——CI 环境没有
声卡，断言"真的响了"只会制造 flaky。第 12 步的"逐项一致"仍由 parity 测试机器保障
（轨迹里新增 `setLight` / `playMedia` 的 `ExecResult` 步骤）。

---

## 3. 架构影响面

### 3.1 不变的东西（这一节存在的意义是让评审能快速否决越界 PR）

- **包边界与依赖方向**：与 v0 完全一致，`pnpm check:constitution` 继续把关。
- **第三方依赖**：零新增。`package.json` 出现任何新依赖 = 触发 CLAUDE.md"停下来问人"第 3 条。
- **ID 前缀**：零新增。灯和原始体是节点（`nd_`），媒体用既有 `med_`。
- **`executor.ts` / `engine.ts` / 规则编辑器**：零改动。新动作全部走 ECA_SPEC §10 三文件法。
- **Player**：**无新增源文件**。灯光、阴影、环境、媒体面板全部长在 core 里，播放器
  自动获得——这是宪法 C3 的常设证明，验收时要专门看一眼 `packages/player/src` 的 diff 是不是空。
- **Player 体积预算**：gzip ≤ 400 KB 不变。HDRI 与媒体走资产管线进 `.w3p`，不进 bundle。

### 3.2 新增文件地图

```
packages/schema/src/
├── light.ts  primitive.ts  media.ts        新增（media 从 deferred.ts 出列）
└── node.ts  material.ts  document.ts       修改（承载体字段 / physical+uv / environment）
    migrate.ts  primitives.ts               修改（1→2 迁移 / Vec2）

packages/core/src/runtime/
├── light-factory.ts  light-helpers.ts      新增
├── primitive-factory.ts  environment.ts    新增
├── texture-cache.ts  media-bus.ts          新增
└── scene-graph.ts  apply-patch.ts          修改（承载体分发 / 新 patch 路径）
    scene-runtime.ts  material-registry.ts  修改（阴影与环境接线 / 贴图与 physical）
    gizmo.ts  picker.ts                     修改（吸附 API / 灯节点拾取）

packages/core/src/eca/
├── actions/light.ts  actions/media.ts      新增（各 1~2 个动作，五项齐全）
└── types.ts  headless.ts                   修改（RuntimeContext +4 方法，双实现）

packages/editor/src/
├── panels/LibraryPanel.tsx  MediaPanel.tsx 新增
├── lib/library.ts  material-presets.ts     新增
├── viewport/place.ts  SnapToolbar.tsx      新增
├── store/clipboard.ts                      新增
└── public/library/**                       新增（manifest + starter 内容，本地分发）

scripts/
├── gen-library-starter.mjs                 新增（程序化生成 starter 纹理/HDRI/组合模型）
└── check-library-manifest.mjs              新增（零外链 + license 必填，挂进 check-constitution）

packages/player/src/                        （刻意为空——见 §3.1）
```

### 3.3 内置库的部署形态（D17 的展开）

```
编辑器静态资源（本地）                项目文档 + 存储                    发布包
packages/editor/public/library/   →  用户点选/拖出时经既有导入管线   →  .w3p 只含被引用资产
manifest.json + 内容文件              （hash 查重、体检、缩略图）          Player 从不知道"库"的存在
```

三条纪律：库内容**只在编辑器侧存在**；引入动作**复用导入管线**（不开新存储通道）；
manifest 里每一项 **license 字段必填**、URL 必须是相对路径（`check-library-manifest.mjs`
静态把关，纳入 `pnpm check:constitution`）。

---

## 4. 规范增量（逐字实现）

> **§4.0 冻结声明**：本节清单已经产品负责人在规划阶段批准。T-120 / T-135 / T-163
> 据此实现并**回写** SCHEMA_SPEC.md 与 ECA_SPEC.md 对应章节，不再触发 CLAUDE.md
> "停下来问人"第 1 条。**超出本节清单的任何字段/动作改动，仍必须停下来问人。**
> 开工后发现漏了字段：不追加进 v2，登记进 v1 的待办——连环 bump 是 C4 最大的敌人（风险 V4）。

### 4.1 schema v2（`schemaVersion: 2`，一次 bump 承载全部增量，见 D11）

#### 4.1.1 节点承载体（`node.ts`）

```ts
// 一个节点有且至多一个承载体：assetRef | primitive | light；三者皆 null = 纯分组节点。
// 互斥由完整性检查 I11 把守（error 级），不靠 zod 联合——保持字段位置稳定、patch 路径可读。
export const NodeSchema = z.object({
  /* …v1 全部字段不变… */
  assetRef:  AssetRefSchema.nullable(),
  primitive: PrimitiveSchema.nullable().default(null),   // 新增
  light:     LightSchema.nullable().default(null),       // 新增
})
```

#### 4.1.2 原始体（新文件 `primitive.ts`）

**只存语义尺寸，不存分段数**——分段数是渲染实现细节，由 core 固化（同 D3 色彩空间的处理哲学）。

```ts
export const PrimitiveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('box'),      size: Vec3.default([1, 1, 1]) }),
  z.object({ kind: z.literal('sphere'),   radius: z.number().positive().default(0.5) }),
  z.object({ kind: z.literal('cylinder'), radiusTop: z.number().nonnegative().default(0.5),
             radiusBottom: z.number().nonnegative().default(0.5),
             height: z.number().positive().default(1) }),
  z.object({ kind: z.literal('cone'),     radius: z.number().positive().default(0.5),
             height: z.number().positive().default(1) }),
  z.object({ kind: z.literal('torus'),    radius: z.number().positive().default(0.5),
             tube: z.number().positive().default(0.15) }),
  z.object({ kind: z.literal('plane'),    width: z.number().positive().default(1),
             height: z.number().positive().default(1) }),
  z.object({ kind: z.literal('capsule'),  radius: z.number().positive().default(0.3),
             length: z.number().positive().default(0.6) }),
])
```

#### 4.1.3 灯光（新文件 `light.ts`）

方向性灯（directional / spot）**沿节点局部 -Z 轴照射，无 target 对象**（D13）。
`angleDeg` 存角度（用户可读），core 转弧度。

```ts
const ShadowSchema = z.object({
  enabled: z.boolean().default(false),
  quality: z.enum(['low', 'medium', 'high']).default('medium'),   // core 映射 512/1024/2048
  bias:    z.number().min(-0.01).max(0.01).default(-0.0005),
}).default({ enabled: false, quality: 'medium', bias: -0.0005 })

export const LightSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ambient'),
             color: HexColor.default('#ffffff'),
             intensity: z.number().min(0).max(10).default(0.6) }),
  z.object({ kind: z.literal('hemisphere'),
             skyColor: HexColor.default('#ffffff'), groundColor: HexColor.default('#444444'),
             intensity: z.number().min(0).max(10).default(0.6) }),
  z.object({ kind: z.literal('directional'),
             color: HexColor.default('#ffffff'),
             intensity: z.number().min(0).max(20).default(1.5),
             shadow: ShadowSchema }),
  z.object({ kind: z.literal('point'),
             color: HexColor.default('#ffffff'),
             intensity: z.number().min(0).max(20).default(1),
             range: z.number().nonnegative().default(0),          // 0 = 无限
             decay: z.number().min(0).max(4).default(2),
             shadow: ShadowSchema }),
  z.object({ kind: z.literal('spot'),
             color: HexColor.default('#ffffff'),
             intensity: z.number().min(0).max(20).default(2),
             range: z.number().nonnegative().default(0),
             decay: z.number().min(0).max(4).default(2),
             angleDeg: z.number().min(1).max(89).default(30),
             penumbra: z.number().min(0).max(1).default(0.2),
             shadow: ShadowSchema }),
])
```

**阴影参与的缺省语义**：阴影管线开启时，mesh 默认 `castShadow = receiveShadow = true`；
`node.overrides.castShadow / receiveShadow`（v1 已有的字段，v0 里空转）用于关掉个别节点。
本版把这两个字段接通，不改它们的形状。

#### 4.1.4 环境与背景（`document.ts` 的 `MetaSchema`）

```ts
background: z.object({
  type:  z.enum(['color', 'transparent', 'hdri']),      // 新增 'hdri'
  color: HexColor.default('#1a1a1a'),
}).default({ type: 'color', color: '#1a1a1a' }),

environment: z.object({                                  // 新增整块
  hdriAssetId: AssetIdSchema.nullable().default(null),   // 指向 type: 'hdri' 的资产；null = 无 IBL
  intensity:   z.number().min(0).max(4).default(1),
  exposure:    z.number().min(0.1).max(4).default(1),
}).default({ hdriAssetId: null, intensity: 1, exposure: 1 }),
```

**toneMapping 不进文档**（渲染实现细节）：`hdriAssetId` 非空时 core 切 ACESFilmic，
清空时还原 v0 现状——保证老文档观感逐帧不变（G0.5-6）。

#### 4.1.5 材质增量（`material.ts` 的 `params`，全部 optional，缺失 = 继承源材质，纪律不变）

```ts
// physical 专属（base !== 'physical' 时出现 → 完整性检查 I15 warn）
transmission:       z.number().min(0).max(1).optional(),
ior:                z.number().min(1).max(2.5).optional(),
thickness:          z.number().min(0).optional(),
clearcoat:          z.number().min(0).max(1).optional(),
clearcoatRoughness: z.number().min(0).max(1).optional(),

// 一套 UV 变换作用于该材质全部已挂贴图槽位（灰区裁决）
uv: z.object({
  repeat:      Vec2.default([1, 1]),
  offset:      Vec2.default([0, 0]),
  rotationDeg: z.number().min(-360).max(360).default(0),
}).optional(),
```

`Vec2` 加进 `primitives.ts`。`maps` 六个槽位形状不变——它们从 v1 起就是对的，只是没人实现。

#### 4.1.6 媒体（`media.ts`，从 `deferred.ts` 出列并扩展）

```ts
export const MediaSchema = z.object({
  id:        Id('med'),
  type:      z.enum(['image', 'video', 'audio']),
  assetId:   AssetIdSchema,
  name:      z.string().min(1),                       // 新增：库面板展示名，默认原文件名
  durationS: z.number().positive().optional(),        // 新增：audio/video 导入时读取；image 无
})
```

`hotspots[].content.mediaId`（v1 已预留）语义生效：`image` 在面板内展示，`video` 原生
controls 播放。`pages` / `flows` 留在 `deferred.ts` 不动。

#### 4.1.7 迁移 1 → 2

纯函数，只补默认值：`nodes[].primitive = null`、`nodes[].light = null`、
`meta.environment = 默认块`、既有 `media` 记录补 `name`（取关联 asset 的 `name`）。
**不注入任何灯光节点**（D14 解释为什么）。fixture：`v2/golden-path-2.json`
（黄金路径 II 终态文档，同时是 parity 输入）；v1 fixture 只增不改不删。

### 4.2 完整性检查增量（I11 – I15）

| # | 检查 | 级别 |
|---|---|---|
| I11 | `assetRef` / `primitive` / `light` 至多一个非空 | error |
| I12 | `environment.hdriAssetId` 指向存在且 `type === 'hdri'` 的资产；`background.type === 'hdri'` 时 `hdriAssetId` 必须非空 | error |
| I13 | `params.maps.*` 全部指向存在且 `type === 'texture'` 的资产 | error |
| I14 | `media.assetId` 的资产类型与 `media.type` 匹配；`hotspot.content.mediaId` 指向存在的 media 且 `type ∈ {image, video}`；`playMedia` 引用的 media `type === 'audio'` | error |
| I15 | physical 专属参数出现在 `base !== 'physical'` 的材质上 | warn |

### 4.3 ECA 增量（动作 13 → 16，注册表零引擎改动）

| `action` | 参数 | 语义 | await 行为 |
|---|---|---|---|
| `setLight` | `{ nodeId, intensity?, color? }` | 改灯光参数（目标节点须为灯节点） | 立即 |
| `playMedia` | `{ mediaId, await?: false, loop?: false, volume?: 1 }` | 播放音频媒体 | `await: true` 时基于 `durationS` 挂起到播完（走 `ctx.wait`，无 GPU 可测）；`loop: true` 时**立即 resolve**（同 D6 的边界，必测）；`durationS` 缺失时立即 resolve + warn |
| `stopMedia` | `{ mediaId \| 'all' }` | 停止播放 | 立即 |

`RuntimeContext` 增量（`SceneRuntime` 与 `HeadlessRuntime` **双实现 + 契约测试**，老规矩）：

```ts
setLight(nodeId: string, patch: { intensity?: number; color?: string }): void
playMedia(id: string, opts: { loop?: boolean; volume?: number; signal?: AbortSignal }): Promise<void>
stopMedia(id: string | 'all'): void
isMediaPlaying(id: string): boolean
```

**规则编辑器零改动**：`FieldDescriptor.refKind` 在 v0 就包含了 `'media'`——表单自动长出来。
这是 v0 先见之明的又一次兑现，也是 C5 的验收证据之一（复用既有的 rule-editor 零改动测试）。

条件（`ConditionSchema`）与事件（`EventDescriptorSchema`）**零改动**（灰区裁决）。

---

## 5. 关键设计决策（D11 – D20，续 v0 的 D1 – D10）

### D11 · 一次 schema bump 承载全部 v0.5 字段

primitive / light / environment / 材质增量 / media 扩展在**同一次** `schemaVersion 1→2`
里落地（T-120 一张卡）。
- ❌ 错误：每条能力各 bump 一次，v0.5 结束时 schemaVersion 到 5，四条迁移链、四代 fixture 目录永久维护。
- ✅ 正确：字段清单在 §4 冻结，一次迁移，一份 v2 fixture。开工后发现漏字段 → 登记 v1，不追加。

### D12 · 灯是节点，不是独立集合

灯光作为 `node.light` 承载体存在，**复用**层级树、transform、gizmo、撤销、显隐、locked、
`refsTo`、增量 patch 的全部既有机制。
- ❌ 错误：顶层加 `lights: []` 集合——选中模型、拖动位置、撤销、删除确认，每一样都要为灯再写一份。
- ✅ 正确：灯出现在层级树里，拖 gizmo 就是调灯位，Ctrl+Z 就是撤销调灯。新增代码只有"构建 three 对象"这一段。

### D13 · 方向性灯沿节点局部 -Z 照射，无 target 对象

与相机朝向约定一致。gizmo 的旋转就是打光方向，文档里没有第二个需要联动维护的坐标。
- ❌ 错误：照抄 three 的 `light.target` 双对象模型进文档——两个对象要联动编辑、联动撤销、联动复制，全是坑。
- ✅ 正确：core 每帧由节点世界矩阵推出 target 位置（内部实现细节，不进文档）。

### D14 · 默认灯架条件退场，迁移不注入灯

文档**不含任何灯节点且 `environment.hdriAssetId` 为空**时，core 挂 v0 的默认三灯 rig
（不进文档、不可选中、层级树不可见）；一旦用户加了第一盏灯或设了环境，默认 rig 整体退场；
删光了再回来。1→2 迁移**不把默认 rig 写成文档节点**。
- ❌ 错误：迁移时注入三个灯节点"让状态显式化"——老项目的层级树凭空多出三个节点，用户会问这是什么，删了场景变黑。
- ✅ 正确：默认 rig 是与"默认背景色"同级的**展示性缺省**，不是业务状态。老文档打开观感逐参数不变（G0.5-6 有回归断言）。

### D15 · 原始体的材质显式化

编辑器创建原始体时，确保文档存在一条名为「默认材质」的共享 material 记录（无则创建），
并把节点 `overrides.materialId` 指向它。**没有隐藏材质态。**
- ❌ 错误：core 里悄悄给原始体配一个不在文档里的材质——用户改不了它，材质面板显示为空，违背 C1。
- ✅ 正确：材质永远是文档里可见的一条记录。用户改「默认材质」= 所有用它的原始体一起变（符合共享直觉）；
  想单独改 → 材质面板「分离材质」按钮（clone 出新记录，走 commit）。core 仅在 override 缺失时兜底渲染中性灰并 warn。

### D16 · 预设是填充器，不是引用

材质预设应用 = 把预设的全量参数 **commit 进文档的 material 记录**（并记 `preset` 名做溯源）。
- ❌ 错误：文档里只存 `preset: 'brushed-metal'`，运行时去库里查参数——发布包在没有库文件的环境下渲染错误，且预设库一改，历史项目全变。
- ✅ 正确：应用之后文档自洽，删掉整个库目录，已发布的 `.w3p` 照常渲染。这是 C6 在数据层的镜像。

### D17 · 内置库 = manifest 机制 + 内容包，机制归 agent、内容归运营

任务卡交付的是：manifest schema、加载与校验、引入流程（复用导入管线）、**程序化生成的
starter 内容**（棋盘/噪声/拉丝纹理、渐变天空 HDRI、原始体拼装的组合模型）。真实美术
内容包是**人工供给项**（H2），不是代码任务。
- ❌ 错误：agent 去"找一些免费模型下下来"——版权不可控（风险 V1），且下载行为本身依赖网络。
- ✅ 正确：机制先行，starter 保底可演示，内容包按 manifest 规范随时插入，license 字段必填且被脚本强制。

### D18 · 拖放落点两级规则，吸附只吸对齐

命中场景表面 → 包围盒**底面**对齐命中点；未命中任何表面 → 落在地平面 y=0。
吸附（网格 0.1/0.5/1 m、角度 15°）作用于 gizmo 拖拽与放置落点，是**编辑器会话态**
（不进文档、不进 localStorage），文档里只有吸附后的最终坐标。
- ❌ 错误：把"吸附开关"存进文档——它是工具状态不是场景状态；或放置绕过 commit 直接 add 到 three 场景（反模式 A1）。
- ✅ 正确：一次放置（含新建节点 + 挂默认材质）= 撤销栈里恰好一条，Ctrl+Z 即整体消失（E2E 断言）。

### D19 · 媒体时长进文档，播放语义与动画对齐

导入时经 `HTMLMediaElement` 元数据读出 `durationS` 写进 media 记录。`playMedia` 的
`await` 基于它在 HeadlessRuntime 里用假时钟推进——**媒体动作与动画动作共用同一套
Promise / abort / loop 语义**（D6），parity 因此可测。
- ❌ 错误：await 依赖真实 `ended` 事件才能测——单测要等真音频播完，flaky 且慢，C8 直接破产。
- ✅ 正确：真实环境听 `ended`（以先到者为准），headless 走 `ctx.wait(durationS)`；`loop` 音频立即 resolve（B 边界必测）。

### D20 · v0.5 不引后处理

「光线效果」的实现边界是：真实光源、阴影贴图、IBL 环境、曝光。**EffectComposer /
postprocessing 不进依赖树。** 高亮继续用 v0 的 emissive 方案。R07（后处理×透明×抗锯齿
三角冲突）继续整体推迟到 v1 一次性解决。
- ❌ 错误："顺手加个 Bloom 让金属好看点"——引入 R07 的全部复杂度，且 player 体积余量（170 KB）会被吃掉一大块。
- ✅ 正确：发现某个效果非后处理不可 → 那是 v1 特效预设的需求，登记，不做。

---

## 6. 里程碑

每个里程碑都有**可演示物**；收尾时例行一轮**小型对抗式审查**（≥3 个独立视角，重点盯
新增测试是否断言到点上），发现如实登记进 [IMPL_NOTES.md](IMPL_NOTES.md)——这是 v0
收尾审查（22 条发现、2 条 blocker）换来的制度，写进流程不靠自觉。

| M | 名称 | 完成标志（Demo） | 覆盖任务卡 |
|---|---|---|---|
| **M7** | 净身 | v0 的 5 条假绿断言全部变异检验转红后修复；CI 首绿 | T-115 ~ T-117 |
| **M8** | 文档模型 v2 | Node 里构造 v2 文档 → 校验 → 迁移 v1 老文档 → 完整性检查，全套单测绿 | T-120 ~ T-122 |
| **M9** | 亮起来 | 样例工程加聚光灯 + 阴影 + HDRI，实时可调；打开 v1 老工程观感逐参数不变 | T-130 ~ T-136 |
| **M10** | 摆得快 | 从资源库拖出原始体与模型，贴面放置、吸附、复制，撤销粒度正确 | T-140 ~ T-145 |
| **M11** | 贴得上 | 贴图 + UV + 玻璃预设；共享材质分离；断网下纹理库可用 | T-150 ~ T-155 |
| **M12** | 响起来 | 热点挂图片视频；规则播放音频；退出预览音停灯还原 | T-160 ~ T-163 |
| **M13** | 发得出·站得住 | 黄金路径 II E2E 全绿 + parity 扩展绿 + 体积复核 + 指标快照 + 全量对抗式审查 | T-170 ~ T-176 |

**M9 是本版的心理拐点**（场景第一次"有光影"），**M13 的 parity 扩展是技术拐点**：
如果灯光/媒体的轨迹在两侧对不齐，说明新能力长歪了（没有全走 core），停下来修，不要继续堆功能。

---

## 7. 验收标准

### 7.1 自动化（`pnpm verify` 一条命令跑完，门槛对应北极星 §3 的 G0.5-1 ~ G0.5-7）

```
pnpm check:constitution   # C2/C6/C7 + 内置库 manifest 零外链、license 必填
pnpm -r test              # 全部单测；ECA（含新动作）纯 Node
pnpm test:parity          # 轨迹含 setLight / playMedia 步骤
pnpm test:e2e             # 黄金路径 I（回归）+ 黄金路径 II
pnpm build --offline      # 断网构建
pnpm size-limit           # Player gzip ≤ 400 KB 不变
```

补充硬指标：
- 动作单测覆盖 = 100%（16/16）；
- `fullRebuildCount` 在两条黄金路径上均为 0（新增 patch 路径不许走全量重建兜底）；
- v1 + v2 fixture 全部 `migrate → validate → checkIntegrity` 零 error；
- 老文档默认观感回归（G0.5-6）：加载 v1 fixture 断言默认 rig 存在且三灯参数与 v0 逐项相等。

### 7.2 人工

| # | 检查项 | 怎么算过 |
|---|---|---|
| H1 | 目标机器 benchmark（含灯光/阴影档位）——**即顺延的 G0-7 / G0.5-8** | 数据记录进 `docs/BENCHMARK.md`，附件A §7 性能表据此回填 |
| H2 | 真实美术内容包按 manifest 规范接入一批（模型/纹理/HDRI 各若干） | `check-library-manifest.mjs` 绿；license 逐项可查 |
| H3 | 弱机上阴影 low/medium/high 三档实测，确定出厂默认档 | 结论写进 IMPL_NOTES 与附件A |
| H4 | 断网环境走完黄金路径 II 全程（编辑 + 发布 + 播放） | 无任何外部请求 |
| H5 | 遗留决议清零：ADR-0014（T-102 位置）人工销案；ADR-0013（WebGL1）商务确认记录 | 两条 ADR 状态更新 |

---

## 8. 风险登记册 → 工程防线

| ID | 风险 | 防线 | 落点 |
|---|---|---|---|
| V1 | 内置库内容版权污染 | 只收 CC0 / 自产；manifest 每项 license 必填，脚本强制；starter 全部程序化生成 | T-145 |
| V2 | 阴影 / HDRI 拖垮弱机 | shadow quality 三档（默认 medium）；bench 增灯光压力档；附件A 写入灯数与阴影上限；H3 实测定默认值 | T-174 / T-175 / H3 |
| V3 | 浏览器自动播放策略吞掉 `playMedia` | 首次用户手势解锁音频；解锁前的播放请求 resolve + warn（不 reject、不卡 sequence）；文档写明"音频动作应挂在点击类事件上" | T-163 |
| V4 | schema 一次 bump 后又发现漏字段 → 连环 bump | §4 冻结清单；开工后的新字段一律登记 v1 待办 | §4.0 |
| V5 | 库内容膨胀拖慢构建与加载 | starter 预算：纹理 ≤ 2MB/张、HDRI ≤ 8MB/张、库总量 ≤ 40MB；manifest 惰性加载，内容不进 JS bundle | T-145 |
| V6 | 假绿测试复发 | **新增测试一律附一次变异检验**（把被测行为改坏 → 测试必须转红，提交信息里记录）；里程碑收尾对抗式审查 | 全局纪律 |
| V7 | "光线效果"被理解成后处理 | D20 明令；发现要装 `postprocessing` 立即停（分诊 Q4） | D20 |
| V8 | 放置 / 复制绕过 commit 通道（v0 曾在回滚上栽过同类跟头） | "一次放置 = 一条撤销"是 E2E 断言项，不是口头约定 | T-142 / T-144 |
| V9 | 灯光 / 媒体只在编辑器侧实现，播放器分叉（A2 重演） | 全部长在 core；`packages/player/src` diff 为空是验收项；parity 扩展覆盖新动作 | §3.1 / T-171 |

---

## 9. 给 agent 的启动指令

把下面这段原样交给写代码的 agent 作为第一条指令：

```
你要实现的是 Web 3D 工具引擎的 v0.5「表现力与体验」版本。底座（v0）已完成，
七条晋级门槛过了六条，唯一未过的 G0-7 已顺延为本版的 G0.5-8（见 ADR-0015）。

开工前必读，按顺序：
1. docs/NORTH_STAR.md           —— 宪法。九条约束任何情况下不得违反。
2. docs/MVP_V0_5_进化规划.md     —— 本次做什么、不做什么、黄金路径 II、
                                    设计决策 D11–D20、规范增量 §4（已冻结）。
3. docs/SCHEMA_SPEC.md          —— 现行文档模型。v0.5 增量以进化规划 §4 为准，
                                    T-120 落地时回写此文件。
4. docs/ECA_SPEC.md             —— 规则引擎。新增动作按 §10 三文件法，
                                    动作表增量见进化规划 §4.3。
5. CLAUDE.md                    —— 工程铁律与 DoD。每次提交前对照。
6. docs/TASK_BACKLOG_V0_5.md    —— 任务卡。从 T-115 开始按依赖顺序领。

工作方式（与 v0 相同，外加两条新纪律）：
- 一次只做一张任务卡。做完跑该卡的"自测"命令，绿了再领下一张。
- 每张卡完成后，在 TASK_BACKLOG_V0_5.md 里把状态改为 [x] 并回填实际耗时。
- 规范没写清楚 → 先在 docs/adr/ 写 ADR 再实现，不要静默做假设。
- 需要修改 SPEC 字段定义（超出进化规划 §4 冻结清单）或 executor.ts / engine.ts
  → 停下来问人。
- 【新】新增的每条测试附一次变异检验：把被测行为故意改坏，测试必须转红，
  在提交信息里记录。v0 留下的 5 条假绿断言就是没做这一步的代价。
- 【新】每个里程碑收尾跑一轮对抗式审查（≥3 个独立视角），发现如实登记进
  docs/IMPL_NOTES.md，不许静默销案。
- 不确定"该不该做"，回到 MVP_V0_5_进化规划.md §1.2 的 Out of Scope 清单。

先执行 T-115 ~ T-117（清偿 v0 遗留），然后做 T-120（schema v2 三件套）。
T-120 完成后停下来汇报，等确认再继续。
```

**为什么 T-120 之后要停**：与 v0 的 T-001 同理——schema v2 的字段形状错了，后面
六个里程碑全部建立在错的地基上，且这是唯一无法靠单测发现的错误类型。人工看一眼
v2 fixture 的成本，远低于返工四条能力线。
