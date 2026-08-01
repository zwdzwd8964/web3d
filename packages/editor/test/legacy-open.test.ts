import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkIntegrity, errorsOf, migrate, needsDefaultLightRig, validate } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { createDocumentStore } from '../src/store/document-store.js'

/**
 * T-172 · opening a v0 project in a v0.5 editor.
 *
 * The promise this defends is 「老文件永远能打开」 (C4), and the specific fear behind D14:
 * that migrating a v1 document would INJECT the three default lights as real nodes, so a
 * user who opens a project they made last month finds three objects in their hierarchy tree
 * that they did not create, cannot explain, and break the scene when deleted.
 *
 * The round trip matters as much as the open: a document that migrates, saves, and then
 * fails to reopen is worse than one that never opened, because the damage is already on disk.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema', 'test', 'fixtures')

const readV1 = (): unknown => JSON.parse(readFileSync(join(FIXTURES, 'v1', 'golden-path.json'), 'utf-8'))

describe('opening a v1 project', () => {
  it('migrates silently to v2 and validates', () => {
    const raw = readV1() as { schemaVersion: number }
    expect(raw.schemaVersion, '前提：这份 fixture 真的是 v1').toBe(1)

    const result = migrate(raw)
    expect(result.ok, '老文件必须打得开（C4）').toBe(true)
    if (!result.ok) return

    expect(result.value.document.schemaVersion).toBe(2)
    expect(validate(result.value.document).ok).toBe(true)
    expect(errorsOf(checkIntegrity(result.value.document))).toEqual([])
  })

  it('does NOT inject any node — the hierarchy tree is unchanged (D14)', () => {
    // The failure this rules out by name: a user opens last month's project and finds three
    // lights in the tree they did not create. The default rig is a DISPLAY default, like the
    // background colour — not business state, and so not something a migration may write.
    const raw = readV1() as { nodes: unknown[] }
    const before = raw.nodes.length

    const result = migrate(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const after = result.value.document
    expect(after.nodes, '迁移不许往层级树里塞任何东西').toHaveLength(before)
    expect(after.nodes.every((n) => n.light === null), '一盏灯都不许注入').toBe(true)
  })

  it('still asks for the built-in rig, so the scene looks the same as it did', () => {
    // The other half of D14: not injecting is only correct if core still lights the scene.
    // Otherwise 「不注入」 would mean 「打开是黑的」.
    const result = migrate(readV1())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(needsDefaultLightRig(result.value.document), '老文档打开必须仍然由内置灯架照亮').toBe(true)
  })

  it('fills the v2 fields with defaults rather than leaving them absent', () => {
    const result = migrate(readV1())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.value.document

    expect(doc.meta.environment).toEqual({ hdriAssetId: null, intensity: 1, exposure: 1 })
    expect(doc.meta.background.type, '老文档的背景类型不该被改动').toBe('color')
    for (const material of doc.materials) expect(material.params.maps).toBeDefined()
  })
})

describe('the round trip', () => {
  /** Save through the same JSON path storage uses, then read it back. */
  const roundTrip = (doc: SceneDocument): SceneDocument => {
    const bytes = new TextEncoder().encode(JSON.stringify(doc))
    const parsed = migrate(JSON.parse(new TextDecoder().decode(bytes)))
    expect(parsed.ok, '存下去的文档必须还能读回来').toBe(true)
    if (!parsed.ok) throw new Error('round trip failed')
    return parsed.value.document
  }

  it('open → save → reopen is stable, byte for byte', () => {
    // A document that migrates, saves, and then fails to reopen is worse than one that
    // never opened: the damage is already on disk.
    const opened = migrate(readV1())
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const once = roundTrip(opened.value.document)
    const twice = roundTrip(once)

    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
    expect(errorsOf(checkIntegrity(twice))).toEqual([])
  })

  it('survives being edited in between, through the real write path', () => {
    // Not just re-serialised: a migrated document has to be a legal target for the ordinary
    // commit path too, which is where every later edit will land.
    const opened = migrate(readV1())
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const store = createDocumentStore(opened.value.document)
    store.getState().commit('改个名字', (draft) => void (draft.name = '老项目 · 改过'))
    store.getState().commit('挪一下', (draft) => {
      const node = draft.nodes[0]
      if (node) node.transform.p = [1, 2, 3]
    })

    const saved = roundTrip(store.getState().doc)
    expect(saved.name).toBe('老项目 · 改过')
    expect(saved.nodes[0]!.transform.p).toEqual([1, 2, 3])
    expect(validate(saved).ok).toBe(true)
    expect(errorsOf(checkIntegrity(saved))).toEqual([])
    // …and it STILL has no injected lights after a full edit-save cycle.
    expect(saved.nodes.every((n) => n.light === null)).toBe(true)
  })

  it('a v2 document is not migrated again', () => {
    // Re-running a migration on an already-current document is how fields get double-applied.
    const opened = migrate(readV1())
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const again = migrate(opened.value.document)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.value.applied, '已经是 v2 了，不该再跑一遍迁移').toEqual([])
    expect(JSON.stringify(again.value.document)).toBe(JSON.stringify(opened.value.document))
  })
})
