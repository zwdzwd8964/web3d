import type { SceneDocument } from '@w3/schema'
import { PUMP_DEMO_IDS, createEmptyDocument, createGoldenPathDocument, createPumpDemoDocument, migrate } from '@w3/schema'
import { buildPumpDemoGlb, buildSamplePumpGlb } from '@w3/core'
import type { DraftRecord, DraftsFacet, LeaseAcquisition, LeaseRequest, ProjectSummary } from '@w3/storage'
import { HEARTBEAT_MS } from '@w3/storage'
import type { ProjectSession } from './session.js'

/**
 * T-282 · 项目的一生：新建 / 列表 / 打开 / 重命名 / 删除。
 *
 * ## 这一层在 v0 与 v0.5 里是一组**从未被 UI 触达的 API**
 *
 * 编辑器根本没有「新建项目」——冷启动永远是「恢复最近一份，否则打开泵组样例」。
 * `StorageProvider.deleteProject` 有接口、两个实现、一份契约测试，**零业务调用者**；
 * `listProjects` 只有一个调用点（恢复最近一份）。`createEmptyDocument` 同样从来没有
 * 被生产代码调用过。
 *
 * 本文件是那组 API 的第一个消费者，所以它同时也是它们的第一次检验。
 *
 * ## 为什么逻辑不写进 React 组件
 *
 * 「切换工程之后撤销栈必须是空的」这类事实要能在纯 Node 里断言。写进组件里的话，
 * 唯一能测它的办法是挂一棵 React 树，而那会让「换文档」这条路径的测试代价高到没人写——
 * 而它恰恰是这个仓库**已经踩过一次的坑**（见下面 `openProject` 的注释）。
 */

/* ── 内置文档表 ──────────────────────────────────────────────────────────── */

/**
 * 一份「内置」文档：不是用户建的，而是产品自带的。
 *
 * ## 为什么要有这张表
 *
 * `materialiseSample` 原本的判据是 `doc.projectId !== SAMPLE_PROJECT_ID` —— 一个硬编码
 * 的字符串比较。它在只有一份样例时是对的；而 T-283 要加泵组样板、v1.2 要加场景模板，
 * 每加一份就要在那个 `if` 上再挂一条 `||`。**判据散在实现里，而它本该是一张可枚举的表。**
 *
 * 表把三件事绑在一起：它的 id、它怎么造出来、它需不需要物化。少了任何一件，
 * 「新建项目」的下拉里就会出现一个打得开但发布不了的选项——而那正是 v0 栽过的坑。
 */
export interface BuiltinDocument {
  /** 稳定的 projectId。**它是判据**，所以不能每次调用重新铸一个。 */
  readonly projectId: string
  /** 新建对话框里显示的名字。 */
  readonly label: string
  /** 一句话说清它是什么，给新建对话框显示。 */
  readonly description: string
  /** 造一份新的。每次调用返回一份独立的文档。 */
  readonly create: () => SceneDocument
  /**
   * 这份内置文档的字节从哪来。**给了它就要物化**，没给就是纯文档。
   *
   * `true` 表示这份文档里声明的资产是**占位**：hash 是编的、字节从不存在。打开它之前
   * 必须走一遍「生成字节 → 哈希 → 存进 storage → 把记录改成实际的」，否则发布闸门会
   * 正确地报告「storage 里没有这个 hash」，而用户看到的是一个画得出来却发布不了的工程。
   */
  readonly materialise?: () => Promise<ArrayBuffer>
}

/** SCHEMA_SPEC §12 的样例。**读一次**，不是每次 boot 重建。 */
const GOLDEN_PATH_PROJECT_ID = createGoldenPathDocument().projectId

/**
 * 全部内置文档。
 *
 * T-283 会往这里加泵组样板；v1.2 的场景模板同理。**只许往表里加，判据不许再回到 `if`。**
 */
export const BUILTIN_DOCUMENTS: readonly BuiltinDocument[] = [
  {
    projectId: PUMP_DEMO_IDS.project,
    label: '泵组拆装样板',
    description: '16 个零件、4 条材质、一条从 GLB 导入的「拆装」动画、一个爆炸分组、一条剖切平面。演示与验收都用它。',
    create: createPumpDemoDocument,
    materialise: buildPumpDemoGlb,
  },
  {
    projectId: GOLDEN_PATH_PROJECT_ID,
    label: '黄金路径样例（最小）',
    description: 'SCHEMA_SPEC §12 的样例场景，三个节点。规范的可执行副本，不是拿来演示的。',
    create: createGoldenPathDocument,
    materialise: buildSamplePumpGlb,
  },
]

/** 这个 projectId 是不是内置文档。`null` = 不是。 */
export function builtinOf(projectId: string): BuiltinDocument | null {
  return BUILTIN_DOCUMENTS.find((entry) => entry.projectId === projectId) ?? null
}

/* ── 重命名 ─────────────────────────────────────────────────────────────── */

/**
 * 重命名的**唯一**实现。
 *
 * ## 为什么它不是一个新的 `StorageProvider` 方法
 *
 * `ProjectSummary.name` 是从 `document.name` 派生的（`idb-provider.ts` 建摘要时读的就是
 * 这个字段）。所以「重命名工程」在存储层眼里根本不是一次操作——它是**改文档的一个字段**，
 * 保存之后摘要自己就变了。加一个 `renameProject(id, name)` 到 provider 上，等于让同一件
 * 事有两条写入路径，而两条路径迟早会对同一份文档给出两个名字。
 *
 * 因此本卡**不触发新纪律 8 的 provider 三件套**，也不触发铁律 4（没有新字段）。
 *
 * ## 两条调用路径共用它，但落点不同
 *
 * - 当前打开的工程：`commit('重命名工程', …)` —— **落撤销**，Ctrl+Z 能改回去。
 * - 列表里未打开的工程：`loadDocument → renameProject → saveDocument` —— **不落本端
 *   撤销栈**，因为那份文档的历史根本不在本端。把它塞进本端撤销栈的话，Ctrl+Z 会去
 *   撤销一次「别人的编辑」，而那份文档此刻甚至没有被打开。
 *
 * @param name 新名字。调用方负责挡住空名（见 `isBlankName`）。
 */
export function renameProject(doc: SceneDocument, name: string): SceneDocument {
  return { ...doc, name: name.trim() }
}

/**
 * 空名与纯空白名。
 *
 * 允许重名：`projectId` 才是主键（铁律 3）。两个都叫「泵组」的工程是用户的自由，
 * 而按名字去重会在他复制一份工程时莫名其妙地失败。
 */
export function isBlankName(name: string): boolean {
  return name.trim().length === 0
}

/* ── 生命周期 ───────────────────────────────────────────────────────────── */

/** 打开一份文档时要做的两件事：换文档，以及把上一份的资产字节丢掉。 */
export interface OpenTarget {
  /** 换进来的文档。 */
  readonly doc: SceneDocument
  /** 换进来之前要不要清撤销栈。**恒为 true**，留成字段只为在测试里读得到这个意图。 */
  readonly keepHistory: false
}

/**
 * 新建一份空工程并存下来。
 *
 * 存下来才返回：不存的话，用户新建之后不做任何编辑就刷新，工程就没了——而他刚刚在
 * 对话框里给它起了名字，那是一次明确的意图。
 */
export async function createProject(session: ProjectSession, name: string): Promise<SceneDocument> {
  if (isBlankName(name)) throw new Error('工程名不能为空。')
  const doc = createEmptyDocument({ name: name.trim() })
  await session.save(doc)
  return doc
}

/**
 * 从内置文档表新建一份**用户自己的**工程。
 *
 * **换掉 `projectId`**：内置文档的 id 是物化的判据，沿用它的话，用户第二次「新建 → 泵组
 * 样例」会直接覆盖第一次建的那份——两份工程共用一个主键。所以造出来之后立刻换一个新 id。
 *
 * **物化必须在换 id 之前做完**，因为 `materialiseSample` 的判据正是那个 id。顺序反了
 * 会得到一份画得出来、发布不了的工程（v0 栽过的坑）。
 */
export async function createFromBuiltin(session: ProjectSession, builtin: BuiltinDocument): Promise<SceneDocument> {
  const source = builtin.create()
  const materialised = builtin.materialise ? await session.materialise(source, builtin.materialise) : source
  // 只借它铸一对新 id，其余字段一个不要——`createEmptyDocument` 是这个仓库里唯一的
  // projectId / sceneId 工厂，而 sceneId 是从 projectId 确定性派生的，手搓一个会分家。
  const fresh = createEmptyDocument({ name: materialised.name })
  const doc: SceneDocument = { ...materialised, projectId: fresh.projectId, sceneId: fresh.sceneId }
  await session.save(doc)
  return doc
}

/**
 * 打开一份已存在的工程。
 *
 * ## `keepHistory: false` 不是保守，是必须
 *
 * `DocumentStore.replaceDocument` 的 `keepHistory` 保留的是**上一份文档的撤销栈**。
 * 换完文档之后按 Ctrl+Z，重放的是一条属于「已经不存在的那份文档」的逆补丁——它会
 * **静默损坏当前文档**（`SnapshotPanel` 的注释把这个坑写清楚过，那次的结论是绕开它）。
 *
 * 所以这里恒 `false`，且测试要**两头断言**：切走之前先编辑一次让 `canUndo === true`，
 * 切换之后 `canUndo === false`。只比较两端的测试对「中间什么都没发生」完全无感。
 *
 * ## 为什么要 `loader.dispose()`
 *
 * `AssetLoader` 缓存的是**上一个工程的几何与贴图**。不丢的话，切到新工程后视口里画的
 * 可能仍然是旧工程的东西——而文档、层级树、属性面板全都已经是新的了。**每一个信号都说
 * 切换成功了，只有画面不同意**，这正是 `session.ts` 文件头记录的那个 bug 的形状。
 */
export async function openProject(session: ProjectSession, projectId: string): Promise<OpenTarget> {
  const builtin = builtinOf(projectId)
  const stored = await session.load(projectId)
  if (!stored && !builtin) throw new Error('找不到这个工程，它可能已经被删除。')

  const source = stored ?? builtin!.create()
  const doc = builtin?.materialise ? await session.materialise(source, builtin.materialise) : source

  // 换文档 = 换资产字节的所有者。先丢旧的。
  session.loader.dispose()
  return { doc, keepHistory: false }
}

/** 列表。按 `updatedAt` 倒序——用户找的几乎总是刚动过的那一份。 */
export async function listProjects(session: ProjectSession): Promise<ProjectSummary[]> {
  const projects = await session.storage.listProjects()
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * 删除一份工程。
 *
 * **删的是文档，不是资产字节。** 资产是内容寻址的、可能被别的工程共享的，按工程删会
 * 让另一个工程的模型凭空消失。回收无人引用的字节是另一件事（垃圾回收），不在本卡。
 */
export async function deleteProject(session: ProjectSession, projectId: string): Promise<void> {
  await session.storage.deleteProject(projectId)
}

/**
 * 重命名一份**未打开**的工程。
 *
 * 读 → 改 → 写。不碰本端撤销栈——理由见 `renameProject`。
 */
export async function renameStoredProject(
  session: ProjectSession,
  projectId: string,
  name: string,
): Promise<SceneDocument> {
  if (isBlankName(name)) throw new Error('工程名不能为空。')
  const stored = await session.load(projectId)
  if (!stored) throw new Error('找不到这个工程，它可能已经被删除。')
  const renamed = renameProject(stored, name)
  await session.save(renamed)
  return renamed
}

/* ── 冷启动步骤表 ───────────────────────────────────────────────────────── */

/**
 * 冷启动跑到哪一步、拿到了什么。
 *
 * `notes` 是给人看的：每一步做了什么、为什么落到了这个分支。冷启动失败时用户看到的是
 * 「打开了样例场景」，而他上一次的工作去哪了没有任何交代——这个数组就是交代。
 */
export interface BootContext {
  readonly session: ProjectSession
  /** 到目前为止选定的文档。`null` = 还没有人选出来。 */
  doc: SceneDocument | null
  /** 走到哪一步、发生了什么。按顺序追加。 */
  readonly notes: string[]
  /**
   * T-288 · 开机之后要不要给用户看一条横幅，看哪一条。
   *
   * 是 `BootContext` 的字段而不是 `crash-recovery` 那一步的返回值：步骤表的
   * `run` 统一返回 `void`，加一个返回值等于把每一步的签名都改了。
   */
  recovery: RecoveryBanner
  /**
   * T-288 · 拿到的会话租约要续，续的活儿归调用方（`main.tsx`）。
   *
   * 参数是**当次**的毫秒时刻，不是复用 `request.nowMs`：复用的话 `heartbeatAt` 每次
   * 都写回开机那一刻，租约会在标签页活得好好的时候过期，然后被另一个标签页接管。
   */
  heartbeat: ((nowMs: number) => void) | null
  /** T-288 · 当前会话是谁、现在几点。时钟注入，冷启动才能在纯 Node 里跑。 */
  readonly request: LeaseRequest
}

/** 冷启动的一步。 */
export interface BootStep {
  /** 稳定标识。测试按它断言顺序，所以改名等于改顺序。 */
  readonly id: string
  /** 一句话说清这一步在做什么。 */
  readonly what: string
  readonly run: (ctx: BootContext) => Promise<void>
}

/**
 * T-282 · 冷启动，写成一张显式的表。
 *
 * ## 为什么值得这么做
 *
 * 这段逻辑原本是 `main.tsx` 里的 20 行。它在 v1 有**四个所有者**：
 *
 * | 卡 | 要往冷启动里加什么 |
 * |---|---|
 * | T-282（本卡） | 新建 / 打开的入口，冷启动不再只有「恢复最近一份」 |
 * | T-288 | 崩溃恢复横幅 |
 * | v1.5 | provider 探测（本地 / HTTP） |
 * | v1.5 | 多场景的入口场景 |
 *
 * 四个人先后往同一段 20 行里插代码，而**顺序在这里是有语义的**（session 必须先于
 * store 建好，物化必须先于 store 建好，否则视口一挂载就向 resolver 要字节，得到的是
 * `资产加载失败：pump.glb`）。写成表之后，**后三张卡只允许往表里加步骤，不许重排**，
 * 而「有没有人重排过」由一条断言看着。
 */
export const BOOT_STEPS: readonly BootStep[] = [
  {
    id: 'restore-last',
    what: '打开上次动过的那份工程（能迁移就迁移）',
    async run(ctx) {
      const restored = await restoreLastDocument(ctx.session)
      if (restored) {
        ctx.doc = restored
        ctx.notes.push(`恢复了上次的工程「${restored.name}」`)
      } else {
        ctx.notes.push('没有可恢复的工程')
      }
    },
  },
  {
    id: 'fallback-builtin',
    what: '没有可恢复的就打开内置文档表里的第一份',
    async run(ctx) {
      if (ctx.doc) return
      const builtin = BUILTIN_DOCUMENTS[0]
      if (!builtin) throw new Error('内置文档表是空的，冷启动无处可去。')
      ctx.doc = builtin.create()
      ctx.notes.push(`打开了内置文档「${builtin.label}」`)
    },
  },
  {
    id: 'materialise',
    what: '把内置文档里的占位资产变成真的存进去的资产',
    async run(ctx) {
      if (!ctx.doc) throw new Error('走到物化这一步时还没有文档。')
      // 判据走内置文档表，不是硬编码的 id 比较。
      const builtin = builtinOf(ctx.doc.projectId)
      if (!builtin?.materialise) return
      ctx.doc = await ctx.session.materialise(ctx.doc, builtin.materialise)
      ctx.notes.push('内置文档的占位资产已物化，发布闸门可通过')
    },
  },
  {
    // T-288 · **插在最后，不动前面三步。** 租约要认工程 id，所以它必须排在文档选定
    // 之后；而它又必须排在 store 建起来之前，否则用户已经能编了才告诉他「另一个标签页
    // 正开着这份」。这两条把它钉死在这个位置。
    id: 'crash-recovery',
    what: '抢会话租约，判断上一次是崩的还是关的',
    async run(ctx) {
      if (!ctx.doc) throw new Error('走到崩溃恢复这一步时还没有文档。')
      const { banner, drafts } = await claimSession(ctx.session, ctx.doc.projectId, ctx.request)
      ctx.recovery = banner
      if (drafts) {
        const projectId = ctx.doc.projectId
        ctx.heartbeat = (nowMs) => void drafts.heartbeatLease(projectId, { ...ctx.request, nowMs })
      }
      ctx.notes.push(NOTE_OF[banner.kind])
    },
  },
]

/** 每种横幅在启动日志里对应的一句话。**日志与界面说的是同一件事。** */
const NOTE_OF: Record<RecoveryBanner['kind'], string> = {
  none: '上一次是干净退出的，没有要恢复的东西',
  crashed: '上一次没有干净退出，草稿已找到',
  'other-tab': '这份工程正被另一个标签页占着',
}

/* ── 崩溃恢复（T-288） ───────────────────────────────────────────────────── */

/**
 * 开机之后该给用户看什么。
 *
 * 三种，且**只有三种**：
 *
 * - `none` — 上一次是干净退出的（或者根本没有上一次）。**什么都不问。** 一个每次开机
 *   都问「要不要恢复」的编辑器，会让用户在真的崩了的那一次也顺手点掉。
 * - `crashed` — 上一个会话没打招呼就没了，而且**草稿还在**。带着真实的编辑次数问。
 * - `other-tab` — 另一个标签页正开着这份工程。
 */
export type RecoveryBanner =
  | { readonly kind: 'none' }
  | { readonly kind: 'crashed'; readonly edits: number; readonly savedAt: string; readonly draft: SceneDocument }
  | { readonly kind: 'other-tab'; readonly heldBy: string }

/**
 * 从「租约申请的结果」与「库里的草稿」推出该显示哪条横幅。**纯函数。**
 *
 * 判定拆出来是因为它有四个输入分支而只有三个输出，中间那两条最容易写错：
 *
 * 1. 崩了**但没有草稿** → `none`。崩溃本身不值得打扰用户，没保存的东西才值得；
 *    没有草稿说明上一次崩之前所有东西都已经落盘了。
 * 2. 拿不到租约 → `other-tab`，**而且这一条压过崩溃**。另一个标签页正拿着这份工程时，
 *    把草稿恢复进来会让两边同时编同一份，后写的覆盖先写的。
 *
 * @param acquisition `acquireLease` 的结果。
 * @param draft 库里那份草稿，没有就是 `null`。
 */
export function bannerFor(acquisition: LeaseAcquisition, draft: DraftRecord | null): RecoveryBanner {
  if (!acquisition.ok) return { kind: 'other-tab', heldBy: acquisition.heldBy.sessionId }
  if (acquisition.previous !== 'crashed') return { kind: 'none' }
  if (!draft || draft.edits <= 0) return { kind: 'none' }
  return { kind: 'crashed', edits: draft.edits, savedAt: draft.savedAt, draft: draft.document }
}

/** `startHeartbeat` 要的东西。定时器注入，所以它在纯 Node 里可测。 */
export interface HeartbeatOptions {
  readonly beat: () => void
  readonly intervalMs?: number
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

/**
 * 每 `intervalMs` 跳一次，直到调用返回的那个函数。
 *
 * 间隔非正数直接抛：`setInterval(fn, 0)` 会变成「每一帧一次」，把租约心跳变成一个
 * 忙等循环——而那件事在功能上**看起来完全正常**（租约确实一直是新鲜的），只有电池
 * 和风扇知道。
 *
 * @returns 停止心跳。
 */
export function startHeartbeat(options: HeartbeatOptions): () => void {
  const intervalMs = options.intervalMs ?? HEARTBEAT_MS
  if (!(intervalMs > 0)) throw new Error(`心跳间隔必须是正数，实际是 ${intervalMs}。`)
  const setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms))
  const clearTimer = options.clearTimer ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>))
  const handle = setTimer(() => options.beat(), intervalMs)
  return () => clearTimer(handle)
}

/**
 * 这个标签页的会话标识。**一次开机一个，刷新算新会话。**
 *
 * 刷新之后旧的那份租约确实没人续了，所以它该被判成一个结束了的会话——如果沿用同一个
 * 标识，`classifyLease` 会返回 `self`，于是「刷新之前崩过一次」这件事永远查不出来。
 *
 * 模块级可变状态，是铁律 1 的运行时瞬态例外（与「当前播放进度」同类）：它不进文档、
 * 不跨刷新、不影响任何两个视图之间的一致性。
 */
let currentSessionId: string | null = null

/** 这个标签页的会话标识。第一次调用时生成。 */
export function sessionIdOf(): string {
  currentSessionId ??= `ses_${Math.random().toString(36).slice(2, 10)}`
  return currentSessionId
}

/** 这个 provider 支持崩溃恢复吗。不支持时整条路径静默跳过——不是报错。 */
export function draftsOf(session: ProjectSession): DraftsFacet | null {
  return session.storage.facets.includes('drafts') ? (session.storage.ext.drafts ?? null) : null
}

/**
 * 一次开机的租约申请 + 草稿读取，合成一条横幅。
 *
 * @param request 当前会话是谁、现在几点、多久算崩（E2E 用 `?w3LeaseStaleMs=` 调小）。
 */
export async function claimSession(
  session: ProjectSession,
  projectId: string,
  request: LeaseRequest,
): Promise<{ banner: RecoveryBanner; drafts: DraftsFacet | null }> {
  const drafts = draftsOf(session)
  if (!drafts) return { banner: { kind: 'none' }, drafts: null }
  const acquisition = await drafts.acquireLease(projectId, request)
  // 草稿只在真崩了的时候才读：拿不到租约时读它没有意义，而每次开机都读一遍等于给
  // 冷启动加一次不必要的库往返。
  const draft = acquisition.ok && acquisition.previous === 'crashed' ? await drafts.loadDraft(projectId) : null
  return { banner: bannerFor(acquisition, draft), drafts }
}

/**
 * 按表跑一遍冷启动。
 *
 * @returns 选定的文档与一路上的说明。**文档一定非空**——表的最后一步之前必有兜底。
 */
export async function runBoot(
  session: ProjectSession,
  request: LeaseRequest,
): Promise<{ doc: SceneDocument; notes: readonly string[]; recovery: RecoveryBanner; heartbeat: ((nowMs: number) => void) | null }> {
  const ctx: BootContext = { session, doc: null, notes: [], recovery: { kind: 'none' }, request, heartbeat: null }
  for (const step of BOOT_STEPS) await step.run(ctx)
  if (!ctx.doc) throw new Error('冷启动跑完了但没有文档，步骤表少了兜底那一步。')
  return { doc: ctx.doc, notes: ctx.notes, recovery: ctx.recovery, heartbeat: ctx.heartbeat }
}

/**
 * 打开最近动过的那份工程，必要时迁移。
 *
 * `migrate` 而不是 `validate`，这个区别就是宪法 C4 的全部。因为 `schemaVersion` 是
 * `z.literal(CURRENT_VERSION)`，旧版本存下来的文档直接过不了校验。这条路径原本调的是
 * `validate` 并回落到样例——在 v1 是唯一版本时看不出来，v2 一发布就变成「所有工程都
 * 不见了」：用户的东西还在盘上，但他**看到**的是样例场景，与数据丢失无从分辨。
 *
 * 迁移后的文档**不在这里写回**。它在第一次自动保存时落盘，于是一次用户随后放弃的升级
 * 不会动到原始记录。
 *
 * 完全迁移不动的记录是**报告并跳过**，不是抛出：因为一条坏记录而打不开编辑器，比从样例
 * 开始糟糕得多，而那条记录留在原地，还能被捞回来。
 *
 * T-229 · 导出是为了让 `restore-migrates.test.ts` 调到**生产路径本身**，不是新 API。
 * 另一条路是在测试里重写一遍恢复逻辑，那样「把 `migrate` 改回 `validate`」这条变异就
 * 不会红——测试自造一份实现，正是 T-176 那条存活 blocker 的形状。
 *
 * T-282 · 从 `main.tsx` 挪到这里，因为它现在是 `BOOT_STEPS` 的第一步，而步骤表要能在
 * 纯 Node 里跑。
 */
export async function restoreLastDocument(session: ProjectSession): Promise<SceneDocument | null> {
  try {
    const latest = (await listProjects(session))[0]
    if (!latest) return null

    const stored = await session.load(latest.projectId)
    if (!stored) return null

    const result = migrate(stored)
    if (!result.ok) {
      console.warn('[project] 上次保存的文档无法打开，已改为打开样例场景。原文档未删除。', result.error)
      return null
    }
    if (result.value.applied.length > 0) {
      console.info(`[project] 文档已从 v${result.value.fromVersion} 升级到 v${result.value.toVersion}`, result.value.applied)
    }
    return result.value.document
  } catch (error) {
    console.warn('[project] 读取上次的文档失败，已改为打开样例场景。', error)
    return null
  }
}
