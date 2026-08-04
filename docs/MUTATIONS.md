# 变异检验登记表

**这份表是干什么的**：每新增一条测试，把它保护的行为**故意改坏**一次，看测试转不转红。
转红说明这条测试真的在测东西；**不转红说明它不是**。两种结果都登记在这里。

**为什么不写进提交信息**：提交信息不可查询、不可统计、不可回填（风险 V25）。
`scripts/check-mutations.mjs`（**T-297 交付**）会读这张表并把它挂进 `pnpm verify`。
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
| **实际** | `红` 或 `绿` |
| **若绿属哪一类** | 封闭枚举 `a` / `b` / `c`。**「实际」为红时填 `—`** |
| **处置** | 怎么处理的。**「实际」为绿时必填**，不许写「已知」「稍后处理」 |

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
（这条不进下面的表：表里的卡号必须在 v1 台账里存在，T-183 是 v0.5 的卡。）

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
| T-204 | ② | `MAX_CHAIN_DEPTH` 改成 `Number.MAX_SAFE_INTEGER` | 反之：同步那条红、跨 await 那条保持绿 | 绿 / 红（正是要的一红一绿） | — | 还原。两道防线确实各管各的，没有互相掩护 |
| T-204 | ③ | churn 错误措辞「1 秒内变化超过」改成「1 秒内变动超过」 | 断言必须红 | 红 | — | 还原。断到措辞而不是「打了 error」——v0.5 T-186「两条守卫互相掩护」的直接对策 |
| T-204 | ④ | （非变异，是复现）两条互写变量的规则夹一个 `wait(1ms)`，跑 3000 ms 引擎时间 | 期望 `MAX_CHAIN_DEPTH` 报警 | **零告警、不收敛**（实测跑到第 480 跳仍在增长） | — | 这就是本卡存在的理由，写成了测试的前置断言（`counts.a + counts.b > 400`）。对照组：去掉 `wait` 恰好在第 16 层报一条 |
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
| T-207 | ⑨″ | 卡面「（22 条以规划 §7.1 的表行数为准」改成「21 条」 | 规则 7 红（**第三种形状**） | **第一次是绿的** | **a** | 形状 ③ 的正则写成 `\*\*(\d+) 条\*\*`，而三张卡里有一张没加粗——**这条形状从写出来那天起就匹配 0 处**。改成 `\*{0,2}` 后重跑转红（`21 vs 22`），全仓声明数从 18 涨到 21。**读正则读不出来，只有真跑探针才发现** |
| T-207 | ⑩ | 从规则 5 的对照表里删掉 `AI provider 插座` 那一行 | 规则 5 红（新增能力必须同时登记落点） | 红 | — | 还原 |
| T-207 | ⑩′ | 把 NORTH_STAR §3 的「AI provider 插座」落点删掉（= 本卡开工时的真实状态） | 规则 5 红 | **第一次是绿的** | **a** | 规则 5 在**整节**里找落点，而我为这次补录写的那段说明本身就含「AI provider 插座」六个字——**断言匹配到的是解释漏洞的散文，不是清单本身**。改成只在 `**新增**：` 那一行里找，重跑转红 |
| T-208 | ① | 在 `engine.ts` 里临时写 `if (action.type === 'x')` | `check-core-purity` 必须红（**A6 说这条有实质风险，必须实测**） | 红：`engine.ts:170  C5/A3: literal comparison against a step discriminant` | — | 还原。**不是装饰品**——但代价第 3 条要如实记：`EXECUTOR_ONLY_SMELLS`（裸 `switch` / `case 'kind'`）仍只锁 `executor.ts`，在 `engine.ts` 里写裸 `switch (kind)` **今天不会红**（反向探针已验），这是 ADR-0028 代价 3 的既定取舍 |
| T-208 | ①′ | 按卡面字面写 `/executor\|dispatch\|engine/i`（不锚 basename） | —— | **本机 19/19 全中，CI 只中 1 个** | — | **不是变异，是勘察实测出的地雷**：`collectFiles` 返回绝对路径，而检出目录叫 `0729 3d engine`。照字面写会在本机报两条 `headless.ts` 的假违规（`animation.kind === 'tween'` / `light.kind === 'hemisphere'`），CI 上却是绿的。改成 `/(executor\|dispatch\|engine)\.ts$/` |
| T-208 | ② | 往 `packages/schema/src/selectors.ts` 加 60 条永不被调用的语句 | `pnpm -F @w3/schema test` 必须红 | 红，exit 1：`Statements 83.13% < 90%`、`branches 71.31% < 80%`、`lines 88.53% < 90%` | — | 还原。**这条门槛此前从未执行过**（阈值配置在 `vitest.config.ts` 里躺着，而 test 脚本是裸 `vitest run`） |
| T-208 | ②′ | （不是变异，是核实）补上 `--coverage` 之后**今天是绿的** | —— | 94.78% / 88.53% / 97.32% / 95.9%，四条阈值全过 | — | 「阈值从未执行」属实，但它不是一个待修的真缺陷。⚠ **branches 88.53% 距离 80 的阈值有余量，距离 90 只有 1.5 个点**——若有人顺手把 branches 也提到 90，当场变红 |
| T-208 | ③ | 往 `packages/core/src/runtime` 临时写 `setInterval` | `check-core-purity` 必须红 | 红：`picker.ts:38  non-deterministic: setInterval()` | — | 还原。C8 扫描面从 `src/eca`（19 个文件）扩到 `+ src/runtime`（46 个），配 6 行具名豁免——被豁免的正是 `ctx.now()` / `ctx.wait()` 的实现本体与渲染循环 |
| T-208 | ④ | 把 `size-budget.json` 的 player 改成 100 | `pnpm size` 必须 FAIL 且 exit 1 | 红，exit 1 | — | 还原 |
| T-208 | ④′ | **删掉 `size-budget.json`** | 必须拒绝给结论，而不是静默通过 | 红：「预算文件缺失时本脚本拒绝给出结论」，exit 1 | — | 还原。`total <= undefined` 与 `total > undefined` **都是 false**——预算文件缺失时读成 pass 还是 fail，取决于比较符往哪边写。所以直接拒绝，不比较 |
| T-217 | ① | `measureFromHeader` 的三角面公式改成一律 `Math.floor(count / 3)` | 交叉校验红 | **前两次都是绿的** | **a** | 第一次：全部 fixture 都是 mode 4，`if (mode===4) … else if (5\|6) …` 与 `count/3` 在这条数据上不可区分。补 `buildMixedModeGlb`（0/1/4/5/6 五种 mode）后**第二次仍然绿**——**4 个顶点时两个公式的和恰好相等**（`0+0+1+2+2 = 5` 与 `1+1+1+1+1 = 5`）。改成 7 个顶点（`0+0+2+5+5 = 12` vs `2×5 = 10`）才转红。**一份 fixture 可以满足测试的每一条结构要求，却仍然无法让它失败** |
| T-217 | ①′ | `textures` 改读 `json.textures.length`（而不是 `json.images.length`） | 交叉校验红 | **第一次是绿的** | **a** | 现有 fixture 是 1 image / 1 texture，两者不可区分（勘察时就预警过）。补一份「一张图背两个 texture」的 fixture 后转红。⚠ gltf-transform 的**写入端**对同样字节仍会各写一份 image，所以这份 fixture 只能靠重写 JSON chunk 造——而「一张图两个采样器」是真实导出器天天产出的形状 |
| T-217 | ② | `readGlb` 去掉 `registerExtensions(ALL_EXTENSIONS)` | **卡面说**「Draco 不再抛异常」会红 | 红——但**红的不是卡面说的那条** | — | **卡面这条验收在实现层面不成立**：实测 `registerExtensions` 让 Draco 从可读的 `Error: Missing required extension` 变成不可读的 `TypeError: Cannot read properties of undefined (reading 'DT_FLOAT32')`（`KHRDracoMeshCompression.install()` 急切调 `initDecoderModule(undefined)`）。「不再抛异常」只能靠**容器分流**实现。因此另写了一条真会红的断言：扩展块被读进 Document 而不是被丢掉 |
| T-217 | ③ | `needsContainerRoute` 的判据取反 | 分流断言红 | 红，4 条 | — | 还原 |
| T-217 | ④ | `readGlbHeader` 去掉 magic 校验 | 「非 GLB 返回 null」红 | **前三次都是绿的** | **a** | 合成的坏字节里 JSON chunk 是四个 0，`JSON.parse` 先抛、被 catch、返回 null——magic 检查删了照样绿。换成「一份完全合法的 GLB，只把头四个字节改成 zip 的 `PK\x03\x04`」才转红。**这也是真实形状**：一个 `.bin` / `.zip` / 截断的上传 |
| T-222 | ① | `ValveCover` 改名成 `Cover` | 路径清单红 | 红，2 条（三方相等 + 父路径存在） | — | 还原 |
| T-222 | ② | 把 Volute 与 Shaft 从 `steel` 挪走（10 → 8） | 共享断言红 | **第一次是绿的** | **a** | 断言遍历的是 `loaded.objects.values()` 的每一个再各自 `traverse` 一遍——嵌套对象被祖先重复计数，乘上了树深。**它在只有 9 个 steel mesh 时也是绿的**。改成从 `scene` 单次遍历、按 mesh 去重后转红。顺带把 Motor 也改成 steel，让 10 这个数字成立 |
| T-222 | ③ | `SAMPLE_OBJECT_PATHS` 删掉 `Root/Pump/Body` | 新补那条红 | 红 | — | 还原。**证明它此前确实什么都没测**——这个常量导出两个版本、零断言 |
| T-222 | ④ | 去掉 `buildDisassembleClip(...)` 调用 | `stats.animations` 断言红 | 红，3 条 | — | 还原。样本资产记录手写 `stats.animations: ['Disassemble']` 而 GLB 里一条动画通道都没有，实测 stats 会把它覆盖成 `[]`——这条断言读的是实测 stats，手写记录满足不了它 |
| T-222 | ⑤ | （非变异，是 T-205 的守卫缺口）新增 `export async function buildPumpDemoGlb` 之后孤儿数**没有变化** | 应该多一个孤儿 | 绿 → 查出守卫瞎了 | **a** | `check-dead-exports.mjs` 的两条正则都写成 `export\s+(declare)?(abstract)?(function\|const\|…)`，**没有 `async`**。后果有两层：① 导出面根本收不到 `export async function`；② 即使收到，它自己的声明行会被当成一次「使用」。两条都补上 `(?:async\s+)?` 之后，`buildPumpDemoGlb` 才如实报成孤儿并进豁免表（owner T-283）。**这是 T-205 的守卫第一次被外部用例证伪** |
| T-224 | ⓪ | `filterNodes` 的祖先查找从 `byId.get(parent)` 改成 `doc.nodes.find((n) => n.id === parent)`（教科书式 O(n²)） | 1000/2000 比值测试红 | **绿 → 改测试后又时红时绿 → 换掉断言方式才稳定红（5/5）** | **a** | 三步。① **第一次绿**：比值测试的查询是 `零件`，它命中每一个节点，于是每个节点的父节点在轮到它时**已经在 `visible` 里**，循环在第一跳就 `break`，那行查找**一次都没执行**——被变异的代码根本不在测试的执行路径上。② 把最深的那个节点单独改名成 `末端零件`、用只命中它的查询把整条链走满之后，变异**时红时绿**：这个规模下二次项（≈ `n²/20`）与线性建表开销同量级，比值落在 3 附近，往哪边掉由 GC 决定。**卡面点名的「必须用 1000/2000」是对的，但不充分。** ③ 最终改成**数数而不是掐表**：用 Proxy 包住 `doc.nodes` 数一遍下标读取次数，诚实实现是 ~2n，每跳一次扫描是 ~n²/20，断言 `< 6n`。连跑 5 次全红 |
| T-224 | ① | `filterNodes` 里去掉 `visible.add(parent)`（不收集祖先） | 「父链可见」红 | 红，3 条（父链可见 + 折叠分支里的命中 + 只标命中行） | — | 还原 |
| T-224 | ② | `flattenTree` 的 `if (filter !== null \|\| !collapsed.has(node.id))` 改回 `if (!collapsed.has(node.id))`（有 filter 时仍尊重折叠） | 「折叠分支里的命中仍出现」红 | 红，1 条 | — | 还原 |
| T-224 | ③ | 空查询返回 `{ visible: 全部 id, matched: 空 }` 而不是 `null` | 零开销断言红 | 红，2 条（空串 + 纯空白串，都断在 `toBe(null)` 上） | — | 还原。断言用 `toBe(null)` 而不是 `toBeFalsy()`——空 Set 版本对每个调用方**行为完全相同**，只是让未过滤时的每次渲染多做 n 次成员测试，只有严格相等能把这个差别钉住 |
| T-224 | ④ | `clampScrollTop` 去掉上界：`return Math.max(0, scrollTop)` | 钳位测试红 | 红，2 条 | — | 还原。这条是卡面之外补的：钳位若写在组件的 `useEffect` 里就无法被测（编辑器单测跑纯 Node，无 jsdom），所以它必须是纯函数，而纯函数就该有自己的变异 |
| T-209 | 探针1 | 在 `App.tsx` 顶部加 `void fetch('/x')` | `check-provider-swap` R2 红 | 红，1 条，点名 `packages/editor/src/App.tsx:2` | — | 还原。**这是「债 A」的直接证据**：同一段代码在本卡之前跑 `pnpm check:constitution` 是全绿的——C7 的两个守卫都不扫 fetch |
| T-209 | 探针2 | 在 `main.tsx` 里加 `new MemoryProvider()` | R1 红 | 红，2 条（R1 未申报构造点 + R3 装配点 2 处） | — | 还原 |
| T-209 | 探针2′ | 把申报的构造点从 `session.ts` **搬到**新文件（本卡自加，卡面没有） | 集合相等两头都要红 | 红，3 条——其中一条是「**申报的构造点消失了**」 | — | 卡面只给了「新增一处」的探针，而集合相等真正比「≤1 个文件」强的地方在**搬走**这一侧。没有这条探针，变异 ① 无法被证伪 |
| T-209 | ① | R1 从集合相等改成 `if (foundProviderSites.size > 1)` | **探针 2 必须仍红**（变绿说明写成了更弱的判据） | 红——**卡面预期正确，但探针 2 无法区分两种判据** | — | 于是拿探针 2′ 在同一个变异下再跑一次：R1 **哑了**，只剩 R3 偶然抓到（且只因为探针恰好多了一处 import）。更干净的一次：只搬构造点、不新增 import，R1 打印「构造点 1 处，申报 1 处」——**两个数字相等，而它数的那一处根本不是它申报的那一处**。计数式判据会在断言成立的同时说一句假话 |
| T-209 | 探针3 | 在 `App.tsx` 里写 `` console.log(`https://${host}.telemetry-probe.net/x`) `` 并重新构建 | `check-no-external` 红 | **第一次是绿的 → 查出是探针自己没生效** | — | 第一版探针的注入正则 `/^(import .*\n)/m` 一次都没匹配上（文件没变，`head -4` 一看就知道），构建产物里根本没有这个字符串。**一个没跑起来的探针和一个通过了的探针，在输出里长得一模一样。** 换成锚在 `export function App` 前注入之后：产物里是 `https://${YR}.telemetry-probe.net/x`（`host` 取 `location.hostname`，esbuild 折不掉），守卫红 |
| T-209 | ② | 模板白名单读成「文件存在即全部放行」 | **卡面写「探针 3 必须仍红」** | **绿** | **c** | **卡面这条预期不成立，且不成立是可证的**：全部放行就意味着探针 3 的模板地址被放行，它只能变绿。这个变异复现的正是 T-209 之前那一行 `url.includes('${')` 的行为——它**是**本卡要消灭的洞，不是洞的检测器。按「若绿属哪一类」归 c（被测代码本来就是对的：真正该红的是下面两条） |
| T-209 | ②′ | 把 `docs/EXTERNAL_URL_ALLOWLIST.md` 整个删掉 | 必须红，且红的理由是「表读不到」 | 红，5 条：第一条「豁免表不存在」，随后 4 条模板地址失去豁免 | — | 还原。**这才是卡面想要的那条**：表缺失时必须是「什么都不豁免 + 点名表不见了」，不能是「什么都豁免」 |
| T-209 | ②″ | 把读表路径改成 `docs/TYPO_ALLOWLIST.md`（拼错） | 必须红 | 红，5 条，第一条点名拼错的路径 | — | 还原。**本版第四次写下 M6 形状**（T-205 的 M6 · T-207 的规则 6 变异 ⑧ · T-297 卡面的变异 ⑤ · 本条）。一个路径写错的守卫永远绿，是这套体系里最贵的失效模式 |
| T-214 | ① | `pixelRatio()` 里 `Math.min(Math.max(raw,1), MAX_PIXEL_RATIO)` 改成 `return raw`（不封顶） | dpr=3 那条红 | 红，4 条（dpr=3 · 0.5 下限 · resize 复用 · globalThis 兜底） | — | 还原 |
| T-214 | ② | `MAX_PIXEL_RATIO` 2 改成 1 | dpr=2 那条红 | 红，3 条 | — | 还原。**两向都要红**：只测「3 变 2」分不出封顶是 2 还是 1，只测「2 还是 2」分不出封顶是 2 还是没有封顶。①②合起来才把上限钉在 2 |
| T-214 | ③ | 把 `limits.pixelRatio` 从 `captureDevicePixels` 与 `maxCaptureScale` 两处公式里删掉 | 两条 `pixelRatio: 2` 的用例红 | 红，2 条 | — | 还原。**这是 X-17 的机器落点**：T-262 的钳位单测注入桩 `limits`，缺了这一项的公式在单测里全绿，只有在真实 2× 屏上炸——现象是 `webglcontextlost`，整页变白 |
| T-214 | ④ | `resize` 里去掉 `setPixelRatio` 调用（只在 attach 时设一次） | resize 复用那条红 | 红，1 条 | — | 还原。把窗口拖到另一块屏只触发 resize，不触发 attach |
| T-214 | ⑤ | `setSize(w,h,false)` 改成 `true` | CSS 尺寸不变那条红 | 红，1 条 | — | 还原。`updateStyle` 与 `setPixelRatio` 是一对：设了像素比又让 three 写 inline 尺寸，2× 屏上画布会变成容器的两倍大 |
| T-214 | ⑥ | （非变异，是接线后暴露的）给 `attachRenderer` 加一行 `renderer.setPixelRatio(...)` 之后，`pnpm -F @w3/core test runtime` **94 条红** | 本不该有连带影响 | 红，94 条，分布在 6 个文件 | — | 六份渲染器桩都以 `as never` / `as unknown as WebGLRenderer` 收尾，**因此可以合法地少实现 `RendererLike` 的成员**——`setPixelRatio` 在接口里一直是必填的，只是从来没有生产代码调用它，所以没人发现。这正是 T-200 的 docstring 点名的那个形状（「a stub could omit any member and the mistake would surface as an `undefined is not a function`」），第一次被真实用例证实。六处各补一行后全绿 |
