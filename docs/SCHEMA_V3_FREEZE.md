# schema v3 冻结裁决表（T-206）

**这份表是什么**：`schemaVersion: 2 → 3` 这唯一一次 bump 要落地的**每一个字段**，逐行、逐字、带签字。

**这份表不是什么**：它**不重新裁决任何东西**。十三份并行产出的领域设计稿交叉核对出 **14 处 schema 冲突（其中 11 条 blocker）**，架构师的裁决已经逐条写进 [MVP_V1_进化规划.md](MVP_V1_进化规划.md) §4.1 – §4.4 与 §5 的 D21–D40。本卡的工作是把那些裁决转成一份**可逐行核对、可被六个领域分别签字**的表。**发现本表与 §4 不一致时，以 §4 为准并当作本表的缺陷登记。**

**为什么要有它**：现在的做法（由 schema 领域单方面出清单）**已被证明会漏掉两个领域的全部字段**——出图的 `hotspot.style.label` 与 `viewpoints[].thumbnailAssetId` 根本不在那份清单上，动画的 `startS` / `endS` / `clipDurations` 被清单写成「不改」。按任何一份单方清单 bump，至少六个领域的第一张卡就无法开工。

**它的机器落点只有一条**：T-225 的验收里有一条反向比对——**「本表的字段总数 === `SceneDocumentSchema` 实际新增字段数」**。那条比对是本表存在的唯一可执行证据。从本表删掉 `hotspots[].style.label` 那一行，T-225 必须转红。

> ⚠ **阀门**：`schemaVersion` 在 v1 **只 bump 一次**。**六方签字齐全之前不许开 T-225。**
> 形状错了，后面九个里程碑全建在错的地基上，**而这是唯一一类单测发现不了的错误**。
> 开工后发现漏字段 → **登记 v2，不追加**（[ADR-0020](adr/0020-v1-拆成三级台阶.md) 决定第 1 条）。

**归属列的两个取值**：`v1.0` = v1.0 就有运行时；**`冻结`** = 形状在 v1.0 定死、v1.2 或 v1.5 才通电。
**每一个 `冻结` 字段都必须在 [DEAD_EXPORTS_ALLOWLIST.md](DEAD_EXPORTS_ALLOWLIST.md) 里有一行**，带 `owner` 与 `expires`（D22 的「冻结即债」，D36 的到期守卫）。

---

## 1 · 逐字段裁决表

九列全部必填，**没有空格**。`签字` 一列在六方确认前一律是 `待签`。

### 1.1 顶层文档（`document.ts`）

| 字段路径 | 类型（逐字 zod） | 默认值 | 来源领域 | 冲突登记号 | 裁决 | 迁移动作 | 首个消费者 | 签字 |
|---|---|---|---|---|---|---|---|---|
| `schemaVersion` | `z.literal(3)` | `3` | schema-v3 | — | 只 bump 一次，v1.0 内完成 | 常量改 3 | T-225 | 待签 |
| `sceneId` | `SceneIdSchema` | 由 `projectId` 派生 | multi-scene | A3(c) | 采纳标量 `sceneId`，**`sceneRefs` 顶层集合不采纳**（D38） | **非增量-1**：`deriveSceneId(projectId)`，幂等，非法时落 `scn_00000000`，**不铸随机 id** | T-225 | 待签 |
| `dataSources` | `z.array(DataSourceSchema).default([])` | `[]` | data-source | X-24 | 新顶层集合（11→13 的第 12 项） | 加法：`asArray(doc.dataSources)` | T-225（形状）· T-442（运行时） | 待签 |
| `prefabs` | `z.array(PrefabSchema).default([])` | `[]` | prefab | prefab 裸串否决 | 采纳集合版，**不采纳 `nodes[].prefab` 裸串**——裸串不进五个遍历面 | 加法：`asArray(doc.prefabs)` | T-232（占位面）· v2（运行时） | 待签 |
| `pages` / `flows` 的「出列」 | 形状不变 | `[]` | flows-pages | — | 从 `deferred.ts` 搬进 `page.ts` / `flow.ts`，**删除 `deferred.ts` 文件**，集合数不变 | 无（集合早就在） | T-225 | 待签 |
| `ID_COLLECTIONS` | `Record<IdCollection, CollectionSpec>` **13 项** | — | schema-v3 | D24 | 由 T-201 先行升格为真注册表，T-225 只加两项 | 无 | T-201（已交付） | 待签 |
| `PREFIXES` | 13 → **17**：`+ov +ds +scn +pfb` | — | 四个领域 | — | 四个新前缀全部来自四个新的**被引用对象**；十条能力零新增前缀 | 无 | T-225 | 待签 |

### 1.2 `meta` 增量（新文件 `fog.ts` / `effects.ts`）

| 字段路径 | 类型（逐字 zod） | 默认值 | 来源领域 | 冲突登记号 | 裁决 | 迁移动作 | 首个消费者 | 签字 |
|---|---|---|---|---|---|---|---|---|
| `meta.fog` | `FogSchema.default(DEFAULT_FOG)` | `DEFAULT_FOG` | postfx | **X-01** | **`meta.fog` 独立块，不并进 `meta.effects`**——雾不是后处理，消费者 / 代价 / 出图裁决三项都与描边不同（D30） | spread-then-default，永不覆盖已有值 | T-239 | 待签 |
| `meta.fog.enabled` | `z.boolean().default(false)` | `false` | postfx | X-01 | 老文档观感不变 | 补默认 | T-239 | 待签 |
| `meta.fog.type` | `z.enum(['linear','exp2']).default('linear')` | `'linear'` | postfx | X-01 | 字段全留、不做判别联合——切到 exp2 再切回来 near/far 还在 | 补默认 | T-239 | 待签 |
| `meta.fog.color` | `HexColorSchema.default('#1a1a1a')` | `'#1a1a1a'` | postfx | X-01 | 与默认背景同色 | 补默认 | T-239 | 待签 |
| `meta.fog.near` | `z.number().min(0).default(10)` | `10` | postfx | X-01 | **拍的不是测的**（G0.5-8 未闭合） | 补默认 | T-239 | 待签 |
| `meta.fog.far` | `z.number().min(0).default(100)` | `100` | postfx | X-01 | 同上；`near >= far` 由 I16 拦（error） | 补默认 | T-239 | 待签 |
| `meta.fog.density` | `z.number().min(0).max(1).default(0.02)` | `0.02` | postfx | X-01 | exp2 专用 | 补默认 | T-239 | 待签 |
| `meta.effects` | `EffectsSchema.default(DEFAULT_EFFECTS)` | `DEFAULT_EFFECTS` | postfx | X-02 | **刻意不含 `bloom` / `ssao` 占位字段**——占位字段是承诺 | spread-then-default | T-235 | 待签 |
| `meta.effects.outline.enabled` | `z.boolean().default(false)` | `false` | postfx | **X-02** | **整条后处理管线的开关**：false 时一个 RenderTarget 都不建（D31）。这一个字段就是「老文档观感逐参数不变」的落点 | 补默认 | T-235 | 待签 |
| `meta.effects.outline.color` | `HexColorSchema.default('#ffb020')` | `'#ffb020'` | postfx | X-02 | 只用于编辑器选中态与缺省，**永不覆盖 `highlight.preset`** | 补默认 | T-241 | 待签 |
| `meta.effects.outline.widthPx` | `z.number().min(1).max(8).default(3)` | `3` | postfx | X-02 | **近似**像素；底层是模糊核半径，面板文案必须写「近似」 | 补默认 | T-241 | 待签 |
| `meta.effects.outline.strength` | `z.number().min(0).max(5).default(3)` | `3` | postfx | X-02 | — | 补默认 | T-241 | 待签 |
| `meta.effects.outline.hiddenEdge` | `z.enum(['hide','dim','show']).default('dim')` | `'dim'` | postfx | X-02 | — | 补默认 | T-241 | 待签 |
| `meta.section` | **不采纳** | — | explode-clip | X-03 | 剖切是节点，不是 meta（D27） | — | — | 待签 |
| `meta.effects.fog` | **不采纳** | — | postfx | X-01 | 同 `meta.fog` 那一行的理由 | — | — | 待签 |
| `meta.fromTemplate` · `rules[].template` | **不采纳，一个字节都不写** | — | templates | — | 模板是编译进 bundle 的常量，文档里不留溯源（D40） | — | — | 待签 |

### 1.3 节点承载体（`node.ts` · 新文件 `section.ts` / `explode.ts` / `prefab.ts`）

| 字段路径 | 类型（逐字 zod） | 默认值 | 来源领域 | 冲突登记号 | 裁决 | 迁移动作 | 首个消费者 | 签字 |
|---|---|---|---|---|---|---|---|---|
| `node.section` | `SectionSchema.nullable().default(null)` | `null` | explode-clip | **X-03** | **节点的第四种承载体**，启停复用 `node.visible`，**零新增动作**（D27）。I11 不换编号，只扩定义域 | 显式补 `section: null` | T-243 | 待签 |
| `node.explode` | `ExplodeSchema.nullable().default(null)` | `null` | explode-clip | **X-04** | 非空 = 本节点是爆炸**分组**，成员是**直接**子节点。**不是承载体，是修饰符** | 显式补 `explode: null` | T-244 | 待签 |
| `node.explodeOffset` | `Vec3Schema.nullable().default(null)` | `null` | explode-clip | X-04 | 父为分组时本件在 `factor=1` 的位移（父的局部空间）；null = 由算法派生（D28） | 显式补 `explodeOffset: null` | T-244 | 待签 |
| `node.prefabRef` | `PrefabRefSchema.nullable().default(null)` | `null` | prefab | — | 与承载体**正交**，不是第五种承载体 | 显式补 `prefabRef: null` | T-232（占位）· v2 | 待签 |
| `SECTION_SCOPES` | `['scene'] as const` | — | explode-clip | X-03 | **单值封闭枚举是刻意的**：加 `'subtree'` 必须改 schema → 机械触发 Q3 | 无 | T-243 | 待签 |
| `section.scope` | `z.enum(SECTION_SCOPES).default('scene')` | `'scene'` | explode-clip | X-03 | — | 新块 | T-243 | 待签 |
| `section.size` | `Vec2Schema.default([4, 4])` | `[4, 4]` | explode-clip | X-03 | 编辑期指示矩形的宽高（米），**不影响剖切结果** | 新块 | T-243 | 待签 |
| `EXPLODE_MODES` | `['radial', 'axis'] as const` | — | explode-clip | X-04 | **分组模型里没有 `dir` / `distance`**——X-04 卡面上那两个字段是被否决的「每节点爆炸」模型的残留 | 无 | T-244 | 待签 |
| `explode.mode` | `z.enum(EXPLODE_MODES).default('radial')` | `'radial'` | explode-clip | X-04 | — | 新块 | T-244 | 待签 |
| `explode.gain` | `z.number().min(0).max(20).default(1.5)` | `1.5` | explode-clip | X-04 | radial：`factor=1` 时锚点相对质心放大 `(1+gain)` 倍 | 新块 | T-244 | 待签 |
| `explode.axis` | `Vec3Schema.default([0, 1, 0])` | `[0, 1, 0]` | explode-clip | X-04 | axis：排布轴（分组根局部空间），运行时归一化；零向量由 I23 拦 | 新块 | T-244 | 待签 |
| `explode.spacing` | `z.number().min(0).max(1000).default(0.5)` | `0.5` | explode-clip | X-04 | 相邻名次间距，文档单位 | 新块 | T-244 | 待签 |
| `explode.easing` | `EasingSchema.default('easeInOutCubic')` | `'easeInOutCubic'` | explode-clip | X-04 | 与补间共用同一张封闭表 | 新块 | T-244 | 待签 |
| `prefab.id` | `PrefabIdSchema` | — | prefab | — | `pfb_xxxxxxxx` | 新集合 | T-232 · v2 | 待签 |
| `prefab.name` | `z.string().min(1).max(120)` | — | prefab | — | — | 新集合 | T-232 · v2 | 待签 |
| `prefab.note` | `z.string().max(500).default('')` | `''` | prefab | — | — | 新集合 | T-232 · v2 | 待签 |
| `prefab.version` | `z.number().int().min(1).default(1)` | `1` | prefab | — | 递增整数。v2 的「把更新推给所有实例」只有这一个抓手 | 新集合 | T-232 · v2 | 待签 |
| `prefab.nodes` | `z.array(NodeSchema).default([])` | `[]` | prefab | — | id 与文档主集合同一命名空间，由 I42 保证不撞车 | 新集合 | T-232 · v2 | 待签 |
| `prefab.materials` | `z.array(MaterialSchema).default([])` | `[]` | prefab | — | 同上 | 新集合 | T-232 · v2 | 待签 |
| `prefabRef.prefabId` | `PrefabIdSchema` | — | prefab | — | — | 新块 | T-232 · v2 | 待签 |
| `prefabRef.overridden` | `z.array(z.string().min(1)).max(200).default([])` | `[]` | prefab | — | v1 只写不读，v2 用它做差量更新 | 新块 | T-232 · v2 | 待签 |

### 1.4 `dataSources` 元素（新文件 `data-source.ts`）

| 字段路径 | 类型（逐字 zod） | 默认值 | 来源领域 | 冲突登记号 | 裁决 | 迁移动作 | 首个消费者 | 签字 |
|---|---|---|---|---|---|---|---|---|
| `dataSources[].id` | `DataSourceIdSchema` | — | data-source | X-24 | `ds_xxxxxxxx` | 新集合 | T-442 | 待签 |
| `dataSources[].name` | `z.string().min(1).max(60)` | — | data-source | X-24 | — | 新集合 | T-442 | 待签 |
| `dataSources[].enabled` | `z.boolean().default(false)` | `false` | data-source | X-24 | **默认 false**：升级到 v3 不会让任何一份现存文档开始发网络请求（C6 的保证） | 新集合 | T-442 | 待签 |
| `dataSources[].mode` | `z.enum(['live','sample']).default('live')` | `'live'` | data-source | X-24 | `sample` 是「断网也能完整使用」的直接兑现，**不是测试用具** | 新集合 | T-442 | 待签 |
| `dataSources[].url` | `z.string().max(2048).default('')` | `''` | data-source | X-24 | 不用 `z.string().url()`——C4：一份能打开的文档不能因为收紧校验而打不开 | 新集合 | T-442 | 待签 |
| `dataSources[].method` | `z.enum(['get','post']).default('get')` | `'get'` | data-source | X-24 | — | 新集合 | T-442 | 待签 |
| `dataSources[].body` | `z.string().max(4096).nullable().default(null)` | `null` | data-source | X-24 | — | 新集合 | T-442 | 待签 |
| `dataSources[].auth` | `DataSourceAuthSchema.default({kind:'none'})` | `{kind:'none'}` | data-source | X-24 | `secretRef` 指向部署侧密钥，**不存明文凭据**；`.strict()` 兜住「顺手塞一个 token」 | 新集合 | T-445 | 待签 |
| `dataSources[].intervalMs` | `z.number().int().min(1000).max(3_600_000).default(30_000)` | `30_000` | data-source | X-24 | **默认 30 000 不是 5 000**：下限的论证是「防 20 台瘦客户端每秒 20 次打 MES」，默认值也该保守 | 新集合 | T-446 | 待签 |
| `dataSources[].timeoutMs` | `z.number().int().min(1000).max(60_000).default(10_000)` | `10_000` | data-source | X-24 | — | 新集合 | T-446 | 待签 |
| `dataSources[].startOn` | `z.enum(['sceneReady','manual']).default('sceneReady')` | `'sceneReady'` | data-source | X-24 | — | 新集合 | T-446 | 待签 |
| `dataSources[].onError` | `z.enum(['keep','default']).default('keep')` | `'keep'` | data-source | X-24 | — | 新集合 | T-446 | 待签 |
| `dataSources[].map` | `z.array(DataMappingSchema).max(64).default([])` | `[]` | data-source | X-24 | — | 新集合 | T-445 | 待签 |
| `dataSources[].sample` | `z.array(z.string().max(8192)).max(20).default([])` | `[]` | data-source | X-24 | — | 新集合 | T-442 | 待签 |
| `map[].path` | `DataPathSchema` | — | data-source | X-24 | `a.b[0].c` 语法 + 对 `__proto__` / `constructor` / `prototype` 三个段名 refine。**原型污染是真实危害**，RFC 6901 表达不了这条防线 | 新块 | T-445 | 待签 |
| `map[].variableId` | `VariableIdSchema` | — | data-source | X-24 | 新的 `variable` 入边 | 新块 | T-445 | 待签 |
| `map[].cast` | `z.enum(['none','number','string','boolean']).default('none')` | `'none'` | data-source | X-24 | — | 新块 | T-445 | 待签 |

### 1.5 `flows` / `pages`（从 `deferred.ts` 出列）

| 字段路径 | 类型（逐字 zod） | 默认值 | 来源领域 | 冲突登记号 | 裁决 | 迁移动作 | 首个消费者 | 签字 |
|---|---|---|---|---|---|---|---|---|
| `flows[].variableId` | `VariableIdSchema`（原 `z.string()`） | — | flows-pages | **X-11** | **收紧**。非法时迁移**确定性 mint 一个变量并追加进 `variables`** | **更重-1**：`deterministicFlowVariableId(i)`；铸出的变量必须同时满足 I36 | T-300 | 待签 |
| `flows[].startStepId` | `StepIdSchema.nullable().default(null)` | `null` | flows-pages | X-11 | 入口步骤。迁移一次性派生，**不是运行时下标引用，不违 C9** | 派生 `steps[0].id` | T-300 | 待签 |
| `flows[].steps[].onEnter` | `z.array(ActionSchema).default([])` | `[]` | flows-pages | **X-14** | **字段保留，永不获得运行时**（D35）。`.describe()` 改中文「v1 未实现——步骤动作请用 flowStepEnter 规则」。非空时 I49 报 warn | 不动 | **永不** | 待签 |
| `PageSchema.name` | `z.string().min(1)`（原 `z.string()`） | — | flows-pages | — | 收紧 | **非增量-3**：空串回填 `页面 N` | T-311 | 待签 |
| `OverlayIdSchema` | `Id('ov')`（原裸 `z.string().min(1)`） | — | flows-pages | — | 今天是全文档**唯一一处受管体系之外的 id** | **非增量-4**：不匹配 `^ov_[0-9a-z]{8}$` 时确定性重铸 | T-311 | 待签 |
| `OverlaySchema` | `z.discriminatedUnion('type', […4 支…])` | — | flows-pages | **X-09** | **采纳按 type 的判别联合**，不采纳开放 record。`id/type/rect/anchor/props` 五个字段位置一个没动 | **更重-2**：按 type 逐键补默认，**未知键丢弃**并各记一条日志 | T-311 | 待签 |
| `OVERLAY_TYPES` | `['text','image','button','panel']` **恒为 4** | — | flows-pages | — | 进度条是 `panel.props.progress`，**不是第五种 type**——加第五支即拆掉 R13 防线 | 不动 | T-311 | 待签 |
| `OVERLAY_TOKENS` | `['{flowName}','{stepName}','{stepIndex}','{stepTotal}']` | — | flows-pages | — | 文本里可用且仅可用这四个占位符 | 新常量 | T-311 | 待签 |
| `text.props.text` / `size` / `color` / `align` / `flowId` | `z.string().default('')` · `z.number().min(8).max(96).default(16)` · `HexColorSchema.default('#ffffff')` · `z.enum(['left','center','right']).default('left')` · `FlowIdSchema.nullable().default(null)` | 见左 | flows-pages | X-09 | 文字大小以 1080 高为参考随画面等比缩放 | 更重-2 | T-311 | 待签 |
| `image.props.mediaId` / `fit` | `MediaIdSchema.nullable().default(null)` · `z.enum(['contain','cover']).default('contain')` | `null` · `'contain'` | flows-pages | X-09 | `media.type` 必须是 image（I40） | 更重-2 | T-311 | 待签 |
| `button.props.label` / `variant` | `z.string().default('按钮')` · `z.enum(['primary','ghost']).default('primary')` | `'按钮'` · `'primary'` | flows-pages | **X-10** | **它要做什么不在 props 里，在规则里**——采纳 `overlayClick` 事件，`overlay.onClick` 内联动作**不进 schema**（D34） | 更重-2 | T-311 | 待签 |
| `panel.props.title` / `text` / `mediaId` / `flowId` / `progress` | `z.string().default('')` ×2 · `MediaIdSchema.nullable().default(null)` · `FlowIdSchema.nullable().default(null)` · `z.boolean().default(false)` | 见左 | flows-pages | X-09 | `flowId` 非空时面板顶部画 `stepIndex/stepTotal` 进度条 | 更重-2 | T-311 | 待签 |
| overlay `rect` | `{x,y,w,h}` 全 `z.number().finite()`，**画面比例 0..1** | — | flows-pages | — | 越界只 warn（I54），**不 refine**——硬约束会让一份能打开的文档打不开（C4） | 不动 | T-311 | 待签 |

### 1.6 `rule.ts`：事件 8→11 · 载荷键 +2 · 条件 +1

| 字段路径 | 类型（逐字 zod） | 默认值 | 来源领域 | 冲突登记号 | 裁决 | 迁移动作 | 首个消费者 | 签字 |
|---|---|---|---|---|---|---|---|---|
| `EventDescriptor` `pageEnter` | `z.object({event:z.literal('pageEnter'), pageId:PageIdSchema}).strict()` | — | flows-pages | — | 事件**枚举**在 v1.0 冻结，**运行时接线在 v1.2** | 无（加法） | T-302（枚举）· T-305（通电） | 待签 |
| `EventDescriptor` `flowStepEnter` | `z.object({event:z.literal('flowStepEnter'), flowId:FlowIdSchema, stepId:StepIdSchema}).strict()` | — | flows-pages | — | 同上 | 无 | T-300 | 待签 |
| `EventDescriptor` `overlayClick` | `z.object({event:z.literal('overlayClick'), overlayId:OverlayIdSchema}).strict()` | — | flows-pages | **X-10 · P-3** | **对「事件枚举是封闭集」的一次显式例外**，产品负责人 2026-08-03 逐条签字。理由与 `mediaEnd` 的区别是**用户意图 vs 运行时结果**。**不构成先例**：第 12 种事件仍是一次完整的 Q3，且 v1 的 bump 已用完 | 无 | T-305 | 待签 |
| `EVENT_TYPES` | `length === 11` | — | flows-pages | X-13 | — | 无 | T-302 | 待签 |
| `EVENT_PAYLOAD_KEYS` | `['nodeId','hotspotId','animationId','stepId','pageId']` | — | flows-pages | **X-13** | **不加 `overlayId`**：`overlayClick` 的 overlayId 在 `when` 里必填，规则体读它没有用例 | 无 | T-302 | 待签 |
| `Condition` `isPageVisible` | `z.object({op:z.literal('isPageVisible'), pageId:PageIdSchema, value:z.boolean()}).strict()` | — | flows-pages | **X-12** | 采纳 **8 个编排动作 + 这一条条件**，不采纳另一份的 3 个 | 无 | T-307 | 待签 |
| `Condition` `isFlowStep` | **不加** | — | flows-pages | X-12 | 等价于 `{var:流程变量} eq {const:'st_x'}` | — | — | 待签 |

### 1.7 既有集合的元素增量

| 字段路径 | 类型（逐字 zod） | 默认值 | 来源领域 | 冲突登记号 | 裁决 | 迁移动作 | 首个消费者 | 签字 |
|---|---|---|---|---|---|---|---|---|
| `animations[].startS`（仅 `imported`） | `z.number().nonnegative().default(0)` | `0` | animation | **X-06** | **`animations[]` 要改**——「序列增强全在动作参数里」的主张被否：区间定义的是「这条记录**就是**那个子片段」，可复用、可被多条规则引用、面板里可见 | 仅 `kind==='imported'` 补 | T-318 | 待签 |
| `animations[].endS` | `z.number().positive().nullable().default(null)` | `null` | animation | X-06 | 同上 | 同上 | T-318 | 待签 |
| `animations[].kind` 第三种 | **永不新增** | — | animation | — | R03 防线 | — | — | 待签 |
| `assets[].stats.clipDurations` | `z.record(z.string(), z.number().nonnegative()).default({})` | `{}` | animation | X-06 | ⚠ **高危**：`AssetStats` 是 `.strict()` 而 `checkIntegrity` 不重跑 schema 校验——T-176 用这个组合炸过一次。**动它的卡验收必须是「发布一次」（`validate` 级），不是「体检一次」** | 补默认 | T-234 | 待签 |
| `assets[].origin` | `AssetOriginSchema.optional()`（嵌套块 `hash`/`bytes`/`stats`/`audit?`/`transcode{profileId,toolchain,ops[],skipped[],triangleRatio,finishedAt}`） | 缺省 | asset-pipeline | **X-08** | **采纳 `asset.origin`，不采纳 `assets[].processing`**（D39）：一个块只有一个「在不在」的问题，六个平铺可选字段要在五处各被看见一次 | 无（可选） | T-424 | 待签 |
| `hotspots[].style.label` | `z.string().max(8).optional()` | 缺省 = 1-based 序号 | render-out | **X-07** | **理由值钱**：编号取下标会让删一个热点使后面全部改号，而出图的头号用途是**印进手册与验收材料** | 无（可选） | T-264 | 待签 |
| `viewpoints[].thumbnailUrl` | **删除** | — | render-out | **X-07** | **本次唯一的字段删除**。今天零读零写且形状是错的，这是唯一一次改它的机会 | **非增量-2**：解构丢弃，迁移日志记一行 | T-225 | 待签 |
| `viewpoints[].thumbnailAssetId` | `AssetIdSchema.optional()` | 缺省 | render-out | X-07 | ⚠ **新的资产入边**：`remapAssetRefs` 与 `referencedHashes` 必须认识它，**漏了就是 T-176「发布漏字节」的逐字复现**，而因为它是 placeholder，v1.0 全程没人会发现 | 无（可选） | T-269（遍历面）· v1.5（写入） | 待签 |
| `variables[].scope` | `z.enum(['scene','project']).default('scene')` | `'scene'` | multi-scene | — | v1.0 零消费者，**必须进 T-205 豁免表** | 补默认 | T-436 | 待签 |
| `variables[].persist` | **不改，也不实现** | — | multi-scene | — | 躺了两个版本、零读取点；v1.5 由后端提供「上次已知值」 | — | — | 待签 |
| `hotspots[].content.type` · `NODE_PROP_KEYS` · `node.parent` / `node.order` | **一个字节都不改** | — | — | — | — | — | — | 待签 |
| `constraints` | **永不定义** | — | — | — | 保留 `validate.test.ts:52-53` 的断言，改注释说明裁决 | — | — | 待签 |
| 分享链接 / 口令 / 有效期 / 权限 / 审计 / 编辑锁 / origin 白名单 / 嵌入 allowlist / 导出参数 / 编辑器工具态 | **零字段** | — | backend · embed · render-out | — | 部署事实与工具状态**不是场景状态**（§1.3 逐条已裁） | — | — | 待签 |

---

## 2 · 计数汇总（T-225 反向比对的对照物）

**这一节是本表唯一的机器落点。** T-225 的验收里那条反向比对读的就是这三个数。

| 口径 | v2 | v3 | 差 |
|---|---|---|---|
| 顶层集合数（`ID_COLLECTIONS`） | 11 | **13** | +2（`dataSources` · `prefabs`） |
| ID 前缀数（`PREFIXES`） | 13 | **17** | +4（`ov` · `ds` · `scn` · `pfb`） |
| 事件枚举（`EVENT_TYPES`） | 8 | **11** | +3（`pageEnter` · `flowStepEnter` · `overlayClick`） |
| 条件（`ConditionSchema` 支数） | 5 | **6** | +1（`isPageVisible`） |
| `EVENT_PAYLOAD_KEYS` | 3 | **5** | +2（`stepId` · `pageId`） |
| `OVERLAY_TYPES` | 4 | **4** | 0（**恒为 4**，加第 5 支即拆 R13 防线） |
| 顶层标量 | — | **+1** | `sceneId` |
| `node` 字段 | — | **+4** | `section` · `explode` · `explodeOffset` · `prefabRef` |
| `meta` 字段 | — | **+2** | `fog` · `effects` |
| 字段删除 | — | **1** | `viewpoints[].thumbnailUrl`（本次唯一一处） |
| 迁移里的非增量操作 | 0 | **4** | 见 §4.1.5 非增量-1 ~ -4 |
| 迁移里更重的改写 | 0 | **2** | 更重-1（mint 变量）· 更重-2（overlay props 丢未知键） |

> **这两个数错一位，那条反向比对就变成两份错误互相签字。** 集合数与前缀数的真值以规划 §4.1.3 为准。

---

## 3 · A4 十四条裁决 → 本表索引

每一条都能在上面 grep 到它的冲突登记号。

| 登记号 | 裁决一句话 | 在本表的哪一节 |
|---|---|---|
| **X-01** | 雾 → `meta.fog` 独立块，不并进 `meta.effects` | §1.2 |
| **X-02** | `meta.effects.outline` 加 `enabled: boolean.default(false)`，老文档不构造 composer | §1.2 |
| **X-03** | 剖切 → `node.section` 第四种承载体，启停复用 `node.visible`，不采纳 `meta.section` | §1.3 |
| **X-04** | 爆炸 → `node.explode{mode,gain,axis,spacing,easing}` + `node.explodeOffset`，**没有 `dir`/`distance`** | §1.3 |
| **X-05** | 动作名 **`explode`**（不是 `setExplode`），`refs()` 返回 `[{kind:'node'}]`；**不新增 `setSection`** | §4.3（动作，不在本表；本表只管字段） |
| **X-06** | `animations` **要改**：`imported.startS` / `endS` + `asset.stats.clipDurations` | §1.7 |
| **X-07** | 出图两字段并入：`hotspot.style.label` 新增；`viewpoints[].thumbnailUrl → thumbnailAssetId`（**破坏性改名**） | §1.7 |
| **X-08** | 资产溯源采纳 `asset.origin`，不采纳 `assets[].processing` | §1.7 |
| **X-09** | `OverlaySchema` 采纳**按 type 的判别联合**，不采纳开放 record | §1.5 |
| **X-10** | 覆盖层按钮采纳 **`overlayClick` 事件**，`overlay.onClick` 内联动作**不进 schema** | §1.5 · §1.6 |
| **X-11** | `flows[]` 三条并入：`startStepId` · `variableId` 收紧 · 迁移里**确定性** mint 新变量 | §1.5 |
| **X-12** | 编排采纳 **8 个动作 + 条件 `isPageVisible`**，不采纳另一份的 3 个 | §1.6 |
| **X-13** | `EVENT_PAYLOAD_KEYS` +2（`stepId` · `pageId`），**不加 `overlayId`** | §1.6 |
| **X-14** | `flows[].steps[].onEnter` **永不实现**（保留字段 + 中文 `.describe()`） | §1.5 |
| prefab | 采纳 `prefabs[]` 集合 + `node.prefabRef`，**不采纳裸串**——裸串不进五个遍历面 | §1.1 · §1.3 |
| **A3(c)** | **`sceneRefs` 顶层集合不采纳**；多场景在文档里只留 `sceneId` 与 `variables[].scope` | §1.1 · §1.7 |

**`I` 编号由本卡统一分配，起始 I16**，真源是规划 §4.2 的 I16–I69 表。合并前三份稿子各自硬编码 `I16` 起（asset-pipeline I16–I19 · postfx I16–I20 · flows-pages I16–I27），且 schema-v3 的 `I??-a..l` 与 flows-pages 的 I16–I27 是同一批检查的两份写法。**已去重，编号以 §4.2 为唯一真源。**

---

## 4 · 六方签字

**六个领域各签一行。签齐之前不许开 T-225。**

签的是一句话：**「本表 §1 里属于我这个领域的每一行，与我的设计一致；不一致的地方我已经在下面写出来了。」**

| 领域 | 本表里属于它的节 | 签字（人名） | 日期 | 不一致之处（无则写「无」） |
|---|---|---|---|---|
| **postfx**（描边与雾） | §1.2 全部 | 待签 | 待签 | 待签 |
| **explode-clip**（爆炸与剖切） | §1.3 的 `section` / `explode` / `explodeOffset` 及两个新文件 | 待签 | 待签 | 待签 |
| **render-out**（渲染出图） | §1.7 的 `hotspots[].style.label` · `viewpoints[].thumbnail*` | 待签 | 待签 | 待签 |
| **animation**（动画序列） | §1.7 的 `startS` / `endS` / `clipDurations` | 待签 | 待签 | 待签 |
| **flows-pages**（编排与覆盖层） | §1.5 全部 · §1.6 全部 | 待签 | 待签 | 待签 |
| **schema-v3 / 集成**（顶层 · 迁移 · dataSources · prefab） | §1.1 · §1.4 · §1.3 的 prefab 段 | 待签 | 待签 | 待签 |

> **签字之外还有两件事要人拍板，写在这里免得散落**：
>
> 1. **四个默认值今天是拍的不是测的**（`fog.near=10` / `fog.far=100` / 剖切平面上限 3 / 描边预设上限 2 / 设备像素比封顶 2）。G0.5-8 未闭合（[ADR-0022](adr/0022-G0.5-8-目标机器-benchmark-的挂载方式.md)），H1 是 v1.0 的出口门槛。**签字不等于确认这些数字是对的**，只等于确认字段形状是对的。
> 2. **`prefabs` 是本版最大的一块 placeholder**：v1.0 与 v1.2 **无任何生产写入路径**。它已在 [DEAD_EXPORTS_ALLOWLIST.md](DEAD_EXPORTS_ALLOWLIST.md) 里占位（`owner` / `expires: v2`）。签字即接受这块债，以及它到期未清会让 CI 转红。
