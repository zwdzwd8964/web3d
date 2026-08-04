import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ID_COLLECTIONS, ID_COLLECTION_NAMES, SceneDocumentSchema } from '../src/document.js'
import type { IdCollection, SceneDocument } from '../src/document.js'
import { createGoldenPathDocument } from '../src/samples.js'
import { checkIntegrity } from '../src/integrity.js'
import { collectAllIds } from '../src/selectors.js'

/**
 * T-201 · the collection registry.
 *
 * `ID_COLLECTIONS` existed since v0 with **zero references anywhere**, while four other
 * places each kept a hand-copied list of the same eleven collections. The point of these
 * tests is not that the registry is well-formed — it is that the four consumers are
 * genuinely derived from it, which is a claim about what happens when a twelfth collection
 * appears. T-225 adds five at once.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))

/**
 * The collections the golden path leaves empty: a page, a flow, a media record — and,
 * since T-225, a data source and a prefab.
 *
 * **This builder is the test's real subject.** The header above says the point is what
 * happens when a twelfth collection appears; a builder that silently skips the new two
 * would let the I1 assertion below pass on eleven of thirteen and call it derived.
 */
function fullDocument(): SceneDocument {
  const doc = createGoldenPathDocument()
  return {
    ...doc,
    pages: [{ id: 'pg_11111111', name: '首页', overlays: [
          {
            id: 'ov_aaaaaaaa',
            type: 'text',
            rect: { x: 0, y: 0, w: 1, h: 1 },
            anchor: 'tl',
            props: { text: '', size: 16, color: '#ffffff', align: 'left', flowId: null },
          },
        ] }],
    flows: [
      {
        id: 'flw_11111111',
        name: '拆装',
        variableId: doc.variables[0]!.id,
        startStepId: 'st_11111111',
        steps: [{ id: 'st_11111111', name: '第一步', next: null, onEnter: [] }],
      },
    ],
    media: [{ id: 'med_11111111', type: 'audio', assetId: doc.assets[0]!.id, name: '提示音' }],
    // v3 · 两个新集合。`enabled: false` / `mode: 'sample'` 是刻意的：这份 fixture 会被
    // 十几个测试读，没有一个该因为它而想到「发网络请求」。
    dataSources: [
      {
        id: 'ds_11111111',
        name: '产线读数',
        enabled: false,
        mode: 'sample',
        url: '',
        method: 'get',
        body: null,
        auth: { kind: 'none', secretRef: '', headerName: '' },
        intervalMs: 30_000,
        timeoutMs: 10_000,
        startOn: 'sceneReady',
        onError: 'keep',
        map: [],
        sample: [],
      },
    ],
    prefabs: [{ id: 'pfb_11111111', name: '标准泵组', note: '', version: 1, nodes: [], materials: [] }],
  } as SceneDocument
}

/* --- the registry itself matches the document ----------------------------- */

describe('注册表与文档形状', () => {
  /**
   * Bidirectional set equality, deliberately.
   *
   * `expect(ID_COLLECTION_NAMES.length).toBeGreaterThan(0)` would pass forever and prove
   * nothing — that is variation ③ on the card, and the reason it is called out is that the
   * weak version is the one that gets written by accident. Both directions matter: a
   * document collection nobody registered is an id-collision waiting to be minted, and a
   * registry entry for a collection that no longer exists is a crash in every consumer.
   */
  it('registers exactly the id-bearing collections the document declares', () => {
    expect([...ID_COLLECTION_NAMES].sort()).toEqual(idBearingCollectionsOf(SceneDocumentSchema).sort())
  })

  it('gives every entry a prefix, a Chinese label and a patch path', () => {
    for (const name of ID_COLLECTION_NAMES) {
      const spec = ID_COLLECTIONS[name]
      expect(spec.key).toBe(name)
      expect(spec.patchPath).toBe(`/${name}`)
      if (spec.idPrefix !== null) expect(spec.idPrefix).toMatch(/^[a-z]{2,3}$/)
      // Chinese, because it is user-facing (CLAUDE.md 命名规范). An English label here shows
      // up verbatim in 完整性检查 messages the customer reads.
      expect(spec.label).toMatch(/^[一-龥]+$/)
    }
  })

  it('mints every collection an id its own prefix matches', () => {
    const doc = fullDocument()
    for (const name of ID_COLLECTION_NAMES) {
      const spec = ID_COLLECTIONS[name]
      if (spec.idPrefix === null) continue
      for (const record of doc[name]) expect(record.id.startsWith(`${spec.idPrefix}_`)).toBe(true)
    }
  })

  /**
   * `variables` is the only unminted collection, and that claim is asserted rather than
   * commented. This test found the fact in the first place: the registry originally listed
   * `PREFIXES.variable` for it, and the golden path's variable is named `step`.
   */
  it('records variables as the one collection whose ids are author-chosen', () => {
    const unminted = ID_COLLECTION_NAMES.filter((name) => ID_COLLECTIONS[name].idPrefix === null)
    expect(unminted).toEqual(['variables'])
  })
})

/* --- consumer 1 · collectAllIds ------------------------------------------- */

describe('collectAllIds 由注册表驱动', () => {
  it('collects every top-level id plus the project id', () => {
    const doc = fullDocument()
    const ids = collectAllIds(doc)
    expect(ids.has(doc.projectId)).toBe(true)
    for (const name of ID_COLLECTION_NAMES) {
      for (const record of doc[name]) expect(ids.has(record.id)).toBe(true)
    }
  })

  it('collects nested step and overlay ids', () => {
    const ids = collectAllIds(fullDocument())
    // Steps have always been collected. Overlays never were — and `pages: ['overlays']` is
    // the ONLY thing that will stop `createOverlay` (v1.2) from reissuing an id that is
    // already in use, because `newId`'s taken-set is exactly this Set.
    expect(ids.has('st_11111111')).toBe(true)
    expect(ids.has('ov_aaaaaaaa')).toBe(true)
  })

  /**
   * T-225 · **恰好多 3，不是「大于」。**
   *
   * `toBeGreaterThan` 在这里是没有内容的：文档里随便多一个 id 它都为真。而
   * `pages: ['overlays']` 漏登记时的实际表现是**一个都不多**，所以 `=== +3` 是唯一能把
   * 「登记了」和「没登记」分开的写法。
   *
   * 这个 Set 就是 `newId` 的 taken-set：漏登记的直接后果是 v1.2 的 `createOverlay` 会
   * 重新发一个已经在用的 id，而重复 id 要到 I1 报出来才被人看见。
   */
  it('新加 3 个覆盖层，collectAllIds 恰好多 3', () => {
    const doc = fullDocument()
    const before = collectAllIds(doc).size

    const rect = { x: 0, y: 0, w: 1, h: 1 }
    const grown: SceneDocument = {
      ...doc,
      pages: [
        {
          ...doc.pages[0]!,
          overlays: [
            ...doc.pages[0]!.overlays,
            { id: 'ov_bbbbbbbb', type: 'text', rect, anchor: 'tl', props: { text: '', size: 16, color: '#ffffff', align: 'left', flowId: null } },
            { id: 'ov_cccccccc', type: 'button', rect, anchor: 'tl', props: { label: '按钮', variant: 'primary' } },
            { id: 'ov_dddddddd', type: 'panel', rect, anchor: 'tl', props: { title: '', text: '', mediaId: null, flowId: null, progress: false } },
          ],
        },
      ],
    } as SceneDocument

    expect(collectAllIds(grown).size - before).toBe(3)
  })

  /**
   * 同一条规矩加在 `prefabs: ['nodes', 'materials']` 上。
   *
   * prefab 里的节点与材质**和文档主集合同一命名空间**（I42 保证不撞车），所以它们必须进
   * taken-set。两条 nested 分别验，一条漏登记时另一条不会替它遮掩。
   */
  it('prefab 里的节点与材质也进 taken-set，各自恰好多 1', () => {
    const doc = fullDocument()
    const before = collectAllIds(doc).size
    const base = doc.prefabs[0]!

    const withNode = { ...doc, prefabs: [{ ...base, nodes: [...base.nodes, { ...doc.nodes[0]!, id: 'nd_inpfb001', parent: null }] }] } as SceneDocument
    expect(collectAllIds(withNode).size - before, 'prefabs[].nodes 没进 taken-set').toBe(1)

    const withMat = {
      ...doc,
      prefabs: [{ ...base, materials: [...base.materials, { id: 'mat_inpfb001', name: '预制材质', base: 'standard', preset: null, params: {} }] }],
    } as unknown as SceneDocument
    expect(collectAllIds(withMat).size - before, 'prefabs[].materials 没进 taken-set').toBe(1)
  })
})

/* --- consumer 2 · checkIntegrity ------------------------------------------ */

describe('checkIntegrity 由注册表驱动', () => {
  /**
   * The I1 table used to be an eleven-row literal. This asserts the derivation instead of
   * the literal: duplicate an id in every collection at once and require that the set of
   * collections reporting I1 is exactly the registry's key set.
   */
  it('reports I1 for every registered collection and no others', () => {
    const doc = fullDocument()
    const duplicated = { ...doc } as Record<string, unknown>
    for (const name of ID_COLLECTION_NAMES) {
      const records = doc[name] as readonly { id: string }[]
      duplicated[name] = [...records, { ...records[0] }]
    }

    const reported = new Set(
      checkIntegrity(duplicated as unknown as SceneDocument)
        .filter((issue) => issue.code === 'I1')
        .map((issue) => issue.path.split('[')[0]!),
    )
    expect([...reported].sort()).toEqual([...ID_COLLECTION_NAMES].sort())
  })

  /** `KIND_LABEL` is derived, so a dangling reference names its target in Chinese. */
  it('names a dangling reference with the registry label', () => {
    const doc = fullDocument()
    const broken = {
      ...doc,
      nodes: doc.nodes.map((n) => ({ ...n, overrides: { ...n.overrides, materialId: 'mat_deadbeef' } })),
    }
    const issue = checkIntegrity(broken as SceneDocument).find((i) => i.refKind === 'material')
    expect(issue?.message).toContain(ID_COLLECTIONS.materials.label)
  })
})

/* --- the literal is really gone ------------------------------------------- */

describe('手写集合表已经消失', () => {
  /**
   * Not "zero collection-name strings" — `'nodes'` and `'rules'` legitimately survive as
   * issue PATHS, and `'media'` as a RefKind that happens to be spelled like its collection.
   * What must not survive is a *table*: three or more of these names clustered together.
   * That shape is the hand-copied list, and it is what silently goes stale.
   */
  it('has no cluster of collection names left in integrity.ts', () => {
    const source = readFileSync(join(SRC, 'integrity.ts'), 'utf8')
    expect(clusteredCollectionLiterals(source)).toEqual([])
  })

  it('has no cluster left in selectors.ts either', () => {
    expect(clusteredCollectionLiterals(readFileSync(join(SRC, 'selectors.ts'), 'utf8'))).toEqual([])
  })

  /**
   * The registry had zero references for two whole versions. This is the assertion that
   * says it is load-bearing now, and it is deliberately a count rather than a boolean:
   * "someone imports it somewhere" was true of plenty of dead code in this repository.
   */
  it('is referenced from at least five places outside its own file', () => {
    const hits: string[] = []
    for (const file of walk(SRC)) {
      if (file.endsWith('document.ts')) continue
      const count = readFileSync(file, 'utf8').split(/\bID_COLLECTIONS?\b|\bID_COLLECTION_NAMES\b/).length - 1
      for (let i = 0; i < count; i++) hits.push(file)
    }
    expect(hits.length).toBeGreaterThanOrEqual(5)
  })
})

/* --- helpers -------------------------------------------------------------- */

/** Every key of `schema` that is an array of records carrying an `id`. */
function idBearingCollectionsOf(schema: typeof SceneDocumentSchema): string[] {
  const out: string[] = []
  for (const [key, field] of Object.entries(schema.shape)) {
    const array = unwrap(field)
    if (def(array)?.type !== 'array') continue
    if (hasIdKey(def(array)?.element)) out.push(key)
  }
  return out
}

/** Peels `.default()` / `.optional()` / `.nullable()` wrappers off a zod schema. */
function unwrap(schema: unknown): unknown {
  let current = schema
  while (['default', 'optional', 'nullable'].includes(def(current)?.type ?? '')) {
    current = def(current)?.innerType
  }
  return current
}

function def(schema: unknown): { type?: string; element?: unknown; innerType?: unknown; options?: unknown[] } | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined
  const candidate = (schema as { def?: unknown }).def
  return typeof candidate === 'object' && candidate !== null ? (candidate as ReturnType<typeof def>) : undefined
}

/** True when `schema` is an object with an `id` key, or a union of such objects. */
function hasIdKey(schema: unknown): boolean {
  const kind = def(schema)?.type
  if (kind === 'object') return 'id' in ((schema as { shape: Record<string, unknown> }).shape ?? {})
  if (kind === 'union') return (def(schema)?.options ?? []).every((option) => hasIdKey(option))
  return false
}

/** Windows of source text holding three or more distinct collection-name literals. */
function clusteredCollectionLiterals(source: string): string[] {
  const pattern = new RegExp(`'(${ID_COLLECTION_NAMES.join('|')})'`, 'g')
  const found = [...source.matchAll(pattern)].map((m) => ({ name: m[1]!, at: m.index }))
  const clusters: string[] = []
  for (let i = 0; i + 2 < found.length; i++) {
    const window = found.slice(i, i + 3)
    const distinct = new Set(window.map((f) => f.name))
    if (distinct.size === 3 && window[2]!.at - window[0]!.at < 400) clusters.push([...distinct].join(','))
  }
  return clusters
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.endsWith('.ts')) yield full
  }
}

/** Kept so the `IdCollection` type is exercised, not merely exported. */
const _sample: IdCollection = 'nodes'
void _sample
