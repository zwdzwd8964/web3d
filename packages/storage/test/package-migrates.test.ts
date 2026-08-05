import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SceneDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { CURRENT_VERSION, migrate } from '@w3/schema'
import { packScene, unpackScene } from '../src/package.js'

/**
 * T-229 · `.w3p` 那一侧的同形回归。
 *
 * `unpackScene` 是**播放器读到的每一份文档的必经之路**（`player/src/app.ts` 与
 * `bench/main.ts` 都走它）。它今天调的是 `migrate`；改回 `validate` 的后果与编辑器那侧
 * 逐字相同——一个旧版本导出的包在新播放器里打不开，而错误信息只会说「文档不合法」。
 *
 * 与 `packages/editor/test/restore-migrates.test.ts` 是一对：那边守编辑器的恢复路径，
 * 这边守分发路径。
 */

const V2_FIXTURE = fileURLToPath(new URL('../../schema/test/fixtures/v2/golden-path-2.json', import.meta.url))
const seed = () => JSON.parse(readFileSync(V2_FIXTURE, 'utf8')) as Record<string, unknown>

/** 文档引用到的每个 blob 都得给一份字节，否则 `packScene` 会以 not-found 拒绝打包。 */
function blobsFor(raw: Record<string, unknown>): Map<string, Uint8Array> {
  const assets = (raw.assets ?? []) as { hash: string }[]
  return new Map(assets.map((a) => [a.hash, new Uint8Array([1, 2, 3])]))
}

/**
 * 打一个包，但**包里的 scene.json 声称是 v2**。
 *
 * 用「迁移到 v3 之后再把 schemaVersion 改回去」而不是直接塞 v2 原文：`packScene` 是
 * **今天的**代码，它按 v3 的形状遍历（T-232 之后还要走 `prefabs` 与 `viewpoints`）。
 * 真实场景里打这个包的是**旧版本的** packScene，我们模拟的是它的产物、不是它的代码。
 * 直接塞 v2 原文会让 `document.prefabs` 是 undefined 而当场炸——那是测试装配的问题，
 * 不是被测行为的问题。
 */
function packAt(schemaVersion: number): Uint8Array {
  const migrated = migrate(seed())
  if (!migrated.ok) throw new Error('种子迁不动')
  const raw = { ...migrated.value.document, schemaVersion }
  // `packScene` 的入参在类型上是 v3；这里刻意塞一份别的版本进去，模拟「旧/新版本导出的包」。
  return packScene({
    document: raw as unknown as SceneDocument,
    coreVersion: '0.0.0-test',
    snapshotId: 'snp_a1b2c3d4',
    publishedAt: '2026-01-01T00:00:00.000Z',
    blobs: blobsFor(raw),
  })
}

describe('T-229 · 旧版本导出的 .w3p 仍然打得开', () => {
  it('前提：包里的 scene.json 确实是 v2', () => {
    expect(seed().schemaVersion, '种子不是 v2，本文件测的就不是迁移').toBe(2)
  })

  it('解包出来的是包里那份文档，且已升到当前版本', () => {
    // `unpackScene` 抛而不是返回 Result（package.ts:166）—— 它的失败都是「这个包读不了」，
    // 而那是调用方要向用户解释的一件事，不是一个要被 if 分支吞掉的值。
    const raw = seed()
    const doc = unpackScene(packAt(2)).document
    expect(doc.schemaVersion, '没迁移就说明这条路调的是 validate').toBe(CURRENT_VERSION)
    expect(doc.projectId).toBe(raw.projectId)
    expect(doc.name).toBe(raw.name)
    expect(doc.nodes).toHaveLength((raw.nodes as unknown[]).length)
    // v3 的字段在场 —— 走的是迁移链，不是「读出来原样返回」
    expect(doc.meta.fog).toBeDefined()
    expect(doc.prefabs).toEqual([])
  })

  it('一个来自未来版本的包被明确拒绝，且报错说得出该怎么办', () => {
    // 降级读取会静默丢字段，所以必须拒。**但错误信息要给出路**：
    // 「文档格式 v999，当前只支持到 v3，请升级后重试」比「包损坏」有用得多。
    expect(() => unpackScene(packAt(999))).toThrow(/请升级后重试/)
  })
})
