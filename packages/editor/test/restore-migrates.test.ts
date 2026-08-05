import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CURRENT_VERSION } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { MemoryProvider } from '@w3/storage'
import { describe, expect, it, vi } from 'vitest'
import { restoreLastDocument } from '../src/main.js'
import { ProjectSession } from '../src/project/session.js'

/**
 * T-229 · G1.0-20 · **编辑器启动那条路真的调了迁移。**
 *
 * 这条路曾经调的是 `validate`，而 `schemaVersion` 是 `z.literal(CURRENT_VERSION)`——
 * 一份旧版本存下的文档校验必然失败，于是回落到样例场景。用户的工作还在盘上，
 * 但他**看到**的是样例，与数据丢失无从分辨。v1 是唯一版本时这条 bug 完全不可见。
 *
 * ## 它与 `legacy-open.test.ts` 不是一回事
 *
 * 那个文件已经证明「迁移本身是对的」（v1 fixture → migrate → validate → checkIntegrity
 * → 存回读回）。但它**直接调 `migrate()`**，从不经过 `session.load` / `restoreLastDocument`，
 * 也从不往存储里播种。把本文件写成那样，就是一条把 main.tsx 改回 `validate` 也不会红的
 * 测试——而那正是本卡唯一要防的东西。
 *
 * ## 为什么用 `MemoryProvider` 而不是 `fake-indexeddb`
 *
 * `fake-indexeddb` 是 `@w3/storage` 的 devDependency，不是 editor 的。而
 * `ProjectSession` 本来就支持注入 storage，注进去跑的是**同一条** `restoreLastDocument`。
 * 真 IndexedDB 的读路径由 `packages/storage/test/idb.test.ts` 覆盖，本文件要证的不是它。
 */

const V2_FIXTURE = fileURLToPath(
  new URL('../../schema/test/fixtures/v2/golden-path-2.json', import.meta.url),
)

/**
 * **必须是 `golden-path-2.json`，不能是 `broken-v2-flows.json`。**
 *
 * 后者的 `projectId` 是 `prj_a1b2c3d4`、3 个节点——与 `createGoldenPathDocument()`
 * 逐字相同。拿它当种子，「比对 projectId 与节点数」这条断言在「恢复正确」和
 * 「静默回落样例」两种情形下**都通过**。卡面给的两个判别量在那份夹具上恒真。
 */
const seed = () => JSON.parse(readFileSync(V2_FIXTURE, 'utf8')) as Record<string, unknown>

async function restoreFrom(raw: Record<string, unknown>) {
  const storage = new MemoryProvider()
  // `saveDocument` 不做校验（memory-provider 直接 set），所以播得进一份 v2
  await storage.saveDocument(raw as unknown as SceneDocument)
  return restoreLastDocument(new ProjectSession({ storage }))
}

describe('T-229 · 编辑器恢复路径打开的是用户的文档，不是样例', () => {
  it('前提：种子确实是一份 v2 文档，且与样例场景可区分', () => {
    const raw = seed()
    expect(raw.schemaVersion, '种子不是 v2，本文件测的就不是迁移').toBe(2)
    // 两个判别量都必须与样例不同，否则下面的断言在回落时也会通过
    expect(raw.projectId).not.toBe('prj_a1b2c3d4')
    expect((raw.nodes as unknown[]).length).not.toBe(3)
  })

  it('播种一份 v2，恢复出来的是它 —— projectId / 节点数 / 名字 三条都对得上', async () => {
    const doc = await restoreFrom(seed())
    {
      const raw = seed()
      expect(doc, '恢复返回 null 就是回落到样例').not.toBeNull()
      expect(doc!.projectId).toBe(raw.projectId)
      expect(doc!.nodes).toHaveLength((raw.nodes as unknown[]).length)
      // 第三条正交断言：名字。projectId 与节点数都可能与样例撞上（见上面那条注释）
      expect(doc!.name).toBe(raw.name)
    }
  })

  it('恢复出来的文档已经升到当前版本 —— 迁移真的跑了，不只是读了出来', async () => {
    const doc = await restoreFrom(seed())
    expect(doc!.schemaVersion).toBe(CURRENT_VERSION)
    // v3 的字段在场，说明走的是迁移链而不是「读出来原样返回」
    expect(doc!.meta.fog).toBeDefined()
    expect(doc!.dataSources).toEqual([])
  })

  it('一份迁不动的文档只被跳过并报告，不会让编辑器打不开', async () => {
    // **必须 await 之后再 restore。** 第一版写成 `try { return p.then(...) } finally { restore() }`
    // ——`finally` 在 promise 兑现**之前**就同步跑掉了，于是 spy 早已被还原，
    // 断言看到的是「一次都没调用」。测试自己踩了一遍异步与作用域的坑。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const doc = await restoreFrom({ ...seed(), schemaVersion: 999 })
      expect(doc, '迁不动就回落样例，而不是抛出去').toBeNull()
      expect(warn, '静默回落等于数据丢失，必须说一声').toHaveBeenCalled()
      expect(String(warn.mock.calls[0]?.[0])).toContain('原文档未删除')
    } finally {
      warn.mockRestore()
    }
  })

  it('存储里什么都没有时返回 null —— 全新用户走样例场景', async () => {
    expect(await restoreLastDocument(new ProjectSession({ storage: new MemoryProvider() }))).toBeNull()
  })
})
