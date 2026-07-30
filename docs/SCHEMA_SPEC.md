# 场景文档模型规范 · SceneDocument v1

**包**：`@w3/schema`
**上位文档**：[NORTH_STAR.md](NORTH_STAR.md)（C1 / C4 / C9）
**性质**：**实现规范，逐字实现。** 需要偏离时先写 ADR 并征得确认，不要自行调整字段名或结构。

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
  schemaVersion: z.literal(1),
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
  media:  z.array(MediaSchema).default([]),
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
    type:  z.enum(['color', 'transparent']),
    color: HexColor.default('#1a1a1a'),
  }).default({ type: 'color', color: '#1a1a1a' }),
})
```

`unit` 与 `upAxis` 记录的是**文档的目标坐标系**。资产导入时若不匹配，在导入阶段一次性归一化到文档坐标系（见 §5.2），运行时不再做任何坐标换算。

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

  assetRef: z.object({
    assetId:    Id('ast'),
    objectPath: z.string(),                  // 'Root/Pump/Body'
    objectName: z.string(),                  // 'Body'
    missing:    z.boolean().default(false),  // 重映射失败的孤儿标记
  }).nullable(),                             // null = 纯逻辑分组节点（空 Group）

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

### 4.2 循环检测

`parent` 链必须是森林，不得成环。`checkIntegrity`（§9）中强制检测；拖拽改父的 UI 必须在放下前就阻止把节点拖进自己的子树。

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
  }).default({}),
})
```

`params` 中缺失的字段 = 继承源材质。这与 node overrides 是同一条纪律。**色彩空间不是文档字段**，由 core 按贴图槽位固定处理（见 MVP 规划 D3）——它是渲染实现细节，不该让用户配错。

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
    mediaId: Id('med').optional(),                // v0 不实现，字段先留
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

---

## 7. v0 定义但不实现的结构

**必须写进 schema，不实现运行时。** 理由见 MVP 规划 §1.2：晚加就要多一次 schemaVersion 迁移，而现在定义是零成本的。

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

const MediaSchema = z.object({
  id: Id('med'),
  type: z.enum(['image', 'video', 'audio']),
  assetId: Id('ast'),
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

**发布前 error 级别一条都不许有**（MVP 规划 D8）。warn 级别展示但不阻断。

---

## 10. 版本与迁移（宪法 C4）

```ts
type Migration = { from: number; to: number; up: (doc: any) => any }
const MIGRATIONS: Migration[] = [ /* 按 from 升序 */ ]

/** 把任意历史版本的文档升到 CURRENT_VERSION。链式执行。 */
export function migrate(raw: unknown): Result<SceneDocument, MigrationError>
export const CURRENT_VERSION = 1
```

### 规程（不可协商）

1. **改 schema = `schemaVersion` +1 + 一个 `Migration` + 一份 fixture。三件套缺一不可，这是 PR 的硬门槛。**
2. `packages/schema/test/fixtures/v<N>/*.json` 存该版本的**真实文档样例**（不是玩具样例，最好来自实际使用）。fixture **只增不改不删**。
3. 回归测试遍历所有 fixture：`migrate(fixture)` → `validate` 必须成功。
4. 迁移函数**必须纯函数**，不读外部状态、不发网络请求。缺失字段用默认值补，多余字段保留（未来降级读取时可能有用）。
5. 迁移**只向上，不向下**。老播放器打不开新文档，靠 `manifest.coreVersion` 给出明确报错，不做降级转换。

v0 起始就是 `schemaVersion: 1`，且 `MIGRATIONS` 数组即使为空也要建好、`migrate()` 即使是恒等函数也要写好并被测试覆盖。技术方案 §1.2 纪律 5 的原话是"第一天就写"——第一天不写，第三周才写的时候已经有三份不同形状的文档在硬盘上了。

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
- [ ] `fixtures/v1/golden-path.json` 已落地并通过 `validate` + `checkIntegrity`
- [ ] `checkIntegrity` 的 I1–I10 每项至少一条针对性单测（含反例）
- [ ] `remapAssetRefs` 五种结果分类各有一条单测，且断言"孤儿节点未被删除"
- [ ] 文档 `JSON.parse(JSON.stringify(doc))` 往返后 `toEqual` 原文档
- [ ] `buildIndex` 的 `refsTo` 能正确回答"删除 nd_x 会影响哪些规则"
