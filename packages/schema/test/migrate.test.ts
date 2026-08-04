import { describe, expect, it } from 'vitest'
import { CURRENT_VERSION } from '../src/document.js'
import type { Migration } from '../src/migrate.js'
import { MIGRATIONS, applyMigrationChain, migrate, needsMigration } from '../src/migrate.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deriveSceneId } from '../src/id.js'
import { createGoldenPathDocument } from '../src/samples.js'

/**
 * T-013 · SCHEMA_SPEC §10, constitution C4.
 *
 * The shipped chain is empty at schemaVersion 1, so the *machinery* is driven here with
 * a synthetic chain and an injected target version. Without that seam the first real
 * migration written for v1 would also be the first execution of this loop — on a
 * customer's document, during their trial period.
 */
const syntheticChain: Migration[] = [
  {
    from: 1,
    to: 2,
    describe: 'move meta.background.color to meta.background.hex',
    up: (doc) => {
      const meta = doc.meta as Record<string, any>
      const { color, ...rest } = meta.background as Record<string, unknown>
      return { ...doc, meta: { ...meta, background: { ...rest, hex: color } } }
    },
  },
  {
    from: 2,
    to: 3,
    describe: 'add meta.locale',
    up: (doc) => ({ ...doc, meta: { ...(doc.meta as object), locale: 'zh-CN' } }),
  },
]

const unwrap = <T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`)
  return r.value
}

/**
 * A v1-SHAPED document, hand-written rather than derived from the sample.
 *
 * `createGoldenPathDocument()` tracks CURRENT_VERSION, so it stopped being a v1 document
 * the moment v2 shipped. Deriving a "v1" from it by overwriting `schemaVersion` would
 * produce a document that already has every v2 field — and the v1 -> v2 migration would
 * then be tested against input it will never see. This is what a v1 document actually
 * looked like: no `primitive`, no `light`, no `meta.environment`, media without a name.
 *
 * The frozen `fixtures/v1/golden-path.json` is the other half of this coverage
 * (fixtures.test.ts) — that one is a real historical file rather than a reconstruction.
 */
const v1Document = () => ({
  schemaVersion: 1,
  projectId: 'prj_a1b2c3d4',
  name: '旧文档',
  meta: {
    unit: 'm',
    upAxis: 'Y',
    createdAt: '2026-08-01T02:10:00.000Z',
    updatedAt: '2026-08-01T03:42:11.000Z',
    background: { type: 'color', color: '#1a1a1a' },
  },
  assets: [
    {
      id: 'ast_9k2m4p7q',
      type: 'audio',
      name: 'alarm.wav',
      hash: `sha256:${'ab12cd34ef567890'.repeat(4)}`,
      url: 'assets/ab/12/ab12cd34ef567890ab12cd34ef567890ab12cd34ef567890ab12cd34ef567890.wav',
      version: 1,
      lineageId: 'ast_9k2m4p7q',
      stats: { tris: 0, materials: 0, textures: 0, bytes: 220544, textureBytes: 0, nodes: 0, animations: [] },
    },
  ],
  nodes: [
    {
      id: 'nd_r5t8y1u3',
      name: '泵组',
      parent: null,
      order: 1000,
      assetRef: null,
      transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
      visible: true,
      locked: false,
      overrides: {},
    },
  ],
  materials: [],
  animations: [],
  hotspots: [],
  viewpoints: [],
  variables: [],
  rules: [],
  pages: [],
  flows: [],
  media: [{ id: 'med_q1s3u5w7', type: 'audio', assetId: 'ast_9k2m4p7q' }],
})

describe('migrate()', () => {
  it('passes a current-version document through unchanged', () => {
    const doc = createGoldenPathDocument()
    const result = unwrap(migrate(doc))
    expect(result.fromVersion).toBe(CURRENT_VERSION)
    expect(result.toVersion).toBe(CURRENT_VERSION)
    expect(result.applied).toEqual([])
    expect(result.document).toEqual(doc)
  })

  it('does not mutate its input', () => {
    const doc = createGoldenPathDocument()
    const before = JSON.stringify(doc)
    migrate(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('ships one migration per version step, with no gaps', () => {
    // The invariant, not the count: a bump that forgets its migration is anti-pattern A4,
    // and the failure mode is silent — `migrate()` only complains when someone opens an
    // old document, which is typically the customer, during their trial.
    expect(MIGRATIONS).toHaveLength(CURRENT_VERSION - 1)
    for (let v = 1; v < CURRENT_VERSION; v++) {
      expect(MIGRATIONS.filter((m) => m.from === v), `no migration from v${v}`).toHaveLength(1)
    }
  })

  it('needsMigration is false at the current version and for malformed input', () => {
    expect(needsMigration(createGoldenPathDocument())).toBe(false)
    expect(needsMigration({})).toBe(false)
    expect(needsMigration(null)).toBe(false)
  })

  it('refuses a document from the future rather than dropping fields', () => {
    const r = migrate({ ...createGoldenPathDocument(), schemaVersion: CURRENT_VERSION + 5 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('from-the-future')
    expect(r.error.message).toMatch(/newer than this build/)
  })

  it('reports malformed input as a result, never as a thrown exception', () => {
    for (const bad of [{}, { schemaVersion: '1' }, { schemaVersion: 0 }, { schemaVersion: 1.5 }, null, [], '{}']) {
      const r = migrate(bad)
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      if (!r.ok) expect(r.error.kind).toBe('malformed')
    }
  })

  it('reports a structurally invalid document with the underlying validation errors', () => {
    const r = migrate({ schemaVersion: 1 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('invalid-result')
    expect(r.error.validation?.length).toBeGreaterThan(0)
  })

  /**
   * v1 -> v2, the real one.
   *
   * Every assertion here reads `applyMigrationChain`'s RAW output rather than `migrate`'s
   * validated document, and that is the whole point. All the v2 fields except
   * `media[].name` carry zod defaults, so `validate()` would fill them in even if `up()`
   * were `d => d` — a migration that does nothing would pass any test written against
   * `migrate()`. The raw output is where "the migration actually did it" is observable,
   * and it is also what the NEXT migration in the chain will receive.
   */
  describe('v1 -> v2 (v0.5 的一次性字段增量, D11)', () => {
    const raw = () => unwrap(applyMigrationChain(v1Document())).raw as Record<string, any>

    it('writes the carrier fields onto every node instead of leaving them to zod', () => {
      const nodes = raw().nodes as Record<string, unknown>[]
      for (const node of nodes) {
        expect(Object.hasOwn(node, 'primitive'), 'primitive 缺席 = 下一条迁移会读到 undefined').toBe(true)
        expect(Object.hasOwn(node, 'light')).toBe(true)
        expect(node.primitive).toBeNull()
        expect(node.light).toBeNull()
      }
    })

    it('writes the default environment block onto meta', () => {
      expect((raw().meta as Record<string, unknown>).environment).toEqual({
        hdriAssetId: null,
        intensity: 1,
        exposure: 1,
      })
    })

    it('names each media record after the asset it points at', () => {
      expect((raw().media as Record<string, unknown>[])[0]).toEqual({
        id: 'med_q1s3u5w7',
        type: 'audio',
        assetId: 'ast_9k2m4p7q',
        name: 'alarm.wav',
      })
    })

    it('falls back to the media id when the asset reference is already dangling', () => {
      // Not a hypothetical: v1 never had UI to create media, so any media record found in
      // a v1 document was hand-written. `name` has no default and cannot have one, so the
      // choice is between a traceable id and refusing to open the document at all.
      const doc = v1Document()
      doc.media = [{ id: 'med_q1s3u5w7', type: 'audio', assetId: 'ast_00000000' }]
      const migrated = unwrap(applyMigrationChain(doc)).raw as Record<string, any>
      expect(migrated.media[0].name).toBe('med_q1s3u5w7')
    })

    it('does not inject light nodes (D14)', () => {
      // The default rig is a display default, like the background colour. Materialising it
      // would make every existing project sprout three tree entries the user never made,
      // cannot explain, and turns the scene black by deleting.
      const before = v1Document().nodes.length
      const nodes = raw().nodes as Record<string, unknown>[]
      expect(nodes).toHaveLength(before)
      expect(nodes.some((n) => n.light !== null)).toBe(false)
    })

    it('fills gaps without normalising what is already there', () => {
      const doc = v1Document() as Record<string, any>
      doc.meta.environment = { hdriAssetId: null, intensity: 2.5, exposure: 1 }
      doc.nodes[0].primitive = { kind: 'sphere', radius: 2 }
      doc.media[0].name = '用户改过的名字'
      const migrated = unwrap(applyMigrationChain(doc)).raw as Record<string, any>
      expect(migrated.meta.environment.intensity).toBe(2.5)
      expect(migrated.nodes[0].primitive).toEqual({ kind: 'sphere', radius: 2 })
      expect(migrated.media[0].name).toBe('用户改过的名字')
    })

    it('produces a document that validates and equals what a second run produces', () => {
      // v3 · 链条现在是 1 → 2 → 3，两步。这条测试的名字说的是「跑两次结果相同」，
      // 而那件事与链条多长无关——改的是两个数字，不是它守的性质。
      const first = unwrap(migrate(v1Document()))
      expect(first.fromVersion).toBe(1)
      expect(first.toVersion).toBe(3)
      expect(first.applied).toHaveLength(2)
      expect(first.applied[0]).toMatch(/^v1 -> v2: /)
      expect(first.applied[1]).toMatch(/^v2 -> v3: /)
      expect(JSON.stringify(unwrap(migrate(v1Document())).document)).toBe(JSON.stringify(first.document))
    })

    it('leaves the input untouched', () => {
      const doc = v1Document()
      const before = JSON.stringify(doc)
      migrate(doc)
      expect(JSON.stringify(doc)).toBe(before)
    })
  })

  describe('the chain, driven with a synthetic set of migrations', () => {
    const opts = { migrations: syntheticChain, targetVersion: 3 }
    // The synthetic chain starts at v1, so it needs a v1-versioned input. Only
    // `meta.background` is touched by it, so the v1 document above is a fine vehicle.

    it('walks every step in order and records what it applied', () => {
      const result = unwrap(applyMigrationChain(v1Document(), opts))
      expect(result.fromVersion).toBe(1)
      expect(result.toVersion).toBe(3)
      expect(result.applied).toEqual([
        'v1 -> v2: move meta.background.color to meta.background.hex',
        'v2 -> v3: add meta.locale',
      ])
      const meta = result.raw.meta as Record<string, any>
      expect(meta.background).toEqual({ type: 'color', hex: '#1a1a1a' })
      expect(meta.locale).toBe('zh-CN')
      expect(result.raw.schemaVersion).toBe(3)
    })

    it('starts mid-chain when the document is already partly migrated', () => {
      const result = unwrap(applyMigrationChain({ schemaVersion: 2, meta: { background: {} } }, opts))
      expect(result.fromVersion).toBe(2)
      expect(result.applied).toEqual(['v2 -> v3: add meta.locale'])
    })

    it('the chain’s output is still validated by migrate() — nothing is trusted', () => {
      // The synthetic chain intentionally produces a shape no version accepts.
      const r = migrate(v1Document(), opts)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.error.kind).toBe('invalid-result')
      expect(r.error.validation?.some((v) => v.path === 'meta.background')).toBe(true)
    })

    it('names a gap in the chain as anti-pattern A4', () => {
      const r = applyMigrationChain({ schemaVersion: 1 }, { migrations: [syntheticChain[1]!], targetVersion: 3 })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.error.kind).toBe('missing-step')
      expect(r.error.message).toMatch(/no migration registered from schemaVersion 1 to 2/)
      expect(r.error.message).toMatch(/anti-pattern A4/)
    })

    it('rejects a migration entry that skips a version', () => {
      const bad: Migration[] = [{ from: 1, to: 3, describe: 'skips v2', up: (d) => d }]
      const r = applyMigrationChain({ schemaVersion: 1 }, { migrations: bad, targetVersion: 3 })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.message).toMatch(/single step/)
    })

    it('rejects two migrations registered from the same version', () => {
      const dupes: Migration[] = [
        { from: 1, to: 2, describe: 'a', up: (d) => d },
        { from: 1, to: 2, describe: 'b', up: (d) => d },
      ]
      const r = applyMigrationChain({ schemaVersion: 1 }, { migrations: dupes, targetVersion: 2 })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.message).toMatch(/two migrations/)
    })

    it('does no work when the document is already at the target version', () => {
      const result = unwrap(applyMigrationChain(createGoldenPathDocument(), { migrations: syntheticChain }))
      expect(result.applied).toEqual([])
      expect(result.raw).toEqual(JSON.parse(JSON.stringify(createGoldenPathDocument())))
    })

    it('migrations are pure — the same input twice gives byte-identical output', () => {
      const doc = createGoldenPathDocument()
      const a = applyMigrationChain(doc, opts)
      const b = applyMigrationChain(doc, opts)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })
  })
})

/* ========================================================================== */
/* T-225 · v2 → v3                                                            */
/* ========================================================================== */

const V2_BROKEN = fileURLToPath(new URL('./fixtures/v2/broken-v2-flows.json', import.meta.url))
const V2_GOLDEN = fileURLToPath(new URL('./fixtures/v2/golden-path-2.json', import.meta.url))
const loadRaw = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Record<string, any>

/** 迁移函数的**原始输出**，没经过 zod。这是本节几乎每条断言的对象，理由见下。 */
const rawOf = (p: string) => unwrap(applyMigrationChain(loadRaw(p))).raw as Record<string, any>

describe('v2 -> v3 · 逐字段 raw 断言', () => {
  /**
   * **为什么断言 `raw` 而不是 `migrate().document`。**
   *
   * `SceneDocumentSchema` 的每个新字段都有 default，所以 `V2_TO_V3.up` 可以整个写成
   * `d => d`，而 `migrate().document` 上的九条断言**一条都不会红**——zod 会把它们全部补上。
   * 迁移函数于是变成一段没人验证的死代码，直到某天有人把它的输出直接喂给下一段迁移
   * （链条的第二步收到的正是上一步的 raw），或者喂给一个不走 zod 的消费者。
   *
   * 这不是假想：`V1_TO_V2` 的注释里就写着同一件事的两个理由，而它比这条早两个版本。
   */
  /**
   * 读的是 `broken-v2-flows.json` 而不是 `golden-path-2.json`：后者的 `variables` 与
   * `animations` 都是空的，五个 for 里有两个跑零圈——那正是下面那四条下限断言存在的理由，
   * 也是它们第一次跑就抓到的东西。
   */
  it('九个新字段在迁移函数的原始输出里就已经显式存在', () => {
    const d = rawOf(V2_BROKEN)

    expect(d.sceneId, 'sceneId').toBe(deriveSceneId(String(d.projectId)))
    expect(d.meta.fog, 'meta.fog').toBeDefined()
    expect(d.meta.effects, 'meta.effects').toBeDefined()
    expect(d.dataSources, 'dataSources').toEqual([])
    expect(d.prefabs, 'prefabs').toEqual([])
    for (const n of d.nodes) {
      expect(n.explode, `nodes[${n.id}].explode`).toBe(null)
      expect(n.explodeOffset, `nodes[${n.id}].explodeOffset`).toBe(null)
      expect(n.section, `nodes[${n.id}].section`).toBe(null)
      expect(n.prefabRef, `nodes[${n.id}].prefabRef`).toBe(null)
    }
    for (const v of d.variables) expect(v.scope, `variables[${v.id}].scope`).toBe('scene')
    for (const a of d.animations) {
      if (a.kind !== 'imported') continue
      expect(a.startS, `animations[${a.id}].startS`).toBe(0)
      expect(a.endS, `animations[${a.id}].endS`).toBe(null)
    }
    for (const a of d.assets) expect(a.stats.clipDurations, `assets[${a.id}].stats.clipDurations`).toEqual({})

    // 扫描面下限：上面五个 for 里任何一个跑零圈都会静默恒真
    expect(d.nodes.length).toBeGreaterThan(0)
    expect(d.variables.length).toBeGreaterThan(0)
    expect(d.assets.length).toBeGreaterThan(0)
    expect(d.animations.filter((a: { kind: string }) => a.kind === 'imported').length).toBeGreaterThan(0)
  })

  it('观感回归：老文档迁移后不会自己亮起来，也不会自己开始发网络请求', () => {
    const d = unwrap(migrate(loadRaw(V2_GOLDEN))).document
    expect(d.meta.fog.enabled, '雾自己开了').toBe(false)
    expect(d.meta.effects.outline.enabled, '描边自己开了').toBe(false)
    for (const n of d.nodes) expect(n.explode, '节点自己有了爆炸配置').toBe(null)
    // C6 的保证：一份老文档升到 v3 之后，一个字节的网络请求都不会多出来
    expect(d.dataSources, 'dataSources 不该被注入内容（D14 第二次执行）').toEqual([])
    expect(d.prefabs).toEqual([])
  })

  it('sceneId 从 projectId 确定性派生，且迁两次逐字相同', () => {
    const first = unwrap(migrate(loadRaw(V2_GOLDEN))).document
    const second = unwrap(migrate(loadRaw(V2_GOLDEN))).document
    expect(first.sceneId).toBe(deriveSceneId(first.projectId))
    // 铸随机 id 的实现在这里红：同一份老文档在两台机器上会迁出两个不同的场景 id，
    // 而那要等到 v1.5 做多场景时才暴露
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('origin 缺席的 v2 文档，迁移后仍然缺席 —— 不是 null，不是 {}', () => {
    const d = rawOf(V2_GOLDEN)
    const bare = d.assets.filter((a: Record<string, unknown>) => !('origin' in a))
    expect(bare.length, '每份资产都带 origin，这条断言没有对象').toBeGreaterThan(0)
    for (const a of bare) expect(Object.prototype.hasOwnProperty.call(a, 'origin')).toBe(false)
  })
})

describe('v2 -> v3 · 六条改写路径各自被执行了一次', () => {
  /**
   * **逐条断言每一处改写，不是断言「没报错」。**
   *
   * 这六处是 v3 第一次打破「迁移只做加法」的规矩，也是唯一可能把用户数据改坏的地方。
   * 一条 `expect(result.ok).toBe(true)` 对它们全部为真——包括六处全都没执行的那个版本。
   *
   * 断言的是**可观测的改写结果**而不是一条日志字符串：`Migration` 没有逐处改写的日志字段，
   * 而给它加一个是这张卡之外的公共 API 变更。观测比日志强的地方在于，日志可以写了却没做，
   * 观测不能。
   */
  const before = loadRaw(V2_BROKEN)
  const after = rawOf(V2_BROKEN)

  it('非增量-1 · sceneId 由 projectId 派生（v2 里根本没有这个键）', () => {
    expect('sceneId' in before).toBe(false)
    expect(after.sceneId).toBe(deriveSceneId(String(before.projectId)))
  })

  it('非增量-2 · thumbnailUrl 被删除，且没有变成 null 或空串', () => {
    expect(before.viewpoints[0].thumbnailUrl).toBe('blob:legacy-thumb')
    expect(Object.prototype.hasOwnProperty.call(after.viewpoints[0], 'thumbnailUrl')).toBe(false)
  })

  it('非增量-3 · 空的 page.name 被补成占位名', () => {
    expect(before.pages[0].name).toBe('')
    expect(after.pages[0].name).toBe('页面 1')
  })

  it('非增量-4 · 只有不合法的 overlay id 被重铸，合法的逐字保留', () => {
    const oldIds = before.pages[0].overlays.map((o: { id: string }) => o.id)
    const newIds = after.pages[0].overlays.map((o: { id: string }) => o.id)
    expect(oldIds).toEqual(['BAD-ID', 'ov_SHORT', 'ov_legal001'])

    // 两个非法的都被重铸，且**重铸后仍然互不相同**（返回常量的实现在这里红）
    expect(newIds[0]).not.toBe(oldIds[0])
    expect(newIds[1]).not.toBe(oldIds[1])
    expect(newIds[0]).not.toBe(newIds[1])
    for (const id of [newIds[0], newIds[1]]) expect(id).toMatch(/^ov_[0-9a-z]{8}$/)

    // 已经合法的那个一个字节都没动。`ov_SHORT` 是 `ov_` 开头但形状不对的那一个：
    // 把判定放宽成 /^ov_/ 会让它逃过重铸，于是上面第二条红。
    expect(newIds[2]).toBe('ov_legal001')
  })

  it('更重-1 · 裸 variableId 被确定性 mint，并真的补出一个同 id 的 string 变量', () => {
    expect(before.flows[0].variableId).toBe('不是合法变量名')
    const minted = after.flows[0].variableId
    expect(minted).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)

    const decl = after.variables.find((v: { id: string }) => v.id === minted)
    expect(decl, `mint 了 ${minted} 却没有声明它 —— 规则引擎会读到一个不存在的变量`).toBeTruthy()
    expect(decl.type).toBe('string')
    expect(decl.scope).toBe('scene')
    // 只为**真正被改写**的 flow 追加：老变量原样还在，没被顶掉
    expect(after.variables.some((v: { id: string }) => v.id === 'step')).toBe(true)
  })

  it('更重-2 · overlay props 补齐已知键、丢弃野键', () => {
    expect(before.pages[0].overlays[0].props).toEqual({ text: '你好', bogusKey: 1 })
    const props = after.pages[0].overlays[0].props
    expect(props.bogusKey, '野键没被丢掉 —— v3 的四支 props 都是 .strict()，它会让整份文档打不开').toBeUndefined()
    expect(props.text, '已有值被默认值顶掉了').toBe('你好')
    expect(props).toEqual({ text: '你好', size: 16, color: '#ffffff', align: 'left', flowId: null })
  })

  it('六条路径的输入在 fixture 里一条不缺', () => {
    // 扫描面下限：上面六条各自依赖 fixture 里的一处「坏」输入。哪天有人把 fixture
    // 「修好」了，六条会一起变成对着正常文档的空断言。
    expect(before.schemaVersion).toBe(2)
    expect(before.pages[0].overlays.length).toBe(3)
    expect(before.flows.length).toBe(1)
    expect(before.viewpoints.length).toBeGreaterThan(0)
  })
})
