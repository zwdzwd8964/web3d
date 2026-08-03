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
