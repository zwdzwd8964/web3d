# 场景文档模型规范 · SceneDocument v2

**包**：`@w3/schema`
**上位文档**：[NORTH_STAR.md](NORTH_STAR.md)（C1 / C4 / C9）
**性质**：**实现规范，逐字实现。** 需要偏离时先写 ADR 并征得确认，不要自行调整字段名或结构。

**版本**：当前 `schemaVersion: 2`。v2 增量由 [MVP_V0_5_进化规划.md](MVP_V0_5_进化规划.md) §4
（已冻结）批准，T-120 落地并回写本文。文中 v2 新增处一律标 **`v2`**；未标注的即 v1 原文，
**形状一字未改**——这是 C4 的直接体现：v1→v2 是一次纯增量迁移，没有任何字段被重命名或改形。

> 技术方案 §1.2 的原话："整个系统的所有功能都是在读写同一份 JSON。这份 schema 设计错了，18 个功能全都要跟它打架。"

---

## 0. 实现原则

1. **Zod 是单一真源。** 先写 Zod schema，TypeScript 类型一律用 `z.infer<typeof X>` 推导。**禁止**手写一份 interface 再手写一份 Zod——两者必然漂移。
2. **所有字段显式声明可选性。** 不写 `.optional()` 就是必填，解析时缺失即报错。
3. **枚举一律封闭**（`z.enum`），不用裸 `string`。封闭枚举的价值：想加一种新类型必须改 schema，从而自动触发北极星 §4 的分诊 Q3，而不是被 agent 顺手加进去。
4. **解析用 `safeParse`，不用 `parse`。** 错误要能带路径返回给 UI 展示，不能抛异常炸掉编辑器。
5. **文档是纯数据。** 不含函数、不含 class 实例、不含 `undefined`（用字段缺失表达"未设置"）。必须能 `JSON.stringify` → `JSON.parse` 往返后完全相等。

---

## 1. 顶层结构

```ts
export const SceneDocumentSchema = z.object({
  schemaVersion: z.literal(2),                     // v2
  projectId:     Id('prj'),
  name:          z.string().min(1).max(120),
  meta:          MetaSchema,

  assets:     z.array(AssetSchema),
  nodes:      z.array(NodeSchema),
  materials:  z.array(MaterialSchema),
  animations: z.array(AnimationSchema),
  hotspots:   z.array(HotspotSchema),
  viewpoints: z.array(ViewpointSchema),
  variables:  z.array(VariableSchema),
  rules:      z.array(RuleSchema),

  // v0 定义结构但无运行时实现，见 §7
  pages:  z.array(PageSchema).default([]),
  flows:  z.array(FlowSchema).default([]),
  media:  z.array(MediaSchema).default([]),        // v2 起有运行时，见 §6.7
})
export type SceneDocument = z.infer<typeof SceneDocumentSchema>
```

**所有集合都是数组，不是 Map/Record。** 理由：数组保序（层级树、规则列表、动画列表的顺序对用户可见），且 Immer patch 路径 `/nodes/3/transform/p` 天然可读。查找性能由运行期构建的索引解决（§8），不靠改数据结构。

### MetaSchema

```ts
const MetaSchema = z.object({
  unit:      z.enum(['m', 'cm', 'mm']).default('m'),
  upAxis:    z.enum(['Y', 'Z']).default('Y'),
  createdAt: z.string().datetime(),      // ISO 8601 UTC
  updatedAt: z.string().datetime(),
  background: z.object({
    type:  z.enum(['color', 'transparent', 'hdri']),   // v2 新增 'hdri'
    color: HexColor.default('#1a1a1a'),
  }).default({ type: 'color', color: '#1a1a1a' }),

  // v2 · 基于图像的照明（IBL）
  environment: z.object({
    hdriAssetId: Id('ast').nullable().default(null),   // 指向 type: 'hdri' 的资产；null = 无 IBL
    intensity:   z.number().min(0).max(4).default(1),
    exposure:    z.number().min(0.1).max(4).default(1),
  }).default({ hdriAssetId: null, intensity: 1, exposure: 1 }),
})
```

`unit` 与 `upAxis` 记录的是**文档的目标坐标系**。资产导入时若不匹配，在导入阶段一次性归一化到文档坐标系（见 §5.2），运行时不再做任何坐标换算。

**`background.color` 在 `type` 不是 `'color'` 时也保留**，这样切回纯色时用户原来的选择还在。

**`toneMapping` 不是文档字段**（v2 明确决定）。用哪条色调映射曲线由"有没有 HDRI"推出：
`hdriAssetId` 非空时 core 切 ACESFilmic，为空时还原 v0 的设置——所以老文档观感逐参数不变
（晋级门槛 G0.5-6 有回归断言）。暴露它只会让用户通过一个他无法与症状联系起来的控件把画面
调坏，与"色彩空间不进文档"（§6.1、MVP 规划 D3）是同一条理由。`exposure` **是**字段：
它是关于场景的艺术选择，不是关于渲染器的实现细节。

---

## 2. ID 规范（宪法 C9）

```ts
const PREFIXES = {
  project: 'prj', asset: 'ast', node: 'nd',  material: 'mat',
  animation: 'anm', hotspot: 'hs', viewpoint: 'vp', variable: 'var',
  rule: 'rl',  page: 'pg', flow: 'flw', step: 'st', media: 'med',
} as const

/** 形如 nd_k3f9a2xq —— 前缀 + 下划线 + 8 位 [0-9a-z] */
const Id = (p: string) => z.string().regex(new RegExp(`^${p}_[0-9a-z]{8}$`))

export function newId(prefix: Prefix): string
```

**铁律**：
- 引用键永远是 ID，永远不是 `name`、`objectPath` 或数组下标（反模式 A5）。
- ID 由系统生成，用户不可编辑。`name` 用户可随便改，改名不影响任何引用。
- ID 在**单个文档内**唯一即可，不需要全局唯一。
- 生成后碰撞检查：`newId` 的调用方（文档写入 API）负责确认新 ID 不在文档中已存在，冲突则重生成。8 位 base36 有 ~2.8×10¹² 空间，单文档内碰撞概率可忽略，但检查成本为零，必须做。

**`variables` 是唯一例外**：变量 ID 允许用户指定成可读标识符（如 `step`、`currentPart`），因为它要出现在规则表达式和用户可见的调试面板里。约束为 `/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/`，且不得与保留字冲突（保留字表见 §6.3）。

---

## 3. assets — 资产（不可变，内容寻址）

```ts
const AssetSchema = z.object({
  id:   Id('ast'),
  type: z.enum(['model', 'texture', 'hdri', 'audio', 'video', 'image']),
  name: z.string().min(1),                     // 原始文件名，展示用
  hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  url:  z.string(),                            // 相对路径，见下
  version: z.number().int().positive(),        // 同一逻辑资产的第几版
  lineageId: Id('ast'),                        // 该逻辑资产的首版 id；首版 lineageId === id
  stats: z.object({
    tris:      z.number().int().nonnegative(),
    materials: z.number().int().nonnegative(),
    textures:  z.number().int().nonnegative(),
    bytes:     z.number().int().nonnegative(),
    textureBytes: z.number().int().nonnegative(),   // 解压后估算显存占用
    nodes:     z.number().int().nonnegative(),
    animations: z.array(z.string()),                // clip 名称列表
  }),
  /** 导入时的体检结论，展示用，也是验收挡箭牌（技术方案 R01） */
  audit: z.object({
    checkedAt: z.string().datetime(),
    policyId:  z.string(),                     // 用了哪套阈值
    findings:  z.array(z.object({
      metric:   z.string(),                    // 'tris' | 'textureBytes' | ...
      value:    z.number(),
      limit:    z.number(),
      level:    z.enum(['pass', 'warn', 'fail']),
      advice:   z.string(),                    // 中文处理建议
    })),
  }).optional(),
  /** 导入时做过的归一化操作，可追溯 */
  normalized: z.object({
    scaleApplied: z.number().default(1),
    axisRotated:  z.boolean().default(false),
  }).optional(),
  thumbnailUrl: z.string().optional(),
})
```

### 3.1 `url` 的形态

**相对路径，永远不是绝对 URL。** 形如 `assets/ab/12/ab12…def.glb`（取 hash 前 2 位、次 2 位做两级分片目录）。

理由：同一份文档要能在 IndexedDB（v0）、后端对象存储（v1）、离线 `.w3p` 包（发布）三种承载下工作。把域名/桶名写进文档，等于把部署环境焊死在数据里——直接违反宪法 C7，且是 §3.2「无悔选型」第 3 条的核心。

解析由 `AssetResolver` 在运行时完成：`resolve(url) => Promise<ArrayBuffer>`。

### 3.2 `lineageId` 与版本

"更新模型"的正确语义是：**新增一条 asset 记录**（`version: n+1`，`lineageId` 沿用），然后跑一次重映射（§5.3）。**永不修改已存在的 asset 记录**——历史发布快照可能还在引用它。

---

## 4. nodes — 场景实例（只存差量）

```ts
const Vec3 = z.tuple([z.number(), z.number(), z.number()])
const Quat = z.tuple([z.number(), z.number(), z.number(), z.number()])   // [x,y,z,w]

const NodeSchema = z.object({
  id:     Id('nd'),
  name:   z.string().min(1).max(120),
  parent: Id('nd').nullable(),               // null = 根节点
  order:  z.number().int(),                  // 同级排序，见下

  // ── 三种承载体，至多一个非空；三者皆 null = 纯逻辑分组节点（空 Group）──
  assetRef: z.object({
    assetId:    Id('ast'),
    objectPath: z.string(),                  // 'Root/Pump/Body'
    objectName: z.string(),                  // 'Body'
    missing:    z.boolean().default(false),  // 重映射失败的孤儿标记
  }).nullable(),
  primitive: PrimitiveSchema.nullable().default(null),   // v2，见 §4.3
  light:     LightSchema.nullable().default(null),       // v2，见 §4.4

  transform: z.object({
    p: Vec3.default([0, 0, 0]),
    r: Quat.default([0, 0, 0, 1]),
    s: Vec3.default([1, 1, 1]),
  }),

  visible: z.boolean().default(true),
  locked:  z.boolean().default(false),       // 编辑器内锁定，不可选中/拖动

  overrides: z.object({
    materialId: Id('mat').optional(),
    castShadow: z.boolean().optional(),
    receiveShadow: z.boolean().optional(),
  }).default({}),
})
```

### 4.1 五条语义纪律

1. **`overrides` 里没有的字段 = 继承源资产。** 不要在导入时把源资产的所有属性拷贝进 node，那会让"换源资产后未覆盖属性自动跟着变"这个低代码核心体验失效（技术方案 §1.2 纪律 3）。
2. **`transform` 是相对父节点的局部变换**，不是世界变换。世界变换由 core 每帧算，不进文档。
3. **`r` 是四元数 `[x,y,z,w]`，不是欧拉角。** UI 上给用户看欧拉角，读写时转换。存欧拉角会引入万向锁和插值歧义。
4. **`parent` + `order` 决定树形。** `order` 是同级内的浮点或整数排序键；拖拽改序时只改 `order`，不做数组重排（否则一次拖拽产生 N 条 patch）。建议用间隔为 1000 的整数，插入时取中值，间隔耗尽时批量重编号。
5. **`assetRef` 三份冗余缺一不可**（技术方案 §1.2 纪律 2）。`assetId` 定位文件，`objectPath` 定位层级位置，`objectName` 兜底。缺任何一个，§5.3 的重映射就降级到猜。
6. **（v2）三种承载体互斥，由完整性检查 I11 把守（error 级），不用 zod 联合。** 用联合会
   让字段位置随承载体类型变化，patch 路径 `/nodes/3/light/intensity` 就不再稳定可读——而
   增量同步（MVP 规划 D1）正是按路径分发的。并排放三个字段，代价是一条完整性规则，换来的是
   一条可分发的路径。
7. **（v2）`overrides.castShadow / receiveShadow` 形状未变，v2 起才真正生效。** 阴影管线开启时
   mesh 缺省投射且接收，这两个字段用于关掉个别节点；缺失仍然表示"继承"。

### 4.2 循环检测

`parent` 链必须是森林，不得成环。`checkIntegrity`（§9）中强制检测；拖拽改父的 UI 必须在放下前就阻止把节点拖进自己的子树。

### 4.3 primitive — 参数化原始体（v2）

```ts
const PrimitiveSchema = z.discriminatedUnion('kind', [
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

**只存语义尺寸，不存分段数。** 分段数是渲染实现细节，由 core 固化——放进文档会让同一份文档
在两个 core 版本下长得不一样，且给用户一个"只能把画面变慢"的旋钮。与色彩空间不进文档
（§6.1、D3）是同一条处理哲学。

`kind` 是封闭判别联合：第八种原始体 = 改 schema = 自动触发分诊 Q3（北极星 §4）。

原始体节点的材质**必须显式**：编辑器创建时确保文档里存在一条名为「默认材质」的共享 material
记录并把 `overrides.materialId` 指向它（MVP v0.5 规划 D15）。core 只在 override 缺失时兜底
渲染中性灰并 warn——**没有隐藏材质态**，否则用户在材质面板里看到空白却改不动它。

### 4.4 light — 灯光（v2）

```ts
const Shadow = z.object({
  enabled: z.boolean().default(false),
  quality: z.enum(['low', 'medium', 'high']).default('medium'),   // core 映射 512/1024/2048
  bias:    z.number().min(-0.01).max(0.01).default(-0.0005),
}).default({ enabled: false, quality: 'medium', bias: -0.0005 })

const LightSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ambient'),
             color: HexColor.default('#ffffff'),
             intensity: z.number().min(0).max(10).default(0.6) }),
  z.object({ kind: z.literal('hemisphere'),
             skyColor: HexColor.default('#ffffff'), groundColor: HexColor.default('#444444'),
             intensity: z.number().min(0).max(10).default(0.6) }),
  z.object({ kind: z.literal('directional'),
             color: HexColor.default('#ffffff'),
             intensity: z.number().min(0).max(20).default(1.5),
             shadow: Shadow }),
  z.object({ kind: z.literal('point'),
             color: HexColor.default('#ffffff'),
             intensity: z.number().min(0).max(20).default(1),
             range: z.number().nonnegative().default(0),          // 0 = 无限
             decay: z.number().min(0).max(4).default(2),
             shadow: Shadow }),
  z.object({ kind: z.literal('spot'),
             color: HexColor.default('#ffffff'),
             intensity: z.number().min(0).max(20).default(2),
             range: z.number().nonnegative().default(0),
             decay: z.number().min(0).max(4).default(2),
             angleDeg: z.number().min(1).max(89).default(30),
             penumbra: z.number().min(0).max(1).default(0.2),
             shadow: Shadow }),
])
```

三条纪律：

1. **灯是节点，不是独立集合**（D12）。它因此白得层级树、transform、gizmo、撤销、显隐、
   `locked`、`refsTo`、增量 patch 的全部机制。顶层加 `lights: []` 的代价是这些每一样都要为灯
   再写一遍。
2. **方向性灯（directional / spot）沿节点局部 -Z 照射，文档里没有 `target` 对象**（D13）。
   把 three 的双对象模型抄进文档，等于让两个对象联动编辑、联动撤销、联动复制。core 每帧由
   节点世界矩阵推出 target，那是实现细节。
3. **`angleDeg` 存角度**（用户可读），core 转弧度。`quality` 存三档而不是像素数——贴图尺寸是
   core 的渲染决定。

**默认灯架不进文档**（D14）：文档不含任何灯节点且 `environment.hdriAssetId` 为空时，core 挂
v0 的默认三灯 rig（不进文档、不可拾取、层级树不可见）；出现第一盏灯或设了环境，rig 整体退场；
删光了再回来。它与"默认背景色"同级，是**展示性缺省**，不是业务状态。

---

## 5. 资产导入与重映射

### 5.1 导入流程

```
文件 → SHA-256 → 命中已有 hash?
   ├─ 是 → 复用 asset 记录，跳到实例化
   └─ 否 → 体检(stats + audit) → 归一化 → 生成缩略图 → 写入存储 → 新建 asset 记录
                 ↓
           实例化：遍历 glTF 场景图 → 为每个有意义的对象创建 node
                 ↓
           objectPath = 从 glTF 根到该对象的名称链，'/' 分隔
```

**"有意义的对象"的判定**：默认为 `Mesh`、`SkinnedMesh`、以及有多个子节点或有名字的 `Group`。纯粹的传输层空节点（无名 Group、单子节点透传节点）应折叠，否则层级树会淹没在噪音里。折叠时 **`objectPath` 仍记录完整原始路径**——折叠只影响展示，不影响重映射的依据。

### 5.2 归一化

导入时一次性完成，之后运行时零换算：
- 单位：源单位 ≠ `meta.unit` → 对根节点应用缩放，记入 `asset.normalized.scaleApplied`；
- 朝向：源 up 轴 ≠ `meta.upAxis` → 应用 −90°/+90° X 轴旋转，记 `axisRotated`。

### 5.3 重映射算法（技术方案 R02）

```ts
export function remapAssetRefs(
  doc: SceneDocument,
  oldAssetId: string,
  newAsset: Asset,
  newObjects: Array<{ path: string; name: string }>,
): { doc: SceneDocument; report: MigrationReport }
```

对每个 `assetRef.assetId === oldAssetId` 的 node，按序尝试：

| 序 | 策略 | 命中条件 | 标记 |
|---|---|---|---|
| 1 | 路径全等 | `newObjects` 中存在 `path === ref.objectPath` | `exact` |
| 2 | 名字唯一 | `name === ref.objectName` 的候选恰好 1 个 | `byName` |
| 3 | 路径相似 | 名字候选 >1 个 → 按 `objectPath` 的最长公共后缀（按 `/` 分段计）打分，唯一最高分者胜出 | `byPathScore` |
| 4 | 歧义 | 最高分并列 | `ambiguous`（保留原 ref，标 `missing:true`，UI 让用户选） |
| 5 | 全失败 | 无任何候选 | `orphaned`（保留原 ref，标 `missing:true`） |

```ts
type MigrationReport = {
  total: number
  exact: RemapEntry[]; byName: RemapEntry[]; byPathScore: RemapEntry[]
  ambiguous: Array<RemapEntry & { candidates: string[] }>
  orphaned: RemapEntry[]
}
type RemapEntry = { nodeId: string; nodeName: string; from: string; to?: string }
```

**绝对不许做的事：把匹配不上的 node 删掉。** 用户在这些节点上配了材质、动画、热点、规则。删除等于毁掉他的工作。标 `missing:true`，在层级树上打警示图标，允许人工重新指定。

**UI 必须展示的文案**（技术方案 R02 原文要求）：`已迁移 N 项 / 需确认 M 项 / 失效 K 项`，并可展开逐条查看。

---

## 6. 交互相关结构

### 6.1 materials

```ts
const MaterialSchema = z.object({
  id:   Id('mat'),
  name: z.string().min(1),
  base: z.enum(['standard', 'physical', 'basic', 'lambert']).default('standard'),
  /** 引用内置材质模板；v0 只有 'custom' 与少量内置 */
  preset: z.string().default('custom'),
  params: z.object({
    color:      HexColor.optional(),
    roughness:  z.number().min(0).max(1).optional(),
    metalness:  z.number().min(0).max(1).optional(),
    opacity:    z.number().min(0).max(1).optional(),
    transparent: z.boolean().optional(),
    emissive:   HexColor.optional(),
    emissiveIntensity: z.number().min(0).optional(),
    side:       z.enum(['front', 'back', 'double']).optional(),
    maps: z.object({
      map:          Id('ast').optional(),
      normalMap:    Id('ast').optional(),
      roughnessMap: Id('ast').optional(),
      metalnessMap: Id('ast').optional(),
      aoMap:        Id('ast').optional(),
      emissiveMap:  Id('ast').optional(),
    }).default({}),

    // v2 · physical 专属（base !== 'physical' 时出现 → 完整性检查 I15 warn）
    transmission:       z.number().min(0).max(1).optional(),
    ior:                z.number().min(1).max(2.5).optional(),
    thickness:          z.number().min(0).optional(),
    clearcoat:          z.number().min(0).max(1).optional(),
    clearcoatRoughness: z.number().min(0).max(1).optional(),

    // v2 · 一套 UV 变换作用于该材质**全部**已挂贴图槽位
    uv: z.object({
      repeat:      Vec2.default([1, 1]),
      offset:      Vec2.default([0, 0]),
      rotationDeg: z.number().min(-360).max(360).default(0),
    }).optional(),
  }).default({}),
})
```

`params` 中缺失的字段 = 继承源材质。这与 node overrides 是同一条纪律。**色彩空间不是文档字段**，由 core 按贴图槽位固定处理（见 MVP 规划 D3）——它是渲染实现细节，不该让用户配错。

**六个 `maps` 槽位的形状从 v1 起就没变过，v2 只是把它们接通了。** 这是"字段先定义、运行时后
补"这条做法唯一一次真正收账：接贴图没有触发任何迁移。

**UV 逐槽位独立不做**（v0.5 灰区裁决）：面板复杂度 ×6，而真实需求 <5%。`rotationDeg` 存角度，
与 `angleDeg` 同理。

**`preset` 是溯源标记，不是引用**（D16）：应用材质预设 = 把预设的**全量参数** commit 进
material 记录，同时记下预设名。文档因此自洽——删掉整个预设库目录，已发布的 `.w3p` 照常渲染。
如果只存 `preset: 'brushed-metal'` 运行时去库里查，发布包在没有库文件的环境下就渲染错误，
且预设库一改历史项目全变。

### 6.2 animations（技术方案 R03 的防线）

```ts
const AnimationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind:      z.literal('imported'),
    id:        Id('anm'),
    name:      z.string().min(1),
    assetId:   Id('ast'),
    clipName:  z.string(),
    speed:     z.number().positive().default(1),
    loop:      z.boolean().default(false),
    clampWhenFinished: z.boolean().default(true),
  }),
  z.object({
    kind:     z.literal('tween'),
    id:       Id('anm'),
    name:     z.string().min(1),
    duration: z.number().positive(),                 // 秒
    easing:   z.enum([
      'linear','easeInQuad','easeOutQuad','easeInOutQuad',
      'easeInCubic','easeOutCubic','easeInOutCubic',
      'easeInBack','easeOutBack','easeInOutBack',
    ]).default('easeInOutCubic'),
    loop:     z.boolean().default(false),
    yoyo:     z.boolean().default(false),
    targets:  z.array(z.object({
      nodeId: Id('nd'),
      from:   z.object({ p: Vec3.optional(), r: Quat.optional(), s: Vec3.optional() }).optional(),
      to:     z.object({ p: Vec3.optional(), r: Quat.optional(), s: Vec3.optional() }),
    })).min(1),
  }),
])
```

**`kind` 是封闭的判别联合，只有两种。** 这是技术方案 R03 的工程防线：甲方要求"关键帧时间轴 + 曲线编辑"时，实现它必须新增第三种 `kind`，即修改 schema，自动触发分诊 Q3——从而进入变更单流程，而不是被 agent 或开发者"顺手支持一下"。

`from` 缺失 = 以播放开始那一刻的当前状态为起点（这是绝大多数场景想要的行为）。

### 6.3 variables（技术方案 §1.2 纪律 4：极易遗漏且极难后补）

```ts
const VariableSchema = z.object({
  id:    z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/),
  name:  z.string().min(1),                       // 中文展示名
  type:  z.enum(['number', 'string', 'boolean', 'enum']),
  default: z.union([z.number(), z.string(), z.boolean()]),
  options: z.array(z.string()).optional(),        // type === 'enum' 时必填
  persist: z.boolean().default(false),            // 是否跨会话保留（v0 忽略，字段先留）
})
```

**保留字**（不得用作变量 ID）：`true false null undefined if then else and or not var event target self scene`。

**v1 之后的 `flows` 直接建立在 variables 之上**（当前步骤就是一个变量），所以这块必须现在做对。

### 6.4 hotspots

```ts
const HotspotSchema = z.object({
  id:   Id('hs'),
  name: z.string().min(1),
  anchor: z.object({
    nodeId: Id('nd'),
    offset: Vec3.default([0, 0, 0]),              // 节点局部空间偏移
  }),
  occlude: z.boolean().default(true),
  visible: z.boolean().default(true),             // 初始可见性
  fadeWithDistance: z.boolean().default(false),
  content: z.object({
    type:  z.literal('panel'),                    // v0 只有 panel，封闭枚举留扩展
    title: z.string().default(''),
    text:  z.string().default(''),
    mediaId: Id('med').optional(),                // v2 起生效：image 面板内展示，video 原生 controls
  }),
  style: z.object({
    marker: z.enum(['dot', 'pin', 'number']).default('dot'),
    color:  HexColor.default('#ffb020'),
  }).default({}),
})
```

### 6.5 viewpoints

```ts
const ViewpointSchema = z.object({
  id:   Id('vp'),
  name: z.string().min(1),
  camera: z.object({
    kind:     z.enum(['perspective', 'orthographic']).default('perspective'),
    position: Vec3,
    target:   Vec3,                               // 存 target 而非 quaternion：轨道控制器友好、可读、易插值
    up:       Vec3.default([0, 1, 0]),
    fov:      z.number().min(1).max(179).default(50),
    zoom:     z.number().positive().default(1),   // 正交时用
    near:     z.number().positive().default(0.1),
    far:      z.number().positive().default(1000),
  }),
  thumbnailUrl: z.string().optional(),
})
```

### 6.6 rules

规则的完整语义在 [ECA_SPEC.md](ECA_SPEC.md)。此处只给数据形状：

```ts
const RuleSchema = z.object({
  id:      Id('rl'),
  name:    z.string().min(1),
  enabled: z.boolean().default(true),
  when:    EventDescriptorSchema,                  // ECA_SPEC §2
  if:      z.array(ConditionSchema).default([]),   // ECA_SPEC §3，数组内为 AND
  ifAny:   z.array(ConditionSchema).default([]),   // 数组内为 OR；两者同时存在时 (AND组) && (OR组)
  mode:    z.enum(['sequence', 'parallel']).default('sequence'),
  reentry: z.enum(['restart', 'ignore', 'queue']).default('restart'),   // MVP 规划 D9
  onError: z.enum(['abort', 'continue']).default('abort'),
  then:    z.array(ActionSchema).min(1),           // ECA_SPEC §4
})
```

条件用 `if` + `ifAny` 两个平铺数组，**不做任意嵌套的布尔表达式树**。理由：嵌套表达式的编辑 UI 复杂度是平铺的数倍，而实际需求 95% 是"几个条件都满足"。需要复杂逻辑时，用中间变量拆成两条规则——这也让规则表更容易转成验收用例（技术方案 R14）。

### 6.7 media（v2 出列，`media.ts`）

```ts
const MediaSchema = z.object({
  id:        Id('med'),
  type:      z.enum(['image', 'video', 'audio']),
  assetId:   Id('ast'),
  name:      z.string().min(1),                       // v2：库面板展示名，默认原文件名
  durationS: z.number().positive().optional(),        // v2：audio/video 导入时读取；image 无
})
```

媒体记录是资产之上的薄层：资产拥有字节、hash 与导入体检，记录拥有**这个场景**怎么称呼它、
它播多久。同一个文件被用两次就是两条记录、一份 blob。

**`durationS` 进文档，不是播放时现读**（v0.5 规划 D19）。`playMedia` 的 `await: true` 必须能在
无 GPU、无声卡、用假时钟的纯 Node 单测里挂起正确的时长——那里没有 `<audio>` 也没有 `ended`
事件。导入时读出来写进文档，是媒体动作能满足 C8 的唯一办法。缺失时动作立即 resolve 并 warn，
不会把 sequence 永久挂住。

---

## 7. 定义但不实现的结构

**必须写进 schema，不实现运行时。** 理由见 MVP 规划 §1.2：晚加就要多一次 schemaVersion 迁移，而现在定义是零成本的。

> **`media` 已于 v2 出列**（见 §6.7）——它是这条做法的第一次兑现：接通多媒体只需要一次纯增量
> 迁移补两个字段，`hotspots[].content.mediaId` 一个字都没改。

```ts
const PageSchema = z.object({
  id: Id('pg'), name: z.string(),
  overlays: z.array(z.object({
    id: z.string(),
    type: z.enum(['text', 'image', 'button', 'panel']),   // 封闭枚举 = 技术方案 R13 的防线
    rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    anchor: z.enum(['tl','tc','tr','ml','mc','mr','bl','bc','br']).default('tl'),
    props: z.record(z.unknown()).default({}),
  })).default([]),
}).describe('v0 未实现')

const FlowSchema = z.object({
  id: Id('flw'), name: z.string(),
  variableId: z.string(),                          // 当前步骤存在哪个变量里 —— flows 是 variables 之上的薄层
  steps: z.array(z.object({
    id: Id('st'), name: z.string(),
    next: Id('st').nullable(),
    onEnter: z.array(ActionSchema).default([]),
  })).default([]),
}).describe('v0 未实现')

```

`constraints`（约束关系对接，技术方案 R04 待甲方确认）**不定义**。它的形状完全取决于澄清结果，猜一个错的结构比没有更糟。

---

## 8. 运行期索引

文档是数组，查找靠索引。索引在**加载时构建一次，patch 应用时增量维护**，不进文档、不进撤销栈。

```ts
export interface DocIndex {
  nodeById:      Map<string, Node>
  childrenOf:    Map<string | null, Node[]>       // 已按 order 排序
  assetById:     Map<string, Asset>
  materialById:  Map<string, Material>
  animationById: Map<string, Animation>
  hotspotById:   Map<string, Hotspot>
  viewpointById: Map<string, Viewpoint>
  variableById:  Map<string, Variable>
  rulesByEvent:  Map<EventType, Rule[]>           // ECA 分发的关键索引
  refsTo:        Map<string, Ref[]>               // 反向引用：谁引用了这个 id（删除前置检查用）
}
export function buildIndex(doc: SceneDocument): DocIndex
```

`refsTo` 是删除操作的前置：删一个节点前，先查有多少动画/热点/规则引用它，弹确认框告知影响范围。没有这个反向索引，用户删掉一个节点后规则静默失效，问题要到发布甚至验收才暴露。

---

## 9. 校验与完整性

两个层次，职责不同：

```ts
/** 结构校验：类型对不对。Zod 负责。 */
export function validate(input: unknown): Result<SceneDocument, ValidationError[]>

/** 完整性校验：引用通不通、逻辑成不成立。手写。 */
export function checkIntegrity(doc: SceneDocument): IntegrityIssue[]
```

`checkIntegrity` 必须覆盖的检查项：

| # | 检查 | 级别 |
|---|---|---|
| I1 | 所有 ID 在各自集合内唯一 | error |
| I2 | `node.parent` 指向存在的节点；`parent` 链无环 | error |
| I3 | 所有 `assetId` / `materialId` / `animationId` / `nodeId` / `hotspotId` / `viewpointId` 引用均可解析 | error |
| I4 | 规则中引用的 `variable` 存在，且比较值类型与变量类型兼容 | error |
| I5 | `type === 'enum'` 的变量，`default` 在 `options` 内 | error |
| I6 | tween 动画的 `targets` 非空，且每个 `nodeId` 存在 | error |
| I7 | 存在 `assetRef.missing === true` 的节点 | warn |
| I8 | 规则 `enabled` 但 `then` 中引用了已 `missing` 的节点 | warn |
| I9 | 存在从未被任何规则/流程触发的动画（孤立配置） | info |
| I10 | 存在不可达的节点（parent 指向已被过滤的分支）| error |
| I11 | **（v2）** `assetRef` / `primitive` / `light` 至多一个非空 | error |
| I12 | **（v2）** `environment.hdriAssetId` 指向存在且 `type === 'hdri'` 的资产；`background.type === 'hdri'` 时 `hdriAssetId` 必须非空 | error |
| I13 | **（v2）** `params.maps.*` 全部指向存在且 `type === 'texture'` 的资产 | error |
| I14 | **（v2）** `media.assetId` 的资产类型与 `media.type` 匹配；`hotspot.content.mediaId` 指向存在的 media 且 `type ∈ {image, video}`；`playMedia` 引用的 media `type === 'audio'` | error |
| I15 | **（v2）** physical 专属参数出现在 `base !== 'physical'` 的材质上 | warn |

**发布前 error 级别一条都不许有**（MVP 规划 D8）。warn 级别展示但不阻断。

I11–I15 由 T-121 实现；T-120 只落地字段形状与迁移。

---

## 10. 版本与迁移（宪法 C4）

```ts
type Migration = { from: number; to: number; describe: string; up: (doc: any) => any }
const MIGRATIONS: Migration[] = [ V1_TO_V2 ]        // 按 from 升序

/** 把任意历史版本的文档升到 CURRENT_VERSION。链式执行。 */
export function migrate(raw: unknown): Result<SceneDocument, MigrationError>
export const CURRENT_VERSION = 2
```

### 规程（不可协商）

1. **改 schema = `schemaVersion` +1 + 一个 `Migration` + 一份 fixture。三件套缺一不可，这是 PR 的硬门槛。**
2. `packages/schema/test/fixtures/v<N>/*.json` 存该版本的**真实文档样例**（不是玩具样例，最好来自实际使用）。fixture **只增不改不删**。
3. 回归测试遍历所有 fixture：`migrate(fixture)` → `validate` 必须成功。
4. 迁移函数**必须纯函数**，不读外部状态、不发网络请求。缺失字段用默认值补，多余字段保留（未来降级读取时可能有用）。
5. 迁移**只向上，不向下**。老播放器打不开新文档，靠 `manifest.coreVersion` 给出明确报错，不做降级转换。

v0 起始就是 `schemaVersion: 1`，且 `MIGRATIONS` 数组即使为空也要建好、`migrate()` 即使是恒等函数也要写好并被测试覆盖。技术方案 §1.2 纪律 5 的原话是"第一天就写"——第一天不写，第三周才写的时候已经有三份不同形状的文档在硬盘上了。

### v1 → v2（v0.5，一次 bump 承载全部增量）

v0.5 的四条能力线（原始体 / 灯光 / 材质纹理 / 多媒体）在**同一次** bump 里落地（规划 D11）。
每条能力各 bump 一次的代价是四条迁移链、四代 fixture 目录永久维护；一次 bump 的代价是字段清单
必须提前冻结（规划 §4）。**开工后发现漏字段，登记进 v1 待办，不追加进 v2**——连环 bump 是 C4
最大的敌人。

迁移内容（纯增量，无重命名、无改形）：

| 补什么 | 补成什么 |
|---|---|
| `nodes[].primitive` | `null` |
| `nodes[].light` | `null` |
| `meta.environment` | `{ hdriAssetId: null, intensity: 1, exposure: 1 }` |
| `media[].name` | 关联 asset 的 `name`；引用已悬空时退回该 media 的 id（可追溯） |

两条实现纪律：

1. **显式写值，不靠 zod 默认值兜底。** 除 `media[].name` 外每个新字段都有 default，所以
   `up: d => d` 也能让 `migrate()` 返回合法文档——只看 `migrate()` 的测试会全绿。但下一条迁移
   （v2→v3）拿到的是 `up()` 的**原始输出**而不是 zod 的产物，字段缺席就会读到 `undefined`。
   因此测试断言 `applyMigrationChain(...).raw`，不断言 `migrate(...).document`。
2. **不注入灯节点**（D14）。默认三灯 rig 是展示性缺省，不是场景内容；把它写成三个文档节点，
   老项目的层级树会凭空多出三个用户没建过、解释不清、删了就变黑的条目。

---

## 11. 文档写入 API

**所有写操作必须经过这一层。** UI 层不许直接 mutate 文档对象（宪法 C1 / 反模式 A1）。

```ts
/** 落一条撤销记录 */
commit(label: string, recipe: (draft: Draft<SceneDocument>) => void): void

/** 不落撤销记录，用于 gizmo 拖拽等高频中间态（MVP 规划 D2） */
preview(recipe: (draft: Draft<SceneDocument>) => void): void

/** 把从 previewStart 到现在的净变化合并成一条撤销记录 */
previewStart(): void
previewCommit(label: string): void
previewAbort(): void
```

`commit` 内部用 `produceWithPatches`，把 `(patches, inversePatches, label)` 压入历史栈，并把 `patches` 转发给 `runtime.applyPatch()`（MVP 规划 D1）。

**合并策略**：同一 `label` 且间隔 < 500ms 的连续 commit 自动合并（如属性面板上连续输入数字）。合并逻辑集中在这一层实现，不散落到各个 UI 组件。

---

## 12. 一份完整示例

黄金路径第 10 步结束时，文档应长成这样。**agent 应把它作为 `packages/schema/test/fixtures/v1/golden-path.json` 落地**，它同时是 §10 的第一份 fixture 和一致性测试的输入。

> **下面这份是 v1 原文，且磁盘上的 `v1/golden-path.json` 必须与它保持一致——永远不要为了让它
> 通过新 schema 而"修一下"。** fixture 只增不改不删（§10 规程 2）：一份被改过的历史 fixture
> 会让 C4 回归套件保持全绿而什么也证明不了。v2 的对应物是
> `fixtures/v2/golden-path-2.json`（黄金路径 II 终态：原始体展台 + 贴面放置的泵体 + 副本 +
> 聚光灯带阴影 + HDRI 环境 + 贴图与 UV + 图片/音频媒体 + `playMedia`/`setLight` 规则）。
> `createGoldenPathDocument()` 跟随 `CURRENT_VERSION`，与本节的 v1 原文由
> **`migrate(v1 fixture) === createGoldenPathDocument()`** 这条断言绑在一起——它把"示例与
> fixture 是同一份文档"变成了对迁移本身的实时检查。

```jsonc
{
  "schemaVersion": 1,
  "projectId": "prj_a1b2c3d4",
  "name": "泵组拆装演示",
  "meta": {
    "unit": "m", "upAxis": "Y",
    "createdAt": "2026-08-01T02:10:00.000Z",
    "updatedAt": "2026-08-01T03:42:11.000Z",
    "background": { "type": "color", "color": "#1a1a1a" }
  },

  "assets": [
    { "id": "ast_9k2m4p7q", "type": "model", "name": "pump.glb",
      "hash": "sha256:ab12cd34ef56…", "url": "assets/ab/12/ab12cd34ef56….glb",
      "version": 1, "lineageId": "ast_9k2m4p7q",
      "stats": { "tris": 128400, "materials": 12, "textures": 6,
                 "bytes": 8412300, "textureBytes": 220200960, "nodes": 34,
                 "animations": ["Disassemble"] },
      "audit": { "checkedAt": "2026-08-01T02:11:03.000Z", "policyId": "default-v1",
        "findings": [
          { "metric": "tris", "value": 128400, "limit": 300000, "level": "pass", "advice": "" },
          { "metric": "textureBytes", "value": 220200960, "limit": 134217728, "level": "fail",
            "advice": "贴图显存 210MB 超出 128MB 限制。建议将 4K 贴图降至 2K，或启用 KTX2 压缩。" }
        ] },
      "thumbnailUrl": "assets/ab/12/ab12cd34ef56….thumb.png" }
  ],

  "nodes": [
    { "id": "nd_r5t8y1u3", "name": "泵组", "parent": null, "order": 1000,
      "assetRef": null,
      "transform": { "p": [0,0,0], "r": [0,0,0,1], "s": [1,1,1] },
      "visible": true, "locked": false, "overrides": {} },

    { "id": "nd_v7w9x2z4", "name": "泵体", "parent": "nd_r5t8y1u3", "order": 1000,
      "assetRef": { "assetId": "ast_9k2m4p7q", "objectPath": "Root/Pump/Body",
                    "objectName": "Body", "missing": false },
      "transform": { "p": [0,0,0], "r": [0,0,0,1], "s": [1,1,1] },
      "visible": true, "locked": false, "overrides": {} },

    { "id": "nd_b3n5m7k9", "name": "阀盖", "parent": "nd_r5t8y1u3", "order": 2000,
      "assetRef": { "assetId": "ast_9k2m4p7q", "objectPath": "Root/Pump/ValveCover",
                    "objectName": "ValveCover", "missing": false },
      "transform": { "p": [0,0,0], "r": [0,0,0,1], "s": [1,1,1] },
      "visible": true, "locked": false,
      "overrides": { "materialId": "mat_c4d6f8h1" } }
  ],

  "materials": [
    { "id": "mat_c4d6f8h1", "name": "拉丝不锈钢", "base": "standard", "preset": "custom",
      "params": { "roughness": 0.4, "metalness": 0.9, "maps": {} } }
  ],

  "animations": [
    { "kind": "tween", "id": "anm_j2l4n6p8", "name": "阀盖抬起",
      "duration": 1.2, "easing": "easeInOutCubic", "loop": false, "yoyo": false,
      "targets": [ { "nodeId": "nd_b3n5m7k9", "to": { "p": [0, 0.35, 0] } } ] }
  ],

  "hotspots": [
    { "id": "hs_q1s3u5w7", "name": "拆卸提示",
      "anchor": { "nodeId": "nd_b3n5m7k9", "offset": [0, 0.2, 0] },
      "occlude": true, "visible": true, "fadeWithDistance": false,
      "content": { "type": "panel", "title": "第一步",
                   "text": "松开六颗固定螺栓后抬起阀盖。" },
      "style": { "marker": "number", "color": "#ffb020" } }
  ],

  "viewpoints": [
    { "id": "vp_e9g1i3k5", "name": "拆解视角",
      "camera": { "kind": "perspective", "position": [2.4, 1.8, 3.2], "target": [0, 0.4, 0],
                  "up": [0,1,0], "fov": 50, "zoom": 1, "near": 0.1, "far": 1000 } }
  ],

  "variables": [
    { "id": "step", "name": "当前步骤", "type": "number", "default": 1, "persist": false }
  ],

  "rules": [
    { "id": "rl_m8o2q4s6", "name": "点击阀盖执行第一步", "enabled": true,
      "when": { "event": "click", "target": { "nodeId": "nd_b3n5m7k9" } },
      "if": [ { "op": "eq", "left": { "var": "step" }, "right": { "const": 1 } } ],
      "ifAny": [],
      "mode": "sequence", "reentry": "restart", "onError": "abort",
      "then": [
        { "action": "playAnimation", "params": { "animationId": "anm_j2l4n6p8", "await": true } },
        { "action": "highlight",     "params": { "nodeId": "nd_b3n5m7k9", "preset": "outline_amber" } },
        { "action": "openPanel",     "params": { "hotspotId": "hs_q1s3u5w7" } },
        { "action": "setVariable",   "params": { "variableId": "step", "value": { "const": 2 } } }
      ] }
  ],

  "pages": [], "flows": [], "media": []
}
```

---

## 附 · agent 自查清单

实现完 `@w3/schema` 后逐条确认：

- [ ] 没有任何手写的 `interface SceneDocument`，全部 `z.infer`
- [ ] `@w3/schema` 的 `package.json` 依赖只有 `zod`
- [ ] 所有枚举都是 `z.enum`，没有裸 `z.string()` 当类型标记用
- [ ] `newId` 有碰撞检查；变量 ID 有保留字检查
- [ ] `migrate()` 存在且被测试覆盖，即使当前是恒等函数
- [ ] **（v2）** 每个已发布版本都有 fixture，且历史 fixture 从未被编辑过
- [ ] **（v2）** 迁移的断言读 `applyMigrationChain(...).raw`，不是 `migrate(...).document`——
      带默认值的新字段会让"什么都不做的迁移"看起来是对的
- [ ] `fixtures/v1/golden-path.json` 与 `fixtures/v2/golden-path-2.json` 均通过 `validate` + `checkIntegrity`
- [ ] `checkIntegrity` 的 I1–I15 每项至少一条针对性单测（含反例）
- [ ] `remapAssetRefs` 五种结果分类各有一条单测，且断言"孤儿节点未被删除"
- [ ] 文档 `JSON.parse(JSON.stringify(doc))` 往返后 `toEqual` 原文档
- [ ] `buildIndex` 的 `refsTo` 能正确回答"删除 nd_x 会影响哪些规则"
