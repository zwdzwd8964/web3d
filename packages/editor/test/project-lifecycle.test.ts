import { readFileSync, readdirSync, statSync } from 'node:fs'
import { buildSamplePumpGlb } from '@w3/core'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PUMP_DEMO_IDS, createGoldenPathDocument } from '@w3/schema'
import { MemoryProvider } from '@w3/storage'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  BOOT_STEPS,
  BUILTIN_DOCUMENTS,
  builtinOf,
  createFromBuiltin,
  createProject,
  deleteProject,
  isBlankName,
  listProjects,
  openProject,
  renameProject,
  renameStoredProject,
  runBoot,
} from '../src/project/project-lifecycle.js'
import { ProjectSession } from '../src/project/session.js'
import { createDocumentStore } from '../src/store/document-store.js'

/**
 * T-282 · 项目的一生。
 *
 * ## 这一层此前是一组从未被 UI 触达的 API
 *
 * `deleteProject` 有接口、两个实现、一份契约测试，**零业务调用者**；`createEmptyDocument`
 * 从来没有被生产代码调用过；`listProjects` 只有一个调用点。契约测试证明的是「实现符合
 * 接口」，而没有任何东西证明过「有人真的用它」——本文件是第一次。
 *
 * ## 为什么这里到处在断言撤销栈而不是名字
 *
 * 本卡最容易假绿的地方，是**两条重命名路径都能让列表里的名字变**。区别只在撤销栈：
 * 当前打开的那一份走 `commit`（落撤销），列表里另一份走读改写（不碰本端撤销栈）。
 * 只断言「名字变了」的话，把后者也塞进撤销栈这个缺陷不会有任何东西红——而它的后果是
 * 用户按 Ctrl+Z 撤销掉一次「别人的编辑」。
 */

let session: ProjectSession
let storage: MemoryProvider

beforeEach(() => {
  storage = new MemoryProvider()
  session = new ProjectSession({ storage })
})

/* ── 生产调用者（卡面的 grep 断言）────────────────────────────────────────── */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 递归读 `packages/editor/src` 下的全部源码，拼成一份文本。 */
function productionSource(): string {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry)) out.push(readFileSync(path, 'utf8'))
    }
  }
  walk(SRC)
  return out.join('\n')
}

describe('T-282 · 那组 API 终于有了生产调用者', () => {
  const source = productionSource()

  it('扫描面没塌 —— 真的读到了源码', () => {
    // D36 M6：一个匹配不到文件的 glob 会报告零违规，而零违规看起来像成功。
    expect(source.length).toBeGreaterThan(50_000)
    expect(source).toContain('export function App')
  })

  it('`createEmptyDocument` 有生产调用者', () => {
    expect(source).toContain('createEmptyDocument(')
  })

  it('`deleteProject` 有生产调用者', () => {
    // v0 起它就有接口、两个实现、一份契约测试，而没有一行业务代码调过它。
    expect(source).toContain('deleteProject(')
  })

  it('`listProjects` 的调用点不止「恢复最近一份」那一个', () => {
    expect((source.match(/listProjects\(/g) ?? []).length).toBeGreaterThan(1)
  })

  it('全程只经 `StorageProvider` —— `packages/editor/src` 里零 `indexedDB` 字样', () => {
    // C7。这一条 `check-storage-abstraction.mjs` 也在查，这里再钉一次，因为本卡是
    // 第一次让编辑器大量触碰存储层。
    expect(source).not.toMatch(/\bindexedDB\b/)
  })
})

/* ── 内置文档表 ─────────────────────────────────────────────────────────── */

describe('T-282 · 内置文档表取代硬编码的 id 比较', () => {
  it('表非空，且每一项都齐全', () => {
    expect(BUILTIN_DOCUMENTS.length).toBeGreaterThan(0)
    for (const builtin of BUILTIN_DOCUMENTS) {
      expect(builtin.projectId, builtin.label).toMatch(/^prj_/)
      expect(builtin.label.length, builtin.projectId).toBeGreaterThan(0)
      expect(builtin.description.length, builtin.projectId).toBeGreaterThan(0)
      expect(typeof builtin.create).toBe('function')
    }
  })

  it('黄金路径样例在表里，且判据认得它', () => {
    const sample = createGoldenPathDocument()
    expect(builtinOf(sample.projectId)).not.toBeNull()
    expect(typeof builtinOf(sample.projectId)!.materialise, '内置文档要带一个字节生成器').toBe('function')
  })

  it('用户建的工程不在表里', () => {
    expect(builtinOf('prj_useruser')).toBeNull()
  })

  it('`create()` 每次给一份独立的文档，不是同一个对象', () => {
    // 共用一个对象的话，用户在样例上改一笔，下一次「新建 → 样例」就带着那一笔。
    const a = BUILTIN_DOCUMENTS[0]!.create()
    const b = BUILTIN_DOCUMENTS[0]!.create()
    expect(a).not.toBe(b)
    expect(a.projectId).toBe(b.projectId)
  })
})

/* ── 冷启动步骤表 ───────────────────────────────────────────────────────── */

/** T-288 · 冷启动现在要一个租约申请。固定时钟——测试里不许有真实时间。 */
const BOOT_REQUEST = { sessionId: 'ses_test01', nowMs: 1_000_000 }

describe('T-282 · 冷启动是一张显式的表', () => {
  it('顺序被钉住 —— 后续三张卡只许加步骤，不许重排', () => {
    // 顺序在这里是有语义的：物化必须先于 store 建好，否则视口一挂载就向 resolver
    // 要字节，得到的是「资产加载失败：pump.glb」。T-288 / v1.5 两张卡还要往表里加东西。
    // T-288 插了第四步 crash-recovery，**追加在末尾**，前三步一个字没动。
    expect(BOOT_STEPS.map((s) => s.id)).toEqual(['restore-last', 'fallback-builtin', 'materialise', 'crash-recovery'])
  })

  it('每一步都说得出自己在做什么', () => {
    for (const step of BOOT_STEPS) expect(step.what.length, step.id).toBeGreaterThan(4)
  })

  it('空存储 → 落到内置文档，且资产被物化（发布闸门能过）', async () => {
    const { doc, notes } = await runBoot(session, BOOT_REQUEST)
    expect(doc.projectId).toBe(BUILTIN_DOCUMENTS[0]!.projectId)
    // 物化的证据是**字节真的在存储里**，不是「文档打开了」。
    expect(await storage.hasBlob(doc.assets[0]!.hash)).toBe(true)
    expect(notes.some((n) => n.includes('物化'))).toBe(true)
  })

  it('有存过的工程 → 恢复它，而不是又打开样例', async () => {
    const mine = await createProject(session, '我的工程')
    const { doc } = await runBoot(session, BOOT_REQUEST)
    expect(doc.projectId).toBe(mine.projectId)
    expect(doc.name).toBe('我的工程')
  })
})

/* ── 新建 / 列表 / 删除 ─────────────────────────────────────────────────── */

describe('T-282 · 新建 → 保存 → 列表里出现', () => {
  it('新建之后立刻就在列表里，不用先编辑一次', async () => {
    // 不存就返回的话，用户新建之后不做任何编辑就刷新，工程就没了——而他刚在对话框里
    // 给它起了名字，那是一次明确的意图。
    const created = await createProject(session, '3 号泵房')
    const list = await listProjects(session)
    expect(list.map((p) => p.projectId)).toContain(created.projectId)
    expect(list.find((p) => p.projectId === created.projectId)!.name).toBe('3 号泵房')
  })

  it('空名与纯空白名被挡住', () => {
    expect(isBlankName('')).toBe(true)
    expect(isBlankName('   ')).toBe(true)
    expect(isBlankName('\t\n ')).toBe(true)
    expect(isBlankName(' 泵房 ')).toBe(false)
  })

  it('新建时空名直接拒绝', async () => {
    await expect(createProject(session, '  ')).rejects.toThrow(/不能为空/)
  })

  it('**允许重名** —— projectId 才是主键（铁律 3）', async () => {
    const a = await createProject(session, '泵组')
    const b = await createProject(session, '泵组')
    expect(a.projectId).not.toBe(b.projectId)
    expect((await listProjects(session)).filter((p) => p.name === '泵组')).toHaveLength(2)
  })

  it('从内置样板新建时**换掉 projectId**，两次新建互不覆盖', async () => {
    const builtin = BUILTIN_DOCUMENTS[0]!
    const first = await createFromBuiltin(session, builtin)
    const second = await createFromBuiltin(session, builtin)
    expect(first.projectId).not.toBe(second.projectId)
    expect(first.projectId).not.toBe(builtin.projectId)
    expect(await listProjects(session)).toHaveLength(2)
  })

  it('从内置样板新建时资产**已经物化**（发布闸门能过）', async () => {
    // 物化必须在换 id 之前做完——判据正是那个 id。顺序反了会得到一份画得出来、
    // 发布不了的工程，而这正是 v0 栽过的坑。
    const doc = await createFromBuiltin(session, BUILTIN_DOCUMENTS[0]!)
    expect(await storage.hasBlob(doc.assets[0]!.hash)).toBe(true)
  })

  it('列表按最近动过的排前面', async () => {
    await createProject(session, '旧的')
    await new Promise((resolve) => setTimeout(resolve, 2))
    const recent = await createProject(session, '新的')
    expect((await listProjects(session))[0]!.projectId).toBe(recent.projectId)
  })

  it('删除之后列表里就没有了', async () => {
    const doomed = await createProject(session, '要删的')
    await deleteProject(session, doomed.projectId)
    expect((await listProjects(session)).map((p) => p.projectId)).not.toContain(doomed.projectId)
  })

  it('删掉的工程打不开，且给的是中文原因', async () => {
    const doomed = await createProject(session, '要删的')
    await deleteProject(session, doomed.projectId)
    await expect(openProject(session, doomed.projectId)).rejects.toThrow(/已经被删除/)
  })
})

/* ── 打开：撤销栈与资产缓存 ─────────────────────────────────────────────── */

describe('T-282 · 打开另一份工程', () => {
  it('**两头断言** · 切走之前 canUndo 为真，切换之后为假，切回来仍为假', async () => {
    // 只比较两端的测试对「中间什么都没发生」完全无感：如果第一步的编辑没生效，
    // canUndo 从头到尾都是 false，而「切换后为 false」照样绿。
    const a = await createProject(session, 'A')
    const b = await createProject(session, 'B')
    const store = createDocumentStore(a)

    expect(store.getState().canUndo, '刚建好时没有可撤销的').toBe(false)
    store.getState().commit('改个名字', (draft) => {
      draft.name = 'A 改过'
    })
    expect(store.getState().canUndo, '编辑之后才有可撤销的').toBe(true)

    const toB = await openProject(session, b.projectId)
    store.getState().replaceDocument(toB.doc, { keepHistory: toB.keepHistory })
    expect(store.getState().canUndo, '换文档之后撤销栈必须是空的').toBe(false)
    expect(store.getState().historyDepth).toBe(0)

    const backToA = await openProject(session, a.projectId)
    store.getState().replaceDocument(backToA.doc, { keepHistory: backToA.keepHistory })
    expect(store.getState().canUndo, '切回来仍然是空的').toBe(false)
  })

  it('`openProject` 返回的 `keepHistory` 恒为 false —— 意图写在返回值里', async () => {
    // 调用点自己再写一遍 `false` 的话，改一处忘一处的那次不会有任何东西红。
    const mine = await createProject(session, '随便一份')
    expect((await openProject(session, mine.projectId)).keepHistory).toBe(false)
    expect((await openProject(session, BUILTIN_DOCUMENTS[0]!.projectId)).keepHistory).toBe(false)
  })

  it('**丢掉上一份工程的资产字节** —— 断言的是渲染器手上有什么，不是文档', async () => {
    // 卡面点名：删掉 `loader.dispose()` 时必须有一条断言红，而它不能是断言文档。
    // 不丢的话，切到新工程后视口里画的可能仍然是旧工程的几何——而文档、层级树、
    // 属性面板全都已经是新的了。**每个信号都说切换成功，只有画面不同意。**
    const sample = await session.materialise(createGoldenPathDocument(), buildSamplePumpGlb)
    await session.save(sample)
    const asset = sample.assets[0]!
    await session.loader.load(asset)
    expect(session.loader.has(asset.id), '加载之后 loader 手上有它').toBe(true)

    const other = await createProject(session, '另一份')
    await openProject(session, other.projectId)
    expect(session.loader.has(asset.id), '换工程之后 loader 手上不该还有上一份的几何').toBe(false)
  })

  it('打开内置文档时物化仍然发生', async () => {
    const builtin = BUILTIN_DOCUMENTS[0]!
    const target = await openProject(session, builtin.projectId)
    expect(await storage.hasBlob(target.doc.assets[0]!.hash)).toBe(true)
  })
})

/* ── 重命名：两条路径 ───────────────────────────────────────────────────── */

describe('T-282 · 重命名的两条路径', () => {
  it('纯函数只改名字，其余字段一个不动', () => {
    const doc = createGoldenPathDocument()
    const renamed = renameProject(doc, '  新名字  ')
    expect(renamed.name).toBe('新名字')
    expect({ ...renamed, name: doc.name }).toEqual(doc)
  })

  it('当前打开的工程：走 commit → **Ctrl+Z 能改回去**', async () => {
    // 卡面点名的变异 ③：把这里的 commit 换成直接 saveDocument，「列表里的名字变了」
    // 照样绿——两条路径都能让名字变，区别只在撤销栈。
    const mine = await createProject(session, '原名')
    const store = createDocumentStore(mine)
    store.getState().commit('重命名工程', (draft) => {
      draft.name = '新名'
    })
    await session.save(store.getState().doc)

    expect((await listProjects(session)).find((p) => p.projectId === mine.projectId)!.name).toBe('新名')
    expect(store.getState().canUndo).toBe(true)
    store.getState().undo()
    expect(store.getState().doc.name, 'Ctrl+Z 要能把名字改回去').toBe('原名')
  })

  it('列表里另一份未打开的工程：名字变了，**而当前的撤销栈深度一格未变**', async () => {
    // 只测前一条的话，「把别人的编辑塞进本端撤销栈」这个缺陷不会有人知道。
    const current = await createProject(session, '当前')
    const other = await createProject(session, '另一份')
    const store = createDocumentStore(current)
    store.getState().commit('随便改一笔', (draft) => {
      draft.name = '当前 改过'
    })
    const depthBefore = store.getState().historyDepth
    expect(depthBefore).toBe(1)

    await renameStoredProject(session, other.projectId, '另一份 改名')

    expect((await listProjects(session)).find((p) => p.projectId === other.projectId)!.name).toBe('另一份 改名')
    expect(store.getState().historyDepth, '改别人的名字不该动本端撤销栈').toBe(depthBefore)
    expect(store.getState().doc.name, '当前文档一个字都不该变').toBe('当前 改过')
  })

  it('重命名不存在的工程时说清原因', async () => {
    await expect(renameStoredProject(session, 'prj_nothere1', '随便')).rejects.toThrow(/已经被删除/)
  })

  it('重命名成空名被拒绝', async () => {
    const mine = await createProject(session, '原名')
    await expect(renameStoredProject(session, mine.projectId, '   ')).rejects.toThrow(/不能为空/)
    expect((await listProjects(session)).find((p) => p.projectId === mine.projectId)!.name).toBe('原名')
  })
})

describe('T-283 · 泵组样板进了内置文档表', () => {
  it('表里第一份就是泵组样板 —— 新建对话框里它排最前', () => {
    // 冷启动的兜底也取表的第一份（BOOT_STEPS 的 fallback-builtin），所以顺序有语义：
    // 一个新用户第一眼看到的应该是那台泵，不是三个节点的规范副本。
    expect(BUILTIN_DOCUMENTS[0]!.projectId).toBe(PUMP_DEMO_IDS.project)
    expect(BUILTIN_DOCUMENTS[0]!.label).toContain('泵组')
  })

  it('两份内置文档各带各的字节生成器，不是共用一个', () => {
    // 原来 `materialiseSample` 写死调 `buildSamplePumpGlb`。共用一个的话，泵组样板会
    // 拿到黄金路径那两个盒子的字节——而它声明的 hash 是自己的，发布闸门当场拒绝。
    const builders = BUILTIN_DOCUMENTS.map((b) => b.materialise)
    expect(builders.every((b) => typeof b === 'function')).toBe(true)
    expect(new Set(builders).size, '两份不该共用同一个生成器').toBe(BUILTIN_DOCUMENTS.length)
  })

  it('**从样板新建 → 资产被物化、hasBlob 为真**（发布闸门能过）', async () => {
    const doc = await createFromBuiltin(session, BUILTIN_DOCUMENTS[0]!)
    const asset = doc.assets.find((a) => a.type === 'model')!
    expect(await storage.hasBlob(asset.hash), 'storage 里要真的有这份字节').toBe(true)
    // 占位统计被**实测值**覆盖：一个报着 0 面数的资产面板是误导。
    expect(asset.stats.tris).toBeGreaterThan(0)
    expect(asset.stats.bytes).toBeGreaterThan(0)
  })

  it('**用户工程不物化** —— 闸门搬了家，没有松', async () => {
    // 一个 blob 丢了的导入资产必须响亮地失败；悄悄给它塞一台泵，是把数据丢失变成
    // 一张错的画面。判据现在是「在不在 BUILTIN_DOCUMENTS 里」。
    const mine = await createProject(session, '我的工程')
    const target = await openProject(session, mine.projectId)
    expect(target.doc.assets).toHaveLength(0)
    expect(builtinOf(mine.projectId)).toBeNull()
  })
})
