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
| **卡号** | `T-2xx`，必须是 `docs/TASK_BACKLOG_V1.md` 里真实存在的卡；**或** `ADR-00xx`（跨卡裁决产出的变异），必须是 `docs/adr/` 里真实存在的文件。两种形状同等硬，都会被回查 |
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

> **ADR-00xx 那一种卡号从 ADR-0033 起合法。** 跨卡裁决（比如一次守卫改造）同样会产出
> 变异，而它没有卡号——逼它挂到某张卡上，会在二分定位时把人送去看一张与该变异无关的卡；
> 编一个假卡号更坏。放宽的是**形状**，不是校验：那份 ADR 文件必须真的存在，否则照样红。

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
| T-235 | ① | `renderFrame()` 改回直接 `renderer?.render(...)` | 「唯一渲染出口」那条红 | 红 · 1 条 | — | 还原。这条断言读的是**源文件文本**而不是行为——ADR-0025 预告的脚本化检查落地之前，它是唯一拦着后来人再加一处的东西 |
| T-235 | ② | `sync()` 忽略 `outline.enabled`，永远建 composer | 「默认文档下工厂被调用 0 次」红 | 红 · 6 条 | — | 还原。**断的是工厂调用数不是 `mode`**：一个「建了 composer 又不用」的实现 `mode` 也是 `direct`，而 D31/ADR-0021 要的是「渲染路径与 v0.5 完全相同」 |
| T-235 | ③ | chrome 显示时一律置 `true`（不还原原值） | 「还原各自隐藏那一刻的值」红 | 红 · 1 条 | — | 还原。手柄的可见性由选择集驱动（无选中时它自己是 false），一律 true 会在「退出预览且无选中」时把 TransformControls 画出来 |
| T-235 | ④ | capturing 时 `tick()` 照画 | 出图守卫那条红 | 红 · 1 条 | — | 还原 |
| T-235 | ⑤ | chrome 只翻 `root.visible`，不逐对象写 | 遍历断言红 | 红 · 5 条，含**两条既有的** light-helpers 用例 | — | 还原。只翻 Group 也能让渲染器与拾取器跳过整棵子树，但子对象自己的 `visible` 仍是 true——而既有测试正是直接断 `grid.visible === false` 的 |
| T-235 | ⑥ | （非变异，是断言自己踩的坑）「源文件里 `renderer?.render(` 恰好一次」第一版没去注释 | 应当数出 1 处 | 非变异 · **数出 2 处**——`drawScene()` 自己那句「全文件唯一一处 `renderer?.render(`」的注释被算成了命中 | — | 一条检查把自己的说明文字当成了违规。改成先去注释再数；ADR-0025 预告的那条脚本化检查同样要处理这件事 |
| T-235 | ⑦ | （非变异，是卡面 ⑨ 的实测）「交付一份接缝清单，预付 +0.5 人日」 | 应当是本卡的新增工作 | 非变异 · **T-200 已经付过了**（12 条接缝 + `SEAM_NOT_WIRED` + SEAMS 表都在） | — | 本卡的真实动作是**删**：4 条接缝实现掉、SEAMS 表 12 → 8、豁免表 4 行删掉。卡面完全没提这两处必改 |
| T-235 | ⑧ | （非变异，是双向锁的实测）接线之后不删豁免行 | 应当只是「少删一行」 | 非变异 · **红**：`stale` 分支把「已接线却还留在表里」判为失败，与 `unexplained` 是两个方向 | — | `check-dead-exports` 是双向锁，卡面一个字没提。删 4 行、为 `beginCapture`/`endCapture` 加 2 行（owner T-266），**棘轮 35 → 33，第一次往下走** |
| T-236 | ① | 删掉链尾的 `OutputPass`（**本卡存在的全部理由**） | 必须转红 | 红 · 1 条 | — | 还原。链尾不是风格问题：`OutputPass` 把线性结果做色调映射并转回 sRGB，排在它后面的 pass 拿到的是已转换的颜色，再处理一次就是二次转换——画面整体偏灰而所有单测全绿 |
| T-236 | ② | `rt2.samples` 不显式设回 0 | target 断言红 | 红 · 1 条 | — | 还原。`EffectComposer` 用 `rt1.clone()` 造 rt2，而 `WebGLRenderTarget.copy()` 把 `samples` 一起复制过去——两个多重采样目标之间每次 `swapBuffers` 都要多做一遍 resolve |
| T-236 | ③ | 浮点缓冲降级时不告警 | 降级那条红 | 红 · 1 条 | — | 还原。静默降级会让「为什么这台机器上高光是灰的」永远查不出来；另有一条反向断言「支持时不说话」，免得告警变成背景噪音 |
| T-236 | ④ | `histogramDistance` 恒返回 0（卡面点名的「容差放宽成都非零就算过」的同形） | 必须证明它测不出东西 | 红 · 2 条 | — | 还原。**这两个纯函数是 E2E 那些阈值的量纲来源**，写错了不会让任何 E2E 变红，只会让阈值静默失去意义（距离恒为 0 → 「两条路径画面一致」永远通过）。所以它们住在 core 的测试助手里、有 Node 单测，而不是躺在 `e2e/` 里没人测 |
| T-236 | ⑤ | `brightWeight` 空表返回 NaN | 空表那条红 | 红 · 1 条 | — | 还原。NaN 的危险在于**方向**：`expect(NaN).toBeLessThan(x)` 会红，而 `expect(NaN).not.toBeGreaterThan(x)` 会绿——「亮部占比没有整体上移」恰好是后一种写法 |
| T-236 | ⑥ | （非变异，是卡面验收对象的实测）「断言 `OutputPass` 的 `toneMapping` 与 `toneMappingExposure` 逐值等于文档值」 | 应当可断言 | 非变异 · **两处都不成立**：`OutputPass` 上没有这两个属性（它在 `render()` 里从渲染器上读，写进自己的 uniform 与 `material.defines`）；而 `toneMapping` **不是文档字段**（文档里只有 `meta.environment.exposure`，模式由 `EnvironmentController` 按有无 HDRI 决定） | — | 断言对象改成它真正消费的那条链：文档 → EnvironmentController → 渲染器状态 → OutputPass 的 uniform。按卡面字面写会断言一个 SPEC 里不存在的字段 |
| T-236 | ⑦ | （非变异，是 T-235 的欠账）`RenderPipeline` 只有注入口，**没有真实的 composer 工厂** | T-235 应当已经交付它 | 非变异 · **没有**。T-235 的验收里有「rt1.samples===4 / rt2.samples===0」，而我当时只做了注入口，用假 composer 测的 | — | 本卡补上 `createDefaultComposer`（T-236 的独占正好是「render-pipeline.ts 的 OutputPass 配置段」）。如实登记：这是 T-235 少交付的一块，不是 T-236 的新增范围 |
| T-236 | ⑧ | （非变异，是 E2E 那一半的可行性）卡面要「开描边前后各截一张图比较亮部分布」 | 应当能在 e2e 里开描边 | 非变异 · **今天没有任何手段**：编辑器没有描边开关（T-241 的 SceneEffectsPanel 才建），而 `runtime-registry.ts` 的 `__w3Dev*` 句柄**按其自身注释是只读的**（「exposes no way to change anything」） | — | 交付可复用的那一半（`pixel-stats.ts` 的直方图与两个纯函数 + Node 单测），把像素比较那一半登记给 T-241——它建面板，届时那个开关是真实的用户操作而不是测试后门 |
| T-239 | ① | `new ThreeFog(colour, fog.far, fog.near)`（near / far 互换） | 逐字段断言红 | 红 · 1 条 | — | 还原。`instanceof Fog` 那半对互换的实现照样绿——所以 color / near / far **逐字段**断 |
| T-239 | ② | `enabled: false` 时不写 null（仍然 new Fog） | 往返那条红 | 红 · 1 条 | — | 还原。**两头都要断**：只断「关着时是 null」是恒真的（默认就是 null，一行代码不写它也过），必须先证明它真的被设起来过 |
| T-239 | ③ | `disableFogOn` 改成空操作 | chrome 那条红 | 红 · 5 条（3 条纯函数 + 2 条运行时遍历） | — | 还原 |
| T-239 | ④ | `applyFog` 挪到 `if (!renderer) return` 之后 | 无渲染器那条红 | 红 · 5 条 —— **雾在 headless 路径上整个消失** | — | 还原。parity（编辑器预览 vs 播放器的唯一机器证明）走的正是无渲染器那条路：写在早退之后，parity 看到的两边都是「没有雾」，于是它对雾完全失明 |
| T-239 | ⑤ | `setFogType` 顺手把另一组数值重置成默认 | 「切类型不清空」那条红 | 红 · 1 条 | — | 还原。调参时在 linear ↔ exp2 之间来回切是最常见的动作，清空的话切过去再切回来用户调好的 near/far 就没了 |
| T-239 | ⑥ | （非变异，是设计裁决的实测）卡面要在 grid / lightHelpers / gizmo / 代理球**四个建构点**各调一次 `disableFogOn` | 四处各调一次 | 非变异 · 改成放进 `registerChrome` 的**唯一入口**。**而第一次跑就红了**：core 内部两处走的是 `this.chrome.register` 而不是公共入口，绕过了 `disableFogOn` | — | 这恰好证明了单入口的价值——四处各调一次的失效方式就是「第五处没人记得调」，而我自己在同一张卡里就漏了两处。已把内部注册也改走公共入口 |
| T-239 | ⑦ | （非变异，是卡面验收的恒真形状）「`scene.children` 里除 `graph.root` 外每个对象材质 `fog === false`」 | 应当能查出 chrome 吃雾 | 非变异 · **恒真**：T-235 之后 chrome 全在一个 Group 下，而那个 Group 本身没有材质，「每个对象」遍历到的是零份材质 | — | 数据源改成 chrome 容器的 traverse，并**先断遍历到的材质数 > 0**——空注册表下「每一个都不吃雾」正是 D36 的 M6 形状 |
| T-239 | ⑧ | （非变异，是 three API 的实测）断言 `material.needsUpdate === true` | 应当读得出来 | 非变异 · **读回来是 `undefined`**：three 的 `Material.needsUpdate` 是只写的（setter 里 `version++`） | — | 改断 `material.version` 变大。按 `.toBe(true)` 写会红在与被测行为无关的地方，按 `.not.toBe(false)` 写又对 undefined 恒真 |
| T-239 | ⑨ | （非变异，是卡面验收的恒真断言）「`git diff apply-patch.ts` 为空」 | 应当是一条验收 | 非变异 · **恒真**：本卡本来就没碰它，而它为真的原因是 `case 'meta'` 的 fallthrough（T-230 的注释里写着「deliberate and load-bearing」），与本卡做了什么无关 | — | 照做了（diff 确实为空），但如实记下它证明不了管线接上了 |
| T-240 | ① | 删掉 `OutlineLayer.ensurePass` 里的 `this.options.composer.addPass(pass)` | 必须有测试红（**只断 `selectedObjects` 是假绿**：pass 造出来了、参数也对，就是没挂进链路，一个像素都画不出来） | 红 · 6 条 —— 全部来自断 `composer.passes` 的那几句；只断 `selectedObjects` 的断言在这条变异下**确实全绿**，卡面点的这个坑是真的 | — | 还原 |
| T-240 | ② | `MAX_ACTIVE_OUTLINE_PRESETS` 由 2 改成 99 | 回落那条红 | 红 · 4 条（回落集合 / warn 条数 / 每预设一条 warn / 回落节点走 fallback.clear） | — | 还原。注意「活跃 pass 数 == 上限」那句用的是常量本身，随变异一起漂——真正抓住它的是 `fallback.applied` 与 `warns.length` 这两句写死的期望 |
| T-240 | ③ | 两个运行时的 `highlightOf` 都改成 `return null` | 契约红 | 红 · 13 条，**契约套件在 headless 与 scene-runtime 两个 label 上同时红** | — | 还原 |
| T-240 | ④ | （反向变异）`highlight()` 改成空操作，查契约里每一条高亮断言是否都红 | 每一条都红 | 红 · 16 条，但**契约里有两条高亮断言是绿的**：「`highlightOf` 只认被点名的那个节点」与「未知预设不会被记成高亮」 | b | 保留原样并在此登记。这两条断的是 `highlightOf` 返回 **null**，删掉高亮功能后当然还是 null——它们防的是另一种缺陷（一个「返回最后一次高亮过的预设名、不管问的是谁」的实现 / 把画不出来的预设记成生效），而正向那一侧由 ③ 与本条的其余 16 条覆盖。**一条负向断言不可能在功能被删时转红，这是它的形状决定的，不是它写得弱** |
| T-240 | ⑤ | （非变异，是契约套件的一次实测）把「高亮 → `highlightOf` 返回预设名」加进契约后第一次运行 | 两侧同时绿 | 非变异 · **headless 一侧红**：它对未知预设照单全收并记进 Map，而 SceneRuntime 从 T-040 起就拒收画不出来的东西 | — | 修 headless：`highlight()` 前置校验预设名，未知则 warn 并返回。**这处分叉在 `highlightOf` 上契约之前无从观测**——两侧的高亮状态从来没有被同一组断言比较过 |
| T-240 | ⑥ | （非变异，是实现期发现的缺陷）`OutlineLayer.apply` 对同一节点重复设同一预设 | —— | 非变异 · 会先 `clear`（该预设最后一个成员 → `removePass` + `dispose`）再 `ensurePass` 新建一条：**一条挂在 hover 上的高亮规则会按帧销毁重建一条全屏后处理通道** | — | `apply` 开头加「`placement.get(nodeId) === preset` 直接返回 true」，并补一条「连设 5 次只造一条 pass 且 disposed 为 0」的测试 |
| T-240 | ⑦ | （非变异，是卡面 ④ 的落点辨析）「unlit 节点 emissive 模式下报新文案」 | 应当有一条新文案 | 非变异 · 原来的两档文案把**三件处置办法完全不同的事**糊在一起：分组节点、写错的预设名、unlit 材质 | — | 拆成四档（未知预设 / 占位节点 / 材质不支持自发光 / 分组节点）。unlit 那档明说「开启描边后可高亮」——原文案会让用户去改一个没有问题的节点 |
| T-237 | ① | 删掉 update 里那句 `for (const playback of this.playing.values()) this.writeTime(playback, nowMs)`，并摘掉 `action.paused = true`（退回累加式驱动） | 姿态断言红 | 红 · 3 条（跳帧等价 / 末帧钳位 / 幽灵对象） | — | 还原。**「循环取模」那条在这条变异下是绿的**——摘掉 paused 之后 three 自己的 loop 处理接管了，回绕照样对。判别力在跳帧那条上：累加式少调几次 update 就少推几次时间 |
| T-237 | ② | scoped clip 缓存旁路（`let scoped = undefined`），退回每次 `new AnimationClip` | 累积断言红 | 红 · 2 条（play ×20 / seek ×20） | — | 还原。断的是 three 内部 `mixer._actions.length`，不是 `activeCount`——后者恒为 1，见 ③ 那条订正 |
| T-237 | ③ | 删掉 `rebuild()` 里的 `tweens.stopAll()` + `clips.clearMixers()` | 幽灵对象断言红 | 绿→红 · **第一版写法全绿**：重建之后我又 play 了一次，而 `play` 开头那句 `stop` 会把旧 playback 顺手停掉，于是幽灵自己不动了，通知接没接进 rebuild 完全看不出来 | b | 把测试改成**重建后不重播、直接继续 tick**，并补断 `mixerCount === 0`。改完这条变异红 1 条 |
| T-237 | ④ | `resetScene` 里的 `clips.clearMixers()` 换回 `clips.stopAll()` | 「5 次不增长」红 | 红 · 2 条（resetScene 后为 0 / 5 次峰值不涨） | — | 还原。卡面点名的假绿确实存在：`clip.test.ts` 的「clearMixers 之后 mixer 数为 0」在这条变异下**全绿**——它测的是方法，不是接线。接线只有 scene-runtime 那两条测得到 |
| T-237 | ⑤ | （非变异，是既有测试的一次留证）16 条既有 `clip.test.ts` 断言一行未改 | 全部原样通过 | 非变异 · 全部通过 | — | 这是卡面「不改语义」的唯一证据。`clampWhenFinished` / `loop` / `speed` / 打断冻结 / D6 的三条 Promise 语义都在里面 |
| T-237 | ⑥ | （非变异，是缓存带出来的新缺陷）scoped clip 按 (animationId, objectUuid) 缓存之后 | —— | 非变异 · 改过 `clipName` / `assetId` 的动画会**安静地继续播老片段**：缓存里那份是按旧定义绑的，而 `fullRebuildCount` 全程是 0 | — | `apply-patch` 的 `case 'animations'` 由「认领即可」改为把动过的 id 交给 `releaseFor`。**这处改动在本卡独占文件清单之外，提交信息里点名** |
| ADR-0033 | ① | 往冻结接口表塞一行 `core:ClipPlayer.mixerCount`（它不在规划 §4 里） | 门锁必须拦住 | 红 · 报「不在「规划§4」的冻结清单里（按代码跨度逐字比对）」并指出行号 | — | 还原。**这条是整张新表能不受条数棘轮约束的全部理由**——它绿了，第三张表就是垃圾桶 |
| ADR-0033 | ② | `spec` 列改成「某份不存在的规范」 | 封闭取值必须红 | 红 · 1 条，报出三个合法取值 | — | 还原 |
| ADR-0033 | ③ | `SPEC_SOURCES` 的小节标题改成 `## 4. 规范增量`（少了「（逐字实现）」） | 应当报「读不到规范」而不是逐行报「不在清单里」 | 红 · 10 条，且措辞是「是标题改了还是路径改了，不是这一行有问题」 | — | 还原。方向很重要：标题失配时若退回全文件扫描，门锁会**悄悄松开一整级**且没有任何提示 |
| ADR-0033 | ④ | **反向变异**：同时拿掉标识符数下限、拿掉「读不到就失败」，并改成「抽不到标识符就放行」 | 想看这三条防线里哪一条在承重 | 红→**PASS** · 守卫一行不报直接绿，而它其实一个标识符都没读到 | — | 还原。这是 D36 的 M6 形状在本守卫上的实例：**空扫描的默认方向必须是「每行都失败」而不是「每行都通过」**，再加一条下限把「抽空了」与「规范里真没有」分开报 |
| ADR-0033 | ⑤ | 同一个符号同时列进豁免表与冻结接口表 | 必须红 | 红 · 1 条，点名符号并要求删掉其中一行 | — | 还原。不查的话它会既不受棘轮约束、又占着一个棘轮名额 |
| ADR-0033 | ⑥ | 往冻结接口表放一个**已经有生产调用者**的符号（`core:SceneRuntime.highlight`） | 陈旧记录检查要覆盖新表 | 绿→红 · 第一版报的是「豁免表里的 …」——检查覆盖到了，措辞没有 | c | 报错措辞改成按表点名（`豁免表` / `冻结接口表`）。一条指错表的报错会把人送去改另一张表 |
| ADR-0033 | ⑦ | （非变异，是门锁第一版的实测击穿）门锁第一版只查「这个词出现在这一节里」 | 应当拦住随手导出 | 非变异 · **被 `schema:touch` 当场击穿**：规划 §4 的一段 JSDoc 里写着 "…defaults and touch nothing that is already there" | — | 改成只认行内代码跨度与围栏块里注释以外的部分。`touch` 因此留在四列表里受条数棘轮管 |
| T-241 | ① | 删掉 `Viewport.tsx` 选择 effect 里的 `runtimeRef.current?.setSelectionOutline(selection)` | E2E 那条红 | 绿→红 · **一条测试都没红**（editor 352 条全绿），红的是 `check:constitution`：唯一的生产调用者没了，`core:SceneRuntime.setSelectionOutline` 变回孤儿 | b | 保留并如实登记。卡面要的是 E2E，而 `e2e/tests/postfx.spec.ts` 归 T-294 独占、今天不存在（`pnpm test:e2e -g postfx` 匹配零条）。**「点选」这个手势本身今天没有测试压着**——像素证明推到 T-294，已扩进 IMPL_NOTES 的 U-21。dead-exports 那条不是行为断言，但它确实会让 CI 转红，登记时不冒充成测试 |
| T-241 | ② | 删掉 `setChromeVisible` 里的 `pushSelectionOutline()`（进预览不清空） | 预览断言红 | 红 · 1 条（「进预览时清空」） | — | 还原。这条能在 Node 里被抓到，是因为清空的责任放在 core 而不是编辑器的 useEffect（[ADR-0036](adr/0036-选中态描边不占预设名额.md)）——放在 effect 里的话只有 E2E 看得见 |
| T-241 | ③ | 面板里颜色的 `commit` 改成 `preview`，宽度的 `onPreviewEnd` 改成空操作 | 撤销那条红 | 红 · 2 条（改颜色落一条撤销 / 一次拖拽恰好一条） | — | 还原 |
| T-241 | ④ | 描边开关的 `onChange` 改成 `() => {}` | 想知道「走到 UI 事件入口」这句话今天有没有落点 | 绿→红 · **本卡之前是绿的**：编辑器一侧的测试全停在 lib 层（`effects-edit.test.ts` 直接 produce 调纯 mutator），面板与 mutator 之间那根线从来没有断言压着 | b | 新建 `test/panels/SceneEffectsPanel.test.tsx`——本仓第一条渲染 React 组件的测试，逐文件 jsdom，零新依赖。范式与代价见 [ADR-0038](adr/0038-编辑器-ui-事件入口的测试范式.md)。改完这条变异红 1 条 |
| T-241 | ⑤ | 让选中通道占预设名额（`this.passes.size + (this.selectionPass ? 1 : 0) >= MAX`） | ADR-0036 的反向：想看那条裁决有没有落点 | 红 · 1 条（「不占那两个预设名额 —— 选中着也能有两种预设」） | — | 还原 |
| T-241 | ⑥ | （非变异，是勘察发现的系统性缺口）全仓有没有宿主注入 `createComposer` / `createOutlinePass` | 应当有 | 非变异 · **一个都没有，且 199 张卡里没有一张认领**。于是 `wantsOutline` 在真编辑器里恒 false，打开 `outline.enabled` 一个像素都不会变；`createDefaultComposer`（T-235 交付）零生产调用者 | — | 把默认值放进 **core**（`SceneRuntime` 的构造与 `createOutlinePass` 私有方法），而不是在两个宿主里各注一次。只注编辑器 = 预览有轮廓、发布出去没有（C3 分叉）；注播放器要动 `session.ts`，那是 C3 验收口径明令不许出现 diff 的文件。补一条「宿主一个工厂都不注入时描边仍然真的走描边」的测试 |
| T-241 | ⑦ | （非变异，是 T-240 一条测试的语义翻转）「没注入 createOutlinePass 时哪怕 composed 也走自发光」 | 本卡之后应当不再成立 | 非变异 · 由绿转红，**这是被本卡刻意改掉的契约**，不是回归 | — | 改写成「宿主一个工厂都不注入时，描边仍然真的走描边 —— 这是 C3 的落点」，并另加一条「注入口仍然管用」守住桩注入不被默认值挤掉 |
| T-241 | ⑧ | （非变异，是一次操作事故）跑变异 ⑤ 时用 `git checkout packages/core/src/runtime/outline-layer.ts` 还原 | 只还原那条变异 | 非变异 · **把本卡未提交的选中通道整个抹掉了**（该文件上一次提交是 T-240，不含选中通道），15 条测试当场红 | — | 用脚本重放补丁恢复。**同一形状 T-234 已经犯过一次**（MUTATIONS 里有记录）：变异检验前一律 `cp` 备份，不用 `git checkout` 还原未提交的文件 |
| T-242 | ① | 背景色的 `onChange` 改成 `() => {}` | UI 入口测试红 | 红 · 1 条（改背景色 → 字段变 + 落一条撤销） | — | 还原。这条能红是因为 T-241 刚立的 jsdom 范式（[ADR-0038](adr/0038-编辑器-ui-事件入口的测试范式.md)）；在本批之前它必绿 |
| T-242 | ② | 把能力体检的覆盖面从「可编辑字段」退回「动作 / 事件」（表里的 field 行与两条新断言一起删掉） | **必须证明它看不见这个缺口** | 红→**PASS（4 条全绿）** · 旧覆盖面对「背景色没有编辑器控件」完全失明——它既不是动作也不是事件 | — | 还原。这就是把覆盖面钉死在字段级的全部理由：`meta.background.color` 与 `meta.environment.exposure` 在文档里、运行时读它、导出用它、体检提它，**13 份设计零认领**，而只看动作与事件的表两年都不会响一声。这是 T-137 那个教训的第二次实例 |
| T-242 | ③ | 只删表里的 field 行、保留新断言 | 双向集合相等应当当场红 | 红 · 1 条（「covers every leaf under meta, and nothing else」） | — | 还原。与 ② 分开跑：② 证明旧口径看不见，③ 证明新口径看得见 |
| T-242 | ④ | （非变异，是新覆盖面第一次运行的产出）把 `meta.**` 的每个叶子都要一行 | 应当只差卡面点名的两个 | 非变异 · **差四个**：除 `background.color` / `environment.exposure` 外，还有 `environment.intensity`（本卡顺手补了控件）与 `meta.unit` / `meta.upAxis`（改它们要把已导入资产整体重新归一化，不是一个下拉框） | — | unit / upAxis 按 `selector: null` + 中文理由登记为**无人认领的缺口**，写清是哪一种「没有」。登记而不是删掉：删掉会让这件事从表上消失，而这张表存在的理由正是让缺口可数 |
| T-242 | ⑤ | （非变异，是设计裁决的留证）背景类型下拉框给不给 `hdri` 这一档 | —— | 非变异 · 给了的话：选中它而 `environment.hdriAssetId` 是 null，画面一片纯黑且没有任何提示 | — | 可选项里只留 color / transparent；**但文档已经是 hdri 时下拉框如实显示它**（否则控件会谎报成「纯色」而文档里不是）。两条都有测试 |
| T-243 | ① | 删掉 `SectionLayer.sync` 里的 `renderer.clippingPlanes = active` | 平面数必须红 | 红 · **12 条** | — | 还原。卡面点名的假绿是真的：本文件里每一条断言读的都是 `renderer.clippingPlanes`，若改读 `layer.livePlanes`（本层自己的账本），这条变异下 12 条会全绿——v0.5 M11「断言渲染器而不是文档」的第四次同形 |
| T-243 | ② | 删掉 `apply-patch` 的 `case 'section'` | `fullRebuildCount` 红 | 绿→红 · **第一版全绿**：本卡的测试全在 SectionLayer 与图这一层，没有一条走补丁路径 | b | 补三条 `it.each`（section / explode / explodeOffset 各一条），断改这个字段不触发整图重建。**三个分开写**：合并成一条的话「删掉其中一个 case」只在其中一支上可观测 |
| T-243 | ③ | `worldVisible(object)` 换成 `object.visible` | 父节点隐藏那条红 | 红 · 1 条 | — | 还原。这条能有判别力，靠的是紧挨着的那条前提断言「同一对节点在父节点可见时是 1 条」——少了它，上一条对一个恒返回 0 条的实现同样成立 |
| T-243 | ④ | （非变异，是规范之间的一处分叉）「启用中的剖切面」怎么判 | 应当只有一个答案 | 非变异 · **两个**：I25 用 `n.visible`（自身），运行时要用世界可见性。父节点被隐藏时两者不同 | — | 运行时取世界可见性（收起分组之后还在切的刀，用户找不着也关不掉），I25 不动——它不在本卡独占栏，且两者回答的不是同一个问题。裁决与代价见 [ADR-0039](adr/0039-剖切面的启用判定用世界可见性.md)，不准确之处登记进 IMPL_NOTES §3 |
| T-243 | ⑤ | （非变异，是为了过闸门差点开的一个后门）给 SceneRuntime 加 `sectionPlaneCount` 让「100 次拖拽」那条测试有东西可断 | —— | 非变异 · 它当场成了新孤儿（dead-exports 判红），而且**它读的是本层账本**，与本卡自己定的「断渲染器」纪律正相反 | — | 删掉它，测试改成注入渲染器桩并读 `renderer.clippingPlanes`。闸门这一次拦住的正是它该拦的东西 |
| T-243 | ⑥ | （非变异，是 three 的一处默认值）只写 `clippingPlanes` 不开 `localClippingEnabled` | 应当就生效了 | 非变异 · **不生效**，且没有任何报错——画面看起来「就是没剖」 | — | `attachRenderer` 里一并打开，并补一条断言。这类「写进去了但没打开总开关」的失效，症状与「功能没实现」逐字相同 |
| T-244 | ① | `base = position − 上一帧我加的` 改成 `base = position` | 「与补间复合」和「patch 之后不塌」红 | 红 · **6 条**（含归零、复合、账本、中断、reset、缓存） | — | 还原。叠加式与记账式的分界就在这一行上，红这么多条说明它确实是承重的 |
| T-244 | ② | 删掉 `resetScene` 里的 `explode.reset()` | 「再 tick 十帧不动」红 | 绿→红 · **第一版全绿**：那条断言写在 `layer.reset()` 上，测的是方法不是接线 | b | 补一组「接缝防线」（照 T-243 的写法），用真 `SceneRuntime` 的 `resetScene` + 十帧 `tick`。改完这条变异红 1 条。**卡面点名的假绿是真的**：只断「回到文档值」时，重建后第一帧位置本来就是对的，坏的是第二帧 |
| T-244 | ③ | 中断时把系数回零（`onAbort` 里加 `state.factor = 0`） | 「停在中途」红 | 红 · 1 条 | — | 还原。这条测试同时断了「不等于起点」与「不等于终点」——只断其一的话，回零那种实现在「不等于终点」下照样绿 |
| T-244 | ④ | `invalidate()` 改成空操作（缓存永不失效） | 需要一条「改了子件 transform.p 之后偏移跟着变」的测试才抓得到 | 红 · 1 条 | — | 还原。卡面这条说的是**测试怎么写**而不是变异怎么做，照写了：改一个成员的锚点 → 质心变 → 同组其余每一个成员的位移都该跟着变 |
| T-244 | ⑤ | （非变异，是实现期被测试逼出来的一个缺口）一条 `/nodes/{i}/transform` patch 把文档值原样写回对象之后 | 卡面说「下一帧自动补回」（D29 逐字） | 非变异 · **补不回来**：账本还记着一份偏移，下一帧 `delta = wanted − previous = 0`，零件停在未爆炸的位置。**爆炸塌了，而没有任何报错** | — | 新增 `forgetApplied(nodeId)`，由 `apply-patch` 的 `case 'transform'` 调用。**按节点清、不整片清**：没被覆盖的成员仍停在「base + 偏移」上，账本一起清会让下一帧再叠一次、位置翻倍——为此另加了一条断言压住 |
| T-244 | ⑥ | （非变异，是卡面漏项的实测）卡面独占栏只列两个新文件 | —— | 非变异 · 实际还要改 `scene-runtime.ts`（构造装配 / tick / resetScene / dispose / setExplode 接缝）、`apply-patch.ts`（两个钩子）、`renderer-injection.test.ts`（接缝表 7 → 6） | — | 照做并在提交信息里逐项点名。`setExplode` 这条接缝的 owner 在代码、接缝表、豁免表里都写着 T-244，而卡面三栏一字未提 |
| T-245 | ① | headless 的 `getNodeProp('positionY')` 改回只读文档（去掉爆炸偏移） | 「两侧 positionY 相等」必须红 | 红 · 2 条 | — | 还原。**卡面提醒的假绿是真的**：这条要在爆炸**完成之后**读，而且要用一个位移非零的成员——契约文档里成员 2 的锚点恰在质心上，位移为零，拿它做主断言的话这条变异是绿的。主断言因此用成员 3 |
| T-245 | ② | 删掉 headless `resetScene` 里的 `explodeFactors.clear()` | 红 | 红 · 1 条 | — | 还原 |
| T-245 | ③ | （非变异，是契约套件的一处硬缺口）「两侧 error 日志措辞相同」 | 应当能比 | 非变异 · **观测不到**：`ContractHarness` 没有日志读取器，而 scene-runtime 那一侧的 harness 构造时根本不传 `onLog` | — | 给 harness 加 `logs()` 这条缝（与 `lightOf` / `events` 同一条理由），scene-runtime 的 harness 补上 `onLog`。两侧的措辞现在逐字比对 |
| T-245 | ④ | （非变异，是 fixture 的判别力实测）契约套件今天的三份文档 | 应当能测出爆炸位移 | 非变异 · **一份都不行**：三份里没有任何爆炸分组，而黄金路径三个节点的 `transform.p` 全是 `[0,0,0]`——radial 位移是 `(锚点 − 质心) × gain`，锚点全重合时**恒为零**，「两侧逐位相等」会退化成 `0 === 0` | — | 新建 `explodeDocument()`，三个成员锚点分别是 y=0/1/2。fixture 的注释里写死了这个理由，免得日后有人「顺手」把它们对齐 |
| T-245 | ⑤ | （非变异，是卡面一句不属实的话）卡面写「`engine.ts` 一行不改（ADR-0018 的**第一次**实战检验）」 | —— | 非变异 · **不是第一次**：T-240 已经在 `RuntimeContext` 上加了 `highlightOf` 且没碰 `engine.ts` | — | 验收照做（`git diff --stat packages/core/src/eca/engine.ts` 实测为空），但如实记下它是第二次。写错的是卡面的动机描述，不是验收本身 |
| T-245 | ⑥ | （非变异，是一条已知未闭合的分叉）headless 的 positionY 只补了爆炸这一半 | —— | 非变异 · **补间那一半照旧分叉**：SceneRuntime 读活的 `object.position.y`，headless 读 `node.transform.p[1]` + 爆炸偏移，而 headless 没有补间采样值。parity 脚本里也没有「tween 之后读 positionY」的步骤 | — | 登记进 IMPL_NOTES §3，不假装闭合。爆炸这一半必须补是因为爆炸大规模移动 transform，会天天踩响；补间那一半要等 parity 脚本先有那个步骤（T-294） |
| T-246 | ① | 删掉 `await:false` 那一支的 `void done.catch(() => undefined)` | 未处理拒绝那条红 | 红 · 1 条 | — | 还原。那条测试装一个 `process.on('unhandledRejection')` 探针——少了 catch，一次中断在浏览器里是一条用户会当成 bug 报上来的控制台错误 |
| T-246 | ② | 从 `refs()` 里拿掉 `expectType: 'explodeGroup'` | T-226 的生产解析器那条 integrity 必须红 | 绿→红 · **按卡面指的那条测（`action-refs-gate`）是绿的**：它用的是保证不存在的 id，而 `requireType` 在 id 解析不出来时**直接静默返回**，`expectType` 从头到尾没参与 | b | 新写一条：目标**存在、但类型不对**（分组的成员，不是分组本身）→ 断 `checkIntegrity` 报出恰好一条 I14 且措辞含 explodeGroup。改完这条变异红 2 条 |
| T-246 | ③ | （非变异，是卡面两处路径错误的实测）独占栏点名 `packages/core/src/eca/actions/scene.test.ts` | 应当是测试落点 | 非变异 · **那个路径在本仓根本不会被执行**：core 的 vitest 只收 `test/**`。按卡面字面新建 = 写完的测试永远不跑，而 `pnpm -F @w3/core test eca` 照样全绿。同一条错路径 **T-215 已经静默踩过一次**（它的独占栏写的也是这个，而该文件至今不存在） | — | 测试落在 `packages/core/test/eca/actions.test.ts`。另：卡面漏了 `registry.test.ts` 的期望清单与 `capability-entries.ts` 的入口行，两处都会当场红 |
| T-246 | ④ | （非变异，是规划的一处编号错误）规划 §4.2 把 `expectType` 违规记成 `I28` | —— | 非变异 · 实现里是 **I14**（`integrity.ts` 的 `requireType('I14', …)`）。按 `code === 'I28'` 过滤会永远筛到零条，写成 `toHaveLength(0)` 就是又一条假绿 | — | 测试按 I14 写。规划那处编号的订正归 SPEC 回写（T-296），本卡不改规划 |
| T-246 | ⑤ | （非变异，是执行期与编辑期的一处语义差）`expectType` 在**执行期**做什么 | 卡面说是「前置检查」 | 非变异 · 执行期**空转**：`REF_KINDS.node` 没有 `expectTypeOf` 钩子，`refTypeOk` 在钩子缺席时无条件返回 true，B9 不会因为「目标不是爆炸分组」跳步 | — | 所以 B9 的跳步由**运行时自己**报（两侧措辞在契约套件里逐字比对，T-245），`expectType` 只在编辑期/发布期的 `checkIntegrity` 上有用。这一层差别写进了动作的 JSDoc |
| T-246 | ⑥ | （非变异，是被一条缩放测试引出来的自查）编辑器 `tree-search` 的「1000 → 2000 节点近似线性」一度报 3.09（门槛 3） | —— | 非变异 · 那条测试与本卡无关（它测 `flattenTree`），事后 3 次连跑全绿，**判为负载噪声**；但顺着查下去发现 **T-243 自己的 `SectionLayer.sync` 是 O(n) per patch**，一次「整份 nodes 被替换」的提交带 n 条补丁 → O(n²) | — | 按文档对象身份缓存「这份文档里有没有剖切面」，没有剖切面且当前也没挂平面时直接返回。绝大多数文档走这一条。**缺陷是真的，红是假的**，两件事分开记 |
| T-250 | ① | `isClipped` 恒 false（把距离判断整行去掉） | 「命中球」红 | 红 · 5 条 | — | 还原 |
| T-250 | ② | 容差 `-1e-6` 改成 `0` | 需要一条「命中点恰好落在平面上」的测试才抓得到 | 红 · 1 条，**但不是靠卡面说的那个样本** | — | 还原。⚠ **卡面给的样本规格杀不掉这条变异**：「恰好落在平面上」即 d===0，而 `d < -1e-6` 与 `d < 0` 在 d===0 上同为 false，两版判据逐字一致。真正能区分的样本是 **d 严格落在 (−1e-6, 0) 之间**——把平面常数往前挪 1e-9（正是浮点求交在切口上会产生的那种误差）。三条样本都写了：容差内、明显负侧、恰好为零，最后一条**如实标注它杀不掉变异**，免得下一个人再推一遍 |
| T-250 | ③ | （非变异，是拾取与渲染两侧数据来源的裁决）平面从哪来 | —— | 非变异 · 各自算一份的话，两边在浮点最后一位上分家，症状是「切口边缘点得中、点不中随机」 | — | `SceneRuntime.syncSections` 把 `sections.livePlanes` **同一个数组**推给 picker。这也让 `setClipPlanes` 当场有了生产调用者，不必进豁免表 |
| T-247 | ① | 「设为爆炸分组」的 `onClick` 改成 `() => {}` | UI 入口测试必须红 | 红 · 2 条 | — | 还原。这是新纪律 4 的直接防线：`explode-edit.ts` 的四个 mutator 各自都能被纯函数测试压住，而**按钮有没有接上它们**只有渲染出来点一下才知道。范式见 [ADR-0038](adr/0038-编辑器-ui-事件入口的测试范式.md) |
| T-247 | ② | （非变异，是 jsdom 范式的第三处桩）第一版用 `FocusEvent('blur')` 触发 `NumberField` 的提交 | 应当提交 | 非变异 · **什么都没发生**：React 17 起 `onBlur` 委托在 `focusout` 上（`blur` 不冒泡），测试红在一个与被测行为无关的地方 | — | 改派 `focusout`。这是 ADR-0038「桩超过五处要重新评估」计数里的**第三处**（前两处是 PointerEvent 与指针捕获），写进了那条测试的注释 |
| T-247 | ③ | （非变异，是默认值真源的一次收敛）「设为爆炸分组」写哪一份默认配置 | —— | 非变异 · 面板另抄一份的话，schema 改了默认值而面板不跟，两处各说各的（T-215 的高亮预设正是这么漂的） | — | 新增 `DEFAULT_EXPLODE = ExplodeSchema.parse({})`——**由 zod 自己解析空对象得出**，不是手抄。测试逐字断了那五个默认值 |
| T-247 | ④ | （非变异，是卡面漏项）豁免表里 `EXPLODE_MODE_LABELS` 那一行 | —— | 非变异 · 本卡一 import 它，那行就变陈旧记录，`check:constitution` 当场 FAIL——而 `DEAD_EXPORTS_ALLOWLIST.md` 不在卡面独占栏里 | — | 删掉该行（它在 ADR-0033 的冻结接口表里，四列表条数不变）。顺带记下：那行的 owner 从头就写错成 T-244，而 T-244 是 core 算偏移的卡、没有任何 UI |
| T-247 | ⑤ | （非变异，是一处刻意的范围收窄）爆炸分区在多选时显示吗 | 卡面没说 | 非变异 · 显示的话，「改一个参数写给所有选中的分组」在语义上说不通——每组的成员完全不同，一个 gain 对 A 组是散开一倍、对 B 组可能是散开十倍 | — | 只在单选时出现，并补一条断言。与面板其余部分的 MIXED 语义不同，因此值得记一笔 |
| T-248 | ① | （**按 2026-08-05 拍板改写**）原文是「去掉 gizmo attach 条件里那一项」，而拍板取消了那一项。改测滑块自己：把 `explode-tool-factor` 的 `onChange` 改成空操作 | UI 入口红 | 绿→红 · **第一版全绿**：那条测试先选分组、再拉滑块，而**选分组时 factor 已被设成 1**，位置在那一刻就变了——滑块那一下盖不住 | b | 拆成两条：一条测「选分组即到 1」，另一条**从已经在 1 出发只拉滑块**，断位置再次变化。改完这条变异红 1 条。这是「两个动作写在一条断言里，前一个把后一个盖住」的形状 |
| T-248 | ② | `closeExplodeTool` 改成只清 store、不通知运行时 | 对应红。**断言必须读渲染器位置**——读 store 布尔量的话这条变异是绿的 | 红 · 2 条 | — | 还原。卡面点名的假绿是真的：本文件每一条都读 `graph.objectFor(id).position`。只清 store 的实现会让零件停在炸开的位置而工具条已经不见了，用户既看不出为什么、也没有入口收回去 |
| T-248 | ③ | `transformLocked` 恒为 false（属性面板不再只读） | 只读断言红 | 红 · 1 条 | — | 还原。这是拍板后**唯一保留**的那一项互锁：它防的是「用户在爆炸态下误改真实 transform」——画面上零件在一米外，面板里的数字却是文档值，此时改一个数改的是原位 |
| T-248 | ④ | （非变异，是卡面一处自相矛盾的裁决）关闭时机 | —— | 非变异 · 「做」栏写**退出**预览时关闭，「验收」与变异 ② 写**进入**预览时关闭，两者方向相反 | — | 以验收为准：爆炸工具态是编辑态工具，**进**预览必须关掉，否则预览里看到的是播放器不会有的姿态（播放器只认规则驱动的 explode），正是 C3 说的分叉 |
| T-248 | ⑤ | （非变异，是一条被卡面点名的对称性假绿）验收「断言该件的 `transform.p` 一字未变」 | —— | 非变异 · 爆炸偏移按 D29 本来就**只写渲染器、从不写文档**，所以这句话在爆炸功能整个没实现、甚至 `setExplode` 从未被调用时同样成立 | — | 保留它，但**与「渲染器位置确实变了」写在同一条测试里**。单独留着就是一句什么都不测的话 |
| T-248 | ⑥ | （非变异，是 node 环境让一条断言恒真的实测）「不进 localStorage」 | —— | 非变异 · 仓库里同形的先例 `snap.test.ts` 写的是 `Object.keys(globalThis.localStorage ?? {})`，而**编辑器测试跑在 node 环境，`globalThis.localStorage` 恒为 undefined**，`?? {}` 让它恒真 | — | 本卡的测试跑在 jsdom 里（ADR-0038），那里有真的 `localStorage`。测试第一句就断 `expect(globalThis.localStorage).toBeDefined()`——**先证明这条断言有对象可断**，再断它是空的。另配一条剥掉注释后的源码扫描 |
| T-249 | ① | 删掉 `recordExplodeOffset` 里的「除以 factor」 | 在 `factor=0.5` 记录再拉到 1 的那条必须红 | 红 · 1 条 | — | 还原。**卡面点名的前提是真的**：在 factor=1 记录时两版实现给出同一个结果，那条变异是绿的——所以专门写了一条 factor=0.5 的样本，并在同一条里反向断言「没除的话它等于观测位移本身」 |
| T-249 | ② | 去掉 mutator 里的 `factor <= 0` 兜底 | 第二道防线红 | 红 · 1 条（0 / −1 / NaN / Infinity 四个值逐个断） | — | 还原。面板禁用是第一道，mutator 自己是第二道：一个 NaN 写进文档之后就传染开了，而它的表现是**整个分组从画面消失、没有报错也没有日志**（explode-math.ts 的 normalizeAxis 注释里已经写下过这个形状） |
| T-249 | ③ | `canRecordOffset` 去掉 `factor > 0` 那一项 | 面板那道防线红 | 红 · 1 条 | — | 还原 |
| T-249 | ④ | （非变异，是卡面验收与变异互相对不上的裁决）「记录后归零再拉回 1，该件回到刚才那个位置」 | —— | 非变异 · **这句只在 factor=1 记录时成立**。变异要求用 factor ≠ 1，而那时存的是 factor=1 的位移（= 观测/factor），拉到 1 时该件落在观测位置的 1/factor 倍处 | — | 两条都写：factor=1 那条对应验收的字面，factor=0.5 那条对应变异，各自把几何关系写在断言旁边。**两条缺一都会让另一半失去意义** |
| T-249 | ⑤ | （非变异，是一处按 T-249 语义补的边界）在 A 组的预览下点开 B 组的零件 | 卡面没说 | 非变异 · 观测位移是 0（B 组没被炸开），记下去就是一条把该件钉死在原位的偏移，**而用户以为自己什么都没做** | — | 记录按钮加第二个条件「正在预览的就是这一组」，并给出对应的中文提示。偏移分区本身**不随工具态出现/消失**——让用户看得见能力存在并读到为什么用不了，比一个凭空闪现的分区好 |
| T-251 | ① | 「新建剖切平面」的 `onClick` 改成空操作 | UI 入口红 | 红 · 2 条 | — | 还原 |
| T-251 | ② | 删掉 helper 的 1mm 法线偏移 | 对应红 | 红 · 3 条（偏移本身 / 带旋转时的偏移 / 重建后的位置） | — | 还原。不偏的话箭头与矩形恰好落在自己的裁剪面上，被切掉一半，画面上是一条闪烁的锯齿 |
| T-251 | ③ | `sync` 里去掉「对象身份变了也要重建」那一项 | M9 同形回归红 | 红 · 1 条 | — | 还原。**这条是本卡最值钱的一条**：three 的辅助物持有对象引用，图重建换掉那个对象之后辅助物静默冻结——继续画在它曾经在的地方。`light-helpers.test.ts` 的注释里写着那条缺陷当年就是这么活下来的 |
| T-251 | ④ | 「暂时关闭剖切」改成只清会话 store、不通知运行时 | `clippingPlanes` 空 **且** picker 恢复，两条都红 | 红 · 2 条 | — | 还原。picker 那条能红，是因为 T-250 把 `sections.livePlanes` **同一个数组**推给了 picker——两件事必须一起变 |
| T-251 | ⑤ | （非变异，是实现期被测试抓到的一个真缺陷）`addSectionPlane` 调 `appendNode` 之后 | 应当多一个节点 | 非变异 · **节点没进文档**：`appendNode` 只**造**节点、不挂（`addLight` 是 `createLightNode(...)` + `draft.nodes.push(node)` 两步）。表现是「点了新建、撤销栈 +1、层级树里什么都没多」——**一次成功的空提交** | — | 补上 `draft.nodes.push(node)`。测试第一条断的是节点数前后对比，不是 `not.toBeNull()`，所以当场抓到 |
| T-251 | ⑥ | （非变异，是卡面三处与仓库不符的实测）「新建入口与『新建灯光』同位置，落在 `HierarchyTree.tsx`」 | —— | 非变异 · **「新建灯光」根本不在层级树里**，它在资源库面板的模板格子；层级树全文没有任何创建入口。另两处：`editorAux` 这个符号全仓零命中（今天的挂载点是 `registerChrome(layer.root)`）；独占栏没有 `scene-runtime.ts` 与 `App.tsx`，而两者都必改 | — | 新建入口放进新建的 `SectionPanel`（与「场景效果」并列）：一把刀不是「资源」，它没有可挑的模板。三处偏差在提交信息里点名 |
| T-251 | ⑦ | （非变异，是「暂时关闭剖切」与 T-243 成本论证的正面冲突）它不进文档，因此不能走 commit 改 `node.visible` | —— | 非变异 · T-243 的整个成本论证建立在「启停复用 `node.visible`、零新增 API」上，而这个开关必须是一个新的 core 运行时 API | — | 写 [ADR-0040](adr/0040-暂时关闭剖切是渲染开关不是文档编辑.md)：加 `setSectionsEnabled(boolean \| null)`，形状逐字抄 `setPostFxEnabled`。ADR 里把「T-243 说的是启停、这里加的是『我先看看原样』」这条区别写成了一张四行对照表 |
| T-251 | ⑧ | （非变异，是一次改错了地方）给 `CreateNodeOptions` 补 v3 的四个承载体字段 | 应当是缺的 | 非变异 · **它们本来就在**（`factory.ts:89-96`），补上去变成重复声明，schema typecheck 16 处红 | — | 整段撤销。教训：动一份 300 行的接口前先读完它，别只 grep 一个字段名 |
| T-253 | ① | 把 `if (p.restart)` 改成恒真（连同新加的跳过分支一起去掉，即「restart 参数完全失效」） | 新测试红 | 红 · 3 条（进度被清零 / debug 日志 / await 不再立即结束） | — | 还原 |
| T-253 | ② | **对照组**：同一变异下，那条叫「restarts by default, and can be told not to」的旧测试（`actions.test.ts`） | 卡面预言它是绿的 | 绿 · **确实是绿的** | c | 保留它并在它上方写明它是反面教材：名字说测了两件事，实际只传了 `restart: true`，而且只断「还在播」——重播之后它也还在播。**这是 v0.5 教训 (a) 最好的现成实例**，删掉比留着损失大 |
| T-253 | ③ | （非变异，是断言量的一次改选）「开始时刻未变」用什么观测 | 卡面说断 `timeOf` | 非变异 · headless 的 `timeOf` **不跟踪飞行中的进度**（只在结束 / reset / seek 三处写），飞行中读恒为 0 | — | 先 `seekAnimation` 把播放头放到 0.4，再看第二次 play 有没有抹掉它——`restart:true` 走的 `stopAnimation({reset:true})` 正是会抹掉它的那一步。另配一条反向对照（restart:true 确实清零），否则上一条对「timeOf 永远返回 0.4」的实现同样成立 |
| T-253 | ④ | （非变异，是新语义带出来的一条边界）`restart:false` 且**没在播** | 卡面没说 | 非变异 · 不补的话，一个「restart:false 就永远不播」的实现在主断言下同样绿 | — | 补一条：没在播时照常起播。跳过只在「已经在播」时发生 |
| T-254 | ① | 「新建 imported」的 commit 改成空操作 | **数量前后对比断言**红（不许用 `.first()` 或 `not.toBeNull()`） | 红 · 3 条 | — | 还原。断言写的是 `importedOf(store).length === before + 1`——v0.5 的 T-115 与 E18 各在那两种写法上栽过一次 |
| T-254 | ② | `previewAnimation` 里的 `runtime.playAnimation` 改成空操作 | 「对象动起来」红 | 红 · 1 条 | — | 还原 |
| T-254 | ③ | （非变异，是 harness 能力的一次改选）预览那条用 imported 行测 | 应当播得起来 | 非变异 · **播不起来**：imported 片段要资产字节真的加载完，而这个 harness 不加载资产（那是 loader 的测试） | — | 改用**补间**那一行测。预览按钮在每一行上都是同一个 `previewAnimation`，所以补间那一行同样压得住这条线，而且不必把 GLB 字节拖进编辑器测试 |
| T-254 | ④ | （非变异，是一处 fixture 的隐藏前提）「资产里一段动画都没有时整块不出现」 | 用黄金路径就能测 | 非变异 · **黄金路径那份资产自带一段 `Disassemble`**，不清空的话这条断言恒红 | — | 显式造一份 `animations: []` 的资产。前提写在注释里 |
| T-254 | ⑤ | （非变异，是一次 tsc 与 esbuild 的分歧）新写的 `{cond && (<div/>)}` 上方带一条**跨两行的 JSX 注释** | 应当能编译 | 非变异 · **vitest（esbuild）过，`tsc` 报 TS1128 且指向文件最后一行**。逐块二分了六轮才定位——错误位置与真正的成因相距 170 行 | — | 改成 `{cond ? (<div/>) : null}` 并把说明移到组件的 JSDoc 里。**教训：JSX 里少用跨行注释**；以及「测试绿了」不等于「typecheck 绿了」，两者用的不是同一个解析器 |
| T-254 | ⑥ | （非变异，是断链兑现的机械证据）`schema:createImportedAnimation` 在遗留基线上 | —— | 非变异 · 接上生产调用者后它变成陈旧记录，守卫要求删行并调低 `MAX_LEGACY` | — | 删行，87 → 86。**这是本卡「断链兑现」唯一的机械证据**：一个躺了两个版本的零调用者导出，今天真的被用户点得到了 |
| T-254 | ⑦ | （非变异，是 CI 抓到的一次真回归）新加的动画行按钮叫「预览」 | —— | 非变异 · **黄金路径 II 第 ⑪ 步当场红了**：那一步用 `getByRole('button', { name: '预览', exact: true })` 点的是工具栏上**预览模式**的开关，而本卡给每一行动画也加了一个同名按钮 —— 点错人，预览模式没进去，「规则应当把音频播起来」为 false | — | 改名「试放」/「停止试放」。**用户读起来也分不清**「预览这条动画」与「进入预览模式」，所以这不只是为了让 E2E 过。⚠ 教训：加按钮前先 grep 一遍 E2E 里按名字找的选择器 |
| T-255 | ① | `retainOnly` 改成空实现 | `has(b) === false` 红 | 红 · 4 条 | — | 还原 |
| T-255 | ② | `retainOnly` 改成「全清」（去掉 `if (assetIds.has(assetId)) continue`） | `has(a) === true` 红 | 红 · 4 条 | — | 还原。**卡面点名的那条前提是真的**：只测一个方向的话，「全清」是绿的——而它会把用户正在编辑的那份文档的几何体也一起扔掉 |
| T-255 | ③ | （非变异，是测试写法的一次订正）给每个网格装 dispose 探针 | 应当每个都被调用 | 非变异 · **有几个探针永远不会被调用**：glTF 里多个网格共用一份几何体是常态（本 fixture 就是），逐网格装的话后一个覆盖前一个 | — | 按几何体对象去重再装。这是一条与被测行为无关的红，不改的话会被当成产品缺陷去查 |
| T-256 | ① | `retainOnly` 的释放循环改成空操作 | 「再对 B 建 clone 后 cloneCount === 1」会变成 2，必须红 | 绿→红 · **第一版那条是绿的**：文档 B 沿用了同一套 nodeId，而 `ownedFor` 按 nodeId 覆盖旧条目，数字停在 1 | b | 文档 B 换一整套 id（换文档时真正会发生的事）。改完这条变异红 4 条。**这正是卡面要防的假绿**，只是成因藏在 `ownedFor` 的覆盖语义里 |
| T-256 | ② | （非变异，是一处顺带补的清理）`sources` 要不要一起删 | 卡面只说了 `owned` | 非变异 · 不删的话，一个 nodeId 在新文档里被复用时 `revert` 会把**上一份文档某个 mesh 的材质**赋给新 mesh —— `noteMesh` 的注释里那句 "silent cross-wire" 说的正是这件事 | — | 一起删，并补一条断言 |
| T-256 | ③ | （非变异，是 dead-exports 闸门的一处结构性失明）两个新方法都叫 `retainOnly` | 应当被判为孤儿（消费者在 v1.5 的 T-429） | 非变异 · **闸门看不见**：成员扫描是跨包全文正则，而 `TextureCache` 内部早就有一句 `this.retainOnly(wanted, doc)`，任意一处同名属性访问就算「有调用者」 | — | 如实登记，不为了让它可见而改名。这与 T-246 记过的 `explode` 同形，是同一处失明的第二个实例——**闸门对「新加的成员恰好与既有成员同名」一律失明** |
| T-262 | ① | `MAX_EXPORT_SCALE` 4 → 999 | 钳位必须红 | 红 · 1 条 | — | 还原。⚠ **它是靠 notice 转红的，不是靠数字**：direct 模式下 `maxScaleFor` 也是 4，倍率结果一模一样，变的是那句中文从「导出倍率上限为 4×」换成了「叠加了描边等画面效果时…」。两把尺子今天同值，**只断数字的话这条变异是绿的**——这正是卡面 ② 要求「每条钳位都断 notice」的机器价值 |
| T-262 | ② | 删掉全部 `notice` 赋值（`notices.push` 改成空操作） | 「钳位必有说明」红 | 红 · 8 条 | — | 还原。8 条里有 5 条是钳位矩阵、1 条是「每条 notice 都带数字」、1 条是像素比用例、1 条是透明背景降级的那句逐字中文 |
| T-262 | ③ | 纵横比里 `vh` 换 `vw`（高按宽算） | 红 | 红 · 6 条 | — | 还原。两条性质测试各红一条（倍率路径 / 长边路径），说明它们走的确实是两条分支 |
| T-262 | ④ | jpeg × transparent 的拒绝改成 `console.warn` 后放行 | 拒绝矩阵红 | 红 · 2 条 | — | 还原。第二条是「拒绝就是拒绝，不返回一份尺寸为 0 的计划」——它防的是把拒绝退化成 `{ ok: true, width: 0 }` |
| T-262 | ⑤ | 把 `limits.pixelRatio` 从 `captureDevicePixels` 与 `maxCaptureScale` 两处公式里删掉 | 那两条 `pixelRatio: 2` 用例必须红 | 红 · 恰好 2 条，且就是那两条 | — | 还原。**其余 26 条全绿**——桩 limits 一律 1×，这就是 X-17 说的「在真实 2× 屏上才炸」的机器形状 |
| T-262 | ⑥ | （非变异，是一处被遮蔽的钳位）为什么倍率用例都用 960×540 的视口 | —— | 非变异 · **在 1920 的视口上 4× 根本到不了**：3840 的长边硬上限先咬住，钳位 ① 与钳位 ④ 同时触发，谁也证明不了谁。第一版按 1920 写，4 条断言全错，错的是断言不是产品 | — | 倍率类用例改用 960×540（× 4 = 3840 恰好卡在合同上限）。**这条要传给 T-267**：对话框若原样列 1×/2×/3×/4×，在常见分辨率下有两个档位是够不着的（已记进 ADR-0041 代价 2） |
| T-262 | ⑦ | （非变异，是闸门失明的第三个实例）`CapturePlan` 的九个字段只有 `notice` / `droppedOutline` 被判孤儿 | 九个都该判 | 非变异 · 另外七个（`width` `height` `scale` `format` …）的名字在包内别处有属性访问，成员扫描是跨包全文正则，同名即算「有调用者」 | — | 如实登记。与 T-246 的 `explode`、T-256 的 `retainOnly` 同形，**第三次记同一处失明**：闸门对「新成员与既有成员同名」一律失明 |
| T-262 | ⑧ | （非变异，是 T-255 遗留的一处真 TS 错，本卡跑 `pnpm -r typecheck` 时才暴露） | —— | 非变异 · `loader.test.ts` 的 声明成「函数或 null」的那个 `release` 在 `release?.()` 处被窄化成 `null`，TS2349。**T-255 / T-256 当时只跑了 `pnpm -F @w3/core test`，没跑 typecheck**——DoD 漏了一条 | — | 初值改成空函数。教训与 T-252 那次同类：自测绿 ≠ DoD 绿 |
| T-258 | ① | `reparentPreservingWorld` 改成「原样返回旧 transform」 | E2E 的「位置不变」必须红 | 红 · E2E ① ② 两条。①**恰好红在卡面点名的那一条上**：`screenPointOf` 返回 null —— 球体被旧的局部坐标弹到视锥外面去了 | — | 还原。⚠ **第一版红错了地方**：断言顺序是「parent 变了 → transform 变了 → 位置不变」，变异先撞上 transform 那条，位置断言一次都没跑到。报告里看到的是红，但红的不是卡面要的那条，等于没验。**把位置断言提到最前面**才算数 |
| T-258 | ② | `sheared` 恒 false | 对应红 | 红 · 3 条：schema 单测「非均匀缩放的父 + 有旋转的子 → sheared === true」、editor 单测「reparentNotice 给中文提示」、E2E ② | — | 还原。E2E ① ③ 保持绿，说明这条变异只动了提示这一路，没有误伤位姿保持 |
| T-258 | ③ | （非变异，是 E2E 场景挑错了一次，**而错的是场景不是产品**）第一版把分组的缩放改成 (2, 0.5, 2) 期待剪切 | 提示应当出现 | 非变异 · **一点剪切都没有，提示正确地没出现**：分组绕 Y 转 35°，而绕 Y 的旋转只搅动 X 与 Z 两轴——X = Z = 2 时那一层在 XZ 平面上仍然是相似变换 | — | 改成 (2, 2, 0.5)，让非均匀落在旋转搅得动的轴上。**这类红最危险**：顺手把断言从 `toBeVisible` 削成 `toBeAttached` 就"过"了，而产品其实一直是对的 |
| T-258 | ④ | （非变异，是测试写法的一处订正）E2E ② 里第二次点「立方体」那一行 | 应当选中它、属性面板出现 | 非变异 · **取消选中**：`toggleSelection(id, additive=false)` 对「当前唯一选中的就是它」这一情形是取消。属性面板整个空掉，`setAxis` 找不到输入框，挂到 120 秒超时 | — | 删掉那次点击（`buildScene` 出来时本来就是选中的）。**这是 UI 语义，不是缺陷**，但它会把 E2E 作者坑住 |
| T-258 | ⑤ | （非变异，是 `applyDropPlan` 的一处承重约束）能不能让它返回剪切信息 | —— | 非变异 · **不能**：调用点把它直接当 immer recipe（`commit(desc, draft => applyDropPlan(draft, plan))`），而一个既改了 draft 又返回非 undefined 的 recipe 会让 immer **抛异常** | — | 保持返回 `void`，剪切提示走单独的 `reparentNotice`。多算一遍矩阵，一次拖拽几百次浮点运算，不是每帧 |
| T-258 | ⑥ | （非变异，是卡面要求的顺带登记，**不在本卡范围**）gizmo 多选拖拽 | —— | 非变异 · 确认属实：多选拖拽**不应用旋转 delta**（只加 position、乘 scale），而 UI 上旋转模式按钮是可用的——用户转得动，东西不转 | — | 如实登记，本卡不修。已在台账 T-258 卡面标注 |
| T-257 | ① | 删掉资产的引用前置检查（`if (referenceCount > 0)` → `if (false)`） | 「被引用时被拒」红 | 红 · 2 条 | — | 还原。第二条是「引用消失之后同一个 id 从不能删变成能删」——它守的是**重新推导而不是拍快照**这条纪律 |
| T-257 | ② | 删材质后不回落到默认材质 | `checkIntegrity` 那条红 | 红 · 1 条，且**恰好红在 `checkIntegrity` 上**（三条悬空 materialId）| — | 还原。⚠ 卡面点名的前提是真的：同一条测试里「材质少了一条」那句断言在变异下**仍然是绿的**，只有完整性检查抓得到 |
| T-257 | ③ | （非变异，是本卡抓到的一处**死分支 + 误导文案**）删一个分组时的问句 | 应当说「将同时删除 N 个子对象」 | 非变异 · **那一支永远走不到**：每个子节点都通过 `parent` 指着父节点，所以 `describeReferences` 把它们全数进「引用者」，三元的第一支恒真。用户删一个 20 零件的分组，看到的是「被 20 个对象引用，删除后这些引用会失效」——读起来像外部依赖要断，而那 20 个正跟着一起被删 | — | 给 `describeReferences` 加一个可选的 `exclude` 集合，把子树内的引用剔掉；两句话在都成立时都说。**这处改动落在 `@w3/schema`，不在本卡独占清单里**——是一个向后兼容的可选参数，不传时行为逐字不变 |
| T-257 | ④ | （非变异，是一条有意的不对称）材质与资产的处置为什么相反 | —— | 非变异 · 材质被引用**照删**（回落默认材质），资产被引用**拒绝删**。判据是有没有安全落点：删完材质文档仍然完整可渲染；删掉一份还有人指的资产，节点要么变空壳、要么外观静默改变——「文档还合法、画面已经错了」 | — | 写进 `removal.ts` 文件头。下一个读的人第一反应一定是「为什么不统一」 |
| T-257 | ⑤ | （非变异，是测试前提写错了一次）「外部引用与子节点同时存在」那条用泵体做主角 | 应当两句话都出现 | 非变异 · 泵体的唯一引用方就是它的子节点阀盖，被 ③ 的排除逻辑剔掉之后外部引用为 0——**红的是测试前提，不是产品**。恰好反过来证明了 ③ 的排除是对的 | — | 改成把热点挂到泵组身上，它才真的同时具备两种情形 |
| T-259 | ① | `ImportDialog` 不传 `sourceUnit`（回到本卡之前的行为） | `scaleApplied === 0.001` 红 | 红 · 1 条，就是入口一那条 | — | 还原。**这条变异就是本卡之前的现状**：公式从 T-051 起就在，没有一个调用方传过参数 |
| T-259 | ② | `suggestUnit` 的毫米阈值 500 → 50000 | 预填红 | 红 · 1 条，就是预填那条 | — | 还原 |
| T-259 | ③ | **只接一条入口**：把 `importLibraryItem` 的两行透传删掉 | 另外两条的测试必须红 | 红 · 1 条，且**恰好只红入口二那条**——入口一与入口三仍然绿 | — | 还原。卡面点名「三条入口各写一条，不许写成一条参数化跑同一个入口」，这次变异证明了三条确实各自独立：改一条只红一条 |
| T-259 | ④ | （非变异，是一处测试退化的自我修正）入口三第一版只断了 `LIBRARY_DECLARATION` 这个常量的值 | 应当证明控制器真的把它传出去了 | 非变异 · **断常量等于什么都没断**：把 `importItem(item, LIBRARY_DECLARATION)` 改回 `importItem(item)`，那条测试照样绿 | — | 真正的接缝断言放进 `drag.test.ts`（`DropController` 的装配在那边）：`expect(importItem).toHaveBeenCalledWith(ITEM, LIBRARY_DECLARATION)`。import-flow 那条保留并注明「另一半在哪」 |
| T-259 | ⑤ | （非变异，是卡面「不解析几何」那句的落点）尺度从哪里量 | —— | 非变异 · glTF 规范**强制要求** POSITION 访问器带 min/max（播放器要靠它做视锥剔除而不必先读完顶点），所以模型尺度在 JSON chunk 里就有。新增 `suggestUnitFromHeader` 读它，几百字节而不是一次完整解码 | — | 顺带给 `GltfJson.accessors` 的类型补上 `min`（原来只有 `count` 与 `max`）。**这处改动落在 `@w3/core`，不在本卡独占清单里**——纯类型加宽 + 一个新函数，零行为变更 |
| T-260 | ① | 首列改回 `finding.metric` | 中文断言红 | 红 · 1 条 | — | 还原。断言是**正则扫首列不许有 `/^[a-z][A-Za-z]+$/` 的裸标识符** + 每个名字都要能在 `METRICS` 里找到，而不是「首列有内容」 |
| T-260 | ② | `formatMetric` 换成 `toLocaleString` | 裸数字红 | 红 · 3 条（数值列两条 + 送检/处理后那条比对 60.0 MB / 10.0 MB 的） | — | 还原。`62914560` 与 `60.0 MB` 是同一个数，但只有后者能让人判断「这算大吗」 |
| T-260 | ③ | 删掉渲染 `summary` 的那一行 | 红 | 红 · 1 条 | — | 还原。它是零调用者清单上的一条：一句话结论算得好好的，从来没人显示过 |
| T-260 | ④ | （非变异，是卡面判断的一次实证）「表格渲染出来了」在旧实现下是不是真的 | —— | 非变异 · **是真的**：旧 `ImportReport` 的表格渲染完好、行数正确、级别染色正确，而首列写着 `textureBytes`、数值写着 `62914560`、`summary` 一次都没出现。一条「报告出现在 DOM 里」的断言对这三件事全部无感 | — | 卡面点名「这三条正是最容易写成假绿的地方」，属实。所以断言全部写成「是不是那个东西」而不是「有没有」 |
| T-260 | ⑤ | （非变异，是测试写法的一次订正）Markdown 里管道符转义那条断言 | 按竖线切开那句断言 应当切出 7 段 | 非变异 · **切出 8 段**：`String.split` 不认反斜杠转义，转义是给 Markdown 渲染器看的，不是给 JS 看的 | — | 改断转义序列本身，外加「未转义的竖线恰好等于列分隔符个数」的负向正则 |
| T-261 | ① | `regrade` 里偷偷把重算结果写回 `stored.findings` | 「未变」红 | 红 · 4 条 | — | 还原。断言是**调用前后 `JSON.stringify` 比对**，不是逐字段——逐字段可以被一个「只改了 findings[2]」的实现绕过 |
| T-261 | ② | 两句结论共用同一个 policy（`storedVerdict = current.verdict`） | 「重算结论变」红 | 红 · 3 条 | — | 还原。存着的那份结论是**收检当天的事实**，是合同口径的一部分；今天阈值变严了不能倒过来改写历史 |
| T-261 | ③ | （守卫自己的变异，卡面要求逐条记进提交信息）把 `DEFAULT_POLICY.maxBytes` 临时改成 61 MB | `check:constitution` 必须红且指出附件A 第几行 | 红 · 2 处，逐行点名「附件A:60 maxBytes 写的是 60 MB（= 62914560），而 DEFAULT_POLICY 是 63963136」+ 黄灯不等于上限 × 0.8 | — | 验后还原 |
| T-261 | ④ | （守卫自己的变异）临时加一条 METRICS 而不写进附件A | 也必须红 | **绿→红** · 第一版是**绿的** | b | 第一版规则 2 按**策略键**核对，而那条探针指标复用了 `p.maxNodes`——键已被覆盖，整条溜过去。改成按**指标 id** 核对，并在附件A 的来源列加「指标 `x`」锚点。改完这条变异红，报错逐字点名「METRICS 有「临时探针」（指标 probeMetric），附件A §2 没有对应的行」 |
| T-261 | ⑤ | （非变异，是新守卫**当场抓到的一处真漂移**）附件A §2 少一行 | —— | 非变异 · `imageSize`（图片最大边长）在 `METRICS` 里有、在附件A 里没有。独立贴图 / 环境贴图走的是它自己的指标，而附件A 那张表只有模型档的 `maxTextureSize` | — | 补上「图片最大边长（独立贴图 / 环境贴图）」一行。**守卫写完第一次运行就抓到了它**，这正是这条卡存在的理由 |
| T-261 | ⑥ | （非变异，是废弃格式扫描的两次误报）规则 5 的扩展名匹配 | 应当只命中散文里的格式名 | 非变异 · 两次误报：第一版无边界，`.max` 命中了 `DEFAULT_POLICY.maxTextureBytes`；补上左边界后又命中了 zod 的 `.max(120)` | — | 两侧边界 + 右侧排除左括号（扩展名后面不会跟一个左括号，方法调用才会） |
| T-261 | ⑦ | （非变异，是一处工程取舍）守卫为什么读 TS 源码而不是 `import` 那两个常量 | —— | 非变异 · 它挂在 `pnpm check:constitution` 上，而那条命令**不保证 dist 已构建**。从 `packages/core/dist` 引入会让守卫在干净检出上直接崩掉——**一条崩掉的守卫和一条不存在的守卫是同一件事** | — | 正则抽 TS 源码，并且抽不到就报错（扫描面下限：策略上限 ≥ 8 项 · METRICS ≥ 10 条 · 附件A 上限行 ≥ 8 行） |
| T-263 | ① | 删掉 `transparent` 判断（`mode = input.docMode`） | 第一条红 | 红 · 2 条 | — | 还原。第二条是「降级之后吃的是 direct 的 4×」——它守的是**先钳倍率还是先改 mode** 的顺序 |
| T-263 | ② | `MAX_SCALE_COMPOSED` 改 4 | 第二条红 | 红 · 2 条 | — | 还原。第二条是「用的就是 T-262 落的那两个常量」，它守的是 X-19：抄一份常量 = 把「composed 上限」写在两个地方，而它们会分叉 |
| T-263 | ③ | reason 断言写成 `not.toBeNull()` | 必须证明它对 `undefined` 也成立（E18 教训 3） | 非变异 · **确实成立**：`expect(undefined).not.toBeNull()` 通过 | — | 全部改成断具体措辞（`toBe('叠加了描边等画面效果时导出倍率上限为 2×，已按 2× 导出。')`），并对「不该有原因」的分支断 `toBe('')` |
| T-263 | ④ | 把「雾」加回文案 | 文案断言红 | 红 · 1 条 | — | 还原。P-11 拍板项：雾画在物体像素上，背景像素仍是 alpha 0，把它列进「透明背景会丢失」的清单是在描述一个不存在的限制 |
| T-263 | ⑤ | （本卡补的一条，守卡面「用公式校验不是硬编码一个数」）把 `COMPOSER_BYTES_PER_PIXEL` 48 → 60 | 显存那几条必须红 | 红 · 3 条 | — | 还原。**只断「落在 170–190 MB」的话这条变异是绿的**——但区间断言天生宽松（60 的系数恰好被区间挡住了，换成 50 就未必），所以每条都同时断 `toBe(expected(w,h,passes))`，期望值由测试自己按 ADR-0021 的两个系数算 |
| T-264 | ① | `markerLabel` 的 `?? String(ordinal + 1)` 改成 `?? ''` | DOM 编号红 | 红 · 3 条（纯函数 1 条 + DOM 2 条） | — | 还原 |
| T-264 | ② | `hotspotDrawOrder` 排序方向反过来 | 顺序红 | 红 · 1 条 | — | 还原。DOM 与 sprite **共用这一个比较器**：两边各写一个就是 C3 分叉的一种，而 parity 看不见它——两侧都「有热点」，只是叠的顺序不同 |
| T-264 | ③ | 删 `forceOcclusion` 判断 | raycast 计数红 | 红 · 1 条 | — | 还原。它防的是：出图发生在任意一帧上，而遮挡状态最多可能是 N-1 帧之前的——导出图上某个热点的明暗与用户按下按钮时看到的不一样，且不可复现 |
| T-264 | ④ | 删 `panelLayout` 翻边分支（`flipped = false`） | 边界红 | 红 · 1 条 | — | 还原 |
| T-264 | ⑤ | 编号输入框的 `onChange` 改成空操作 | UI 入口红 | 红 · 2 条 | — | 还原 |
| T-264 | ⑥ | （非变异，是本卡确认的一处死代码）`markerFor` 里 `marker.textContent = hotspot.style.marker === 'number' ? '' : ''` | —— | 非变异 · **两个分支都是空串**，number 标记从来没有显示过编号。而 `style.label` 是 v3 已冻结的字段、`markerLabel` 也已备好——三样东西各就各位，中间那一行是空的 | — | 文字改由 `update()` 每帧按 `markerGeometry` 写（序号会随文档变），`markerFor` 只建元素 |
| T-264 | ⑦ | （非变异，是与卡面的一处偏差）卡面写「jsdom 断 number 标记 textContent」 | —— | 非变异 · core 的 vitest 环境是 `environment: 'node'`（C8：引擎无显卡可测），而 `DomHotspotRenderer` 现有的那份测试（`hotspot-media.test.ts`）用的是 Node 里的 DOM 桩 | — | 沿用桩，不给 core 引入 jsdom 先例。要断的是 `textContent` 与几个 `style` 字段，桩全都记得下来。**编辑器侧的编号输入框仍然用 jsdom**（那边本来就是 jsdom 范式，ADR-0038） |
| T-264 | ⑧ | （非变异，是本卡发现的第二处「铺好路没人走」）热点面板 | —— | 非变异 · 热点的视觉表现**全仓一行 CSS 都没有**：`w3-hotspot--number` 指向一份不存在的样式表，面板 `w3-hotspot-panel` 连一行定位代码都没有。所以靠近右边界的热点，它的面板有一半在画布外 | — | `panelLayout` 接进 `update()`（那里才有 placement），标记尺寸 / 字号 / 圆角全部改由 `HOTSPOT_MARKER_SPEC` 写成内联样式 |
| T-265 | ① | `update()` 空操作 | 全部 ops 红 | 红 · 10 条 | — | 还原 |
| T-265 | ② | marker 的 `alpha` 恒 1 | 遮挡红 | 红 · 1 条 | — | 还原 |
| T-265 | ③ | `panel-text` 的 text 改成 `hotspot.id` | 逐字断言红 | 红 · 1 条 | — | 还原。**卡面点名的假绿属实**：一个「断言调用了 fillText 但不断言参数」的测试对这条变异完全无感，而导出的图上每个面板都印着一串 `hs_00000001` |
| T-265 | ④ | 删 `toneMapped: false` | 材质属性断言红 | 红 · 1 条 | — | 还原。⚠ **这条只能断材质属性，断不了像素**——卡面要求如实写在卡里，照办：overlay 画在色调映射之后，再映射一次的表现是「热点颜色与面板上选的色号对不上」，而两次都「有颜色」 |
| T-265 | ⑤ | 把过期版本号从 `CONSTITUTION-EXCEPTION` 白名单条目里删掉 → `check:constitution` 必须红 | —— | 非变异 · **本卡做不了，已挪到 T-266** | — | 那条例外注释的落点是 `scene-runtime.ts` 里的**第二处** `renderer.render(...)`，而那处代码属于 T-266（本卡独占清单里没有 scene-runtime.ts）。本卡交付的是被 overlay pass 调用的那一层，例外与它的到期守卫随调用点一起落 |
| T-265 | ⑥ | （非变异，是接口宽了一格）`Canvas2DLike.stroke` 被闸门判成孤儿 | 应当有人调 | 非变异 · **真的没人调**：规范里有 `strokeWidth`、代码里设了 `lineWidth` 与 `strokeStyle`，然后从来没 `stroke()` 过——那个字段是装饰 | — | 补上描边。闸门这次拦住的是一处「设了参数不用」，不是一个多余的导出 |
| T-265 | ⑦ | （非变异，是本卡与 ADR-0025 的一次对账）ADR 里缺一条 | —— | 非变异 · ADR-0025 已存在（卡面标「新」不准），但它没写卡面要求的那条作废与连带后果 | — | 补第 5 节：作废「热点 sprite 是场景内对象、会吃雾、进 composer」，并写明**雾对热点无效、描边对热点无效**。两条都合理（被雾糊掉的编号等于没有编号），但「合理」不等于「不用说」——用户开了雾、导出后发现热点没被雾化，第一反应一定是「导出坏了」 |
| T-265 | ⑧ | （非变异，是豁免表一次有意的上调）22 → 28 | —— | 非变异 · 六行全部 owner 是紧接着的 T-266 / T-267。sprite 层与它的消费者被卡面拆成了两张卡：本卡落栅格化与 `ops`（纯 Node 可穷举），T-266 落编排 | — | 六行都到期 v1.2。**下一张卡就该把它们全删掉，删不掉就说明拆卡拆错了** |
| T-266 | ① | 还原栈弹栈改成只还原尺寸 | 故障矩阵至少 4 条红 | 红 · **9 条** | — | 还原。八条故障注入 + 「全程顺利也回到进入前」。卡面预期「至少 4 条」，实际更多——因为矩阵是**八步 × 五项**，深度不同的路径各自都会踩到 |
| T-266 | ② | 删面板重放 | 重放断言红 | 非变异 · **本层只透传 `openPanelCount`**，真正的重放发生在 `prepareOverlay` 的宿主实现里（sprite 层由宿主注入）。编排层能断的是「这个数原样进了结果」，断到了 | — | 如实登记。用户可见的重放证据落在 T-267 的对话框上 |
| T-266 | ③ | `compose()` 挪到 `drawScene()` 之前 | 顺序断言红 | 红 · 2 条 | — | 还原。契约 K3：反过来的话热点会被这一帧的场景盖掉，而**两种顺序都「画了」** |
| T-266 | ④ | 删重入守卫 | 并发红 | 红 · 1 条 | — | 还原。两次导出交叠会让还原栈互相覆盖——后一次记的「原尺寸」是前一次改过的那个，导完画布停在谁也没要过的尺寸上 |
| T-266 | ⑤ | 删第 ③ 步（不设目标分辨率） | pending 尺寸红 | 红 · 3 条，含「`drawScene` 那一刻是目标分辨率」 | — | 还原 |
| T-266 | ⑥ | （非变异，是本卡自己踩的一个字符类陷阱）`sanitiseFilename` 的非法字符集 | 空格应当被替换 | 非变异 · **没被替换**：类写成 `[…?* -]`，结尾那个「空格 + 减号」让人以为空格在集合里。**我照着「以为」写了测试期望值，红了才发现** | — | 拆开重写，并且**决定不替换空格**（它在两个平台上都合法，替换只会让用户认不出自己起的名字）。控制字符改按码点过滤，因为写进正则会触发 `no-control-regex` |
| T-266 | ⑦ | （非变异，是与 T-265 那条预期的对账）T-265 的六行豁免「下一张卡就该全删掉」 | —— | 非变异 · **一条都没删掉**，与我上一卡写的预期不符。成因是拆卡边界与我以为的不同：sprite 层的消费者不是 `captureImage`（它只调一个注入进来的 `composeOverlay`，好让不出图的宿主不背那份对象），而是**宿主侧的接线**，属于 T-267 | — | 如实记下。另一头是好消息：`beginCapture` / `endCapture` / `planCapture` / `CapturePlan.notice` / `HotspotSpriteLayer` / `HotspotSpriteLayer.surface` / `RendererLike.setClearAlpha` **七行退休**，净 −5（28 → 23）|
| T-266 | ⑧ | （非变异，是闸门的一处真实盲区）`CaptureRunOptions.request` / `.surface` 被判孤儿 | 它们明明被用着 | 非变异 · 函数里写的是 `const { surface, request } = options`，解构之后全仓再没有一处 `options.request` 的属性访问，而 D36 的闸门正是按属性访问判消费者 | — | 改成逐项读 `options.x`。**闸门这次是对的**：一个只在解构里出现的入参，与一个真的没人用的字段，在扫描面上确实一样 |
| T-268 | ① | `HeadlessRuntime.captureImage` 返回硬编码 1280×720 | 契约红 | 红 · 4 条（契约 1 + 动作测试 3） | — | 还原 |
| T-268 | ② | 把 headless 侧的 `planCapture` 换成一个**算出同样数字**的等价 wrapper | 卡面预言「契约测试仍然绿」 | **红 · 恰好 1 条，且就是身份断言那条**；其余 303 条全绿 | — | 还原。⚠ **卡面的预言完全成立**：一个 `(req, lim) => planCapture(req, lim)` 的包装算出的每一个数都一样，所有「结果相等」的断言无一转红。只有 `expect(HeadlessRuntime.planFn).toBe(planCapture)` 抓得住它——这是本批唯一一条断「是不是同一份实现」而不是「结果一不一样」的断言 |
| T-268 | ③ | （非变异，是卡面一处对仓库现状的误判）独占清单里的 `packages/core/test/eca/runtime-contract.test.ts` | 应当存在 | 非变异 · **不存在**。双实现契约的真实落点是 `packages/core/test/runtime-contract.ts`（一个被 `headless.test.ts` 与 `scene-runtime.test.ts` **两边共同调用**的 `describeRuntimeContract`） | — | 三条 `captureImage` 契约加进那个共享函数，两个运行时因此各跑一遍 |
| T-268 | ④ | （非变异，是契约里一处会假成立的写法）第一版契约用 `scale: 4` 断「notice 非空」 | 两侧都该钳位 | 非变异 · **真运行时那侧绿不了**：两个 harness 的视口不一样（无头 1280×720、真运行时 800×600），800×4 = 3200 没超过 3840，根本没钳位。**按倍率比出来的「相等」是两个巧合** | — | 改用 `longEdge: 9999`：长边是绝对值，两侧必然得到同一个数 |
| T-268 | ⑤ | （非变异，是 harness 的一处补齐）真运行时那侧 `captureImage` 恒失败 | 契约要能比成功分支 | 非变异 · 渲染器替身的 `domElement` 是 `{}`，没有 `toBlob`，于是 `readPixels` 恒返回 null | — | 给替身加 `toBlob`。**不是为了让测试变绿**——没有它，两个运行时在契约上的差别变成「真运行时永远导不出图」，而那是 harness 的性质不是产品的性质（与 `createMediaElement` 同一条理由） |
| T-268 | ⑥ | （非变异，是两条闸门当场点名）注册一个新动作之后 | —— | 非变异 · 两条守卫各红一次：`registry.test.ts` 的内置动作清单、`capability-entries.ts` 的能力入口体检表。后者的注释写着「a new action fails this file on the day it is registered」——**当天就应验了** | — | 各补一行。这正是那两张表存在的理由 |
| T-268 | ⑦ | （非变异，是 C5 的验收证据）`git diff --stat packages/core/src/eca/engine.ts packages/core/src/eca/executor.ts` | 必须为空 | 非变异 · **为空**。规则编辑器（`RulePanel.tsx`）的 diff 同样为空，而 `rule-editor.test.ts` 的「源码里不许出现动作类型名」守卫仍绿 | — | 三文件法兑现：加一个动作只动 `actions/scene.ts` / `types.ts` / `headless.ts` |
| T-270 | ① | 把 `OpenLinkParams.url` 改成 `z.string().url()` | 卡面：「含 javascript: 的历史文档仍能 validate」那条必须红 | **绿→红** · schema 侧 154 条**全绿**（卡面点名的那条根本不动）；本卡补的 core 侧断言红 1 条 | b | ⚠ **卡面这条变异在今天的仓库里不可观测**：`OpenLinkParams` 在 @w3/core，而 `validate()` 在 @w3/schema 且只校验 SceneDocument，**它不跑 core 的逐动作 schema**。补一条 ECA 侧断言把它变成可观测的 |
| T-270 | ② | （本卡补的）注入口失效（恒走 `defaultOpenLink`） | 注入相关断言红 | 红 · 2 条 | — | 还原 |
| T-270 | ③ | （非变异，**是卡面那条建议的证伪**）`z.string().url()` 到底挡不挡得住 `javascript:` | 应当挡住 | 非变异 · **挡不住**。实测 zod：`javascript:alert(1)` 与 `data:text/html,...` 都**通过**，被挡住的反而是 `/manual.pdf` 与 `#step-3` 两个完全正当的相对地址 | — | 也就是说那次收紧**代价是拦掉正当用法、收益是零**。写成一条断言钉住，免得下一个人「顺手加个 .url() 更安全」。真正管用的是 `integrity.ts` 里那对 `SAFE_SCHEME` / `ANY_SCHEME` 正则（I44 走的就是它们） |
| T-270 | ④ | （非变异，是与冻结清单的一次对账）卡面的「一律发 `openLink` 事件」 | —— | 非变异 · `RuntimeEvent` 是规划 §4 冻结的**封闭联合**，没有 openLink 这一支。往里加会同时放宽 `RuntimeEventSchema`，让宿主能 `dispatchEvent({ event: 'openLink' })` 打进引擎——§4.4.4 明令禁止宿主自定义事件 | — | 那条事件属于**嵌入协议的 Evt**（T-271/T-272 的另一条通道），本卡只交核心注入口。已登记进 IMPL_NOTES §3 |
| T-270 | ⑤ | （非变异，是一处零覆盖的分支）无头环境那条 warn | —— | 非变异 · 重构前 `openLink` **全仓零测试**，`无头环境下不打开链接` 那条 warn 没有任何断言压着——一次「顺手改成自由函数」的重构会把它悄悄丢掉 | — | `warn` 由调用方传进来（不走 this），并补一条断言 |
| T-269 | ① | 删 thumbnail 透传（`packScene` 那一行） | `.w3p` 断言红 | 红 · 2 条 | — | 还原 |
| T-269 | ② | 「出图失败不阻断发布」改成抛错 | 降级红 | 红 · 1 条 | — | 还原。一个能用的包 + 没有预览图，好过因为一张预览图发不出去 |
| T-269 | ③ | （本卡补的）删掉零字节守卫 | 空 blob 不许进包 | 红 · 1 条 | — | 还原。`new Uint8Array(0)` 是 **truthy**，而 `packScene` 与 `publish` 两处都是 truthy 判断——一次返回空 blob 的出图会让一个 0 字节的 thumbnail 进包，而**「有图但打不开」比没有图更糟** |
| T-269 | ④ | （非变异，是卡面验收的一处**不可能达成**）`grep -rn 'thumbnailUrl' packages/` 零命中 | 应当零命中 | 非变异 · **实测 21 处命中**。`AssetSchema.thumbnailUrl` 是一条活着的、v3 冻结清单没有删除的字段：`TexturePicker` 在渲染它、`import-flow` 在写它、`migrate.ts` 里那句 `{ thumbnailUrl: _dropped, ...rest }` 是 C4 要求的迁移代码——删掉就是老文档打不开 | — | 按**规划 §1378 的收窄版**执行：只断「无一条写向 viewpoint」。写成一条遍历源码的测试（同一行里既提 viewpoint 又提 thumbnailUrl 即算违规），实测 0 处。另补一条反向断言钉住「资产上那条仍然活着」，免得下一个人照字面把它一起删了 |
| T-269 | ⑤ | （非变异，是卡面另一半的对账）「视点缩略图改读 `thumbnailAssetId`」 | 应当有可改的读点 | 非变异 · **编辑器里没有任何读点**：`ViewpointPanel.tsx` 全文零处 thumbnail，全仓也没有生产代码读写 `viewpoints[].thumbnailAssetId`（只有 schema 的 I30 校验与 storage 的 referencedHashes，后者 T-232 早已补上并有测试） | — | 这半张卡实质已由 T-225（改名）与 T-232（打包引用）交付，本卡不重复做，只补机器断言把状态钉住 |
| T-269 | ⑥ | （非变异，是一处名实不符，如实登记）包内条目名 | —— | 非变异 · `THUMBNAIL_FILENAME` 硬编码 `thumbnail.png`，而卡面要求 `format: 'jpeg'`——**JPEG 字节装在一个 .png 名字里** | — | 接受并点名。改那个常量会同时打到 `packages/storage/src/package.ts` 与 storage 的两份测试，三者都不在本卡独占清单上。功能上无碍（读取方按常量取，不按扩展名嗅探），但这是一处真实的名实不符，留给动 storage 的那张卡 |
| T-269 | ⑦ | （非变异，是一次包边界上的取舍）`publish()` 要不要自己去找运行时 | —— | 非变异 · 让它 `import { getActiveRuntime }` 会把「发布」与「当前有没有一个活着的视口」绑死，而发布在逻辑上不需要视口 | — | 改成注入 `captureThumbnail?`。`runtime-registry.ts` 加一个**窄口**（参数写死 512 长边 / 不含热点 / 不透明 / JPEG——这四项是「缩略图」这个词的定义，不是调用方的选择），与 `previewAnimation` 同一条纪律。⚠ 那个文件不在本卡独占清单上（属 T-254 / T-294），加的是一个函数、没动既有的两个 |
| T-267 | ① | 让 UI 自己算 `vw * scale` | 打桩断言红 | 红 · 1 条 | — | 还原。**一个自己算尺寸的实现在其余十条断言下全绿**——它显示的是一个像模像样的数字，只是与实际导出的不一样。钳位链有像素比 / 管线上限 / 显卡上限 / 合同长边上限四层，UI 那份算术落后一层就错 |
| T-267 | ② | 删 `disabled` 条件 | JPEG × 透明红 | 红 · 1 条 | — | 还原 |
| T-267 | ③ | 把「透明 + 描边」也改成 disabled | 降级提示那条红 | 红 · 1 条 | — | 还原。**两种行为互相排斥**：拒绝要禁用、降级要可用。把任一条做成另一条，都只会让其中一条红——所以卡面要求两条各写一次 |
| T-267 | ④ | （非变异，是档位的一处收窄）倍率档位列几档 | 卡面写 1/2/4 | 非变异 · 照卡面只列三档。**3× 不列是因为它够不着**：1920 视口上 3× 与 4× 都被 3840 的长边上限咬住（ADR-0041 代价 2 记的就是这件事），列出来是骗人的 | — | 三档。4× 保留是因为小视口（≤960）上它到得了 |
| T-271 | ① | 把 `hotspotClick` 那处改回 `engine.dispatch`（漏发） | 长度断言红 | 红 · 1 条 | — | 还原 |
| T-271 | ② | double-fire：`onEvent` 放到 dispatch 之后并额外调一次 | 长度断言红 | 红 · 2 条 | — | 还原。**这条是「多一条」，最难发现的那种**：任何「收到了吗」的断言都是绿的，症状是宿主的计数器每次多加一。只有「与引擎收到的序列逐项相等**且长度相等**」两条同时断才堵得住 |
| T-271 | ③ | `getVariable` 改成直接透传 | 打错字那条红 | 红 · 1 条 | — | 还原。透传的话打错的名字返回默认值（数字 0），宿主据此显示「当前步骤：0」，而真相是那个变量不存在 |
| T-271 | ④ | `ready.commands` 改成手写数组并少一项 | 门槛红 | 红 · 2 条 | — | 还原 |
| T-271 | ⑤ | 注入缺失时仍注册 | 「注入缺失则命令不出现」红 | 红 · 1 条 | — | 还原。这一条同时是 X-53 的解法：`goToScene` 在 v1.0 依赖注不进来 → 不出现在 `ready.commands` 里 → 宿主 `can()` 立刻知道，而协议里那个名字保留着，v1.5 接上时**协议版本号一个数都不用动** |
| T-271 | ⑥ | `unknown-command` 改成静默返回 null | 对应红 | 红 · 1 条 | — | 还原。静默的话宿主看到的是一个永远不 resolve 的 Promise |
| T-271 | ⑦ | （非变异，是一处编译期哨兵）`RUNTIME_EVENT_TYPES` 与 `RuntimeEvent` 联合的对应 | —— | 非变异 · 往联合里加一支而忘了加进数组，**运行时的表现只是「宿主收不到那种事件」**，没有任何东西会红 | — | 加一行赋值哨兵，漏了就编译不过 |
| T-272 | ① | `isAllowed` 直接 `return true` | 至少 5 条红 | 红 · **19 条** | — | 还原 |
| T-272 | ② | 通配从 `endsWith('.' + suffix)` 改成 `endsWith(suffix)` | `customer.example.evil.com` 那条红 | 红 · 4 条 | — | 还原。这是这一层最经典的漏法 |
| T-272 | ③ | 去掉「只回一次 denied」 | 放大器那条红 | 红 · 1 条 | — | 还原。逐条回的话我们就成了反射放大器：攻击者用一个 iframe 换我们无限量的 postMessage |
| T-272 | ④ | 回发的 target origin 改成 '*' | 源码扫描红 | **绿→红** · 第一版**守卫没抓到** | b | ⚠ **这条变异抓到的是守卫自己的缺陷**：扫描只认 `postMessage(`，而传输层调的是注入进来的 `postTo(`——把 target origin 改成通配之后守卫照样通过。一条只认得出直接调用的扫描，对着一个把调用注入出去的分层设计是瞎的。正则改成认两个名字，重跑转红 |
| T-272 | ⑤ | （守卫自身的变异，v0.5 T-117 的教训）往 `protocol.ts` 临时写一句 `const _ = window` | `check-embed-layering` 必须 fail | 红 · 逐行点名 protocol.ts:87 | — | 验后还原。**一条永远不会红的守卫，与一条不存在的守卫是同一件事** |
| T-272 | ⑥ | （非变异，是守卫的一次误报）第一版扫描把 `CommandDeps` 的 `document` 字段判成浏览器全局 | 应当只判全局 | 非变异 · `document: () => SceneDocument` 是一个字段名。另外模板字面量里的 `w` 会被求值成 `w`，字符类退化成 `[w.$]`——`xdocument` 之类本来也会溜过去 | — | 右侧排除 `:`，并改用 `String.raw`。**后一处是更值钱的那个**：它让守卫看起来一切正常而实际上放宽了一大截 |
| T-273 | ① | 三个输入量拆成三处各自 start/stop | 「hidden 再 visible 之后仍暂停」红 | 红 · 2 条 | — | 还原。**这个缺陷只在「先暂停 → 切标签页 → 切回来」这条三步路径上出现**，任何单步测试都看不见它 |
| T-273 | ② | `unsupported` 改回直接 return | capability 那条红 | 红 · 1 条 | — | 还原。嵌入时宿主看到的是一个黑框，而页面里那句中文提示在 iframe 里、宿主的 JS 读不到 |
| T-273 | ③ | 去掉 `?embed=1` 判断 | 「不带参数时不加载」红 | 红 · 1 条 | — | 还原 |
| T-273 | ④ | （本卡补的）在与门之外多加一处 `runtime.start()` | 「只出现在与门里」红 | 红 · 1 条 | — | 还原。多一处调用点就是多一条绕过与门的路，而它在行为测试上完全看不出来——那一处只是让它「早跑了一点」 |
| T-273 | ⑤ | （非变异，是断言写法的一次订正）「unsupported 不再直接 return」那条 | —— | 非变异 · 第一版对着整段文本 `indexOf('return')`，而那段注释里就写着「不能直接 return」——**断言匹配到了自己的理由说明** | — | 改成按行找并跳过注释行 |
| T-273 | ⑥ | （非变异，是一处刻意不给的 API）要不要暴露 `player.session` / `player.runtime` | —— | 非变异 · **不给**。一个 public getter 意味着页面上任何拿得到 Player 的代码都能绕过嵌入控制器直接改场景，而控制器存在的全部理由就是宿主只能通过一条受检的通道说话 | — | 改用 `onSession` 回调，只在装配时被调一次。补一条源码断言钉住「不许出现 get session()」 |
| T-275 | ① | `frame-ancestors` 默认值改成 `*` | 红 | 红 · 1 条，逐字点名改成了什么 | — | 还原 |
| T-275 | ② | 删掉 bench 的 404 规则 | 红 | 红 · 1 条 | — | 还原 |
| T-275 | ③ | （非变异，是守卫第一次运行就误报）示例注释被当成生效指令 | 应当只判生效的指令 | 非变异 · 注释里写着「改成客户宿主域：frame-ancestors https://customer.example …」，而守卫对着整段文本正则——**一份好模板必然在注释里写示例**，所以剥注释不是可选的 | — | 加一个 `directives()`，三条规则都先剥注释 |
| T-275 | ④ | （非变异，是取值正则的一处错）`[^"';]+` 读不出 `'none'` | 应当读出来 | 非变异 · **值本身就是带单引号的**，单引号被字符类排掉，于是「读不出来」。指令的边界是那对双引号，不是引号字符本身 | — | 改成 `[^"]*` |
| T-274 | ① | SDK 的 `SUPPORTED_PROTOCOLS` 改成 `[2]` | 一致性红 | 红 · 1 条 | — | 还原 |
| T-274 | ② | **把一致性测试改成两边 `import { EMBED_PROTOCOL }` 比对** | 卡面预言：它会永远绿 | **绿 · 卡面的预言完全成立** | b | ⚠ **这是本卡要证明的东西本身，不是一处待修的缺陷。** 实测：把 SDK 改成 `const SUPPORTED_PROTOCOLS = [IMPORTED + 1]`（即协议 2，一次真实的不匹配），import 式的测试**全部 6 条绿**。原因很直白——两边读的是同一个值，那个测试断的是 `x === x`。所以一致性只能靠**外部比对**：读 SDK 源文件的文本、正则抠出字面量、再与 `EMBED_PROTOCOL` 比。SDK 会被拷进客户页面、与播放器分别升级，import 等于假设两边永远同版本，而那是「嵌入」最不成立的假设 |
| T-274 | ③ | `build` 写回 `vite build && vite build -c …` 并用 `--base` 跑 | base 断言红 | 红 · 1 条，`index.html` 里是 `/assets/…` 而不是 `/player/assets/…` | — | 还原。成因：`--base` 只会追加到链里的**最后一条**命令上，第一次 `vite build` 拿不到它。Dockerfile 因此分两行各自调用 |
| T-274 | ④ | （非变异，是断言又一次匹配到自己的理由说明）「SDK 里没有 EMBED_PROTOCOL」那条 | —— | 非变异 · 文件头注释里正写着「**不 import** `EMBED_PROTOCOL`」，整份源码断当场红。**T-273 刚踩过同一个坑**（那次是注释里的「不能直接 return」） | — | 剥注释再断。两次同形，值得当成一类记住：**一条解释「不许出现 X」的注释里必然出现 X** |
| T-274 | ⑤ | （非变异，是本机环境的一处坑）Git Bash 下 `--base=/player/` | 应当得到 `/player/assets/…` | 非变异 · MSYS 把 `/player/` 当成路径转换成了 `/Program Files/Git/player/`，产物里是那一串 | — | 本机改用 PowerShell 跑构建。**Dockerfile 在 Linux 上不受影响**，是纯本机环境问题 |
| T-277 | ① | 给 `COMMANDS` 加一个 `foo` 不写文档 | 双向一致性红 | 红 · 2 条 | — | 还原。**这一半才是会出事的那一半**：加命令时改代码是必须的、写文档是可选的，于是文档慢慢变成一份不完整的清单而它看起来一直是对的 |
| T-277 | ② | 改样板页里的快速开始片段 | 文档同步红 | 红 · 1 条 | — | 还原。一份「大意相同」的快速开始，读者照着抄下来跑不通——而他不会怀疑文档，他会怀疑产品 |
| T-277 | ③ | （非变异，是一条防空跑的断言）「文档里真的认出了命令行」 | —— | 非变异 · 双向一致性的两条断言在**正则一个都没匹配上**时也全绿（两个空集合相等）。加一条 `documented.size === Object.keys(COMMANDS).length` 把它钉住 | — | 变异 ① 恰好同时红了这一条，说明它有效 |
| T-276 | ① | 去掉 transport 的 origin 校验（`if (!isAllowed(…))` → `if (false)`） | 用例 3 红 | 红 · 「白名单外的宿主不该握上手」 | — | 还原 |
| T-276 | ② | `EMBEDDED` 恒 true（去掉 `?embed=1` 判断） | 用例 4 红 | 红 · 「没带 ?embed=1 时不该握上手」 | — | 还原 |
| T-276 | ③ | `screenshot` 返回一张 640×400 全透明空图 | 字节数断言红 | 红 · **但不是卡面预判的那条断言**：`bytes > 1000` **照过**——一张全透明 PNG 也不止 1 KB。红的是「画面上不该只有一种颜色」 | — | 卡面预判的那条断言不够，卡面同时写了「若不红说明断言写在有没有返回上，要改成像素内容」——照它办了：宿主页把 dataUrl 画进 canvas，回报颜色桶数与不透明像素数 |
| T-276 | ④ | （非变异，是本卡查出的缺陷）SDK 默认 `sandbox='allow-scripts'` | —— | 非变异 · **用例 1 从一开始就是红的**：iframe 落进不透明源 → 模块脚本被 CORS 拦 + `resolveSource` 拿 `"null"` 比对，握手永远超时。改默认值为 `'allow-scripts allow-same-origin'` | — | T-274 的注释把理由写反了（以为 `allow-same-origin` 会让 iframe 拿到**宿主**的权限）。加了一条读源码文本的断言当廉价后备，因为 e2e 不在 `pnpm verify` 里 |
| T-278 | ① | 把软渲警告那段从 `renderReport` 删掉 | 第 3 条红 | 红 · 「软件渲染时必须挂出警告」 | — | 还原。这段话会跟着报告贴进验收单，删了它之后一份软渲帧率会被当成硬件读数用 |
| T-278 | ② | 让 `run()` 在 `unpackScene` 之后直接 return | 第 2 条红 | 红 · 「选完文件应当跑出一张报告表」 | — | 还原 |
| T-278 | ③ | （非变异，是一条查出来**不咬人**的断言）拿掉 `?fast=1` | 墙钟 ≥ 30 秒 → 红 | 非变异 · **没红，实测 25.9 秒**。软件渲染下两条爬坡在第一档就跌破 fail 线直接收摊，本该最贵的十几档根本没跑——**一条本以为在守时的断言，其实在守一个恒成立的条件** | — | 改成直接断言首屏文案里的秒数（由 `SAMPLE_MS.main` 算出，参数认错时是 6 而不是 0.6）。墙钟上限保留，它挡的是另一类失效（某档忘了收摊） |
| T-278 | ④ | （非变异，是一条被钉死的环境）`--disable-gpu` | —— | 非变异 · 第一次跑时第 3 条**红在开发机有独显上**：`capability.level === 'ok'`，那句警告本来就不该出现。跟着机器走的话，这条断言在有显卡的机器上是空转的 | — | **空转的断言与不存在的断言，在测试报告上长得一模一样**。放 `test.use` 里只钉这一份 spec |
| T-279 | ① | `recommendShadowDefault` 恒返回 `'medium'` | 四条情形至少红三条 | 红 · **6 条** | — | 还原 |
| T-279 | ② | `ceilingFor('high')` 用 `'medium'` 的数据 | 必须红 | 红 · 「每一档读的是自己那一列的数据」 | — | 还原。**这条变异只在测试数据三档互不相同时才抓得到**——所以 `LADDER` 里 low/medium/high 的上限灯数分别是 8/4/1、帧率 53/50/48。同一个坑 v0.5 的 T-184 踩过（基准文档恰好已排好序，排序是空操作） |
| T-279 | ③ | `t_firstFrame` 恒为 0 | 必须红 | 红 · 「每一段都报自己的数」 | — | 还原 |
| T-279 | ④ | （非变异，是死导出闸门失明的**第四个实例**，且第一次朝「误判为活着」的方向）`toMarkdown` 里写 `const report = toJsonReport(…)` 再一路 `report.rows` | —— | 非变异 · **红**：遗留基线里的 `schema:RemapResult.report` 被判成「已经有生产调用者」，守卫要求删行并调低棘轮——而它一个调用者都没有 | — | 改成解构（零属性访问）。前三次（T-246 `explode` / T-256 `retainOnly` / T-262 `CapturePlan` 九字段）都是**新成员被误判为死**；这一次是**既有的死成员被误判为活**，而这个方向更坏：它逼你去删一条真实的债 |
| T-279 | ⑤ | （非变异，是棘轮的一次真实下调）`shadowMapSizeFor` 与 `CapabilityReport.webgl2` 接上生产调用者 | 守卫应当点名它们陈旧 | 非变异 · 红 2 条，如实 | — | 删两行遗留基线、`MAX_LEGACY` **85 → 83**。阴影显存估算读 `shadowMapSizeFor` 而不是再抄一张表（BENCH_LIMITS 抄错过一次，1,500,000 对 300,000）；JSON 报告记 `webgl2`，因为一份不写明「有没有 WebGL2」的性能报告没法比较 |
| T-280 | ① | 删软渲判定（`if (report.capability?.level === 'software')` → `if (false)`） | 「软渲报告不许进附件A」红 | 红 · 一份 `level: 'software'` 的报告被**静默接受**并回填（原本退出 1 并给中文原因） | — | 还原。这一条是拒绝不是警告：警告会在某个赶工的下午被忽略，而它的代价落在合同附件上 |
| T-280 | ② | `--check` 写成「文件存在即通过」 | 手改一个字那条红 | 红 · 把表里那一格的 `60.4 fps` 改成 `90.4 fps` 之后 `--check` 仍然 **PASS**、退出 0 | — | 还原。**这是本卡最容易假绿的地方**，卡面点了名：`--check` 天生容易写成空转。真实现是「重生成后与磁盘上的字节逐字比对」 |
| T-280 | ③ | （非变异，是三条正路的实测）M1/M2/M3 三份人造报告 | —— | 非变异 · 回填出 12 行（4 指标 × 3 档），状态列为 `` `[实测] M2 · 车间工控机 · 2026-08-12` ``；`--check` 绿；手改后 `--check` 红 | — | 档位与代号取自**文件名**（`M2-车间工控机.json`）而不是 JSON 字段：那份 JSON 是浏览器导出的，浏览器不知道这台机器在合同里叫什么档 |
| T-280 | ④ | （非变异，是「没有报告时它也在守东西」）零报告下跑 `--check` | 应当绿且有意义 | 非变异 · 绿。**它守的是那四行「待实测」的措辞一个字都没被动过**——挂进 `pnpm verify` 之后，今天就开始生效，而不是等到有实测那天 | — | 同一份生成器同时负责「没实测」和「有实测」两种形态，所以两种形态都被逐字节钉住 |
| T-281 | ① | 把首帧代价改成复用上一次的数字（`ms(cost.offFirstFrameMs)` → `ms(cost.onFirstFrameMs)`） | 需要一条「开 / 关两次得到两组不同数字」的断言才抓得到 | 红 · 「**开与关两次分别报数**，不是一个数字用两遍」 | — | 还原。卡面点名「**必须专门写这条**」——其余每一条断言（行数、limit、说明文案、评级）在复用之下全绿。两个输入故意差一个数量级（42.4 / 7.1），相等的话这条变异也是绿的 |
| T-281 | ② | （非变异，是「断言形状不是毫秒」的落法）不写死任何毫秒阈值 | —— | 非变异 · 钉住的是：两次切换各报各的数、program 报的是**差值**且不为负、没有剖切平面时报「不适用」而不是 `0 ms` | — | 同 `scale.test.ts` 的做法。「开一次剖切要花多少毫秒」是这台机器的属性，写死等于把开发机的显卡写进测试 |
| T-281 | ③ | （非变异，是软渲警告的覆盖范围）这两档走的是同一张表 | 应当自动被那段警告罩住 | 非变异 · 绿：`toMarkdown` 里同时出现「不可作为验收依据」与这两档的行名 | — | 断言的是「**没有绕过去的第二条路**」——这两档同样是帧率类数据，如果它们另开一张表就会绕过那段警告 |
| ADR-0042 | ① | `shouldKeepSampling` 回退成「只按墙钟收」（缺陷原样） | 采样不足那几条必须红 | 红 · 4 条，含「实测那条时间线：一次 334ms 的编译卡顿不再让这一档归零」 | — | 还原。判据**从 `measure()` 里抽成纯函数**才有这条变异——见 ④ |
| ADR-0042 | ② | `gradeFrames` 去掉样本不足分支 | 三行一起转红 | 红 · 「空样本时**三行一起**报未测到」「**没有一行判 pass**」 | — | 还原。塌掉的那一格是 P95 与最慢单帧：空样本下都是 0，而「0 毫秒的帧时间」被 `<= 33ms` 判成**通过** |
| ADR-0042 | ③ | 「阴影贴图显存」改回按灯数取最大（`l.lights > best.lights`） | 应当报 low 而不是 high | 红 · 「按显存取最大，不是按灯数取最大」 | — | 还原。**这个错在完全没有采样问题的干净跑里也成立**：慢跑 12 档全过，它照样报「8.0 MB（8 盏 · low）」 |
| ADR-0042 | ④ | （非变异，是一次**失败的**变异检验）把 `measure()` 的延长逻辑删掉，跑 `pnpm test:e2e bench` | e2e 应当红 | 非变异 · **绿，4.9 秒**。那一轮机器够快，没饿着 | — | 饥饿要靠一次 shader 编译卡顿正好落在 warmup 帧里，取决于机器与时刻。**一条只在某些机器上某些时刻会红的守卫等于没有守卫**——所以把判据抽成 `shouldKeepSampling` 纯函数，用构造的时间线钉死（变异 ①） |
| ADR-0042 | ⑤ | `measureSection` 去掉 `clipPlanes === 0` 判据 | 「有刀但都关着」那条红 | 绿 · **这一行的「红 2 条」曾经是编的**。被变异的那一行在 `main.ts`，而它引的两条红打的是 `metrics.ts` 的纯函数 `gradeSection`（喂手搓的 `{skipped:'no-planes'}`），与被变异的代码毫无关系；`measureSection` 全仓零测试引用 | **a** | 对抗式复核查出。判据抽成纯函数 `classifySection` 并配单测（见 ⑨），变异才真的红得起来。**账本里一条「声称红、实际绿」的记录，比没有记录更坏——它让下一个人以为这里有守卫** |
| ADR-0042 | ⑥ | 样板宿主页改回两次 `W3Player.mount` | 用例 5 红 | 红 · 「一个容器只该有一个播放器」（Expected 1 / Received 2） | — | 还原。**这一页此前从没被任何自动化打开过**：`docs-sync` 只比文本切片 |
| ADR-0042 | ⑦ | （非变异，是 e2e 自己那一格的补洞）bench 的 e2e 原本只查行数 / 判定合法 / 值非空 | —— | 非变异 · 那三条在「平均帧率 = 0.0 fps ❌ / P95 = 0.0 ms ✅」这份报告上**全绿六次**（`fail` 是合法判定，`0.0 fps` 是非空串） | — | 补两条：任何行不许出现 `0.0 fps`/`0.0 ms`；未测到的行必须判 warn；头条指标只允许「真读数」或「未测到」两种形态 |
| ADR-0042 | ⑧ | （非变异，是修复自己引入又修掉的一处回归）只按「测到且低于 fail 线」收摊 | 应当只影响报告 | 非变异 · **SwiftShader 上整页跑过 3 分钟没出表**：一帧要几秒，16 档灯光一档都收不了摊 | — | 拆成两个决定：*报什么*（未测到 / warn）与*还爬不爬*（`shouldStop`：没测到就停）。延长本身已经把「一次卡顿」这种成因滤掉了，凑不满只可能是持续地慢 |
| T-282 | ① | `openProject` 的 `keepHistory` 从 `false` 改成 `true` | 「切换后 `canUndo === false`」红 | 红 · 2 条（两头断言 + 「意图写在返回值里」） | — | 还原。`keepHistory` 保留的是**上一份文档**的撤销栈，换完文档按 Ctrl+Z 重放的是一条属于已不存在文档的逆补丁，会静默损坏当前文档 |
| T-282 | ② | 删掉 `openProject` 里的 `session.loader.dispose()` | 「切到另一份工程后视口画的是新工程的几何」红 | 红 · 「**丢掉上一份工程的资产字节** —— 断言的是渲染器手上有什么，不是文档」 | — | 还原。断言用 `loader.has(assetId)`：先真的 `load()` 一次让它进缓存（两头断言），再切工程。**只断言文档的话这条变异是绿的**——文档、层级树、属性面板全都已经是新的了，只有画面不同意 |
| T-282 | ③ | 把「重命名当前工程」的 `commit` 换成直接 `saveDocument` | 「Ctrl+Z 能改回去」必须红 | 红 · 1 条（`canUndo` expected false to be true） | — | 还原。**这是本卡最容易假绿的地方**，卡面点了名：两条路径都能让列表里的名字变，区别只在撤销栈 |
| T-282 | ④ | （非变异，是两道棘轮同时下调）`deleteProject` 与 `createEmptyDocument` 接上生产调用者 | 守卫应当点名它们陈旧 | 非变异 · 红 4 条（豁免表 3 行 + 遗留基线 1 行） | — | `MAX_EXEMPTIONS` **24 → 21**、`MAX_LEGACY` **83 → 82**，孤儿 114 → 110。`deleteProject` 从 v0 起就有接口、两个实现、一份契约测试而**零业务调用者**——契约测试证明的是「实现符合接口」，没有任何东西证明过有人真的用它 |
| T-282 | ⑤ | （非变异，是搬家的连带）`restoreLastDocument` 从 `main.tsx` 挪到 `project-lifecycle.ts` | —— | 非变异 · `check-migrate-on-read` 当场红：`main.tsx` 读外部文档却不再调 `migrate()` | — | 守卫的 READERS 表跟着改一行。**这道守卫按文件名认路，搬家会让它指着一个空壳**——它红了，说明它没瞎 |
| ADR-0042 | ⑨ | 删掉 `classifySection` 的 `clipPlanes === 0` 判据 | 「有刀但都关着」那条红 | 红 · 2 条（「**有刀但一条平面都没装 → no-planes**」「两种跳过给出的形状不同」） | — | 这是 ⑤ 该有的样子。判据从 `main.ts` 的模块私有函数抽成 `metrics.ts` 的导出纯函数，只为让它测得到 |
| ADR-0042 | ⑩ | `verdictOf` 把 `not-measured` 判回 `fail`（第一轮的行为） | 五条产能结论行必须红 | 红 · 2 条（四条动态灯上限 + 承载上限） | — | **blocker A1。** 第一轮只 `filter(isMeasured)` 就 reduce 成 `null`，然后一律印「不足 1 盏 / 不足 1 份」判 fail——**起因那三行 `0.0 fps` 换了个措辞活下来**，而第一轮新加的 e2e 守卫写的是「值含『未测到』才查 warn」，这五行不含那三个字，正好从守卫底下过 |
| ADR-0042 | ⑪ | （非变异，是决策 4 的**撤回**）复核证明它结构上达不成目的 | 「剖切引起的 shader 重编译」应当不再恒 +0 | 非变异 · **仍恒 +0**。`renderStats.programs` 读的是 program 缓存，而「首屏 · 首帧」为了计时必然更早地按文档态画过一帧；走到 cost 分支的前提又正是 `clipPlanes > 0`，即那一帧已经把 clip=N 的变体编译完了 | — | 档序还原。那一行改报**绝对数**并在说明里承认「量不到那次编译的代价，它落在首屏 · 首帧里」。挪动还带进一个回归：`measureSection` 为取基线画的 3 帧编译出的 clip=0 变体被算进「几何体 / 着色器」（实测 5 → 9），three 不回收 |
| ADR-0042 | ⑫ | （非变异，是回填脚本的最后一步）喂一份 `capability.level: "ok"` 但主采样「未测到」的报告 | 应当被拒绝 | 非变异 · **第一轮照收**：「未测到（样本 3/8）」被写进附件A §7 的「目标值」列并盖上 `[实测]` 章。补一条拒绝后转为退出 1 | — | 判据一直就在手边：那几行的 `verdict` 是 `warn`。§7 回填规则 5 说一档只能有一次实测——这一档会被一次没跑成的测量占掉 |
| ADR-0042 | ⑬ | （非变异，是第二轮自己踩的两个坑）零值守卫收紧到 `0.0 MB`；夹具补 `var_step` | —— | 非变异 · 两条**当场红在合法读数上**：① e2e 场景是三个无贴图立方体，「贴图显存 0.0 MB」是对的；② 补 `var_step` 时整段覆盖了 `variables`，用例 1 的 `getVariable('step')` 当场红 | — | 零值按**指标名**分档（帧率永远非 0、首屏/剖切毫秒可为 0、贴图显存可为 0、阴影显存不可能为 0）；夹具改成继承 + 追加 |
| ADR-0042 | ⑭ | （未决项裁决为**乙**）把 `setSectionsEnabled` 的签名从 `false 竖线 null` 退回 `boolean 竖线 null` | 「签名里不许出现 true」那条必须红 | 红 · 1 条 | — | ADR-0040 的决策段原本写着「`true` / `false` 强制开 / 关」，而实现里只有 `false` 走 `withoutSections`——**「强制开」从来没有存在过**，缺口活了两个版本。选乙（改 ADR 不改实现）：甲要绕过 ADR-0039 的世界可见性判据、并让「哪些平面是活的」有两个所有者，而**没有人需要它**。⚠ 本行用「竖线」二字代替 `竖线` 字符：表格单元格里的裸竖线会被 R4 数成多出来的列（同一个坑本批第二次踩） |
| T-283 | ① | 删掉内置文档表里泵组样板那一行 | 「发布闸门通过」必须红 | 红 · 「表里第一份就是泵组样板」 | — | 还原。判据在表里，不在 `if` 上——T-282 ① 的收益在这里第一次被兑现：加第二份内置文档只加一行 |
| T-283 | ② | 把物化改成空操作（`materialise` 直接 `return doc`） | `hasBlob` 那条红 | 红 · **5 条**，含「从样板新建 → 资产被物化、hasBlob 为真」 | — | 还原。**只断言「文档打开了」不会红**——画面画得出来而发布闸门会正确地拒绝，这正是 v0 栽过的坑 |
| T-283 | ③ | （非变异，是一处**被文档自己的完整性检查抓出来的内容缺陷**）四颗盖螺栓不钉 `explodeOffset` | —— | 非变异 · `checkIntegrity` 报 I22：「4 个子件的锚点全部重合，径向散开没有方向可依」 | — | 它是对的：`assetRef` 节点的 `transform` 存的是**相对源资产的增量**，四颗螺栓在文档里都是 `[0,0,0]`，真实位置在 GLB 里。不钉偏移的话爆炸分组在样板里等于没有。顺带让 `explodeOffset` 第一次有了真文档使用者 |
| T-283 | ④ | （非变异，是第三道棘轮下调）`buildPumpDemoGlb` 接上生产调用者 | 守卫应当点名豁免行陈旧 | 非变异 · 红 1 条，如实 | — | `MAX_EXEMPTIONS` **21 → 20**。它从 T-222 起就躺在豁免表上，owner 写着 T-283——**一个「16 个零件、4 条材质、一条真动画」的 GLB 生成器，写了两周没有任何人调过它** |
| T-283 | ⑤ | （非变异，是本卡的一处交付偏差）`session.materialiseSample` 的硬编码闸门 | —— | 非变异 · 第二份内置文档一来，`projectId !== SAMPLE_PROJECT_ID` 与写死的 `buildSamplePumpGlb` **两处都要再挂一条 `\|\|`** | — | 改名 `materialise(doc, build)`：判据搬进 `BUILTIN_DOCUMENTS`，生成器由调用方传。**闸门没松**——「用户工程不物化」那条断言搬到了 project-lifecycle 层 |
| T-284 | ① | 删掉样板里的 `explode` 规则 | E2E 那一步必须红 | 绿 · **那条 E2E 没写**。删掉规则 ② 之后 `explode` 仍在用（规则 ③ 复原也是 `explode`，factor 0），而「径向爆炸在真实泵组上有可见效果」需要浏览器截图对比，本卡没交付 | **a** | 如实登记，不假装被覆盖。E2E 与 T-285 的能力覆盖体检一起补——后者遍历 `allActions()` 断言每个动作都被演示过，`explode` 消失时它会红，且不需要浏览器 |
| T-284 | ② | 把「剖开」改成 `setVisible(剖切面, false)` | 平面数断言红 | 红 · 「「剖开」用的是 `setVisible` —— 零新增动作」 | — | 还原 |
| T-284 | ③ | （非变异，是 T-283 交付里的一处**真缺陷**）样板规则用了 `setViewpoint` | —— | 非变异 · 那个动作**根本不存在**（注册表里是 `moveCamera`）。而 `checkIntegrity(doc, {actionRefs})` **零 error** —— 换成一个随手编的 `__definitely_not_real` 也照样零 error | — | 改成 `moveCamera`。**这是 T-283「checkIntegrity 零 error」那条验收的一个洞**：完整性检查不查动作类型存不存在。反向覆盖（样板里的每个动作都要在注册表里）交给 T-285 |
| T-284 | ④ | （非变异，是与 T-283 的一处冲突裁决）剖切面的默认可见性 | —— | 非变异 · T-283 设 `visible: true`（为了让 bench 的剖切档量得到东西），而 T-284 的验收要「两次往返后平面数回到 0」——**静息态必须是 0 条** | — | 依 T-284 的验收，改回 `false`。bench 那一档在这份文档上如实报「未测到（剖切平面都是关的）」，那正是 ADR-0042 决策 3 造出来的形态 |
| T-285 | ① | `actionsUsedIn` 改成只看 `rules[].then` | 至少一个只在 sequence 嵌套里出现的动作必须红 | 绿 · **v1.0 没有嵌套**：`ActionSchema` 是扁平信封 `{action, params}`，`sequence`/`parallel` 是 `rule.mode` 不是一种动作；全文档里动作只出现在 `rules[].then` 一处，两种写法逐字等价 | **c** | 如实登记。仍然写成通用遍历——不是因为今天需要，而是 v1.2 的 flows / pages 会新增动作出现的位置，那时写死路径的那一版会静静地漏掉它们 |
| T-285 | ② | 豁免表清空 | 必须有若干条红 | 红 · 2 条（9 个动作 + 9 种事件） | — | 还原。证明豁免表真的在生效，不是遍历本来就是空的 |
| T-285 | ③ | （卡面点名的**反向证明**）临时注册假动作 `__probe`，不加豁免 | 覆盖测试红 | 红 · 「注册表里的每个动作都被样板演示过」，报 `action:__probe`；删掉即恢复 5/5 绿 | — | 卡面要求这一条必须记进提交信息，**否则这张卡本身就是假绿** |
| T-285 | ④ | （非变异，是第三条测试当场查出的内容缺陷）样板的 `meta` 只偏离默认值 3 处 | 应当够高 | 非变异 · **红**：20 个可编辑字段只动过 3 个（背景色 / 雾色 / 描边开关）。前两条（动作 / 事件）对此完全失明 | — | **改样板不改阈值**：补上环境强度与曝光、雾的开关与远近、描边的颜色宽度强度与遮挡策略，11 处。这正是这条测试存在的理由——一份「一堆几何」的样板前两条照样全绿 |
| T-286 | ① | `expectedRev` 比较恒真（`if (false)`） | 冲突用例红 | 红 · 「expectedRev 对得上就放行，对不上抛 conflict 且**不覆盖**」 | — | 还原。那条用例同时断言**库里那份没被改**——只断言「抛了」的话，一个「先写再抛」的实现照样绿，而它已经把别人的改动盖掉了 |
| T-286 | ② | `readDocument` 返回内部对象本身（去掉 clone） | 「两者相等」红 | 红 · 「readDocument 与 loadDocument 一致，且都返回副本」 | — | 还原。断言是「拿到手就改，再读一次库里那份不该变」——症状否则是「我什么都没保存，它自己变了」 |
| T-286 | ③ | 删掉 `session.save` 里的 `touch()` | updatedAt 红 | 绿→红 · 第一版断言写的是 `stored.updatedAt >= doc.updatedAt`，而删掉 touch 之后两者相等，`>=` 照样成立；收紧成**严格大于**之后红 | **a** | 改成**严格大于**。`touch` 零调用者正是本卡要修的那件事，用一个删掉它也成立的断言守它等于没守 |
| T-286 | ④ | 给 `MemoryProvider` 挂一个空的 `locks` 但不改 `facets` | 契约套件必须 fail | 红 · 「声明的 facet 与实际挂着的一致」（声明了（无），实际挂着 locks） | — | 卡面把这一条写成了验收。**这是显式声明机制存在的全部理由**：探测式的套件会当场开始跑 locks 子套件，而那些用例会以某种方式绿 |
| T-286 | ⑤ | （非变异，是本卡撞上的一堵墙）40 个零调用者的冻结类型 | 应当能进豁免表 | 非变异 · `MAX_EXEMPTIONS` **正好 20/20 且只能降不能升**；冻结接口表不限条数但要求符号名逐字出现在规范的代码跨度里，而这些类型不在任何一份规范里 | — | 产品拍板选**甲**：写进规划 §4.6，走冻结接口表（[ADR-0043](adr/0043-provider-v2-接口写进冻结清单.md)）。冻结接口 7 → 39 行；**门锁没有被绕过**——§4.6.2 是一段围栏 TypeScript，每一个进表的符号都在里面 |
| T-286 | ⑥ | （非变异，是又一次棘轮下调）`touch` 接上生产调用者 | 守卫应当点名它陈旧 | 非变异 · 红 1 条，如实 | — | `MAX_EXEMPTIONS` **20 → 19**。`meta.updatedAt` 自创建起再没前进过，而 `listProjects` 与冷启动都按它倒序排——「最近动过的那一份」其实是「最早建的那一份」。症状温和，所以它躺了两个版本 |
| T-287 | ① | `classifyLease` 删掉 `closedCleanly` 那一行 | 「干净退出不算崩溃」红 | 红 · 4 条（两条纯函数 + 两个实现各一条契约用例） | — | 还原。干净退出的租约心跳**必然**是旧的，所以这一条同时钉死了判定顺序：先判 closedCleanly、再判 stale。顺序反过来，每一次正常关浏览器都会被报成崩溃 |
| T-287 | ② | `acquireLease` 删掉 `live-elsewhere` 分支（无条件成功） | 「第二个会话拿不到」红 | 红 · 两个实现各一条 | — | 还原。**两个实现同时改**才算一次有效变异：只改一个，另一个仍然红，红灯来源就说不清是哪一侧坏 |
| T-287 | ③ | `clearDraft` 改成空实现 | 「清后 load 返回 null」红 | 红 · 4 条（两个实现 × 单槽/多槽两条） | — | 还原 |
| T-287 | ④ | 把 `loadDraft` 的 `?? null` 去掉，直接透出底层的 `undefined` | 卡面点名的假绿形状：断言写 `not.toBeNull()` 时会绿 | 红 · 4 条 | — | 还原。**前置断言写的是 `toBeNull()`，不是 `not.toBeNull()`**——后者对 `undefined` 也成立，于是红灯会出现在「清除」上，坏掉的却是「读取」 |
| T-287 | ⑤ | （机制变异）把台账里的 `### [ ] T-288` 改成 `### [x] T-288` | 卡号到期的八行必须立刻转红 | 红 · 8 条「T-288 已经收工了，但这一行还在」 | — | 还原。这一条测的不是产品代码，是**这张卡新加的那档到期机制本身**。没有它，「到期 T-288」就只是一句注释 |
| T-287 | ⑥ | （非变异，是一次撞墙）8 个零调用者的成员，消费者是**下一张卡** | 应当能进某一张豁免表 | 非变异 · 两张表都进不去：四列豁免表 `MAX_EXEMPTIONS` 19/19 只降不升；五列冻结接口表写 `v1.0` **当场就算过期**（当前就是 v1.0） | — | 给 `expires` 加了一档**卡号**（`scripts/lib/exemptions.mjs`），到期条件是那张卡被标 `[x]`。这是**收紧**：卡号行在下一张卡收工时转红，版本行能躺满一个版本。写 `v1.2` 才是那条软路——把隔一张卡的债谎报成隔一个版本的债 |
| T-287 | ⑦ | （非变异，是一次表行清理）`.ext` 的三条冻结行 | 守卫应当点名它们陈旧 | 非变异 · 红 3 条「已经有生产调用者了」，如实 | — | 删掉三行。`ext` 现在真的被写了（两个 provider 都往里挂 drafts），守卫的陈旧检测按预期先于我发现这件事 |
| T-288 | ① | 把 `flush` 里的次序改成 `save → saveDraft` | 顺序断言红 | 红 · 4 条 | — | 还原。次序不是风格问题：草稿是 `save` 失败或来不及时兜底的那一份，写在 `save` 之后就恰好在**唯一需要它的那个窗口**里不存在 |
| T-288 | ② | `save` 失败之后仍然 `clearDraft` | 第二条红 | 红 · 1 条 | — | 还原。这是整条通道唯一真正要保护的那一刻——正式保存失败了，草稿是这份工作仅存的一份，清掉它等于把一次失败变成一次数据丢失 |
| T-288 | ③ | `startHeartbeat` 的间隔恒 0 | 需要一条「N 毫秒里跳 N/间隔 次」的断言，否则绿 | 红 · 1 条 | — | 还原。**只断言「跳过至少一次」的话这条变异会绿**，而间隔 0 是一个忙等循环：功能上看起来完全正常（租约确实一直新鲜），只有电池知道 |
| T-288 | ④ | `bannerFor` 恒返回 `none`（崩溃判定失效） | 横幅红 | 红 · 2 条（纯判定一条 + 打通到真 provider 一条） | — | 还原 |
| T-288 | ⑤ | 心跳复用开机那一刻的 `nowMs` | 「另一个标签页仍然拿不到」应当红 | 绿→红 · 第一版测试直接调 `drafts.heartbeatLease`，而那一层是对的（错的是冷启动怎么包它），所以它绿；改成走生产闭包之后红 | **b** | 测试改成走 `runBoot` 交出来的那个闭包。**这个 bug 是我自己写出来又自己改掉的**：冻住的 `heartbeatAt` 会让租约在标签页活得好好的时候过期，然后被另一个标签页接管。变异登记它，是因为第一版测试对它完全无感 |
| T-288 | ⑥ | （非变异，是棘轮兑现）T-287 挂在冻结接口表上的 8 行 | 本卡接线后应当全部转红 | 非变异 · 红 12 条（8 行 + `facets` 三行 + `Lease.heldBy`），如实 | — | 12 行全删。**T-287 新加的那档卡号到期机制在这里第一次真的兑现**：不是我记得去清，是守卫点名要求清 |
| T-288 | ⑦ | （非变异，是盲区第 5 次）`storage:Lease.heldBy` 被 `acquisition.heldBy` 消掉 | 它本该继续等 v1.5 | 非变异 · 成员扫描是跨包文本正则，分不出两个同名属性 | — | 如实删行并在豁免表里记下第 5 次。删掉是如实的（守卫确实不再认为它是孤儿），代价是 `Lease.heldBy` 从此不再被这道门看着 |
| T-288 | ⑧ | （补，写 T-289 的 E2E 时发现）草稿只在 flush 里写 | 「编辑之后、防抖到期之前草稿就在」应当红 | 红 · 5 条 | — | **这不是变异，是一个真缺陷的回归证据。** 只在 flush 里写草稿的话，能救回来的窗口只有「一次保存正在进行中」的那十几毫秒；而崩溃最常发生在**安静期里**——改完一笔、防抖还没到期的那 1.2 秒。那样的崩溃恢复覆盖的是每 1210 毫秒里的 10 毫秒。改成 `schedule` 当场写、并做合并 |
| T-289 | ① | `classifyLease` 的后两个分支都返回 `closed`（永不报崩溃、永不报占用） | 第 1、3 条红 | 红 · 第 1、3 条，与卡面预期逐字一致 | — | 还原。改的是 `@w3/storage` 的源，所以要重建 dist 才进得了 E2E——类型步骤在变异下会红，ESM 产物先于它生成，E2E 吃的是后者 |
| T-289 | ② | `AutoSaver` 的次序倒过来，并去掉即时草稿 | 第 1 条红 | 红 · 第 1 条 | — | 还原。**两处一起改**才算这条变异：只倒次序的话，即时草稿仍然会在编辑当场落库，崩溃横幅照常出现 |
| T-289 | ③ | 删掉 `pagehide` 里那次 `releaseLease` | 卡面预期第 2 条红 | **绿** · 三条全过 | **b** | **卡面这条预期不成立，如实记。** 第 2 条是「干净退出 → 不提示」，而干净退出时东西都存完了、库里根本没有草稿——`bannerFor` 要求草稿存在，所以横幅本来就不会出现，`closedCleanly` 是不是被写下来无关。⚠ 一度改过第 2 条去制造一份草稿，它当场红了（「有 1 处修改没保存」），但**那条红灯是对的**：那时确实有一笔没落盘，问一句正是该做的。所以问题在我造的前提，不在产品。`releaseLease` 真正的作用域是「flush 只完成了一半」那个竞态（文档存进去了、`clearDraft` 没来得及），E2E 复现不了它 |
| T-289 | ③′ | （替补）`bannerFor` 不再要求草稿存在 | 第 2 条红 | 红 · 第 2 条 | — | 还原。这是第 2 条真正守着的那件事：**崩了但没有草稿也不问**。崩溃本身不值得打扰用户，没保存的东西才值得 |
| T-252 | ① | 把三条结论断言的阈值方向反过来（`toBeGreaterThan(0)` → `toBe(0)`） | 必须转红 | 红 · 3 条 | — | 还原。⚠ **卡面自己说这条变异的目的是「证明测试真的在读像素 / 读计数器，而不是读一个恒真的表达式」，而它做不到**——一个恒定但非零的表达式在这条变异下同样转红。真正钉住产品的是下面 ② ③ 两条 |
| T-252 | ② | （**产品侧变异**，卡面没有而本卡补的）把 `renderer.clippingPlanes` 强制置空 | 剖面处的像素桶必须变 | 红 · 4 条（探针的 clipPlanes 断言 + 两条足迹比较 + 「暂时关闭剖切」那条） | — | 还原。这才是卡面 ① 想要的那种变异：改的是产品，不是测试自己的断言行 |
| T-252 | ③ | （**产品侧变异**）把 outline pass 从 composer 上摘掉 | 同一组像素必须回落 | 红 · 2 条（描边足迹 3735 → 0，以及 ①c 的 composer 那一支） | — | 还原 |
| T-252 | ④ | （非变异，是本卡最值钱的产出：E2E 抓到一个单测抓不到的真缺陷）「新建剖切平面」之后 | 应当开始切 | 非变异 · **一刀没切**：`clipPlanes === 0`。逐 index 的节点新增走 `graph.addNode` 的 O(1) 快路，成功后**直接 return**，`applySections` 一次都不会被调用；整份 `/nodes` 替换那条路也一样。表现是层级树里多了一把刀、面板参数都在、画面一刀没切，而 `fullRebuildCount` 全程是 0 | — | `apply-patch` 的节点新增 / 删除 / 整份替换三处都补上 `applySections`。**单测抓不到它**：单测都是逐字段发补丁的，走不到那条快路——这正是这张观测卡存在的理由 |
| T-252 | ⑤ | （非变异，是三次换观测量）「描边画了多少像素」怎么量 | —— | 非变异 · 三次都读到 0：① 采样直方图数描边色那个桶（`bucketHistogram` 每 37 像素取一个，一两像素宽的轮廓整个被跳过）；② 全分辨率差分「选中 / 取消选中」（按 Escape 之后两张快照**逐字节相同**——没有稳定的取消选中入口）；③ 才换成「开 / 关描边开关」的差分 | — | 最终用 ③：开关描边时选中态不变、gizmo 不动，差出来的就是描边本身。**采样直方图对「一圈轮廓还在不在」完全不敏感**，这条要记住 |
| T-252 | ⑥ | （非变异，是结论的一次反转）第一版预期是「composer 上剖切会失效」 | —— | 非变异 · **不是**：composer 路径上加一把刀确实改变了 39012 像素，剖切生效。真正的偏差是那个数只有直连（183212）的 21% —— 与「被剖掉那一侧仍然画着轮廓」一致 | — | 结论按实测写，不按预期写。断言也照实测的方向立：两条路径都 `> 0`，而不是「composer 那条 `=== 0`」 |
