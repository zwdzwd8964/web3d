# 变异检验登记表

**这份表是干什么的**：每新增一条测试，把它保护的行为**故意改坏**一次，看测试转不转红。
转红说明这条测试真的在测东西；**不转红说明它不是**。两种结果都登记在这里。

**为什么不写进提交信息**：提交信息不可查询、不可统计、不可回填（风险 V25）。
`scripts/check-mutations.mjs`（**T-297 已交付**）会读这张表并把它挂进 `pnpm verify`。
它每次运行打印**登记条数 / 涉及卡数 / 未转红条数**，并断言「台账里每张已标 `[x]` 且需登记的卡
都被覆盖」——缺一张就点名卡号。
**本表由 T-200 收尾时手工建立，T-297 只是把它锁上，不是它的起点。**

**预期有多少条是绿的**：v0.5 实测 31 次变异里 **8 次不转红**（26%）。v1 的 13 份设计合计列出
约 377 次变异，按同比例预期 **≈97 次不转红**。**这是排期事实，不是写得差，也不是停下来问人的理由。**

---

## 怎么填

七列，逐行必填，列头顺序不许改：

| 列 | 填什么 |
|---|---|
| **卡号** | `T-2xx`。必须是 `docs/TASK_BACKLOG_V1.md` 里真实存在的卡 |
| **编号** | 卡内序号，与卡面「变异检验」栏的 ①②③ 或 M1/M2 对应 |
| **操作** | 把哪一行代码改成了什么。要具体到能被别人原样复现 |
| **期望** | 期望哪条测试转红 |
| **实际** | **必须以四个封闭 token 之一开头**（见下），后面爱写多少散文写多少 |
| **若绿属哪一类** | 封闭枚举 `a` / `b` / `c`。**token 为 `红` / `非变异` 时填 `—`** |
| **处置** | 怎么处理的。**token 为 `绿` / `绿→红` 时必填**，不许写「已知」「稍后处理」，也不许写 `—` |

「实际」列的四个 token（T-297 立的口径，`scripts/check-mutations.mjs` 认它）：

| token | 含义 | 后两列 |
|---|---|---|
| `红` | 变异让测试转红了，也就是它该有的样子 | `—` / 随意 |
| `绿` | 没转红 | **必填** |
| `绿→红` | **先绿，把测试改强之后才红** | **必填** |
| `非变异` | 不是变异，是一次观察 / 测量，为留证而登记 | `—` / 随意 |

> **为什么要 token，而不是让这一列继续写散文。** T-458 的里程碑收尾脚本要报「本里程碑未转红
> 条数」，而在立这条口径之前，同一张表按「含『绿』字」数得 19、按「含绿且不含红」数得 14。
> **一个可以争辩的数字不是指标。**
>
> **为什么 `绿→红` 单列一档，而不是并进 `红`。** 并进去等于把「我们差点漏掉这个缺陷」洗成
> 「一切正常」。这一档在本仓是**信息量最大的一类**——它记的不是被测代码有问题，是**测试本身
> 原来什么都没测到**，而这正是整张表存在的理由。v1 至今 19 条未转红里有 8 条属于它。
>
> **`非变异` 这一档是补的。** 七列模板原本只给「红/绿」留了位置，而实际登记里出现了第三种
> 东西：不是变异、是一次为留证而记的观察（例如「这条断言在本机 19/19 全中、CI 只中 1 个」）。
> 硬把它塞进「绿」会污染未转红基线——它压根没有「该不该红」这回事。

「若绿属哪一类」的三档（**不许自造第四档**）：

- **a · 测试没测到东西** —— 最常见。**补断言，不是补一句解释。**
- **b · 冗余机制互相掩护** —— 两条路径保证同一件事，单独敲掉任何一条都没有观测后果。
  处理方式有两种且都对：删掉多余那条（v0.5 T-182 的 C1），或保留两条但把断言收紧到
  能分开的粒度、例如报错措辞（v0.5 T-186 的 I4）。
- **c · 被测代码本来就是对的** —— 记录并放过。**这一档最容易被滥用**：v0.5 的 8 次绿里
  只有 1 次真属于这一档，其余 7 次全是刚写的测试自己没测到东西。填 `c` 之前先问一遍
  「我是不是在给 a 找台阶下」。

**一条真实的例子**（v0.5 T-183 · D1，见 `IMPL_NOTES.md` E18 那一节）：
删掉 `SceneRuntime` 构造函数里那行 `await this.environment.apply(doc)`，期望「HDRI 照亮场景」
那条测试转红，**实际是绿的**。原因是测试**用带 HDRI 的文档去构造 runtime**，而构造函数本身
就会 apply 一次——被测的那一行删掉毫无变化。属 **a**，处置是改成先构造空场景再 `load` 带 HDRI 的文档。
（这条**故意写成散文而不是表行**：R3 要求卡号在 v1 台账里存在，而 E18 那 8 条绿全是 v0.5 的
卡号（T-182 ~ T-186）。写成表行会被 R3 判红；为容纳它放宽 R3，R3 就废了。脚本因此**只扫
`## 登记表` 以下的表**，这一节的散文不在扫描面内。）

---

## 登记表

| 卡号 | 编号 | 操作 | 期望 | 实际 | 若绿属哪一类 | 处置 |
|---|---|---|---|---|---|---|
| T-200 | ① | `attachRenderer` 里 `this.options.createRenderer ?? defaultCreateRenderer` 改成恒用 `defaultCreateRenderer` | `prefers the injected factory over the default one` 转红 | 红 | — | 还原。红的理由正确：Node 里 `new WebGLRenderer` 拿一个假 canvas 会抛 |
| T-200 | ② | `renderer-like.ts` 的 `webGLRendererParams` 里 `preserveDrawingBuffer: true` 改成 `false` | 「不注入时逐属性相同」转红 | 红 | — | 还原。两条断言同时转红（默认参数 + 不透明背景那条） |
| T-200 | ③ | 接缝清单里 `registerChrome` / `setChromeVisible` / `isPageVisible` 三处的 `throw` 改成 `return`（分别返回空函数 / `undefined` / `false`） | 接缝清单那 3 条 `it.each` 转红 | 红 | — | 还原。这条证明清单测试断的是「未接线会抛」而不只是「方法存在」——只断存在时空实现照绿 |
| T-201 | ① | 给 `SceneDocumentSchema` 加一个 `foos: z.array(z.object({id: z.string()}))` 而不动 `ID_COLLECTIONS` | 反射比对那条转红 | 红 | — | 还原 |
| T-201 | ② | `applyRollback` 的循环里加 `if (name === 'media') continue` | 回滚覆盖那条转红 | **绿** | **a** | 测试用 `createGoldenPathDocument()` 造 draft，而它的 `pages` / `flows` / `media` 三个集合本来就是空的——把空数组回滚成空数组，与做对了完全同形。改成 `populatedDocument()`（三个集合各塞一条），再跑同一条变异 → **2 条转红** |
| T-201 | ③ | 把反射比对换成 `expect(ID_COLLECTION_NAMES.length).toBeGreaterThan(0)`，同时保留 ① 的 `foos` | 证明弱写法测不出东西 | 绿（**预期如此**） | a | 这是卡面要求的反向证明，不是缺陷：弱断言在有未注册集合时照样通过。正式版保留双向集合相等 |
| T-201 | ④ | （顺带）`applyPatch` 对整块 `/materials` 的处置 | 覆盖测试要求每个集合的整块补丁都被认识 | 红 | — | **不是变异，是覆盖测试第一次跑就抓到的既有行为**：`applyMaterialPatch` 对 `indexRaw === undefined` 显式 `return false`，是 T-176 记录过的「故意回落全量重建」。登记进测试里的 `DELIBERATE_FULL_REBUILD` 表（一条，带 owner T-257）并加一条「这张表只能缩不能涨」的棘轮 |
| T-202 | ① | upgrade 里去掉 `if (!db.objectStoreNames.contains('projects'))` 守卫，改成无条件 `createObjectStore` | 老库回归（v1 库升 v2）转红 | 红 | — | 还原。红在 `ConstraintError`，正是「upgrade 不是幂等的」该有的症状 |
| T-202 | ② | upgrade 里删掉 `revs` 那一段，只建三个新 store | store 集合断言转红 | 红 | — | 还原。断言写的是**集合双向相等**（`toEqual([...OBJECT_STORES].sort())`）；写 `toContain` 时漏一个不会红，这正是本卡要防的形状 |
| T-202 | ③ | `mapWriteError` 里 `if (isQuotaError(cause))` 改成 `if (false && …)`，即直接 rethrow | 配额契约那条转红 | 红 | — | 还原。IndexedDb 侧转红，证明跑的是 `mapWriteError` 的真实识别路径（测试注入的是浏览器真实形状的 `QuotaExceededError`） |
| T-202 | ④ | `getBlob` 的 `new Uint8Array(bytes)` 改成 `new Uint8Array(bytes.byteLength)`（长度对、内容全零） | 64 MB 往返那条转红 | 红 | — | 还原。断言走内容哈希而不是 `toHaveLength`——`toHaveLength` 对 64 MB 全零同样成立，那恰好是坏拷贝的产物 |
| T-203 | ① | `REF_KINDS.node.exists` 改成恒 `true` | 「引用已删对象的动作被跳过」转红 | 红 | — | 还原。ref-kinds 与 executor 两侧各红一条 |
| T-203 | ② | `REF_KINDS` 的类型从 `Record<RefKind, RefKindSpec>` 放宽成 `Partial<Record<…>>` | 测试里的 `@ts-expect-error` 变成编译错 | 红（编译错 TS2578 `Unused '@ts-expect-error' directive`） | — | 还原。守卫写错不再是绿灯，而是编译不过——v0.5 T-185 的 H2 同形 |
| T-203 | ③ | 把 14 条行为对照压成「至少一条通过」 | 证明弱写法测不出东西 | 绿（**预期如此**） | a | 卡面要求的反向证明。正式版保留 `it.each(ALL_KINDS)` 的 7×2 逐项断言 |
| T-203 | ④a | 在 `executor.ts` 里手写 `switch (kind) { default: }`（无 per-kind case） | `check-core-purity` 转红 | 红 | — | 还原。命中的是新加的 `switch` 正则 |
| T-203 | ④b | 在 `executor.ts` 里手写 `switch (kind) { case 'step': … }` | `check-core-purity` 的 **case 正则**独立转红 | 红（2 条：25 行 switch + 26 行 case） | — | **本卡最有价值的一次**：第一版 case 正则**结构上永不可能匹配**——`stripCommentsAndStrings` 会把字符串内容清空只留引号，`case 'step'` 到达正则时已经是 `case '    '`。同一探针在旧扫描面上只报 1 条（25 行），补了 `keep-strings` 扫描面之后报 2 条。若不做这次探针，这条守卫从加上那天起就是装饰品，而 T-302 的关键变异会是绿的 |
| T-203 | ⑤ | 把 case 正则的枚举删到只剩 `node`，保留 ④b 的探针 | 探针仍须红（证明 `switch` 那条不是摆设） | 红（25 行仍报） | — | 还原 |
| T-204 | ① | `CHURN_LIMIT` 改成 `Number.MAX_SAFE_INTEGER` | 跨 await 那条红、同步 20 层那条**保持绿** | 红 / 绿（正是要的一红一绿） | — | 还原。跑的是 `-t '跨 await'` 三条：只有第一条转红。⚠ 副作用：`ChurnGuard 本体` 那五条会 `for (i <= CHURN_LIMIT)` 死循环，所以这条变异必须带 `-t` 过滤跑 |
| T-204 | ② | `MAX_CHAIN_DEPTH` 改成 `Number.MAX_SAFE_INTEGER` | 反之：同步那条红、跨 await 那条保持绿 | 红 · 绿 / 红（正是要的一红一绿） | — | 还原。两道防线确实各管各的，没有互相掩护 |
| T-204 | ③ | churn 错误措辞「1 秒内变化超过」改成「1 秒内变动超过」 | 断言必须红 | 红 | — | 还原。断到措辞而不是「打了 error」——v0.5 T-186「两条守卫互相掩护」的直接对策 |
| T-204 | ④ | （非变异，是复现）两条互写变量的规则夹一个 `wait(1ms)`，跑 3000 ms 引擎时间 | 期望 `MAX_CHAIN_DEPTH` 报警 | 非变异 · **零告警、不收敛**（实测跑到第 480 跳仍在增长） | — | 这就是本卡存在的理由，写成了测试的前置断言（`counts.a + counts.b > 400`）。对照组：去掉 `wait` 恰好在第 16 层报一条 |
| T-204 | ⑤ | （测试自身的假绿）第一版用 `await h.advance(3000)` 一次推进 | 期望环跑起来 | **绿但没测到东西**（环只跑了 1 跳就停） | a | `advance` 在两个时钟条目之间只让出两个微任务，不够一条带 await 的规则跑完并排下一跳——环看起来「自己停了」，而这样写的测试**有没有防线都会过**。改成逐毫秒 `step(h, 3000)` 后才真的跑起来 |
| T-205 | M1 | 给 `packages/core/src/index.ts` 加一行 `export const __probe = 1` | 脚本 exit 1 并**点名 `__probe`** | 红，点名 `core:__probe` | — | 还原 |
| T-205 | M2 | 清空豁免表与遗留基线 | 必须红出若干条（证明扫描非空） | 红，121 条 | — | 还原 |
| T-205 | M3 | 把 `schema:touch` 的 reason 改成「以后要用」（4 个字） | 必须红且点名该行 | 红，点名 `docs/DEAD_EXPORTS_ALLOWLIST.md:30` | — | 还原 |
| T-205 | M4 | 把同一行的 expires 从 `v1.2` 改成 `v0.5` | 必须红 | 红：「豁免已于 v0.5 到期（当前 v1.0）」 | — | 还原 |
| T-205 | M5 | 把有大量调用者的 `core:SceneRuntime` 加进豁免表 | 陈旧豁免必须红 | 红 | — | 还原 |
| T-205 | M6 | 把扫描的包名列表改成 `['nope']` | 必须红，**红的理由是导出面下限不成立**而不是「孤儿为 0 所以放行」 | 红：「导出面只扫到 0 个符号（下限 600）——扫描范围坏了，不是代码干净了」 | — | 还原。这是唯一能区分「守卫在工作」与「守卫在扫空气」的探针 |
| T-205 | M7 | 给 `Picker` 加一个零调用的公共方法 `__probeMethod()` | 必须被点名（成员级的全部意义） | 红，点名 `core:Picker.__probeMethod` | — | 还原。只做符号级时这条是绿的 |
| T-205 | M8 | 把 `packages/*/test/**` 也算作「生产引用」 | 已知死导出应大量变成「有引用」 | 红：孤儿 **121 → 32**，89 条陈旧登记被点名 | — | 还原。这个数字量化了为什么覆盖率 / typecheck / lint 三者都看不见这一形状：**121 条里有 89 条只被测试引用过** |
| T-207 | ① | 把 `package.json` 的 `size` 脚本改名成 `sizeX` | 规则 1 红 | 红，30 条（`CLAUDE.md:240` 等逐处点名） | — | 还原 |
| T-207 | ② | 给 `IMPL_NOTES.md` 加一条 `[不存在](./nope-probe.md)` | 规则 2 红 | 红，点名文件与行号 | — | 还原 |
| T-207 | ③ | 删掉 `docs/adr/0031-…md` | 规则 3 红 | 红：「声称 31 条 ADR，实际 30 条」 | — | 还原 |
| T-207 | ③′ | 把 README 里的 ADR 数改成 99（**卡面点名的假绿陷阱**：脚本若只数目录不和 README 比，③ 也会绿） | 规则 3 红 | 红：「声称 99 条 ADR，实际 31 条」 | — | 还原。两向都验过，证明 ③ 不是「只数目录」 |
| T-207 | ④ | 把 `**M14 小计：27 张**` 改成 28 张 | 规则 4 红 | 红：「M14 声称 28 张，实数 27 张」 | — | 还原 |
| T-207 | ④′ | 把 `CLAUDE.md` 的卡数引用改回 196 / 220.5（本卡开工时的真实状态） | 规则 4 红 | 红：「引用 196 / 220.5，台账真值 199 / 222.7」 | — | 还原。**4a/4b 的合计行今天全部自洽，4c 是规则 4 唯一非空的检查面**——不加 4c，规则 4 就是装饰品 |
| T-207 | ⑤ | 把门槛表里 `pnpm -F @w3/core test apply-patch-coverage` 的过滤器改成 `zzz` | 规则 6 红 | 红，且带上「T-201 已标 [x]，待交付标记已失效」 | — | 还原 |
| T-207 | ⑥ | 把「由 T-218 交付」改成「由 T-999 交付」 | 规则 6 红 | 红：「台账里没有这张卡」 | — | 还原 |
| T-207 | ⑦ | 删掉已标 `[x]` 的 T-205 所交付的 `scripts/check-dead-exports.mjs` | 规则 6 红（证明 (d) 的失效逻辑真的在跑） | 红 | — | 还原 |
| T-207 | ⑧ | 把规则 6 的门槛表小节标题改成永不匹配的 `#### ZZZ` | **下限断言**红，而不是「零问题」 | 红：「找不到门槛表小节」+ 命令数从 84 掉到 47 | — | 还原。与 T-205 的 M6、T-297 的变异 ⑤ 同一种风险，本仓第三次写下它 |
| T-207 | ⑨ | 台账里 `G1.5-1 ~ G1.5-16` 改成 `~ G1.5-12` | 规则 7 红且打印 `12 vs 16` | 红 | — | 还原 |
| T-207 | ⑨′ | 附录 D 小节标题 `## v1.0 晋级门槛 G1.0-1 ~ G1.0-22` 改成 `~ G1.0-20` | 规则 7 红（**第二种形状**，抽取正则不同） | 红：`20 vs 22` | — | 还原 |
| T-207 | ⑨″ | 卡面「（22 条以规划 §7.1 的表行数为准」改成「21 条」 | 规则 7 红（**第三种形状**） | 绿→红 · **第一次是绿的** | **a** | 形状 ③ 的正则写成 `\*\*(\d+) 条\*\*`，而三张卡里有一张没加粗——**这条形状从写出来那天起就匹配 0 处**。改成 `\*{0,2}` 后重跑转红（`21 vs 22`），全仓声明数从 18 涨到 21。**读正则读不出来，只有真跑探针才发现** |
| T-207 | ⑩ | 从规则 5 的对照表里删掉 `AI provider 插座` 那一行 | 规则 5 红（新增能力必须同时登记落点） | 红 | — | 还原 |
| T-207 | ⑩′ | 把 NORTH_STAR §3 的「AI provider 插座」落点删掉（= 本卡开工时的真实状态） | 规则 5 红 | 绿→红 · **第一次是绿的** | **a** | 规则 5 在**整节**里找落点，而我为这次补录写的那段说明本身就含「AI provider 插座」六个字——**断言匹配到的是解释漏洞的散文，不是清单本身**。改成只在 `**新增**：` 那一行里找，重跑转红 |
| T-208 | ① | 在 `engine.ts` 里临时写 `if (action.type === 'x')` | `check-core-purity` 必须红（**A6 说这条有实质风险，必须实测**） | 红：`engine.ts:170  C5/A3: literal comparison against a step discriminant` | — | 还原。**不是装饰品**——但代价第 3 条要如实记：`EXECUTOR_ONLY_SMELLS`（裸 `switch` / `case 'kind'`）仍只锁 `executor.ts`，在 `engine.ts` 里写裸 `switch (kind)` **今天不会红**（反向探针已验），这是 ADR-0028 代价 3 的既定取舍 |
| T-208 | ①′ | 按卡面字面写 `/executor\|dispatch\|engine/i`（不锚 basename） | —— | 非变异 · **本机 19/19 全中，CI 只中 1 个** | — | **不是变异，是勘察实测出的地雷**：`collectFiles` 返回绝对路径，而检出目录叫 `0729 3d engine`。照字面写会在本机报两条 `headless.ts` 的假违规（`animation.kind === 'tween'` / `light.kind === 'hemisphere'`），CI 上却是绿的。改成 `/(executor\|dispatch\|engine)\.ts$/` |
| T-208 | ② | 往 `packages/schema/src/selectors.ts` 加 60 条永不被调用的语句 | `pnpm -F @w3/schema test` 必须红 | 红，exit 1：`Statements 83.13% < 90%`、`branches 71.31% < 80%`、`lines 88.53% < 90%` | — | 还原。**这条门槛此前从未执行过**（阈值配置在 `vitest.config.ts` 里躺着，而 test 脚本是裸 `vitest run`） |
| T-208 | ②′ | （不是变异，是核实）补上 `--coverage` 之后**今天是绿的** | —— | 非变异 · 94.78% / 88.53% / 97.32% / 95.9%，四条阈值全过 | — | 「阈值从未执行」属实，但它不是一个待修的真缺陷。⚠ **branches 88.53% 距离 80 的阈值有余量，距离 90 只有 1.5 个点**——若有人顺手把 branches 也提到 90，当场变红 |
| T-208 | ③ | 往 `packages/core/src/runtime` 临时写 `setInterval` | `check-core-purity` 必须红 | 红：`picker.ts:38  non-deterministic: setInterval()` | — | 还原。C8 扫描面从 `src/eca`（19 个文件）扩到 `+ src/runtime`（46 个），配 6 行具名豁免——被豁免的正是 `ctx.now()` / `ctx.wait()` 的实现本体与渲染循环 |
| T-208 | ④ | 把 `size-budget.json` 的 player 改成 100 | `pnpm size` 必须 FAIL 且 exit 1 | 红，exit 1 | — | 还原 |
| T-208 | ④′ | **删掉 `size-budget.json`** | 必须拒绝给结论，而不是静默通过 | 红：「预算文件缺失时本脚本拒绝给出结论」，exit 1 | — | 还原。`total <= undefined` 与 `total > undefined` **都是 false**——预算文件缺失时读成 pass 还是 fail，取决于比较符往哪边写。所以直接拒绝，不比较 |
| T-217 | ① | `measureFromHeader` 的三角面公式改成一律 `Math.floor(count / 3)` | 交叉校验红 | 绿→红 · **前两次都是绿的** | **a** | 第一次：全部 fixture 都是 mode 4，`if (mode===4) … else if (5\|6) …` 与 `count/3` 在这条数据上不可区分。补 `buildMixedModeGlb`（0/1/4/5/6 五种 mode）后**第二次仍然绿**——**4 个顶点时两个公式的和恰好相等**（`0+0+1+2+2 = 5` 与 `1+1+1+1+1 = 5`）。改成 7 个顶点（`0+0+2+5+5 = 12` vs `2×5 = 10`）才转红。**一份 fixture 可以满足测试的每一条结构要求，却仍然无法让它失败** |
| T-217 | ①′ | `textures` 改读 `json.textures.length`（而不是 `json.images.length`） | 交叉校验红 | 绿→红 · **第一次是绿的** | **a** | 现有 fixture 是 1 image / 1 texture，两者不可区分（勘察时就预警过）。补一份「一张图背两个 texture」的 fixture 后转红。⚠ gltf-transform 的**写入端**对同样字节仍会各写一份 image，所以这份 fixture 只能靠重写 JSON chunk 造——而「一张图两个采样器」是真实导出器天天产出的形状 |
| T-217 | ② | `readGlb` 去掉 `registerExtensions(ALL_EXTENSIONS)` | **卡面说**「Draco 不再抛异常」会红 | 红——但**红的不是卡面说的那条** | — | **卡面这条验收在实现层面不成立**：实测 `registerExtensions` 让 Draco 从可读的 `Error: Missing required extension` 变成不可读的 `TypeError: Cannot read properties of undefined (reading 'DT_FLOAT32')`（`KHRDracoMeshCompression.install()` 急切调 `initDecoderModule(undefined)`）。「不再抛异常」只能靠**容器分流**实现。因此另写了一条真会红的断言：扩展块被读进 Document 而不是被丢掉 |
| T-217 | ③ | `needsContainerRoute` 的判据取反 | 分流断言红 | 红，4 条 | — | 还原 |
| T-217 | ④ | `readGlbHeader` 去掉 magic 校验 | 「非 GLB 返回 null」红 | 绿→红 · **前三次都是绿的** | **a** | 合成的坏字节里 JSON chunk 是四个 0，`JSON.parse` 先抛、被 catch、返回 null——magic 检查删了照样绿。换成「一份完全合法的 GLB，只把头四个字节改成 zip 的 `PK\x03\x04`」才转红。**这也是真实形状**：一个 `.bin` / `.zip` / 截断的上传 |
| T-222 | ① | `ValveCover` 改名成 `Cover` | 路径清单红 | 红，2 条（三方相等 + 父路径存在） | — | 还原 |
| T-222 | ② | 把 Volute 与 Shaft 从 `steel` 挪走（10 → 8） | 共享断言红 | 绿→红 · **第一次是绿的** | **a** | 断言遍历的是 `loaded.objects.values()` 的每一个再各自 `traverse` 一遍——嵌套对象被祖先重复计数，乘上了树深。**它在只有 9 个 steel mesh 时也是绿的**。改成从 `scene` 单次遍历、按 mesh 去重后转红。顺带把 Motor 也改成 steel，让 10 这个数字成立 |
| T-222 | ③ | `SAMPLE_OBJECT_PATHS` 删掉 `Root/Pump/Body` | 新补那条红 | 红 | — | 还原。**证明它此前确实什么都没测**——这个常量导出两个版本、零断言 |
| T-222 | ④ | 去掉 `buildDisassembleClip(...)` 调用 | `stats.animations` 断言红 | 红，3 条 | — | 还原。样本资产记录手写 `stats.animations: ['Disassemble']` 而 GLB 里一条动画通道都没有，实测 stats 会把它覆盖成 `[]`——这条断言读的是实测 stats，手写记录满足不了它 |
| T-222 | ⑤ | （非变异，是 T-205 的守卫缺口）新增 `export async function buildPumpDemoGlb` 之后孤儿数**没有变化** | 应该多一个孤儿 | 绿 → 查出守卫瞎了 | **a** | `check-dead-exports.mjs` 的两条正则都写成 `export\s+(declare)?(abstract)?(function\|const\|…)`，**没有 `async`**。后果有两层：① 导出面根本收不到 `export async function`；② 即使收到，它自己的声明行会被当成一次「使用」。两条都补上 `(?:async\s+)?` 之后，`buildPumpDemoGlb` 才如实报成孤儿并进豁免表（owner T-283）。**这是 T-205 的守卫第一次被外部用例证伪** |
| T-224 | ⓪ | `filterNodes` 的祖先查找从 `byId.get(parent)` 改成 `doc.nodes.find((n) => n.id === parent)`（教科书式 O(n²)） | 1000/2000 比值测试红 | 绿→红 · **绿 → 改测试后又时红时绿 → 换掉断言方式才稳定红（5/5）** | **a** | 三步。① **第一次绿**：比值测试的查询是 `零件`，它命中每一个节点，于是每个节点的父节点在轮到它时**已经在 `visible` 里**，循环在第一跳就 `break`，那行查找**一次都没执行**——被变异的代码根本不在测试的执行路径上。② 把最深的那个节点单独改名成 `末端零件`、用只命中它的查询把整条链走满之后，变异**时红时绿**：这个规模下二次项（≈ `n²/20`）与线性建表开销同量级，比值落在 3 附近，往哪边掉由 GC 决定。**卡面点名的「必须用 1000/2000」是对的，但不充分。** ③ 最终改成**数数而不是掐表**：用 Proxy 包住 `doc.nodes` 数一遍下标读取次数，诚实实现是 ~2n，每跳一次扫描是 ~n²/20，断言 `< 6n`。连跑 5 次全红 |
| T-224 | ① | `filterNodes` 里去掉 `visible.add(parent)`（不收集祖先） | 「父链可见」红 | 红，3 条（父链可见 + 折叠分支里的命中 + 只标命中行） | — | 还原 |
| T-224 | ② | `flattenTree` 的 `if (filter !== null \|\| !collapsed.has(node.id))` 改回 `if (!collapsed.has(node.id))`（有 filter 时仍尊重折叠） | 「折叠分支里的命中仍出现」红 | 红，1 条 | — | 还原 |
| T-224 | ③ | 空查询返回 `{ visible: 全部 id, matched: 空 }` 而不是 `null` | 零开销断言红 | 红，2 条（空串 + 纯空白串，都断在 `toBe(null)` 上） | — | 还原。断言用 `toBe(null)` 而不是 `toBeFalsy()`——空 Set 版本对每个调用方**行为完全相同**，只是让未过滤时的每次渲染多做 n 次成员测试，只有严格相等能把这个差别钉住 |
| T-224 | ④ | `clampScrollTop` 去掉上界：`return Math.max(0, scrollTop)` | 钳位测试红 | 红，2 条 | — | 还原。这条是卡面之外补的：钳位若写在组件的 `useEffect` 里就无法被测（编辑器单测跑纯 Node，无 jsdom），所以它必须是纯函数，而纯函数就该有自己的变异 |
| T-209 | 探针1 | 在 `App.tsx` 顶部加 `void fetch('/x')` | `check-provider-swap` R2 红 | 红，1 条，点名 `packages/editor/src/App.tsx:2` | — | 还原。**这是「债 A」的直接证据**：同一段代码在本卡之前跑 `pnpm check:constitution` 是全绿的——C7 的两个守卫都不扫 fetch |
| T-209 | 探针2 | 在 `main.tsx` 里加 `new MemoryProvider()` | R1 红 | 红，2 条（R1 未申报构造点 + R3 装配点 2 处） | — | 还原 |
| T-209 | 探针2′ | 把申报的构造点从 `session.ts` **搬到**新文件（本卡自加，卡面没有） | 集合相等两头都要红 | 红，3 条——其中一条是「**申报的构造点消失了**」 | — | 卡面只给了「新增一处」的探针，而集合相等真正比「≤1 个文件」强的地方在**搬走**这一侧。没有这条探针，变异 ① 无法被证伪 |
| T-209 | ① | R1 从集合相等改成 `if (foundProviderSites.size > 1)` | **探针 2 必须仍红**（变绿说明写成了更弱的判据） | 红——**卡面预期正确，但探针 2 无法区分两种判据** | — | 于是拿探针 2′ 在同一个变异下再跑一次：R1 **哑了**，只剩 R3 偶然抓到（且只因为探针恰好多了一处 import）。更干净的一次：只搬构造点、不新增 import，R1 打印「构造点 1 处，申报 1 处」——**两个数字相等，而它数的那一处根本不是它申报的那一处**。计数式判据会在断言成立的同时说一句假话 |
| T-209 | 探针3 | 在 `App.tsx` 里写 `` console.log(`https://${host}.telemetry-probe.net/x`) `` 并重新构建 | `check-no-external` 红 | 绿→红 · **第一次是绿的 → 查出是探针自己没生效** | **a** | 第一版探针的注入正则 `/^(import .*\n)/m` 一次都没匹配上（文件没变，`head -4` 一看就知道），构建产物里根本没有这个字符串。**一个没跑起来的探针和一个通过了的探针，在输出里长得一模一样。** 换成锚在 `export function App` 前注入之后：产物里是 `https://${YR}.telemetry-probe.net/x`（`host` 取 `location.hostname`，esbuild 折不掉），守卫红 |
| T-209 | ② | 模板白名单读成「文件存在即全部放行」 | **卡面写「探针 3 必须仍红」** | **绿** | **c** | **卡面这条预期不成立，且不成立是可证的**：全部放行就意味着探针 3 的模板地址被放行，它只能变绿。这个变异复现的正是 T-209 之前那一行 `url.includes('${')` 的行为——它**是**本卡要消灭的洞，不是洞的检测器。按「若绿属哪一类」归 c（被测代码本来就是对的：真正该红的是下面两条） |
| T-209 | ②′ | 把 `docs/EXTERNAL_URL_ALLOWLIST.md` 整个删掉 | 必须红，且红的理由是「表读不到」 | 红，5 条：第一条「豁免表不存在」，随后 4 条模板地址失去豁免 | — | 还原。**这才是卡面想要的那条**：表缺失时必须是「什么都不豁免 + 点名表不见了」，不能是「什么都豁免」 |
| T-209 | ②″ | 把读表路径改成 `docs/TYPO_ALLOWLIST.md`（拼错） | 必须红 | 红，5 条，第一条点名拼错的路径 | — | 还原。**本版第四次写下 M6 形状**（T-205 的 M6 · T-207 的规则 6 变异 ⑧ · T-297 卡面的变异 ⑤ · 本条）。一个路径写错的守卫永远绿，是这套体系里最贵的失效模式 |
| T-214 | ① | `pixelRatio()` 里 `Math.min(Math.max(raw,1), MAX_PIXEL_RATIO)` 改成 `return raw`（不封顶） | dpr=3 那条红 | 红，4 条（dpr=3 · 0.5 下限 · resize 复用 · globalThis 兜底） | — | 还原 |
| T-214 | ② | `MAX_PIXEL_RATIO` 2 改成 1 | dpr=2 那条红 | 红，3 条 | — | 还原。**两向都要红**：只测「3 变 2」分不出封顶是 2 还是 1，只测「2 还是 2」分不出封顶是 2 还是没有封顶。①②合起来才把上限钉在 2 |
| T-214 | ③ | 把 `limits.pixelRatio` 从 `captureDevicePixels` 与 `maxCaptureScale` 两处公式里删掉 | 两条 `pixelRatio: 2` 的用例红 | 红，2 条 | — | 还原。**这是 X-17 的机器落点**：T-262 的钳位单测注入桩 `limits`，缺了这一项的公式在单测里全绿，只有在真实 2× 屏上炸——现象是 `webglcontextlost`，整页变白 |
| T-214 | ④ | `resize` 里去掉 `setPixelRatio` 调用（只在 attach 时设一次） | resize 复用那条红 | 红，1 条 | — | 还原。把窗口拖到另一块屏只触发 resize，不触发 attach |
| T-214 | ⑤ | `setSize(w,h,false)` 改成 `true` | CSS 尺寸不变那条红 | 红，1 条 | — | 还原。`updateStyle` 与 `setPixelRatio` 是一对：设了像素比又让 three 写 inline 尺寸，2× 屏上画布会变成容器的两倍大 |
| T-214 | ⑥ | （非变异，是接线后暴露的）给 `attachRenderer` 加一行 `renderer.setPixelRatio(...)` 之后，`pnpm -F @w3/core test runtime` **94 条红** | 本不该有连带影响 | 红，94 条，分布在 6 个文件 | — | 六份渲染器桩都以 `as never` / `as unknown as WebGLRenderer` 收尾，**因此可以合法地少实现 `RendererLike` 的成员**——`setPixelRatio` 在接口里一直是必填的，只是从来没有生产代码调用它，所以没人发现。这正是 T-200 的 docstring 点名的那个形状（「a stub could omit any member and the mistake would surface as an `undefined is not a function`」），第一次被真实用例证实。六处各补一行后全绿 |
| T-215 | ① | 去掉 `preset` 与 `materialId` 两处 `.default(null)` | 三条全红 | 红：core 3 条 + editor 1 条 | — | 还原。三层各自都说得通，所以谁都没发现：编辑器清空字段时**删键**（这是对的，写 `''` 会往文档里塞非法值）· zod 的 `nullable()` 不等于 `optional()`，少了键就是缺必填 · executor 把解析失败记成 `status:'failed'`。标签写着「留空取消」，而这个手势从 v0 起一次都没成功过 |
| T-215 | ② | UI 选项改回手写四行 | 集合相等那条红 | 红：core 1 条 + editor 1 条 | — | 还原。手写清单**和自己永远一致**，所以没有任何东西可以和它对不上——`outline_white` 因此整整两个版本无人能选 |
| T-215 | ③ | **反向变异**：把集合相等断言改成 `expect(options.length).toBeGreaterThan(0)`，同时把选项砍到只剩 1 个 | 必须证明这条断言测不出东西 | 绿 · **core 全绿**（7/7），editor 那条 `toEqual` 仍红 | **a** | 卡面要求的自证。`toBeGreaterThan(0)` 在选项从 5 个砍到 1 个时纹丝不动——**它断言的是「有东西」，不是「是那些东西」**。留着 editor 那条 `toEqual` 是为了让这次演示同时说明另一半：同一个变异，写法不同结果就不同 |
| T-215 | ④ | 把 `outline_white` 的 `label` 改成空串 | 中文标签那条红 | 红，1 条 | — | 还原。表里没有标签的预设在下拉框里是一行空白，比选不到还费解 |
| T-215 | ⑤ | （非变异，是接线后暴露的）`.default(null)` 落地后 `pnpm -F @w3/editor test` 红 12 条 | 本不该有连带影响 | 红，12 条，两个文件 | — | 与 T-214 的 ⑥ 同源：`place.test.ts` / `snap.test.ts` 的渲染器桩也以 `as never` 收尾、也缺 `setPixelRatio`。**同一个形状在一天之内出现在第八个文件里**——`as never` 让桩可以合法地少实现接口成员，这是 T-200 那条注释的第二次实证 |
| T-216 | ① | 删掉 `HeadlessRuntime.playAnimation` 里新加的 `this.stopAnimation(id)` | 重叠播放那条**在 headless 侧**红 | 红，1 条，**只在 headless 侧**（真实侧全绿） | — | 还原。「只在哪一侧红」是这张卡的判据：契约测试最容易的假绿是**两侧一致地错**，那种情况下两边都绿、分歧照旧 |
| T-216 | ② | 把 `stopAnimation` 里的 `if (!entry.loop)` 加回去 | 停循环那条**在 headless 侧**红 | 红，1 条，**只在 headless 侧** | — | 还原。真实侧 `TweenPlayer.stop` 无条件通知，只是循环不 reject promise（`settleOnStart` 已经 resolve 过）；旧的 `if (!entry.loop)` 把「不 reject」错读成了「不通知」 |
| T-216 | ⓪ | （非变异，是本卡的前提证据）在两条断言存在**之前**跑整套契约 + parity | 应当能发现分歧 | 绿 · 全绿 | **a** | 分歧从 v0.5 起就在，**契约套件与 parity 都没有重叠播放用例**，所以两者都测不到它。这正是 ECA_SPEC §6 点名要防的形状：headless 慢慢漂走，全部测试绿，产品坏了 |
| T-211 | ① | 把 `Promise.allSettled` 改回 `Promise.all`（裁决的反面） | 一个 step 抛错时其余 step 的完成状态必须红 | 红，2 条 | — | 还原。裁决是**改实现去对齐 SPEC**：§5.1 从 v0 起就写着 allSettled。两者此前"看起来等价"只是因为 `runStep` 兜住了一切——而 `registry.get` / `schema.safeParse` / `definition.refs` 三处都在 `try` **外面**，任何一处抛出，`Promise.all` 当场 reject，`execute` 直接抛异常，**兄弟步骤的结果全部丢失**（不是部分丢失，是一个都没有） |
| T-211 | ②′ | 卡面点名的假绿对照：把 ① 的断言弱化成 `expect(result).toBeDefined()` | 卡面预判「两种实现都绿」 | 红 · **仍红** | — | 卡面的警告方向对、举例不准。用「refs 抛错」这条路径时，`Promise.all` 让 `execute` **整个抛出**，于是任何断言都会失败。真正两种实现不可区分的是**另一条路径**：handler 自己抛错（被 `runStep` 接住）——本文件的 counter-example 那条在变异 ① 下确实**保持绿**，那才是卡面描述的形状 |
| T-211 | ② | 按 §6 的旧说法把两侧都改成「未在播放立即 resolve」 | **第一次的裁决是改实现**，预期新断言绿 | **红 3 处：`media-bus.test.ts` 的自动播放被拒那条 + parity 自检 + 本文件 ② 组** | — | **裁决因此被推翻，改成改规范、不改实现。** 那条 media-bus 测试连名字带注释都写着这件事已经在 T-186 被算过账：浏览器拒绝自动播放时什么都没在播，于是「响完」**没有发生**，不是「已经发生过」；立即 resolve 会让 `await:true` 当场返回、下一步立刻触发，作者编排的节奏整个塌掉——音频被拦的场景会在**静音之外**再多坏一种、且更难解释的方式。**当时 parity 的自检抓到过一次同样的尝试**（两侧没分叉，两侧一样错）。一条写着「立即 resolve」的规范句子，在实现层面被三处独立证据否掉 |
| T-211 | ②′ | 把 §6 那句话改回旧说法（**只改文档，不动代码**） | 规范断言必须红 | 红，1 条 | — | 还原。断言直接读 `ECA_SPEC.md` 的那一句：这次裁决改的是文档，那么会退化的也是文档，测试就得看着文档 |
| T-211 | ②″ | （非变异，是第一次裁决短暂落地时暴露的）`actions.test.ts` 的 ADR-0019 那条 | 本不该有连带影响 | 红，1 条 | **a** | 那条测试**根本没先 `playMedia`**，于是它一直在用「未在播放」这条分支去证明「永不 resolve」——两条分支恰好同答案，所以它绿得毫不费力。裁决推翻后它本可以原样绿回去，**仍然把 `await ctx.playMedia(...)` 补上留在那里**：一条靠「两个分支答案碰巧相同」而绿的断言，下次分支分家时不会红 |
| T-211 | ③ | 把 `playMedia` 的 `await` 默认值改成 `true`（真「对齐」） | 默认值断言红 | 红，1 条 | — | 还原。裁决是**保留差别、改文档**：动画通常就是下一步要等的那件事，音频通常垫在后续动作底下。SPEC §4.2 此前只给 `playMedia` 写了默认值、`playAnimation` 那格写 `await?: boolean`，于是 D19 的「语义对齐」被读成了「默认值也一样」 |
| T-211 | ③′ | 把 `// Default false — same as \`playAnimation\`.` 这句错注释加回去 | 注释断言红 | 红，1 条 | — | 还原。断言直接读源文件，因为这句话的错处不在行为里、在人读到的那句话里 |
| T-212 | 替代验收 | 把「爆炸」从 NORTH_STAR §3 v1.0 清单与规划 §1.2 里**同时**删掉 | `check-docs.mjs` 规则 5 必须红 | 红，1 条，点名「v1.0 交付『爆炸与剖切』，而 NORTH_STAR §3 的 v1.0 新增清单里找不到它的落点」 | — | 还原。合同/文档卡不适用常规变异检验，卡面指定了这条替代验收 |
| T-297 | ① | 把已标 `[x]` 的 T-224 的全部登记行从 `MUTATIONS.md` 里删掉 | R1 必须红**且点名卡号** | 红 · 1 处，逐字点名「T-224 已标 [x] 且「变异检验」栏不是「不适用」，但 `docs/MUTATIONS.md` 里一行都没有」 | — | 还原 |
| T-297 | ② | 某行「实际」改成 `绿`、后两列清空 | R2 必须红 | 红 · 4 处（R2 两条 + R4 两条）。**R4 先报「列为空」，R2 再报「绿必须有分类与处置」** | — | 还原。两条规则同时红是对的：一个空格子既违反「七列逐行非空」，也违反「没转红的必须说清怎么处理的」 |
| T-297 | ③ | 把某行卡号改成 `T-999` | R3 必须红 | 红 · 1 处 | — | 还原。R3 防的是登记表**自己**腐烂——卡被删或改号之后，指向它的登记行会变成一条谁也查不到的记录 |
| T-297 | ④ | 列头把「期望」与「实际」调换 | R4 必须红 | 红 · 1 处，打印期望列序与实际列序两行 | — | 还原 |
| T-297 | ⑤ | 把读**登记表**的路径改成 `docs/TYPO.md` | 必须红，且红的理由是「登记条数拿不到」**而不是「零条登记所以放行」** | 红 · 17 处，第一条逐字是「登记表读不到：docs\TYPO.md。**这不是「零条所以放行」，是拿不到结论**」 | — | 还原。**M6 形状本版第五次**（T-205 的 M6 · T-207 规则 6 的变异 ⑧ · T-209 的 ②″ · T-298 卡面的变异 ④ · 本条） |
| T-297 | ⑤′ | 把读**台账**的路径改成 `docs/TASK_BACKLOG_V9.md`（卡面没给的那一侧） | 同样必须红 | 红 · 98 处，第一条是「任务台账读不到」 | — | 还原。**卡面变异 ⑤ 只给了登记表一侧的探针**，而「需登记卡数」是从台账算出来的：台账读坏 → 需登记集合变空 → R1 会安安静静全过，此时唯一红的是 R3，理由却是「卡号不在台账里」，指错方向 |
| T-297 | ⑤″ | 把台账路径指向一份**真实存在但不含卡头**的文件（`docs/V1_KICKOFF.md`） | 「扫描面塌了」下限必须红 | 红 · 逐字「台账扫描面塌了：只认出 0 张卡，下限 150」 | — | 还原。这条与 ⑤′ 不同：⑤′ 是文件不存在（走 `existsSync`），本条是文件存在但**卡头正则匹配零处**——后者才是正则写错时的真实形状，而它绕过了 ⑤′ 的那条防线 |
| T-297 | ⑥ | 把登记表清成只剩表头（验收明确点名的空表用例） | 必须**正常读取并打印「登记条数 0」**，再由 R1 报出缺失卡号而 exit 1 | 红 · 先打印「登记条数 0 / 涉及卡数 0 / 未转红条数 0」与「应登记卡数 16 · 已覆盖 0」，再列 16 条 R1，exit 1 | — | 还原。**不许因为表是空的就跳过检查**——空表与「读不到表」必须走两条不同的路，前者打印 0 继续，后者拒绝给结论 |
| T-297 | ⑦ | （非变异，是口径裁决的证据）用 naive `.split('\|')` 切表 | 应当与转义感知切分给出同样的列数 | 非变异 · 四行给出 11 / 8 / 9 / 9 列，转义感知切分给出 7 / 7 / 7 / 7 | — | 因此自写了转义感知的 `splitRow`。**那四行正是正文里引用了正则的行**（`/executor\|dispatch\|engine/i` · `(function\|const\|…)` · `if (filter !== null \|\| …)`），也就是信息量最大的四行。照抄 `check-docs.mjs:366` 的 naive 切分会把它们判成格式错误，而「修正方向」如果搞反（去掉正文里的转义竖线）就会毁掉证据 |
| T-223 | ① | 把逐字节比对 `sha1(生成) !== sha1(已提交)` 改成 `generated.length !== committed.length`（只比文件数） | 「改一个字节要 FAIL」必须红 | 红 · 改一个字节后闸门变绿（PASS，exit 0），证明逐字节比对是唯一起作用的判据 | — | 还原 |
| T-223 | ② | 把 `MIN_LIBRARY_FILES` 改成 0，同时把 `LIBRARY` 路径拼错一个字母 | 下限必须红，且不许静默通过 | 红 · exit 1（`readdirSync` 直接抛，路径不存在） | — | 还原。**卡面点名「照抄 `sync-vendor.mjs --check` 的形态」，而那份实现没有任何扫描面下限**：它的判据 `srcFiles.length === dstFiles.length && every(...)` 在两侧同时为空时是 `0 === 0` 加一个空 `every`，恒真。逐字照抄会交出一个 D36 M6 形状的守卫，因此加了双侧下限 |
| T-223 | ③ | （非变异，是全新克隆的实测）`git checkout-index` 取出 `library/manifest.json` | 应与生成器写出的字节相同 | 非变异 · **不同**：checkout 出 2783 字节 / 86 个 CR，生成器写出 2697 字节 / 0 个 CR | — | `.gitattributes` 补一行 `packages/editor/public/library/manifest.json text eol=lf`。系统级 `core.autocrlf=true` 是 Git-for-Windows 默认，而该路径此前无声明。**CI（Linux）会永远绿、每一台 Windows 克隆会永远红**，并被这道新闸门指着一个「重跑生成器也没用」的文件——正是 `.gitattributes` 头注释里记过的同一种失效，当时只推广到了二进制扩展名 |
| T-223 | ④ | （非变异，是靶子选择的依据）拿 `manifest.json` 或 `display-stand.glb` 当「手改一个字节」的靶子 | 验后 `git checkout --` 应能干净还原 | 非变异 · 两个都不行：manifest.json 还原经 smudge filter 写回 CRLF（还原后仍红）；display-stand.glb 会打翻 `packages/editor/test/library.test.ts:175` 的导入管线单测 | — | 靶子钉死为 `previews/tex-noise.png`：无任何测试读它、`.gitattributes` 已给 `binary`（还原不经 EOL 转换）。**卡面只写「手改一个字节（验后还原）」没指定靶子**，按字面随手挑会得到误导性的红 |
| T-213 | 替代验收 | 把 ADR-0014 的状态改回「已接受（**但需人工确认**，见下）」 | `check-docs.mjs` 必须报一次 | 红 · 1 处，逐字点名文件、行号与实际状态串 | — | 还原。**这条替代验收在本卡之前无处可落**：七条规则里唯一碰 `docs/adr` 的是规则 3，它数文件个数、不读内容。决定性证据是现状本身——本卡开工那一刻 ADR-0014:3 正写着「需人工确认」，而 `pnpm check:docs` 输出 PASS、exit 0。因此本卡建了规则 8 与 `scripts/lib/adr-status.mjs` |
| T-213 | ① | 把状态判定从逐字相等改成同义词前缀匹配（`Accepted` / `已接受` / `已采纳`），同时把 ADR-0014 改回坏串 | 必须**仍然红** | 绿 · **PASS，31 份全判为 Accepted** | **a** | 还原。**这正是不做同义词映射的全部理由**：本卡要清的那个串是「已接受（**但需人工确认**，见下）」，它**以「已接受」开头**。任何前缀或同义词匹配都会把一个悬而未决的决议判成已确认，而遗留决议清零这道门槛的全部意义就是抓它。四种写法在本卡里被人工归一了一次，从此解析器故意不宽容 |
| T-213 | ② | 把某份 ADR（0019）的状态行整行删掉 | 必须红，且理由是「找不到状态行」而不是静默跳过 | 红 · 1 处，点名文件并给出期望格式 | — | 还原。**读不到状态的 ADR 与没有状态的 ADR，对读者是同一件事**，两者都必须停下构建 |
| T-213 | ③ | 把 ADR 目录拼成 `docs/adrr` | 下限必须红 | 红 · 2 处：先「ADR 目录读不到」，再「只读到 0 份（下限 25）」 | — | 还原。下限断在 **ADR 文件数**上而不是「非 Accepted 条数」上——今天合法地是 0 条非 Accepted，拿它当下限这条规则当天就无法通过；而 glob 写错时文件数会掉到 0 |
| T-213 | ④ | （非变异，是验收面的实测）自测命令 `grep -rn "需人工确认" docs/adr` 的退出码 | 通过时应 exit 0 | 非变异 · **退出码是反的**：有命中（失败态）exit 0，无命中（通过态）exit 1 | — | 自测改写成 `! grep -rn "需人工确认" docs/adr`。任何把「自测命令 exit 0 = 通过」当判据的地方（DoD 勾选 / 将来 milestone-close 的复跑 / CI 串联）都会把成功读成失败 |
| T-213 | ⑤ | （非变异，是验收面的实测）`grep -rn "需人工确认" docs/adr` 的命中数 | 卡面只处置 ADR-0014，隐含命中 1 处 | 非变异 · **2 处**：ADR-0014:3 与 **ADR-0011:48** | — | ADR-0011 不在本卡独占清单里，且全 199 张卡无人认领它。它自己就自相矛盾：状态栏已是 `Accepted`，「代价」栏却留着「与 D3 的字面文本不符，需人工确认」。改写成「这一点随本 ADR 一并被接受」——**代价被接受了，不等于它还悬着** |
| T-213 | ⑥ | （非变异，是按验收字面口径的普查）逐份读 31 份 ADR 的状态行 | 卡面隐含只有 0013 / 0014 两份不合格 | 非变异 · **四份**：0013「已接受」· 0014「已接受（但需人工确认）」· 0018「已采纳」· 0019「已接受」 | — | 0018 / 0019 同样在独占清单外、同样无卡认领。验收写的是「非 Accepted ADR 列表为空」，按字面只改两份仍然过不了。四份一并归一，并**逐字相等判定**（见变异 ①） |
| T-218 | ① | 注掉 `loader.ts:66` 的 `this.gltf.setDRACOLoader(this.draco)` | **卡面写「第 2 层必须红」** | 红 · **但红的不是卡面说的那一层**：Node 侧 **6/6 全绿**，E2E 导入红（体检报告根本没出现） | — | 还原。**卡面这条在实现层面不成立**：第 2 层是 `auditGlb`，它对压缩容器走 `measureFromHeader`（`audit.ts:207-213`），读 JSON chunk 的 accessor 数、一行 three 都不碰——那正是 T-217 建的容器分流。变异的真实落点是 E2E 导入与第 3 层。已在 [ADR-0032](adr/0032-draco-取证的第三层改挂-e2e.md) 就地更正 |
| T-218 | ①′ | `dracoPath` 恒指向 `/nope/` | E2E 必须红 | 红 · 且浏览器控制台打出 `Uncaught SyntaxError: Unexpected token '<'` | — | 还原。**这条报错是「`status() === 200` 不可用」的现场证据**：vite dev 的 SPA 兜底对 `/nope/draco_wasm_wrapper.js` 回的是 `200 OK` + `index.html`，浏览器把 HTML 当 JS 解析才炸的。断言若写成 `status() === 200`，一个 404 的解码器路径照样绿——正是卡面自己警告的那种假绿。因此换成读 `content-type` 与前四字节（`\0asm`） |
| T-218 | ② | 把 `e2e/fixtures/pump-draco.glb` 换成未压缩的同源 GLB | Node 单测必须红（防 fixture 悄悄退化） | 红 · 4 条（声明层 2 条 + 体检等值 1 条 + 「无 decoder 必须 reject」1 条） | — | 还原。第 4 条尤其要紧：未压缩件在没有 decoder 时**读得出来**，于是那条反例断言转红——它守的是「fixture 真的需要解码器」 |
| T-218 | ③ | （非变异，是卡面第 3 层不可实现的实测）在纯 Node 里实例化 three 的 `DRACOLoader` 并解码 | 卡面要求这一层在 Node 单测里绿 | 非变异 · `TypeError: fetch failed`；`typeof Worker === 'undefined'` | — | `DRACOLoader.js:358` 的 `_loadLibrary` 走 three 的 `FileLoader`（内部 `fetch`），Node 的 fetch 不支持 `file://`；解码走 `new Worker`。而 core 的 vitest 是 `environment: 'node'`（C8 要求，不是可调项）。第 3 层改挂 E2E，Node 侧换成用 `draco3dgltf` 真解一遍再比顶点数与三角面数——**比键名集合更强**。见 ADR-0032 |
| T-218 | ④ | （非变异，是 T-220 要的裁决依据）把 E2E 观测到的解码器 URL 打印出来 | 应能看到生产形态的路径 | 非变异 · 两条，全是 dev-only 形态：`/@fs/.../three/examples/jsm/libs/draco/draco_wasm_wrapper.js`（276,778 字节 · `text/javascript`）与 `.../draco_decoder.wasm`，同源 | — | **只把这两条交给 T-220 会误导它**：`/@fs/` 在生产里不存在。生产侧证据要另取——`packages/{editor,player}/dist/assets/` 里已有 `draco_decoder-*.wasm` / `draco_wasm_wrapper-*.js` 的带哈希产物。两条证据指向同一结论：真实 URL 是打包器产物，`/vendor/` 零请求 |
| T-218 | ⑤ | （非变异，是落地纪律的欠账登记）ADR-0030 要求「断网 job `offline` 的预热 store 同批更新」 | 应能更新那个 job | 非变异 · **那个 job 不存在**（`.github/workflows/` 只有 `ci.yml`，其 :21 注释逐字写着不做断网构建） | — | 由 **T-210** 交付，本批已跳过（Docker daemon 未起 + 验收要求 GitHub 上真绿过一次）。**欠账登记在此**：T-210 落地时必须把 `draco3dgltf` 纳入预热 store，遗漏的表现是**安装步骤红，不是编译步骤红** |
| T-219 | ① | 删掉 `SceneRuntime.attachRenderer` 里新加的 `this.loader.attachRenderer(renderer)` | 装配断言必须红 | 红 · 2 条（「attach 之后 transcoder 非空」+「detectSupport 真的跑过」） | — | 还原。**这条断言在本卡之前不存在，所以这个缺陷在生产里活了整整两个版本**：解码器建在 `if (options.renderer)` 里，而两个生产构造点都不传 renderer，条件恒假。覆盖率看不见这种形状——每个零件都有测试，没接上的是零件之间的缝 |
| T-219 | ② | `attachRenderer` 里不调 `detectSupport` | 需要一条「它被调用过」的断言，否则这条变异是绿的 | 红 · 1 条（桩渲染器的 `extensions.has` 探针计数为 0） | — | 还原。卡面预判正确：只断言「transcoder 非空」的话，一个**建好了但没被告知 GPU 能力**的 transcoder 照样绿，它随后会 transcode 成本机采样不了的格式 |
| T-219 | ②′ | （卡面变异 ④ 的更正）卡面写「`detectSupport` 提前到构造 → 零请求断言红」 | 按卡面应当红 | 非变异 · **逻辑上不可能红**：`detectSupport` 一个字节都不发 | — | `KTX2Loader.js:230-280` 全身只读 `renderer.extensions.has(...)` 并写 `workerConfig`；取货在 `init()`（`:283-310`），而 `init()` 只被 `_createTexture` 调用，即**真的 parse 一份 KTX2 才会走到**。所以「无 KTX2 场景」下无论 `detectSupport` 在哪调，请求数恒为 0。改写成「把 `init()` 提到 attachRenderer 里预热」才真能红，守的是同一件事：**不许为 KTX2 预付网络成本**。「不含 KTX2 的场景 transcoder 零请求」这条 E2E 已交付并实测通过 |
| T-219 | ③ | 派生表把 `LINEAR_TEXTURE_SLOTS` 映成 `SRGBColorSpace`（即 `normalMap` 变 srgb） | 色彩空间断言必须红 | 红 · 4 条 | — | 还原。**卡面说「需要一条断言渲染侧 `texture.colorSpace` 的测试」，而它已经存在**（`material-registry.test.ts:243-244`），且卡面点名要扩的 `__w3DevMaterialOf` 钩子根本读不到 colorSpace、也不看 normalMap。不为这条去改编辑器 |
| T-219 | ④ | 把 `decodeInto` 的 KTX2 分支挪到 `if (!decode) return null` **之后** | 诚实日志那条必须红 | **绿 → 红** · 第一次跑：**855/855 全绿**。补了两条断言之后才红 | **a** | 还原。**第一次绿是因为我自己没写断言**：那句「该贴图为 KTX2 格式，当前环境未启用 GPU 纹理解码」在任何没注入 `decode` 的构建里（headless / parity / 绝大多数 Node 测试）一次都不会打出来，而那正是最需要它的地方。补的两条：① 无 `decode` 无 `decodeKtx2` 时必须打出含「KTX2」「未启用 GPU 纹理解码」与贴图名的 warn；② **反例**——普通 PNG 不许借用这套措辞（没有它，一个对所有格式都触发的分支也会绿） |
| T-219 | ⑤ | （非变异，是接线后暴露的）给 `RendererLike` 加 `extensions` 成员 | 应当只影响新代码 | 非变异 · `renderer-injection.test.ts` **编译失败**：`Property 'extensions' is missing` | — | 这正是 T-200 那条「no cast」注解买到的东西：桩少实现一个必填成员时**编译期就红**，而不是运行到某一行才 `undefined is not a function`。两处桩各补一个 `extensions`，其中 `renderer-injection` 那份做成**计数器**，成了变异 ② 的观测点 |
| T-219 | ⑥ | （非变异，是棘轮的一次真实下调）让 `material-registry` 真的 import schema 的两条纯数据清单 | 守卫应当放行 | 非变异 · 红 3 条，其中 2 条是「遗留基线里的 `schema:SRGB_TEXTURE_SLOTS` 已经有生产调用者了」 | — | 删掉两行遗留基线、`MAX_LEGACY` **90 → 88**。这两条清单从 v0 起零调用者，而 `material-registry` 一直手写着同一份知识的第二份拷贝。**这是这道棘轮第一次往下走** |
| T-219 | ⑦ | （非变异，是我自己写的 E2E 的一次假绿）第一版把 transcoder 断言包在 `if (hits.length > 0)` 里 | 应当能发现「一次都没取」 | 非变异 · **PASS，并打印「0 条」** | **a** | 改成 `expect.poll(...).toBeGreaterThan(0)` 无条件断言。根因是「挂上基础色」那一步没走通——导入被 `确认导入` 挡着，资产没进文档，选择器里因此没有这张贴图。**一个在什么都没发生时也绿的测试**，正是这张卡要删掉的形状 |
| T-219 | ⑧ | （非变异，是自测命令自身的实测）在本卡任何文件存在之前跑 `pnpm -F @w3/core test texture-cache ktx2` | 应能区分「ktx2 测试通过」与「ktx2 测试不存在」 | 非变异 · **绿，13 passed** | — | vitest 对匹配不到任何文件的过滤词不报错。**实现写完、忘了建 ktx2 测试文件，自测照样绿、DoD 照样过。** 新建 `ktx2-wiring.test.ts`，让 `ktx2` 这个词第一次有落点 |
| T-298 | ① | 把 `not-due` 夹具的到期版本改成已过期（`v1.5` → `v0.5`） | 必须红且点名行号 | 红 · 逐字「ADR-0024 的例外已于 v0.5 到期（当前 v1.0）：C7」 | — | 还原 |
| T-298 | ② | 把 `not-due` 的「到期 v1.5（改走 HttpApiProvider）」改成「到期」（缺版本号） | 必须红，**不是跳过** | 红 · 逐字「到期版本号「」不成形」 | — | 还原。**这是本卡的重点**：一条解析不出来的例外与一条不存在的例外，在「静默跳过」的实现里是同一个结果 |
| T-298 | ③ | **（替身，卡面原变异不可实现）** 删掉版本号的阶梯成员校验 | `off-ladder` 夹具必须红 | 红 · 变异后该夹具**变绿**（`v1.10` 被放行） | — | 还原。**卡面原变异「把版本比较改成字符串比较 → `v1.10` 那条必须红」逻辑上不可能成立**：实测 `VERSION_LADDER` 七级恰好字典序有序（`JSON.stringify([...L].sort()) === JSON.stringify(L)` 为 true），且字符串比较与阶梯比较**对每一对合法级别给出完全相同的结论**（49 组全等）。`v1.10` 根本不在阶梯上，走的是 `indexOf === -1` 的静默 `return false`。所以真正该守的是**成员校验**，不是比较方式 |
| T-298 | ④ | 把 `SCAN_ROOTS` 里 `packages/core/src` 拼成 `packages/corre/src` | 「扫描文件数 ≥ 下限」必须红 | 红 · 逐字「扫描面塌了：只看到 118 个文件，下限 150」 | — | 还原。**下限断在文件数上，不是断在例外数上**——今天合法地是 0 条到期例外，拿它当下限这条守卫当天就无法通过。D36 的 M6 形状，本版第六次 |
| T-298 | ⑤ | （非变异，是卡面事实的实测）`grep -rn "CONSTITUTION-EXCEPTION" packages scripts` | 卡面写「今天零命中」 | 非变异 · **1 条命中**：`scripts/lib/exemptions.mjs:8` 的 JSDoc | — | 三条 ADR 写的「`grep -rl … scripts/` 无输出」是 **T-205 交付之前**的事实，今天已失效。而这一条恰好落在卡面 ① 指定的扫描面内、又恰好会被卡面 ③ 判成「格式写错」。处置：锚点收成带冒号的 `CONSTITUTION-EXCEPTION:`，并把散文说明登记成一张**集合相等**的表——**不许靠正则碰巧躲开**，那样下一处散文会被随机审判 |
| T-298 | ⑤′ | （非变异，是本卡自己撞上的）新守卫写完之后跑第一次 | 应当 PASS | 非变异 · **红 7 处，全在它自己身上** | — | 守卫的 JSDoc 引用格式、常量 `ANCHOR`、正则字面量、以及报错文案里都写着这个标记。登记进同一张散文表（连同后来 GUARDS 那一行），**不是把自己移出扫描面**——「把措辞改到扫描器碰巧看不见」与「把正则收到刚好漏掉」是同一个动作，而这份文件的 JSDoc 正好在反对它 |
| T-298 | ⑤″ | （非变异，是本卡在自己的注释里预告了却没实现的坑）`not-due` 夹具第一次跑 | 应当绿 | 非变异 · **红**：「到期版本号「v1.5（改走」不成形」 | — | **我在这个正则上方逐字写了这个陷阱，然后照样用了 `(\S+)`。** ADR-0024 的实例在版本号后带全角括号补语，贪婪捕获吞进去、`indexOf` 得 -1、`isExpired` 静默返回 false——**一条真会到期的例外，被专为抓它而写的守卫放行**。捕获改成停在空白或任一宽度的左括号，再做形状与阶梯双重校验。**这份夹具的全部价值就是它逐字复刻了那个补语** |
| T-298 | ⑥ | （非变异，是卡面 ② 的致命处）按字面「与 `package.json` 的当前版本比较」 | 应当能比较 | 非变异 · `package.json` 是 `"version": "0.0.0"`、无 `w3Version`；`isExpired('v1.0','0.0.0')` 恒为 `false` | — | 照字面实现会造出一个**永远不红**的守卫。改为 `resolveCurrentVersion()`：优先 `w3Version`，缺失回落常量 `v1.0`（与 `check-dead-exports.mjs` 对齐），且**解析结果不在阶梯上就直接红**。顺带登记一笔债：仓库已有**三套**「当前版本」算法，`check-dead-exports.mjs` 得 `v1.0`、`check-no-external.mjs` 得 `v0.5` |
| T-298 | ⑦ | （非变异，是 ⚠ 栏的可达性）逐条回读 ADR-0022 / 0024 / 0025 的到期承诺在代码里的落点 | ⚠ 栏要求确认三条都能被解析 | 非变异 · **三条一条都不在代码里**：`captureImage()` 还是 T-266 的桩 · benchmark 脚本未创建 · `main.ts:80` 的 fetch 上方无注释 | — | 因此 ⚠ 栏只能这样满足：**五份夹具逐字复刻这三条原文**，`--self-test` 证明解析器认得它们。若为满足 ⚠ 而把 `docs/adr/**` 纳入扫描面，ADR-0022 的「到期 v1.0」在 current=v1.0 时立刻红，与验收 exit 0 直接冲突——扫描面因此显式不含 `docs/**`，并写进 JSDoc |
| T-221 | ① | 把 `DEPLOY.md` 里的 `deploy/nginx.conf.template` 改成 `deploy/nginx.conf.tmpl` | `check-docs` 必须红 | 红 · 1 条，点名行号与错误路径 | — | 还原。规则 9 是本卡新建的：**一份部署文档是照着做的，里面每个路径都会有人原样敲进终端** |
| T-221 | ①′ | 把 `DEPLOY.md` 清成一个路径都不引用 | 下限必须红 | 红 · 逐字「只从 docs/DEPLOY.md 抽到 0 条路径（下限 6）」 | — | 还原。**下限断在「从这一个文件里抽到的条数」上，不是断在规则 2 的全仓 267 条链接上**——全局计数下，一份零路径的 DEPLOY.md 完全隐形 |
| T-221 | ② | （非变异，是自测命令自身的实测）在四份产物提交之前跑卡面的 `git ls-files Dockerfile railway.toml deploy/` | 应能发现它们没被跟踪 | 非变异 · **exit 0**（零匹配时 `git ls-files` 照样成功） | — | 卡面的自测命令**在本卡主交付物完全没做的那一天就是绿的**。改用 `git ls-files --error-unmatch <逐个路径>`：实测对不存在的路径 exit 1、对已跟踪的 exit 0 |
| T-221 | ③ | （非变异，是 `railway.toml` 的两处枚举实测）`builder = "dockerfile"` / `restartPolicyType = "on_failure"` | 应为 Railway schema 认的值 | 非变异 · schema 认的是 `DOCKERFILE` / `ON_FAILURE`，小写会被判无效并**静默回落默认** | — | 两处改成大写。重启策略「看起来配了、实际没配」是最难发现的一类——它只在第一次崩溃时暴露 |
| T-221 | ④ | （非变异，是验收③ 的实跑）照 DEPLOY.md §3 从零部署到 Railway 并跑 §6 的五条验证 | 五条全过 | 非变异 · **全过**：`/healthz`→`ok` · `/`→200 · `/player/`→200 · vendor wasm 的 `Content-Type` 是 `application/wasm` · 播放器 HTML 引用 `/player/assets/index-CXNhoBCL.js` | — | 域名 `0729-3d-engine-production.up.railway.app`。**第 5 条是唯一能证伪的**：`--base=/player/` 漏了的话前四条全部通过、页面一片空白。Dockerfile 把播放器构建两遍（第二遍覆盖第一遍），这条正是为「第一遍的产物漏了出去」准备的 |
| T-210 | ① | 在 `@w3/schema` 的 `build` 脚本前加一次 `fetch('https://example.com')`，推到探针分支 | **步骤 2 必须红**（这条证明 `--network none` 真的生效，而不是命令根本没跑到那里） | 红 · 步骤 2 逐字报 `getaddrinfo EAI_AGAIN example.com`；**同一次 run 里 `verify` 跑的是同一份被改过的 build 脚本，却是绿的** | — | 还原并删掉探针分支。**「verify 绿而 offline 红」才是这条变异的全部价值**：出网这件事对每一个联网的 job 都不可见，只有断网那个能抓到它。跑完 25 秒 |
| T-210 | ② | （非变异，是 job 自己第一次跑就撞上的）`offline` job 首次运行 | 步骤 2 应当绿 | **红 · 24 分 30 秒**：431 个包轮流重试 `registry.npmjs.org`，栈顶是 `runDepsStatusCheck` | **a** | **`pnpm build` 这条命令自己会打电话回家**：pnpm 11 执行任何脚本之前先核对 `node_modules` 与 lockfile，那次核对发起一次 `pnpm install`，install 里又带一次 supply-chain policy 校验，两者都要联网。本机看不见——`~/.cache` 里有「1 小时前验过」的记录；容器 HOME 是全新的 `/root`，**这正是内网客户的处境**。三处一起修：offline job 的容器、**部署 `Dockerfile`（让交付物本身能在内网构建）**、`DEPLOY.md` §3.1（写给手动构建的人）|
| T-210 | ②′ | 顺带把 `pnpm_config_fetch_retries` 设为 0 | 让真的出网**立刻**失败 | 非变异 · job 从 **24m52s → 38s** | — | 一个 24 分钟后超时的 job 什么都不告诉你；一个 3 秒内报出 `EAI_AGAIN registry.npmjs.org/xxx` 的 job 直接点名是谁在出网。**可读的失败也是一种交付物** |
| T-210 | ③ | （非变异，是推之前抓到的）原设计用 `COPY . .` 造断网构建的中间镜像 | 镜像里应当有依赖 | 非变异 · **`.dockerignore` 排掉了 `node_modules`**，造出来的镜像一个依赖都没有 | — | 断网构建会因为「没装依赖」而红，**看起来像 C6 出了问题，实际是 dockerignore 的作用域搞错了**。改成镜像只装 pnpm、源码与 `node_modules` 在 run 时挂载。**这个坑在推之前被抓到，没有烧掉一轮 CI** |
| T-210 | ④ | （非变异，是 `.dockerignore` 新规则的验证）在部署镜像里 `find /usr/share/nginx/html -name '*.w3p'` | 必须零命中 | 非变异 · 零命中，逐字打印「确认：部署镜像里零个 .w3p」 | — | `packages/player/public` 下躺着 `golden.w3p`（4,555 B）与 `gp2.w3p`（84,681 B），它们是 E2E 的夹具。`COPY . .` 会把它们带进镜像并从 `/player/` 服务出去——**一份谁都能下载的示例文档，没人会注意到它在那里** |
| T-210 | ⑤ | （非变异，是顺带发现的一条既有缺陷）探针分支上 E2E 红在「规则应当把音频播起来」+ 若干 404 | 与本变异无关 | 非变异 · 同一份代码在 `main` 上 E2E **连绿两次**（4m41s / 5m1s），探针分支上红一次 | — | **与变异无关，是一条既有的 E2E 不稳定**（媒体那条断言）。登记在此不处置：它不属于本卡，但既然被这次跑撞见了就不该让它无声无息地过去。下一次 E2E 红时先查这里 |
| T-210 | ⑥ | （非变异，是 T-210 标 `[x]` 当天暴露的规则 6 缺陷）门槛表里 `pnpm install --offline --frozen-lockfile` | 应当被判为合法 | 非变异 · 红：「package.json 里没有 install 这个脚本」 | — | **`install` 是 pnpm 的内置子命令，不是 package.json 里的脚本**。规则 1 早就认识这批词（`PNPM_BUILTINS`），**规则 6 却自己又写了一遍查找逻辑并漏了这一步**——同一件事在同一个文件里有两处实现，漂移是时间问题。两处共用同一个集合。⚠ 这条只在 T-210 被标 `[x]`、「待交付」标记失效的那一刻才会浮现，**在此之前它一直藏在 pending 里** |
| T-210 | ⑦ | （非变异，是 CI 抓到的一条既有假红）`packages/schema/test/scale.test.ts` 的三条比值断言 | 应当稳定 | 非变异 · **CI 上红**：`walkTree is linear` 报 `expected 3.2085082563662835 to be less than 3`，而该算法的真实比值恰好是 2；本机连跑 8 次全绿 | — | **与本次提交无关，是 T-184 留下的计时比值测试**。`SMALL = 400 / LARGE = 800` 下整个操作只要几微秒，比值量的是 GC。**这正是 T-224 卡面点名的同一个陷阱**（「比值测试若用 200/400 节点，两种复杂度都在噪声里」），修法也相同：**改成数数不掐表**——Proxy 数 `doc.nodes` 的下标读取，而那恰好就是当年爆炸的那个量（三处回归全是「每个节点扫一遍整个数组」）。规模同时提到 1000/2000。实测 400→800 与 1000→2000 **都恰好是 2.00**，连跑 10 次零抖动 |
| T-210 | ⑦′ | 把新计数器改成永不计数（`count++` 去掉） | **内建对照物**必须红 | 红 · 1 条，且**只有对照物那一条红** | — | 还原。新测试里放了一个**故意 O(n²) 的 `quadraticReference`**，用同一个上限约束它、要求它必须 FAIL。没有它，一个停止计数的计数器会让所有断言都读到 1.00 并全部通过——**整个文件变成装饰品**，正是 D36 反复点名的形状。这条对照物在每一次运行里都重新证明「这把尺子还量得动东西」 |
| T-220 | 替代验收 | 卡面要求 ADR 里写死撤销条件与到期版本号 | ADR「代价」「撤销条件」两栏非空且带到期版本号 | 非变异 · ADR-0037 代价四条、撤销条件三条，到期版本号 `v1.2` 写进两条 `CONSTITUTION-EXCEPTION` | — | 到期版本号**不能写 `v1.0`**：`isExpired('v1.0','v1.0')` 为 true 且当前版本回落值就是 `v1.0`，**写 v1.0 等于当天到期转红**。写 `v1.2`，与撤销条件 #1 对齐 |
| T-220 | ① | 把 `sync-vendor.mjs` 的 `MIN_VENDOR_FILES` 抬到 12（实测面 10） | 「扫描面塌了」必须真的开火 | 红 · exit 1，逐字打印「只比对了 10 个文件，下限 12」 | — | 还原。**真正的触发条件（两侧目录同时为空）无法在不改 node_modules 的前提下模拟**，所以探针打在常量上——证明的是「这条断言接通了、文案是对的」，不是「它见过真实的空目录」。这一点如实写在这里 |
| T-220 | ② | 从 `packages/editor/dist/assets` 移走两个 draco `.wasm`，模拟 three 不再同源产出解码器 | `--require-build` 必须红 | 红 · 逐字点名「打包器不再同源产出解码器了」并引 ADR-0012 撤销条件 #2 | — | 还原。**这是 ADR-0012 的撤销条件 #2 第一次变成机器**：它此前是一句纯人工承诺（「升级 three 时必须复验」），全仓零脚本。三方一旦改掉 `import.meta.url` 的解析方式，`dist` 会悄悄少掉解码器，而 `sync-vendor --check` 照样绿——第一个症状是内网白屏 |
| T-220 | ③ | （非变异，是我自己改坏又改回来的）把 `walk(dst).filter(f => f !== 'VENDOR.md')` 「修正」成 `'README.md'` | 应当无影响（`VENDOR.md` 全仓不存在，是条死过滤） | 非变异 · **两条 DRIFT**，`--check` 当场红 | — | 三方在 `examples/jsm/libs/draco` 与 `basis` 下**也各带一个 `README.md`**，两侧因此恰好对得上；只过滤 dst 那一侧就把一对相等变成了数量不等。**一条看起来明显是笔误的死代码，其实是正确的**。已还原并把这段原委写进注释 |
| T-220 | ④ | （非变异，是卡面自相矛盾）独占清单列了三条「（若删）」路径 | 应当能删 | 非变异 · **删不掉**：卡面两个分支没有一个是删，而自测栏逐字要求「`sync-vendor --check` 必须仍绿」，删了走 MISSING 分支必红 | — | 「去留裁决」在卡面层面实际只有「留 + 怎么留」。已在 ADR-0037 的「未采纳的方案」里说破 |
| T-220 | ⑤ | （非变异，是验收③ 的可行性）把 `vendor/` 登记进 T-205 的豁免表 | 卡面要求如此 | 非变异 · **机器上不可能**：豁免表的 `symbol` 列是导出符号，一个目录名必落进 stale 分支 exit 1；退一步只登记两个常量也不行，`MAX_EXEMPTIONS` 正好 34/34 且「只能降不能升」 | — | 改走 `CONSTITUTION-EXCEPTION`（NORTH_STAR §8 第 2 步），由 T-298 的 `check-expiry.mjs` 读——**这是本仓唯一能承载「到期版本号」的机制**。按铁律 12 在 ADR-0037 里记下这次偏离 |
| T-220 | ⑥ | （非变异，是卡面依据的错配）卡面要求依据 T-218 打印的真实 URL 裁决 | 那应当是决定性证据 | 非变异 · T-218/T-219 的 E2E 跑在 vite **dev server** 上，观测到的是 `/@fs/…` 开发期路径，**生产里不存在** | — | 决定性证据在构建产物里、今天就能数：`packages/{editor,player}/dist/assets/` 各 **7 个**带内容哈希的解码器产物。ADR-0037 的论据用的是这个，不是那一行打印 |
| T-225 | ① | `V2_TO_V3.up` 删掉 `fog: {...DEFAULT_FOG, ...}` 那一行 | raw 断言必须红；只断言 `migrate().document` 则**不会**红 | 红 · 2 条（`migrate.test.ts > 九个新字段在迁移函数的原始输出里就已经显式存在`） | — | 还原。**这条变异存在的全部理由就是证明「断言 raw 而不是 document」不是洁癖**：zod 会把缺席的 `meta.fog` 补齐，走 `.document` 的断言一条都不会红 |
| T-225 | ② | `V2_TO_V3.up` 整个改成 `d => d` | 九条 raw 断言全红 | 红 · **76 条**，含幂等、六条改写路径、fixture 往返、`samples.ts` 与迁移链逐字相等 | — | 还原。76 这个数本身是结论：v2→v3 的迁移函数被 76 条断言从不同角度盯着，不是一条 `result.ok` 兜底 |
| T-225 | ③ | `nodes[].explode` 的 default 从 `null` 改成 `{mode:'radial',...}` | 观感回归「所有 explode === null」必须红 | 绿→红 · **第一次跑全绿（287 条一条没红）**，补了 `validate.test.ts` 的默认值断言后转红 2 条 | a | 已修。**(a) 断言写错了地方**——原因值得记：`V2_TO_V3.up` **显式**写 `explode: null`，而 zod 的 default 只在键缺席时生效——迁移链上它永远不缺席，所以整条迁移路径的断言对这个 default 完全免疫。真正读到它的是「手写文档 / 第三方生成的文档 / 将来少写一个字段的工厂」，断言必须打在 `NodeSchema.parse()` 上 |
| T-225 | ④ | `deterministicOverlayId` 改成返回常量 `ov_00000000` | 「两个非法 overlay id 重铸后仍唯一」红 | 红 · 2 条（`非增量-4 · 只有不合法的 overlay id 被重铸`） | — | 还原。为这条变异，`broken-v2-flows.json` 的覆盖层从 1 个加到 **3 个**（`BAD-ID` / `ov_SHORT` / `ov_legal001`）——只有一个非法 id 时，「重铸后仍唯一」是恒真的 |
| T-225 | ⑤ | `sceneId` 改成 `scn_${随机}` | 幂等断言红 | 红 · 10 条，含 `fixtures.test.ts` 里「v1 fixture 迁移后 === `createGoldenPathDocument()`」 | — | 还原。10 条里最有价值的是 fixture 那条：它说明随机 id 会让**磁盘上的往返**当场断裂，而不只是让一条幂等断言不高兴 |
| T-225 | ⑥ | `variables[].scope` 从 `up()` 里删掉，靠 zod 兜底 | 「原始输出」那条红 | 红 · 2 条 | — | 还原。与 ③ 是同一枚硬币的两面：③ 证明「只测迁移路径会漏掉 schema 默认值」，⑥ 证明「只测 zod 会漏掉迁移函数」。两条断言都要有 |
| T-225 | ⑦ | `OVERLAY_ID_RE` 放宽成 `/^ov_/` | 「已合法 id 不被重铸」红 | 红 · 4 条，含 `v2/broken-v2-flows.json migrates, validates and resolves` | — | 还原。`ov_SHORT` 这个 fixture 输入是**专为这条变异造的**：`ov_` 开头、形状不对。没有它，放宽后的正则对 `BAD-ID` 照样判非法，变异杀不掉 |
| T-225 | ⑧ | v3 fixture 的 `pages` 改成 `[]` | 非空断言红 | 红 · 2 条（`§4.1.6 断言二 · v3 fixture 真的走过每一个在 v1 拿到形状的集合`） | — | 还原 |
| T-225 | ⑨ | （反向比对）从 `SCHEMA_V3_FREEZE.md` 删掉 `hotspots[].style.label` 那一行 | **冻结表点名的那条变异**：T-225 必须转红 | 红 · 逐字报出 `1 个字段进了 schema 却没进冻结表`，并点名 `hotspots[].style.label` | — | 还原。这是 T-206 那张 98 行签字表**唯一的机器落点**（`SCHEMA_V3_FREEZE.md` §2 原话） |
| T-225 | ⑩ | （反向比对）§2 的「顶层集合数」v3 列 13 → 12 | 文档与代码对不上，必须红 | 红 · `expected 12 to be 13` | — | 还原。§2 自己写着「这两个数错一位，那条反向比对就变成两份错误互相签字」——所以那三个数是**从文档里读出来**跟代码比的，不是在测试里再抄一遍 |
| T-225 | ⑪ | （反向比对）把「不采纳」的 `meta.section` 那一行改成一条正常新增行 | 排除项必须仍被守住 | 红 · `meta.section（1.2 meta 增量）—— 表里有，代码里没有` | — | 还原。**「不采纳」的行是最容易烂掉的一类**：仓库里没有任何别的地方会提到一个被否决的字段，不读回这张表就没人守它 |
| T-225 | ⑫ | （反向比对）把 `viewpoints[].thumbnailUrl` 的「删除」改成「不采纳」 | 「本次唯一一处字段删除」这句必须失守 | 红 · 2 条，其中一条是扫描面下限 `裁决「removed」一行都没解析到` | — | 还原。下限断言在这里第一次生效：四种裁决每一种都必须真的被解析出来，否则 `classify()` 可以整个坏掉而不被发现 |
| T-225 | ⑬ | （反向比对）把 §1.4 的 `dataSources[].timeoutMs` 拼错成 `timeoutMS` | 表里写了个不存在的字段，必须红 | 红 · `dataSources[].timeoutMS —— 表里有，代码里没有` | — | 还原 |
| T-225 | ⑭ | （非变异，是实测发现）反向比对第一次跑，逮到实现与签字表不符两处 | 本应一致 | **红 · `HIDDEN_EDGE_MODES` 实现成 `['hidden','dashed','solid']` / 默认 `'hidden'`，冻结表与规划 §4.1.2 都写着 `['hide','dim','show']` / `'dim'`；`outline.strength` 默认 1.5 对 3** | **(b) 实现偏离了规范** | 已按冻结表订正代码（不是订正表——两份文档一致，是我写错了）。**两处都编译通过、校验通过、迁移往返通过，另外 254 条单测全绿**，除了把表读回来没有任何办法发现。这就是这条反向比对存在的理由 |
| T-225 | ⑮ | （非变异，是工具的假绿）改完 `effects.ts` 直接跑 `gen-v3-fixtures.mjs` | 生成器应当拿新 schema 校验 | 非变异 · **四份 fixture 全部打印「迁移✓ 校验✓ 完整性✓」——因为它从 `dist` 读，而 `dist` 是旧的** | **(a) 探针没接通** | 已加 `assertDistFresh()`：`dist` 比 `src` 旧就 exit 1。生成器的全部价值是「写盘之前先验一遍」，读着过期 dist 时那三个 ✓ 是最有说服力的假绿 |
| T-226 | ①a | I16 删掉 `fog.enabled &&` 那个子句 | 「三个子句各自都是必要条件」必须红 | 红 · 1 条 | — | 还原。v0.5 E18 的教训逐字适用：三个条件写成一个 `&&` 之后，删掉其中一个子句测试照样绿。三条子句因此各有一条独立断言 |
| T-226 | ①b | I16 删掉 `type === "linear"` 那个子句 | 同上 | 红 · 1 条 | — | 还原 |
| T-226 | ①c | I16 的措辞里去掉 near / far 两个数 | 措辞断言必须红 | 红 · 1 条（`反例：开着雾且 near >= far → error`） | — | 还原。**级别之外还要断措辞**：一条「near 不小于 far」的报错不带上两个数，用户还得自己去翻文档 |
| T-226 | ② | `typeOf` 的 node 分支永远返回 `node` | 剖切/爆炸那条必须红 | 红 · 2 条（`typeOf 的阶梯真的分得清四种节点` + I28 正例） | — | 还原。阶梯是 section > explodeGroup > light > node，四级各有一条断言；只钉「explodeGroup 被接受」不够，那一条对「永远返回 explodeGroup」的实现也是绿的 |
| T-226 | ③ | `setVisible` 的 `refs()` 改成返回 `[]` | `action-refs-gate` 必须红 | 红 · 2 条（主检查 + 覆盖率） | — | 还原。这正是闸门存在的理由：一个动作可以在编辑器里长出对象选择器、同时对完整性检查完全不可见，两边都编译得过 |
| T-226 | ④ | I49 的级别从 warn 改成 error | 级别断言必须红（**级别本身要断，不能只断「报了」**） | 红 · 2 条，其中一条是 `orchestration.json` 的「零 error」 | — | 还原。T-225 交付 I49 时**没有一条测试断它的级别**，本卡补上——`toContain('I49')` 对 warn 和 error 一样为真 |
| T-226 | ⑤ | I25 的阈值从 `> 3` 放宽成 `> 30` | 「四个启用的剖切面」那条必须红 | 红 · 1 条 | — | 还原 |
| T-226 | ⑥ | 把 `assetById` 索引改回每次 `find` | 多轴 scale 测试必须红 | 红 · 1 条（`assets 这根轴上是线性的`） | — | 还原。**这条变异是在修完之后才能跑的**：修之前它本来就是红的，见下面 ⑧ |
| T-226 | ⑦ | 把 `action-refs-gate.test.ts` 拷进 `packages/schema/test/` 并改成从 `@w3/core` import | `pnpm check:deps-direction` 必须红（卡面原话：**这条不是形式主义**） | **绿 · 扫描文件数一个没变（164 → 164），PASS 照旧**。修好守卫后重跑：红 · 2 条，逐行点名 | a | **(a) 探针没接通**：`check-deps-direction.mjs` 只扫 `packages/*/src`，**从不扫 `test`**。而卡面要它拦的正是一个测试文件放错包。已改成 src + test 一起扫（164 → 260 个文件），变异重跑转红。**一条守卫扫不到的地方，与没有守卫没有区别** |
| T-226 | ⑧ | （非变异，是新测试第一次跑的实测）给 scale 测试补上 assets / materials / variables / hotspots / viewpoints / rules 六根轴 | 六条应当都线性 | **红 · 2 条：assets 轴增长 3.639、variables 轴 3.887**（线性应为 2） | b | **(b) 实现有真缺陷**：两处都是规划 §4.2 预告过的真二次项：① `checkRuleConditionTypes` 每条规则第一行就 `new Map(doc.variables.map(...))` → 规则数 × 变量数；② 六处 `doc.assets.find(...)` 嵌在材质槽位 / 视点 / 动画的循环里。已各建一次索引，六轴全部转绿。**原来那条「checkIntegrity is linear」用的文档只有 nodes，其余集合全是空数组——只在一根轴上证明了线性** |
| T-226 | ⑨ | （非变异，是 I30 第一次跑的实测） | fixture 应当干净 | **红 · `v3/integration-placeholder.json` 的 `thumbnailAssetId` 指向一个 model 资产** | b | **(b) fixture 有真缺陷**：T-225 写这份 fixture 时随手指了 `doc.assets[0]`，而那是模型。I30 第一次跑就把它逮了出来。已在生成器里补一份真的 image 资产 |
| T-226 | ⑩ | （非变异，是闸门自检第一次跑的实测）合成参数给没有 default 的 string 字段填 `''` | 合成的参数应当都通过 schema | **红 · `setLight` 的 `color: HexColorSchema.optional()` 校验失败** | a | **(a) 探针没接通**：`createActionRefResolver` 在 `safeParse` 失败时**返回空数组**（registry.ts:89-90）——所以合成错的参数不会让测试红，只会让那个动作悄悄退出统计。已改成「可选字段一律不填」，并加了一条自检断言把这类静默跳过变成红 |
| T-227 | ① | eventDescriptorRefs 删掉 overlayClick 那个 case（让它掉进 default） | event-exhaustive 必须红 | 红 · 2 条 | — | 还原。**锁只锁 index-builder 这一份**：同一个 switch 在 integrity.ts 里还有第二份手抄（checkRuleRefs），那一份由 T-226 的「三个新事件的引用真的被查」覆盖。别读成「事件遗漏已被机械拦住」 |
| T-227 | ② | buildIndex 删掉 pages 整段遍历 | 「overlay 引用的 media 被引用数为 1」必须红 | 红 · 3 条 | — | 还原。断言全部写成 toEqual 全等路径数组 —— toContain 或 length > 0 对「删掉一半遍历」照样绿 |
| T-227 | ③ | getFlowChain 删掉环截断（seen） | 「环形 flow 不死循环」必须红 | 红 · 2 条 | — | 还原。**长度断言 + 1000ms 超时缺一不可**：只写 not.toThrow 的话，删掉 seen 之后的表现是挂住，在 CI 上是超时不是失败 |
| T-227 | ④ | describeReferences 删掉 overlay 标签 | 断中文标签那条红 | 红 · 1 条 | — | 还原。卡面要求加的是 page 标签，实际该加的是 overlay —— labels 按 from.kind 索引，而覆盖层的出边 from 记的是 overlay。加 page 标签会得到一条没有产生者的死表项，对它做变异只会绿 |
| T-227 | ⑤ | dataSources 的路径用 mapping 而不是 map | 路径断言必须红 | 红 · 1 条 | — | 还原。卡面写的是 mapping[].variableId，schema 里的字段名是 map（data-source.ts:96）。TS 会拦住 doc.dataSources[i].mapping，但**拼进 path 字符串的那个词没有任何类型检查**，而 path 是给删除确认直接展示的 |
| T-227 | ⑥ | flowStepEnter 只登记 flow 不登记 step | 「步骤的引用有三类」必须红 | 红 · 2 条 | — | 还原。卡面验收说 step 的引用是「startStepId / next 两类」，那是只登记 flow 的版本。裁决登记两条：删掉一个步骤，指着它的 flowStepEnter 规则也会失效，删除确认必须说得出 |
| T-227 | ⑦ | media-edit 的 refSummary 改回只认 hotspot / rule | 新加的回归必须红 | 红 · 1 条 | — | 还原。这是本卡**自己造出来的**缺陷：加了 overlay→media 出边之后，refCount 数全部而 refSummary 只认两种，一份只被覆盖层引用的媒体会显示「被引用」却说不出被谁。编辑器现有用例的样本文档不含 pages，全程绿 |
| T-228 | ①~⑦ | 八个 v3 新默认值各改成明显错的值（fog.near / fog.density / outline.strength / outline.hiddenEdge / explode.gain / section.size / dataSource.intervalMs） | 八次全部转红 | 红 · 七条各红 1~2 条 | — | 还原。对应 v0.5 M8 那次「8 个默认值被改坏而全套测试全绿」 |
| T-228 | ⑧ | text overlay 的 `size` 默认值 16 → 24 | 同上 | 绿 · 补了「两条路径同值」那条之后转红 1 条 | a | 已修。**`props` 整个缺席时 zod 用的是 `.default(DEFAULT_TEXT_PROPS)` 那个手写常量，`props: {}` 时才逐字段走各自的 `.default()`**——两份独立的值，可以静默分叉。原来那批「props 逐值」断言走的全是常量那一条路，所以改坏逐字段 default 一条都不红。这与 T-225 的反向比对逮到的 `hiddenEdge` / `strength` 分叉是同一形状：同一个值在仓库里写了两遍 |
| T-229 | ① | 把 `main.tsx` 的 `migrate(stored)` 改回 `validate(stored)` | 常设回归必须红 | 红 · 3 条（`restore-migrates.test.ts`），同时 `check-migrate-on-read.mjs` 也红并逐行指出回归文件在哪 | — | 还原。回归必须调**生产路径本身**（导出的 `restoreLastDocument`），不是在测试里重写一遍恢复逻辑——后者这条变异不会红，而那正是 T-176 那条存活 blocker 的形状 |
| T-229 | ② | （非变异，是卡面普查口径的实测）按卡面跑 `grep -rn "validate(" packages/` | 应当找到卡面点名的四处 | 非变异 · **只找到 7 行 src（其中 3 行是注释散文）+ 68 行测试噪音；三条生产路径一个都不在结果里**，它们写的是 `migrate(` | 非变异 | 普查口径改成「谁读外部字节」而不是「谁调用了哪个函数名」。判定表写进 IMPL_NOTES §5，同时补上卡面漏掉的 `migrate.ts:361`——那是唯一一处「validate 用对了」的正面样本，每份外部文档最后都从它过一次 |
| T-229 | ③ | （非变异，是规划 §V14 与卡面的缺口） | §V14 要三样：常设回归 · 判定表 · **lint 守卫** | 非变异 · **卡面只列了前两样。** 三条外部读取路径里，做完卡面仍有两条只靠人记住 | 非变异 | 补了 `scripts/check-migrate-on-read.mjs` 并挂进 `check:constitution`。它按一张显式清单（不猜启发式）看守三条路径，读外部字节的模块里出现 `validate(` 即红。变异① 实测它与回归一起红 |
| T-229 | ④ | （非变异，是卡面判别量的实测）用 `broken-v2-flows.json` 当种子，断言 projectId 与节点数 | 应当能区分「恢复正确」与「回落样例」 | 非变异 · **两种情形下都通过**：那份夹具的 projectId 是 `prj_a1b2c3d4`、3 个节点，与 `createGoldenPathDocument()` 逐字相同 | 非变异 | 改用 `golden-path-2.json`（`prj_s7t9v2x4` / 4 个节点），并补第三条正交断言 `doc.name`。D36 的 M6 形状原样出现在一张专为防它而写的卡的验收标准里 |
| T-229 | ⑤ | （非变异，是我自己写测试时踩的）`try { return p.then(...) } finally { spy.mockRestore() }` | spy 应当看得到 `console.warn` | 非变异 · 红「一次都没调用」——`finally` 在 promise 兑现之前就同步跑掉了 | 非变异 | 改成 `await` 之后再 restore。一条断言看起来在测异步行为，实际测的是「同步块结束时的状态」 |
| T-230 | ① | 删掉 case pages 里的 applyPages?.(next)，只留 return true | 钩子计数断言红 **而** fullRebuildCount 断言仍绿 | 红 · 2 条，全部是钩子计数那两条；「钩子缺席时路径仍算 handled」那条**仍然绿** | — | 还原。**这个对比就是本条变异的全部意义**：只断 fullRebuildCount === 0 的测试对「钩子根本没被调用」完全无观测能力，而那正是 v1.2 接线时会踩的坑 |
| T-230 | ② | 删掉 case sceneId | 对应测试红 | 红 · 1 条 | — | 还原。两个顶层标量分开写不合并，就是为了能单独删掉一个 |
| T-230 | ③ | （非变异，是卡面验收项的实测）「/prefabs/0/name 返回 handled」 | 应当证明本卡生效了 | 非变异 · **改动前后都绿**：T-225 已经把 prefabs 加进认领组，且 apply-patch-coverage 的 it.each 早就覆盖了它 | — | 真正新增的判别点只有四个钩子的调用计数与 /projectId、/sceneId 两条。把已经绿的项列进验收是假绿 |
| T-230 | ④ | （非变异，是删 case id 的可观测性） | 删掉一支不可达的 case 应当可观测 | 非变异 · 不加断言的话**完全不可观测** | — | 补了一条负向断言：/id 现在必须 rebuilt === true 且 fullRebuildCount === 1。SceneDocument 顶层没有 id 字段，那一支从写下那天起就不可达，而真正存在的 projectId 反倒走 default 触发整图重建 |
| T-231 | ① | 删掉 `case variables` 里的 `applyVariables?.(next)` | 钩子计数断言红，而 `fullRebuildCount` 断言仍绿 | 红 · 5 条（3 条钩子计数 + 2 条同步行为） | — | 还原。**这条路径静默失效的形状就在这里**：`/variables` 一直被认领着，所以钩子没接上时没有回落、没有告警，`fullRebuildCount` 全程是 0——铁律 11 的告警机制对这一类失效完全看不见 |
| T-231 | ② | `syncVariables` 删掉 `if (this.variables.has(id)) continue`，改成全部按 `default` 重建 | 「保留当前值」那两条必须红 | 红 · 2 条 | — | 还原。**需要一份两个变量的文档才抓得到**：只有 1 个变量时，「改一个不相干的变量名」这个场景根本造不出来。黄金路径只有 1 个，所以本文件自带一份两变量的夹具 |
| T-231 | ③ | 把 `headless` 的 `setVar` 未声明分支从 `error` 降成 `warn` | 两个运行时同形那条必须红 | 红 · 1 条 | — | 还原。**不能写成 `expect(headlessErrors[0]).toEqual(sceneErrors[0])`**：两边都空时那是 `undefined === undefined`，恒过，而「两边都不说话」正是这条断言要防的失效之一。改成各自先断「恰好一条 error」，再断措辞逐字相同 |
| T-231 | ④ | （非变异，是卡面前提的实测）卡面要求「把 `setVar` 对未声明变量的行为在两个运行时里做成同形」 | 两边应当不一致 | 非变异 · **两边今天已经逐字相同**（`scene-runtime.ts:796` 与 `headless.ts:204` 都是 `error` + 同一句措辞） | — | 本卡的实际产出因此变成「把这个已成立的性质钉住」而不是「把它做出来」，并补进 ECA_SPEC §9.2 的 B15。卡面写死的行号也漂了 113 行（`:683` → `:796`） |
| T-232 | ① | 删掉 `referencedHashes` 里的 prefab 遍历 | 「prefab-only 资产进包」红，而「无人引用的资产不进包」仍绿 | 红 · 1 条（两句断言在同一条用例里，因为它们**必须用同一份文档**） | — | 还原。分成两份文档的话这两句会互相掩护：一个「把所有资产都收进来」的实现在前一句下是绿的，而后一句用的是另一份没有 prefab 的文档，也绿 |
| T-232 | ② | `dropMissingPrefab` 去掉「不在集合里返回 null」那一句 | 「粘完仍然零 error」必须红 | 红 · 1 条 | — | 还原。保留一条悬空 prefabRef 会让 I42 判 error —— 症状是「粘一下就发布不了」 |
| T-232 | ③ | `dropMissingPrefab` 的 `overridden: [...ref.overridden]` 改成直接返回 `ref` | 「overridden 是新数组」必须红 | 红 · 1 条 | — | 还原。数组共享的症状是「改副本的覆盖列表连原件一起改」，而这类 bug 在单测里不写就永远看不见 |
| T-232 | ④ | （非变异，是卡面第一条与变异① 的实测）「collectAllIds 在含 prefab 文档上 id 数 == 手工计数」与「删注册表 prefabs 项 → 铸 id 不撞 prefab body 红」 | 应当是本卡的新增值 | 非变异 · **今天就已经绿，且那条变异今天就已经能转红**（T-201 把 collectAllIds 改成注册表驱动，T-225 登记了 prefabs） | — | 本卡在这一条上没有新增值，如实写在 `prefab.test.ts` 的文件头：这里不是「把它做出来」，是把它钉住 |
| T-232 | ⑤ | （非变异，是卡面第三条验收的实测）「粘贴带 prefabRef 的节点到不含该 prefab 的文档 → checkIntegrity 零 error」 | 应当能证明本卡生效 | 非变异 · **一行代码不写它就是绿的**：粘贴前后都没有 prefab，扫描面本来就是空的（D36 的 M6 形状） | — | 改成两条一起写：目标文档**有**该 prefab 时引用保留且 overridden 换新数组，**没有**时引用被丢掉。前者才是让变异②③ 能转红的那一半 |
| T-232 | ⑥ | （非变异，是漏掉的一条入边）`viewpoints[].thumbnailAssetId` | 应当有人认领 | 非变异 · **T-232 与 T-233 是仅有的两张动 `package.ts` 的卡，两张的卡面都没提它** | — | 本卡一并补上并加了断言。漏了它，发布出去的包里视点缩略图是空的——与 T-176 那次「贴图没进包」同形 |
| T-233 | ① | 删掉 `packScene` 资产循环里的 `if (!needed.has(asset.hash)) continue` | 产物断言红 | 红 · 2 条（孤儿资产进了 zip；`assetCount` 与实际条目数对不上） | — | 还原。**断的是产物不是 `referencedHashes` 的返回值**——这个文件里既有的两条都只断返回值，而裁剪发生在写 zip 那一步，只测返回值的话删掉裁剪它们照样绿 |
| T-233 | ②a | （卡面字面版）从 `PackageManifest` 接口里删掉 `entrySceneId` | 新包那条必须红 | 绿 · **33 条一条没红** | a | **(a) 变异操作本身没有效果**：删一个 TypeScript 可选字段是纯类型改动，运行时一个字节都不变——`packScene` 照写、`JSON.stringify` 照序列化。卡面这条按字面执行是空操作。改成 ②b |
| T-233 | ②b | （有实质的版本）`packScene` 的 manifest 字面量里删掉 `entrySceneId: input.document.sceneId` | 新包那条红，**老包兜底那条不能红** | 红 · 1 条，且**只有新包那条**；老包的三条全绿 | — | 还原。卡面明写这两条要分开写，理由就在这个对比里：老包本来就没有这个键，它走的是 `resolveEntryScene` 的兜底，与 `packScene` 写不写无关 |
| T-233 | ③ | `resolveEntryScene` 去掉 `?? pkg.document.sceneId` 兜底 | 老包那条必须红 | 红 · 1 条（只有老包那条） | — | 还原 |
| T-233 | ④ | （非变异，是卡面三项互斥）「用**当前构建**打一个单场景 .w3p 存成 fixture」 vs 文件名 `legacy-v2-…` vs 验收「迁移到 v3 后 sceneId === deriveSceneId(projectId)」与「manifest.entrySceneId 为 undefined」 | 三者应当能同时成立 | 非变异 · **互斥**：当前构建写的是 `schemaVersion: 3` 和三个新 manifest 字段，打不出老包 | — | 改成手工拼一份 v1.0 之前形状的 manifest（六个键，一个不多），生成器 `make-legacy-package.mjs` 一次性执行、产物提交。这份 fixture 的全部价值恰恰在于它**没有**那三个键 |
| T-233 | ⑤ | （非变异，是卡面写法的代价）「`packScene` 的资产循环改为遍历 `needed`」 | 应当等价于加裁剪 | 非变异 · **不等价**：一个 hash 可以对应多条 `assets` 记录（同一份字节以两个扩展名导入过），遍历 hash 只会写出其中一条的 url，另一条在播放器里解析不到 | — | 保留按 `assets` 遍历，在 `isBlobHash` 之后加一行 `needed.has` 守卫。理由写进代码注释与本行 |
| T-234 | ① | `TEXTURE_BPP` 的 `etc1s` 从 4 改成 32 | KTX2 显存那条红 | 红 · 1 条 | — | 还原 |
| T-234 | ② | 去掉 `grade()` 里的 `applicable` 过滤 | 「无 KTX2 时不含该行」红 | 红 · 1 条 | — | 还原。`applicable` 与 `level` 的区别是「不出现」与「出现且 pass」：一份没压过的模型显示「压缩收益 1:1，通过」，读起来像「压过了但没省」 |
| T-234 | ③ | 白名单改回黑名单（`const { maxTextureSize: _d, ...rest }`） | `strict().parse` 那条红 | 红 · 3 条，含既有的「the stats it stores match the schema」 | — | 还原。四个新测量键会一起漏进文档，而 `AssetStatsSchema` 是 `.strict()`——症状是「编辑器全绿、发布闸门拒绝」（T-176 实测过一次） |
| T-234 | ④ | `clipDurations` 从白名单去掉（改回写死 `{}`） | 发布回归必须转红 | 红 · 2 条（两条测量路各一条） | — | 还原。**卡面这条的字面版本做不到**：`clipDurations` 早就在 `AssetStats` 里（T-225 加的），去掉它 `strict().parse` 不会红，红的是「时长真的被量出来了」那两条 |
| T-234 | ⑤ | `glb-header` 的 `clipDurations` 改回空表 | 两条测量路的对拍必须红 | 红 · 3 条，其中两条是**既有的**「agrees with the document route on a … GLB」整对象对拍 | — | 还原。既有那两条对拍是白捡的看守：它比对两条路的整个 measurements 对象，任何一侧漏一个字段都红 |
| T-234 | ⑥ | （非变异，是本卡最实质的发现） | `measure()` 量出的时长应当能到达文档 | **红 · `stats.clipDurations` 永远是空表**——`grade()` 的白名单里那一项是写死的 `{}` | 非变异 | **白名单拦住了泄漏，也拦住了新字段，而两者的症状完全不同**：前者发布失败（吵），后者静默为空（不吵）。T-225 把 `clipDurations` 加进 `AssetStats` 时没人动这里，于是它从加进来那天起就是死字段 |
| T-234 | ⑦ | （非变异，是我自己写错的一条注释）T-225 在 `audit.ts` 与 `glb-header.ts` 两处都写了「时长要解 BIN chunk，头部拿不到」 | 那应当是事实 | **非变异 · 不是事实**：glTF 规范要求 animation 的 input 访问器必须带 `min`/`max`，正是为了让播放器不读完整条轨道就算得出时长 | 非变异 | 两处注释与 `docs/METRICS.md` 的趋势观察点一并订正。头部快路径现在只读 JSON chunk 就量得出时长，与 document 路对拍误差 < 1e-4 |
| T-234 | ⑧ | （非变异，是 `listSamplers()` 的实测行为）`clipDurationsOf` 用 `animation.listSamplers()` | 应当列出这条动画的 sampler | **非变异 · 空数组**，而同一条动画的 `listChannels()` 有值 | 非变异 | 改走 channel → `getSampler()`。失效方式是静默的：时长变成 0，而 `stats.animations` 照样正确，两个字段一个对一个错 |
| T-238 | ① | 三级排序砍成只按 `dot` | 确定性那条红（基准文档必须刻意乱序） | 红 · 2 条（「打平时按 order 排」「order 也打平时按 id」） | — | 还原。**「两次调用逐位相等」那条反而没红**——V8 的 sort 对小数组是稳定的，所以「不确定」在单机上抓不到。真正抓得住的是「打平时按什么排」这个**可观测的顺序**，而不是「两次一样」这个概率性质 |
| T-238 | ② | radial 的质心改成 `[0,0,0]` | 「相对位置 × (1+gain)」那条红 | 红 · 3 条 —— **但不含卡面点名的那一条** | — | 还原。**卡面点名的那条断言在数学上抓不到这个变异**：相对位置差是质心无关的（`(p_a−c)−(p_b−c) = p_a−p_b`，`c` 约掉了）。真正抓到它的是「整组位移和为零」——那一条才依赖质心。卡面还预告了「若不红说明 fixture 质心恰在原点，换 fixture」，而问题不在 fixture |
| T-238 | ③ | `node.explodeOffset ?? derived` 改成永远用 `derived` | 覆盖那条红 | 红 · 2 条 | — | 还原 |
| T-238 | ④ | 删掉零向量兜底那一行 | 轴为零那条红 | 红 · 1 条 | — | 还原。判零必须在除法之前：先归一化再判长度得到 `0/0 = NaN`，而 NaN 沿 transform 传下去的表现是整个分组从画面上消失，没有报错也没有日志 |
| T-238 | ⑤ | （非变异，是 fixture 的实测）卡面变异② 预告「若不红说明 fixture 质心恰在原点」 | golden-path-3 的分组应当可用作基准 | 非变异 · **那两个分组的全部 6 个子件锚点都在 `[0,0,0]`**，质心就是原点 | — | 本卡自建基准文档（质心 `[1.5, 0.5, 0]`），并加一条前置断言把「质心不在原点」这个前提本身钉住 |
| T-238 | ⑥ | （非变异，是死导出闸门的解法）新导出 `explodeOffsets` 在 v1.0 没有消费者（T-244 才用） | 应当需要一条豁免 | 非变异 · **不需要**：完整性检查 I22 本来就在自己算一遍「锚点是否全部重合」 | — | I22 改成问 `explodeOffsets`——「锚点全重合」等价于「径向派生位移全为零」，两种说法一份实现。顺带覆盖了 min/max 版看不见的一种情形：钉了 `explodeOffset` 的成员不该算进「散不开」，它有确定的去处。棘轮因此没动 |
