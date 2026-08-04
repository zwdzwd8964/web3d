import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CURRENT_VERSION } from '../src/document.js'
import { checkIntegrity, errorsOf } from '../src/integrity.js'
import { migrate } from '../src/migrate.js'
import { OVERLAY_TYPES } from '../src/page.js'
import { createGoldenPathDocument } from '../src/samples.js'

/**
 * T-018 · gate G0-3, constitution C4.
 *
 * One real document per historical schema version lives under test/fixtures/v<N>/.
 * These files are APPEND-ONLY: adding is fine, editing or deleting is not. The moment a
 * fixture is "fixed up" to satisfy a new schema, this suite stops proving anything —
 * which is exactly how anti-pattern A4 slips through.
 */

const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures', import.meta.url))

interface Fixture {
  version: number
  name: string
  path: string
}

function collectFixtures(): Fixture[] {
  const out: Fixture[] = []
  for (const dir of readdirSync(FIXTURE_ROOT)) {
    const full = join(FIXTURE_ROOT, dir)
    if (!statSync(full).isDirectory()) continue
    const m = /^v(\d+)$/.exec(dir)
    if (!m) throw new Error(`fixture directory must be named v<N>, got "${dir}"`)
    for (const file of readdirSync(full)) {
      if (file.endsWith('.json')) out.push({ version: Number(m[1]), name: `${dir}/${file}`, path: join(full, file) })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const fixtures = collectFixtures()

describe('schema fixtures', () => {
  it('there is at least one fixture for every shipped schema version', () => {
    const versions = new Set(fixtures.map((f) => f.version))
    for (let v = 1; v <= CURRENT_VERSION; v++) {
      expect(versions.has(v), `no fixture for schemaVersion ${v} — C4 cannot be proven`).toBe(true)
    }
  })

  it.each(fixtures.map((f) => [f.name, f] as const))('%s migrates, validates and resolves', (_name, fixture) => {
    const raw = JSON.parse(readFileSync(fixture.path, 'utf8'))

    // The directory must agree with what the file says about itself.
    expect(raw.schemaVersion).toBe(fixture.version)

    const migrated = migrate(raw)
    expect(migrated.ok, migrated.ok ? '' : JSON.stringify(migrated.error, null, 2)).toBe(true)
    if (!migrated.ok) return
    expect(migrated.value.toVersion).toBe(CURRENT_VERSION)

    const issues = checkIntegrity(migrated.value.document)
    const errors = errorsOf(issues)
    expect(errors, `${fixture.name}: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}`).toHaveLength(0)
  })

  it.each(fixtures.filter((f) => f.version === CURRENT_VERSION).map((f) => [f.name, f] as const))(
    '%s round-trips byte-identically',
    (_name, fixture) => {
      const raw = JSON.parse(readFileSync(fixture.path, 'utf8'))
      const migrated = migrate(raw)
      expect(migrated.ok).toBe(true)
      if (!migrated.ok) return
      expect(JSON.parse(JSON.stringify(migrated.value.document))).toEqual(raw)
    },
  )
})

describe('the golden path fixture and the in-code sample are one document', () => {
  it('SCHEMA_SPEC §12, migrated to today’s version, matches createGoldenPathDocument()', () => {
    // The fixture is frozen at v1 (append-only) while the builder tracks CURRENT_VERSION,
    // so the two are now related BY THE MIGRATION rather than by transcription. Which
    // makes this a stronger assertion than it was: it says the v1 -> v2 migration produces
    // exactly the document the code claims v2 looks like, field for field.
    //
    // If they ever diverge, every consumer of the builder (core ECA tests, player parity,
    // the editor sample project) is testing a different scene than the fixture suite is.
    const onDisk = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'v1/golden-path.json'), 'utf8'))
    const migrated = migrate(onDisk)
    expect(migrated.ok, migrated.ok ? '' : JSON.stringify(migrated.error, null, 2)).toBe(true)
    if (!migrated.ok) return
    expect(JSON.parse(JSON.stringify(migrated.value.document))).toEqual(
      JSON.parse(JSON.stringify(createGoldenPathDocument())),
    )
  })

  it('the v1 fixture on disk is still a v1 document — append-only means never edited', () => {
    // The failure this guards is subtle and fatal: "fixing up" a historical fixture so it
    // satisfies the current schema makes the C4 suite green while proving nothing at all.
    // A v1 file that no longer declares v1, or that has grown v2 fields, has been edited.
    const onDisk = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'v1/golden-path.json'), 'utf8'))
    expect(onDisk.schemaVersion).toBe(1)
    expect(onDisk.meta.environment, 'v1 文档不该有 environment —— 这份 fixture 被改过').toBeUndefined()
    for (const node of onDisk.nodes) {
      expect(node.primitive, 'v1 节点不该有 primitive —— 这份 fixture 被改过').toBeUndefined()
      expect(node.light).toBeUndefined()
    }
  })
})

/* ========================================================================== */
/* T-225 · 规划 §4.1.6 点名的三条 fixture 断言                                  */
/* ========================================================================== */

/** 老版本 fixture 里**一个字节都不该出现**的 v3 字段。 */
const V3_ONLY_TOP = ['sceneId', 'dataSources', 'prefabs'] as const
const V3_ONLY_META = ['fog', 'effects'] as const
const V3_ONLY_NODE = ['explode', 'explodeOffset', 'section', 'prefabRef'] as const

const HISTORICAL = ['v1/golden-path.json', 'v2/golden-path-2.json', 'v2/broken-v2-flows.json'] as const

describe('§4.1.6 断言一 · 只增不改不删的机械看门', () => {
  /**
   * 「fixture 没有被人顺手改新」——这是 C4 唯一真正的把手。
   *
   * 上面那条 v1 专用的检查逐字段点名 `meta.environment` / `node.primitive`，v2 出现时没人
   * 想起要给它写一条同样的。结果是 v2 的两份 fixture 从落盘那天起就没有任何东西拦着被
   * 「顺手补个 sceneId 让它过校验」。参数化到每一份历史 fixture，往后加 v4 时只多一行。
   */
  it.each(HISTORICAL)('%s 仍是它自己声称的那个版本，没长出 v3 字段', (rel) => {
    const raw = JSON.parse(readFileSync(join(FIXTURE_ROOT, rel), 'utf8'))

    expect(raw.schemaVersion, `${rel} 的 schemaVersion 已经不小于 CURRENT_VERSION 了`).toBeLessThan(CURRENT_VERSION)

    for (const key of V3_ONLY_TOP) expect(raw[key], `${rel} 长出了 v3 的顶层 ${key}`).toBeUndefined()
    for (const key of V3_ONLY_META) expect(raw.meta?.[key], `${rel} 的 meta 长出了 v3 的 ${key}`).toBeUndefined()
    for (const node of raw.nodes ?? []) {
      for (const key of V3_ONLY_NODE) {
        expect(node[key], `${rel} 的节点 ${node.id} 长出了 v3 的 ${key}`).toBeUndefined()
      }
    }
    // 扫描面下限：一份 nodes 为空的 fixture 会让上面那层循环恒真
    expect((raw.nodes ?? []).length, `${rel} 没有节点，节点那层循环什么都没查`).toBeGreaterThan(0)
  })
})

describe('§4.1.6 断言二 · v3 fixture 真的走过每一个在 v1 拿到形状的集合', () => {
  const load = (rel: string) => JSON.parse(readFileSync(join(FIXTURE_ROOT, rel), 'utf8'))

  /**
   * `pages` / `flows` 是反面教材：v0 定义、两份 fixture 全空，于是 I1 对 `flow.steps` 的去重
   * 与 I3 对 `step.next` 的检查**从没在一份磁盘上的真文档上走过**。v3 新加的
   * `dataSources` / `prefabs` 若也是 `[]`，v1.5 落地那天会是它们第一次被 migrate 碰到——
   * 而那时客户盘上已经有 v3 文档了。
   */
  it('orchestration.json：page / flow / 四种 overlay / 三条新事件都非空', () => {
    const d = load('v3/orchestration.json')
    expect(d.pages.length).toBeGreaterThan(0)
    expect(d.flows.length).toBeGreaterThan(0)
    expect(d.pages[0].overlays.map((o: { type: string }) => o.type).sort()).toEqual([...OVERLAY_TYPES].sort())
    expect(d.flows[0].steps.length).toBe(3)
    expect(d.flows[0].startStepId).toBe(d.flows[0].steps[0].id)
    const events = d.rules.map((r: { when: { event: string } }) => r.when.event)
    for (const e of ['pageEnter', 'flowStepEnter', 'overlayClick']) {
      expect(events, `v3 的新事件 ${e} 没有一条规则用到，它在回归链上等于不存在`).toContain(e)
    }
  })

  it('golden-path-3.json：两个 enabled 都为 true、radial 与 axis 分组各在、剖切非单位旋转', () => {
    const d = load('v3/golden-path-3.json')
    // 只用默认值的 fixture 覆盖的是「关着」那一侧——v0.5 toneMapping 那条假绿的同形
    expect(d.meta.fog.enabled).toBe(true)
    expect(d.meta.effects.outline.enabled).toBe(true)

    const modes = d.nodes.filter((n: { explode: unknown }) => n.explode).map((n: { explode: { mode: string } }) => n.explode.mode)
    expect(modes).toContain('radial')
    expect(modes).toContain('axis')

    const sections = d.nodes.filter((n: { section: unknown }) => n.section !== null)
    expect(sections.length).toBeGreaterThan(0)
    // 单位旋转下剖切法向恰好是 +Y，会掩盖「法向取错轴」的实现
    expect(sections[0].transform.r, '剖切平面是单位旋转 —— 它掩盖的正是它该暴露的那个 bug').not.toEqual([0, 0, 0, 1])

    const clips = d.animations.filter((a: { kind: string }) => a.kind === 'imported')
    expect(clips.some((a: { endS: number | null }) => a.endS !== null), '没有一条带区间的 imported 动画').toBe(true)
    expect(clips.some((a: { endS: number | null }) => a.endS === null), '没有一条整段的 imported 动画').toBe(true)
    expect(d.hotspots.some((h: { style: { label?: string } }) => h.style.label !== undefined)).toBe(true)
    expect(d.hotspots.some((h: { style: { label?: string } }) => h.style.label === undefined)).toBe(true)
  })

  it('integration-placeholder.json：dataSources / prefabs / origin.transcode 都非空', () => {
    const d = load('v3/integration-placeholder.json')
    expect(d.dataSources.length).toBeGreaterThan(0)
    expect(d.prefabs.length).toBeGreaterThan(0)
    expect(d.prefabs[0].nodes.length).toBeGreaterThan(0)
    expect(d.prefabs[0].materials.length).toBeGreaterThan(0)
    expect(d.nodes.some((n: { prefabRef: unknown }) => n.prefabRef !== null)).toBe(true)
    expect(d.viewpoints.some((v: { thumbnailAssetId?: string }) => v.thumbnailAssetId !== undefined)).toBe(true)
    const withOrigin = d.assets.find((a: { origin?: { transcode?: { skipped: unknown[] } } }) => a.origin?.transcode)
    expect(withOrigin, '没有一份资产带 origin.transcode').toBeTruthy()
    expect(withOrigin.origin.transcode.skipped.length, 'skipped 是空的 —— 跳过路径没被走过').toBeGreaterThan(0)
  })
})
