import { z } from 'zod'
import { AnimationSchema } from './animation.js'
import { AssetSchema } from './asset.js'
import { DataSourceSchema } from './data-source.js'
import { DEFAULT_EFFECTS, EffectsSchema } from './effects.js'
import { FlowSchema } from './flow.js'
import { DEFAULT_FOG, FogSchema } from './fog.js'
import { PageSchema } from './page.js'
import { PrefabSchema } from './prefab.js'
import { HotspotSchema } from './hotspot.js'
import { AssetIdSchema, PREFIXES, ProjectIdSchema, SceneIdSchema } from './id.js'
import type { IdKind, Prefix } from './id.js'
import { MaterialSchema } from './material.js'
import { MediaSchema } from './media.js'
import { NodeSchema } from './node.js'
import { HexColorSchema, TimestampSchema } from './primitives.js'
import { RuleSchema } from './rule.js'
import { VariableSchema } from './variable.js'
import { ViewpointSchema } from './viewpoint.js'

/**
 * SCHEMA_SPEC §1 · the single source of truth (C1).
 *
 * If a feature needs to survive a reload, it is a field here. If it cannot be pointed
 * at a field here, the feature is designed wrong — that is the one question every
 * change has to answer (NORTH_STAR §2, C1).
 *
 * Runtime state — the current playback head, the hovered object, the live camera
 * position, which panel happens to be open — is explicitly NOT here. It is derived and
 * per-session; persisting it would make every mouse move a document mutation.
 *
 * Every collection is an ARRAY, not a Map/Record: order is user-visible (hierarchy tree,
 * rule list, animation list), and an Immer patch path stays readable as
 * `/nodes/3/transform/p`. Lookup cost is solved by a runtime index (index-builder.ts),
 * never by changing the persisted shape.
 */

export const CURRENT_VERSION = 3

export const SCENE_UNITS = ['m', 'cm', 'mm'] as const
export const UP_AXES = ['Y', 'Z'] as const
/** v2 adds `'hdri'`: the environment map doubles as the visible backdrop. */
export const BACKGROUND_TYPES = ['color', 'transparent', 'hdri'] as const

export const BackgroundSchema = z
  .object({
    type: z.enum(BACKGROUND_TYPES),
    /** Kept even when `type` is not `'color'`, so switching back restores the user's pick. */
    color: HexColorSchema.default('#1a1a1a'),
  })
  .strict()
export type Background = z.infer<typeof BackgroundSchema>

/**
 * v2 · image-based lighting.
 *
 * `hdriAssetId` is the switch for the whole feature: non-null means core builds a PMREM
 * environment from that `.hdr` and — per D14 — the built-in default light rig stands down.
 * Null restores v0's look exactly, which is what gate G0.5-6 asserts.
 *
 * **`toneMapping` is deliberately NOT a field.** Which tone-mapping curve to use is a
 * rendering decision that follows from whether there is an HDRI at all (ACESFilmic when
 * there is, v0's setting when there is not). Exposing it would let a user produce a washed
 * out scene through a control they cannot connect to the symptom — the same reasoning that
 * keeps texture colour space out of the document (MVP_V0 D3).
 *
 * `exposure` IS a field: it is an artistic choice about the scene, not about the renderer.
 */
export const EnvironmentSchema = z
  .object({
    /** Points at an asset with `type: 'hdri'`. null = no IBL. Checked by I12. */
    hdriAssetId: AssetIdSchema.nullable().default(null),
    intensity: z.number().min(0).max(4).default(1),
    exposure: z.number().min(0.1).max(4).default(1),
  })
  .strict()
export type Environment = z.infer<typeof EnvironmentSchema>

export const DEFAULT_ENVIRONMENT: Environment = { hdriAssetId: null, intensity: 1, exposure: 1 }

/**
 * `unit` and `upAxis` record the DOCUMENT's target coordinate system. An asset whose
 * own system differs is normalised once at import (SCHEMA_SPEC §5.2); the runtime then
 * performs zero coordinate conversion.
 */
export const MetaSchema = z
  .object({
    unit: z.enum(SCENE_UNITS).default('m'),
    upAxis: z.enum(UP_AXES).default('Y'),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    background: BackgroundSchema.default({ type: 'color', color: '#1a1a1a' }),
    environment: EnvironmentSchema.default({ hdriAssetId: null, intensity: 1, exposure: 1 }),
    /** v3 · 雾。**独立块，不并进 `effects`**（X-01 · D30）——它不是后处理。 */
    fog: FogSchema.default(DEFAULT_FOG),
    /** v3 · 后处理。**只有描边**，刻意不含 bloom / ssao 的占位字段（X-02 · D31）。 */
    effects: EffectsSchema.default(DEFAULT_EFFECTS),
  })
  .strict()
export type Meta = z.infer<typeof MetaSchema>

export const SceneDocumentSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_VERSION),
    projectId: ProjectIdSchema,
    /**
     * v3 · 场景 id。**必填、无 default**（多场景，v1.5 才通电）。
     *
     * 无 default 是有意的：一份没有 sceneId 的文档不该被静默补一个，它该走迁移——
     * 而迁移用 `deriveSceneId(projectId)` **确定性派生**，不铸随机 id。
     *
     * **`sceneRefs` 顶层集合不建**（A3(c) · D38）：场景之间的关系由项目层表达，
     * 文档不该知道有别的文档存在。
     */
    sceneId: SceneIdSchema,
    name: z.string().min(1).max(120),
    meta: MetaSchema,

    assets: z.array(AssetSchema),
    nodes: z.array(NodeSchema),
    materials: z.array(MaterialSchema),
    animations: z.array(AnimationSchema),
    hotspots: z.array(HotspotSchema),
    viewpoints: z.array(ViewpointSchema),
    variables: z.array(VariableSchema),
    rules: z.array(RuleSchema),

    // v3 · 从 deferred.ts 出列（该文件已删）。运行时在 v1.2。
    pages: z.array(PageSchema).default([]),
    flows: z.array(FlowSchema).default([]),
    /** v3 · 外部数据源。形状冻死，运行时在 v1.5。默认 `[]` —— 老文档不会开始发请求（C6）。 */
    dataSources: z.array(DataSourceSchema).default([]),
    /** v3 · 预制体。形状冻死，运行时在 **v2**。本版最大的一块 placeholder（D22 已签字接受）。 */
    prefabs: z.array(PrefabSchema).default([]),
    /** Defined in v0, given a runtime in v0.5 — see media.ts and SCHEMA_SPEC §6.7. */
    media: z.array(MediaSchema).default([]),
  })
  .strict()
export type SceneDocument = z.infer<typeof SceneDocumentSchema>

/**
 * T-201 · what is known about one id-bearing collection, in one place.
 *
 * Until this card, `ID_COLLECTIONS` was a bare array of names with **zero references
 * anywhere in the repository** — while four other places each kept their own hand-copied
 * list of the same eleven collections: `checkIntegrity`'s I1 table, `checkIntegrity`'s
 * `sets`, `collectAllIds`, and the editor's snapshot rollback. It looked like there was a
 * collection registry. There was not.
 *
 * What that costs is not hypothetical. Adding a twelfth collection means editing four
 * places, and TypeScript reports **none** of them: the I1 table is an array literal, the
 * rollback is eleven statements, and `collectAllIds` is eleven `add()` calls. The failure
 * modes are silent and expensive — an id collision minted on first write (nothing collected
 * the new collection's ids, so `newId` never saw them), and a published `.w3p` missing
 * bytes. v0.5 shipped both of those, for exactly this reason (IMPL_NOTES T-176).
 *
 * schema v3 (T-225) adds five collections at once. This registry has to exist first.
 */
export interface CollectionSpec {
  /** The document key. Also the first segment of its patch path. */
  readonly key: string
  /**
   * The id prefix its records carry, e.g. `nd` — or null when ids are not minted.
   *
   * Null has exactly one member today and it is not an oversight: a variable's id is an
   * identifier the author types (`step`, `pressure`), governed by `VariableIdSchema`'s
   * pattern and reserved-word list rather than by `newId`. `PREFIXES.variable` exists and is
   * used by nothing. Recording that as `null` is the point of having a registry — the
   * alternative is a table that quietly claims variables are minted `var_xxxxxxxx`, which
   * the first consumer to trust it would get wrong.
   */
  readonly idPrefix: Prefix | null
  /** Chinese, user-facing — `checkIntegrity`'s messages and the editor's labels read it. */
  readonly label: string
  /**
   * The `RefKind` used when something points AT this collection, or null when nothing can.
   *
   * Null is a real answer, not a gap: no field anywhere references a rule, a page or a flow
   * by id today. `checkIntegrity`'s `sets` is derived from exactly the non-null ones, which
   * is why that table has eight entries while I1's has eleven — a difference that used to be
   * two unrelated hand-written lists and is now one derivation.
   */
  readonly refKind: IdKind | null
  /**
   * Sub-arrays inside each record that carry ids of their own.
   *
   * Both entries are load-bearing, not illustrative. `flows: ['steps']` is why step ids are
   * unique. `pages: ['overlays']` is the ONLY thing that will stop `createOverlay` from
   * minting a duplicate id — `collectAllIds` feeds `newId`'s taken-set, and an overlay id it
   * cannot see is an overlay id it will happily reissue.
   */
  readonly nested: readonly string[]
  /** The Immer patch path prefix `applyPatch` must recognise, e.g. `/nodes`. */
  readonly patchPath: string
}

/**
 * Every collection keyed by a generated id, in the order `checkIntegrity` reports them.
 *
 * Declaration order IS the report order — objects preserve string-key insertion order, and
 * making it a second exported tuple would recreate the two-lists-that-drift problem this
 * card exists to remove.
 */
const COLLECTION_SPECS = {
  assets: { key: 'assets', idPrefix: PREFIXES.asset, label: '资产', refKind: 'asset', nested: [], patchPath: '/assets' },
  nodes: { key: 'nodes', idPrefix: PREFIXES.node, label: '对象', refKind: 'node', nested: [], patchPath: '/nodes' },
  materials: {
    key: 'materials',
    idPrefix: PREFIXES.material,
    label: '材质',
    refKind: 'material',
    nested: [],
    patchPath: '/materials',
  },
  animations: {
    key: 'animations',
    idPrefix: PREFIXES.animation,
    label: '动画',
    refKind: 'animation',
    nested: [],
    patchPath: '/animations',
  },
  hotspots: {
    key: 'hotspots',
    idPrefix: PREFIXES.hotspot,
    label: '热点',
    refKind: 'hotspot',
    nested: [],
    patchPath: '/hotspots',
  },
  viewpoints: {
    key: 'viewpoints',
    idPrefix: PREFIXES.viewpoint,
    label: '视点',
    refKind: 'viewpoint',
    nested: [],
    patchPath: '/viewpoints',
  },
  variables: {
    key: 'variables',
    // Author-chosen, not minted. See `CollectionSpec.idPrefix`.
    idPrefix: null,
    label: '变量',
    refKind: 'variable',
    nested: [],
    patchPath: '/variables',
  },
  rules: { key: 'rules', idPrefix: PREFIXES.rule, label: '规则', refKind: null, nested: [], patchPath: '/rules' },
  pages: { key: 'pages', idPrefix: PREFIXES.page, label: '页面', refKind: null, nested: ['overlays'], patchPath: '/pages' },
  flows: { key: 'flows', idPrefix: PREFIXES.flow, label: '流程', refKind: null, nested: ['steps'], patchPath: '/flows' },
  media: { key: 'media', idPrefix: PREFIXES.media, label: '多媒体', refKind: 'media', nested: [], patchPath: '/media' },
  // v3 · 顶层集合 11 → 13。五个遍历面由本注册表自动覆盖——这正是 T-201 把它从一个
  // 零引用的字符串数组升格成真注册表所买到的东西：加一个集合改一处，不是改四处。
  dataSources: {
    key: 'dataSources',
    idPrefix: PREFIXES.dataSource,
    label: '数据源',
    refKind: 'dataSource',
    nested: [],
    patchPath: '/dataSources',
  },
  prefabs: {
    key: 'prefabs',
    idPrefix: PREFIXES.prefab,
    label: '预制体',
    refKind: 'prefab',
    nested: ['nodes', 'materials'],
    patchPath: '/prefabs',
  },
} as const satisfies Record<string, CollectionSpec>

export type IdCollection = keyof typeof COLLECTION_SPECS

export const ID_COLLECTIONS: Record<IdCollection, CollectionSpec> = COLLECTION_SPECS

/** The collection names in report order. Derived, never hand-written. */
export const ID_COLLECTION_NAMES = Object.keys(ID_COLLECTIONS) as readonly IdCollection[]
