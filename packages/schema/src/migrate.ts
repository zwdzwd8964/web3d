import { CURRENT_VERSION } from './document.js'
import { DEFAULT_OUTLINE } from './effects.js'
import { DEFAULT_FOG } from './fog.js'
import { VARIABLE_ID_PATTERN, deriveSceneId, isReservedVariableId } from './id.js'
import { DEFAULT_OVERLAY_PROPS } from './page.js'
import type { SceneDocument } from './document.js'
import type { Result, ValidationError } from './validate.js'
import { err, ok, validate } from './validate.js'

/**
 * SCHEMA_SPEC §10 · constitution C4. Any historical snapshot must open in today's code,
 * forever.
 *
 * The non-negotiable procedure: changing the schema means schemaVersion +1 AND a
 * Migration AND a fixture. All three, every time. Two out of three is anti-pattern A4 —
 * historical snapshots break silently and it surfaces during the customer's trial run
 * at the earliest.
 *
 * Migration is upward only. A v1 build handed a v2 document refuses it loudly rather
 * than guessing; silently ignoring unknown fields would let an old player save over a
 * newer document and destroy work.
 */

export interface Migration {
  readonly from: number
  readonly to: number
  /** One line, shown in the migration log and the publish dialog. */
  readonly describe: string
  /**
   * Pure function. No external state, no network.
   *
   * Through v2 the rule was "fill in missing fields with defaults and touch nothing that is
   * already there". **v3 breaks that rule in six places** — four non-additive rewrites plus
   * two heavier ones (minting a flow variable, normalising overlay props). Every one of them
   * is listed in `V2_TO_V3`'s own comment with the licence that permits it.
   *
   * The old sentence also claimed unknown fields are KEPT. **That was never true**:
   * `SceneDocumentSchema` is `.strict()`, so anything this function preserves is rejected by
   * the very next `validate()`. The note described a behaviour the code does not have.
   */
  up(doc: Record<string, unknown>): Record<string, unknown>
}

/**
 * v1 → v2 · the v0.5 field set, in ONE bump (D11).
 *
 * Additive only: every new field gets its documented default and nothing existing is
 * touched. That is what makes the whole of v0.5 — primitives, lights, environment,
 * material maps, media — cost a single migration and a single fixture generation instead
 * of four of each.
 *
 * **It writes the defaults explicitly rather than leaving the fields absent for zod to
 * fill.** Zod would fill them, and `migrate()` would still return a valid document, so
 * this function could be `d => d` and every test that only looks at `migrate()` would
 * stay green. Two reasons it must not be:
 *
 *   1. the next migration (v2 → v3) receives this function's RAW output, not zod's — it
 *      would find `undefined` where the v2 shape promises a value;
 *   2. `media[].name` has no default and cannot have one, because the sensible value comes
 *      from a different collection. A v1 document that actually used `media` would fail
 *      validation outright without this step.
 *
 * **No light node is injected** (D14). The default three-light rig is a display default,
 * like the default background colour — not scene content. Materialising it into three
 * document nodes would make every existing project sprout three tree entries the user
 * never created, cannot explain, and turns the scene black by deleting.
 */
const V1_TO_V2: Migration = {
  from: 1,
  to: 2,
  describe: '新增原始体/灯光承载体、环境与背景 HDRI、材质贴图变换与 physical 参数、媒体记录名称与时长',
  up(doc) {
    const assetNames = new Map<string, string>()
    for (const asset of asArray(doc.assets)) {
      const record = asRecord(asset)
      if (typeof record?.id === 'string' && typeof record.name === 'string') assetNames.set(record.id, record.name)
    }

    const meta = asRecord(doc.meta) ?? {}
    return {
      ...doc,
      meta: {
        ...meta,
        // Spread-then-default, never overwrite: a document that somehow already carries an
        // environment block keeps it. Migrations fill gaps; they do not normalise.
        environment: { hdriAssetId: null, intensity: 1, exposure: 1, ...(asRecord(meta.environment) ?? {}) },
      },
      nodes: asArray(doc.nodes).map((node) => ({ primitive: null, light: null, ...(asRecord(node) ?? {}) })),
      media: asArray(doc.media).map((entry) => {
        const record = asRecord(entry) ?? {}
        if (typeof record.name === 'string' && record.name.length > 0) return record
        const assetId = typeof record.assetId === 'string' ? record.assetId : ''
        // The asset's filename is the name the user recognises. When the reference is
        // already dangling the id is kept instead of inventing a label — an unhelpful but
        // TRACEABLE name, on a document that integrity check I14 is about to flag anyway.
        const fallback = typeof record.id === 'string' ? record.id : '媒体'
        return { ...record, name: assetNames.get(assetId) ?? fallback }
      }),
    }
  },
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/**
 * The shipped chain, in ascending `from` order.
 *
 * It was built and tested while still empty at schemaVersion 1 (SCHEMA_SPEC §10 is
 * explicit that day one is when this gets built), which is why adding the first real entry
 * here was a five-line change rather than a project.
 */
/**
 * v2 → v3 · **v1 唯一的一次 bump**（A2）。
 *
 * 逐字实现 `docs/SCHEMA_V3_FREEZE.md` §1 的裁决表，表里没有的字段一个都不加。
 *
 * **默认值全部显式写出来，不靠 zod 兜底。** 下一条迁移拿到的是本函数的**原始输出**，
 * 不是 zod 的产物——所以测试断言 `applyMigrationChain(...).raw` 而不是 `migrate(...).document`：
 * 把 `up` 整个换成 `d => d`，只看 `.document` 的测试**仍然全绿**。
 *
 * **不注入任何内容**（D14 第二次执行）：不补默认 page / flow / dataSource / prefab / 灯光节点。
 * 唯一的例外是「更重-1」，它的许可条件写在下面。
 */
const OVERLAY_ID_RE = /^ov_[0-9a-z]{8}$/

/** 确定性重铸，纯函数无随机——同一份文档迁两次得到同一个 id。 */
const deterministicOverlayId = (pageIndex: number, overlayIndex: number): string =>
  `ov_${String(pageIndex).padStart(4, '0')}${String(overlayIndex).padStart(4, '0')}`

const deterministicFlowVariableId = (flowIndex: number): string => `flow_step_${flowIndex + 1}`

const V2_TO_V3: Migration = {
  from: 2,
  to: 3,
  describe:
    '新增场景主键、雾与描边、爆炸与剖切承载体、覆盖层与流程的运行时字段、动画区间、热点编号、资产溯源、外部数据源与 prefab',
  up(doc) {
    const meta = asRecord(doc.meta) ?? {}
    const declared = new Set(asArray(doc.variables).map((v) => String(asRecord(v)?.id)))
    /** 更重-1 的两半必须一起算：flows 改写与 variables 追加要看同一份判定结果。 */
    const flowFixes = asArray(doc.flows).map((f, i) => {
      const rec = asRecord(f) ?? {}
      const old = typeof rec.variableId === 'string' ? rec.variableId : ''
      const legal = VARIABLE_ID_PATTERN.test(old) && !isReservedVariableId(old) && declared.has(old)
      return { rec, variableId: legal ? old : deterministicFlowVariableId(i), minted: !legal }
    })
    return {
      ...doc,
      // 非增量-1：从 projectId 确定性派生，**不铸随机 id**——否则同一份老文档在两台机器上
      // 迁出两个不同的场景 id，而那要到 v1.5 做多场景时才暴露。
      sceneId: deriveSceneId(String(doc.projectId)),
      meta: {
        ...meta,
        // spread-then-default，永不覆盖已有值（同 V1_TO_V2 的 environment）
        fog: { ...DEFAULT_FOG, ...(asRecord(meta.fog) ?? {}) },
        effects: {
          ...(asRecord(meta.effects) ?? {}),
          outline: { ...DEFAULT_OUTLINE, ...(asRecord(asRecord(meta.effects)?.outline) ?? {}) },
        },
      },
      nodes: asArray(doc.nodes).map((n) => ({
        section: null,
        explode: null,
        explodeOffset: null,
        prefabRef: null,
        ...(asRecord(n) ?? {}),
      })),
      animations: asArray(doc.animations).map((a) => {
        const rec = asRecord(a) ?? {}
        return rec.kind === 'imported' ? { startS: 0, endS: null, ...rec } : rec
      }),
      assets: asArray(doc.assets).map((a) => {
        const rec = asRecord(a) ?? {}
        // `AssetStats` 是 .strict()，少这一个键会让每一份老 fixture 的校验失败。
        return { ...rec, stats: { clipDurations: {}, ...(asRecord(rec.stats) ?? {}) } }
      }),
      // 非增量-2：本次唯一一处字段删除。`origin` 缺席的文档迁移后**仍然缺席**
      // （不是 null 不是 {}）——这是 `...rest` 而不是显式补值的原因。
      viewpoints: asArray(doc.viewpoints).map((v) => {
        const { thumbnailUrl: _dropped, ...rest } = asRecord(v) ?? {}
        return rest
      }),
      variables: [
        ...asArray(doc.variables).map((v) => ({ scope: 'scene' as const, ...(asRecord(v) ?? {}) })),
        // 更重-1 的后半：只为**真正被改写**的 flow 追加，且 id 与前半逐字相同。
        ...flowFixes
          .filter((f) => f.minted)
          .map((f, n) => ({
            id: f.variableId,
            name: `流程 ${n + 1} 当前步骤`,
            type: 'string',
            default: '',
            persist: false,
            scope: 'scene' as const,
          })),
      ],
      flows: flowFixes.map(({ rec, variableId }) => {
        const steps = asArray(rec.steps)
        return {
          // startStepId：一次性推导，纯函数，不注入内容。
          startStepId: (asRecord(steps[0])?.id as string) ?? null,
          ...rec,
          variableId, // 更重-1 的前半
        }
      }),
      pages: asArray(doc.pages).map((page, pi) => {
        const p = asRecord(page) ?? {}
        return {
          ...p,
          // 非增量-3：v3 把 name 收紧为 min(1)
          name: typeof p.name === 'string' && p.name.length > 0 ? p.name : `页面 ${pi + 1}`,
          overlays: asArray(p.overlays).map((overlay, oi) => {
            const o = asRecord(overlay) ?? {}
            return {
              ...o,
              // 非增量-4：仅当不匹配 ^ov_[0-9a-z]{8}$ 时确定性重铸
              id: OVERLAY_ID_RE.test(String(o.id)) ? o.id : deterministicOverlayId(pi, oi),
              // 更重-2：按 type 取 props schema 逐键补默认值，未知键丢弃
              props: normaliseOverlayProps(String(o.type), asRecord(o.props) ?? {}),
            }
          }),
        }
      }),
      dataSources: asArray(doc.dataSources),
      prefabs: asArray(doc.prefabs),
    }
  },
}

/**
 * 更重-2 · 按 overlay 的 type 把 props 归一化。
 *
 * v2 的 props 是 `z.record(z.unknown())`——什么都能塞。v3 的四支各自 `.strict()`，
 * 于是老文档里一个拼错的 prop 名会让整份文档校验失败。**丢弃未知键**是为了让
 * 「一份能打开的文档永远能打开」（C4）；丢的是什么，由本函数的调用方记进迁移日志。
 */
function normaliseOverlayProps(type: string, props: Record<string, unknown>): Record<string, unknown> {
  const shape = (DEFAULT_OVERLAY_PROPS as Record<string, Readonly<Record<string, unknown>>>)[type]
  // 未知 type：原样返回，让 zod 的判别联合去报错——静默改写一个我们不认识的 overlay
  // 比让它校验失败更糟。
  if (!shape) return props
  const out: Record<string, unknown> = {}
  for (const [key, fallback] of Object.entries(shape)) {
    out[key] = key in props ? props[key] : fallback
  }
  return out
}

export const MIGRATIONS: readonly Migration[] = [V1_TO_V2, V2_TO_V3]

export interface MigrationFailure {
  readonly kind: 'malformed' | 'from-the-future' | 'missing-step' | 'bad-chain' | 'invalid-result'
  readonly message: string
  /** Present when the migrated document failed structural validation. */
  readonly validation?: readonly ValidationError[]
}

export interface MigrationSuccess {
  readonly document: SceneDocument
  readonly fromVersion: number
  readonly toVersion: number
  readonly applied: readonly string[]
}

export interface MigrateOptions {
  /** Defaults to the shipped chain. Injectable so the machinery is exercised while MIGRATIONS is empty. */
  readonly migrations?: readonly Migration[]
  /** Test seam only. Production always targets CURRENT_VERSION. */
  readonly targetVersion?: number
}

function readVersion(raw: unknown): Result<number, MigrationFailure> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err({ kind: 'malformed', message: 'document must be a JSON object' })
  }
  const v = (raw as Record<string, unknown>).schemaVersion
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return err({ kind: 'malformed', message: `missing or invalid schemaVersion: ${JSON.stringify(v)}` })
  }
  return ok(v)
}

export interface ChainResult {
  /** The migrated plain object. Not yet validated. */
  readonly raw: Record<string, unknown>
  readonly fromVersion: number
  readonly toVersion: number
  readonly applied: readonly string[]
}

/**
 * Walks the chain and returns the raw migrated object.
 *
 * Split out from `migrate()` on purpose: because `schemaVersion` is a literal, a chain
 * that ends above the current version can never validate, so this loop would otherwise
 * be unobservable until the day a real migration ships. Here it is directly testable
 * with a synthetic chain, and `migrate()` stays the only entry point that also
 * validates.
 */
export function applyMigrationChain(
  raw: unknown,
  options: MigrateOptions = {},
): Result<ChainResult, MigrationFailure> {
  const migrations = options.migrations ?? MIGRATIONS
  const targetVersion = options.targetVersion ?? CURRENT_VERSION

  const versionResult = readVersion(raw)
  if (!versionResult.ok) return versionResult
  const fromVersion = versionResult.value

  if (fromVersion > targetVersion) {
    return err({
      kind: 'from-the-future',
      message:
        `document schemaVersion ${fromVersion} is newer than this build understands (${targetVersion}). ` +
        'Refusing to open it: a downgrade would silently drop fields.',
    })
  }

  const byFrom = new Map<number, Migration>()
  for (const m of migrations) {
    if (m.to !== m.from + 1) {
      return err({ kind: 'bad-chain', message: `migration ${m.from}->${m.to} must be a single step` })
    }
    if (byFrom.has(m.from)) {
      return err({ kind: 'bad-chain', message: `two migrations registered from version ${m.from}` })
    }
    byFrom.set(m.from, m)
  }

  let current = structuredClone(raw) as Record<string, unknown>
  const applied: string[] = []
  let version = fromVersion

  while (version < targetVersion) {
    const step = byFrom.get(version)
    if (!step) {
      return err({
        kind: 'missing-step',
        message:
          `no migration registered from schemaVersion ${version} to ${version + 1}. ` +
          'Bumping the version without a migration is anti-pattern A4.',
      })
    }
    current = step.up(current)
    current.schemaVersion = step.to
    applied.push(`v${step.from} -> v${step.to}: ${step.describe}`)
    version = step.to
  }

  return ok({ raw: current, fromVersion, toVersion: version, applied })
}

export function migrate(raw: unknown, options: MigrateOptions = {}): Result<MigrationSuccess, MigrationFailure> {
  const chain = applyMigrationChain(raw, options)
  if (!chain.ok) return chain

  const validated = validate(chain.value.raw)
  if (!validated.ok) {
    return err({
      kind: 'invalid-result',
      message: `migrated document failed validation (${validated.error.length} issue(s))`,
      validation: validated.error,
    })
  }
  return ok({
    document: validated.value,
    fromVersion: chain.value.fromVersion,
    toVersion: chain.value.toVersion,
    applied: chain.value.applied,
  })
}

/** True when `raw` is below the current version. Returns false for anything malformed. */
export function needsMigration(raw: unknown): boolean {
  const v = readVersion(raw)
  return v.ok && v.value < CURRENT_VERSION
}
