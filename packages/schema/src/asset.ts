import { z } from 'zod'
import { AssetIdSchema } from './id.js'
import { ContentHashSchema, TimestampSchema } from './primitives.js'

/**
 * SCHEMA_SPEC §3 · assets are immutable and content-addressed.
 *
 * "Update the model" never edits an asset record. It appends a new one carrying the
 * same `lineageId` with `version: n+1`, then runs the remap (§5.3). Published snapshots
 * may still reference the old record, so mutating it corrupts history retroactively.
 */

export const ASSET_TYPES = ['model', 'texture', 'hdri', 'audio', 'video', 'image'] as const
export const AssetTypeSchema = z.enum(ASSET_TYPES)
export type AssetType = z.infer<typeof AssetTypeSchema>

export const AssetStatsSchema = z
  .object({
    tris: z.number().int().nonnegative(),
    materials: z.number().int().nonnegative(),
    textures: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    /** Estimated decoded VRAM, not file size. This is what exhausts a GPU. */
    textureBytes: z.number().int().nonnegative(),
    nodes: z.number().int().nonnegative(),
    /** Clip names, not a count — the animation panel needs the list. */
    animations: z.array(z.string()),
    /**
     * v3 · 每条 clip 的时长，秒（X-06）。
     *
     * ⚠ **高危**：`AssetStats` 是 `.strict()`，而 `checkIntegrity` 不重跑 schema 校验。
     * 加这一个键意味着**每一份老 fixture 的校验都会失败**，除非迁移显式补上 `{}`。
     * 这是四处非增量迁移里最容易漏的一处。
     */
    clipDurations: z.record(z.string(), z.number().nonnegative()).default({}),
  })
  .strict()
export type AssetStats = z.infer<typeof AssetStatsSchema>

export const AUDIT_LEVELS = ['pass', 'warn', 'fail'] as const
export const AuditLevelSchema = z.enum(AUDIT_LEVELS)
export type AuditLevel = z.infer<typeof AuditLevelSchema>

export const AuditFindingSchema = z
  .object({
    metric: z.string().min(1),
    value: z.number(),
    limit: z.number(),
    level: AuditLevelSchema,
    /** Chinese, and concrete: "4K 降 2K", never "请优化". */
    advice: z.string(),
  })
  .strict()
export type AuditFinding = z.infer<typeof AuditFindingSchema>

/**
 * The import health verdict (R01). Shown to the user, and the contractual shield when
 * a customer hands over a CAD export no architecture can save.
 */
export const AssetAuditSchema = z
  .object({
    checkedAt: TimestampSchema,
    /** Which threshold set produced this verdict — Appendix A can change per customer. */
    policyId: z.string().min(1),
    findings: z.array(AuditFindingSchema),
  })
  .strict()
export type AssetAudit = z.infer<typeof AssetAuditSchema>

/** What import-time normalisation did, so it stays traceable (SCHEMA_SPEC §5.2). */
export const AssetNormalizedSchema = z
  .object({
    scaleApplied: z.number().finite().default(1),
    axisRotated: z.boolean().default(false),
  })
  .strict()
export type AssetNormalized = z.infer<typeof AssetNormalizedSchema>

/** 一次转码操作的留痕。`op` 是机器读的操作名，`detail` 是给人看的中文说明。 */
export const TranscodeOpSchema = z
  .object({
    op: z.string().max(40),
    detail: z.string().max(200).default(''),
  })
  .strict()
export type TranscodeOp = z.infer<typeof TranscodeOpSchema>

/** 一次**被跳过**的转码操作，以及为什么。与 `TranscodeOpSchema` 同形，区别只在语义。 */
export const TranscodeSkipSchema = TranscodeOpSchema
export type TranscodeSkip = z.infer<typeof TranscodeSkipSchema>

export const AssetTranscodeSchema = z
  .object({
    profileId: z.string().max(60).default(''),
    /** 工具链版本串，用来回答「这份产物是哪个版本压的」。 */
    toolchain: z.string().max(120).default(''),
    ops: z.array(TranscodeOpSchema).max(32).default([]),
    skipped: z.array(TranscodeSkipSchema).max(32).default([]),
    /** 减面后三角面数 / 原始三角面数。1 = 没减面。 */
    triangleRatio: z.number().min(0).max(1).default(1),
    finishedAt: TimestampSchema,
  })
  .strict()
export type AssetTranscode = z.infer<typeof AssetTranscodeSchema>

export const AssetOriginSchema = z
  .object({
    hash: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    stats: AssetStatsSchema,
    audit: AssetAuditSchema.optional(),
    transcode: AssetTranscodeSchema.optional(),
  })
  .strict()
export type AssetOrigin = z.infer<typeof AssetOriginSchema>

export const AssetSchema = z
  .object({
    id: AssetIdSchema,
    type: AssetTypeSchema,
    /** Original file name. Display only — never a key (C9). */
    name: z.string().min(1),
    hash: ContentHashSchema,
    /**
     * SCHEMA_SPEC §3.1 · a RELATIVE path, never an absolute URL:
     * `assets/ab/12/ab12….glb`. The same document has to work over IndexedDB (v0),
     * an object store (v1) and an offline .w3p package. Writing a host or bucket name
     * into the document welds the deployment environment into the data — a direct C7
     * violation. Resolution is AssetResolver's job at runtime.
     */
    url: z.string().min(1),
    version: z.number().int().positive(),
    /** First version's id for this logical asset; on the first version `lineageId === id`. */
    lineageId: AssetIdSchema,
    stats: AssetStatsSchema,
    audit: AssetAuditSchema.optional(),
    normalized: AssetNormalizedSchema.optional(),
    thumbnailUrl: z.string().optional(),
    /**
     * v3 · 这份资产是从哪来的、被怎么处理过（X-08）。**optional**——老文档缺席就是缺席，
     * 迁移不给它补 `null` 也不补 `{}`（那会让「从没处理过」与「处理过但没记」不可分）。
     *
     * ⚠ **叶子类型是签字之后补的**（SCHEMA_V3_FREEZE §1.8）。嵌套结构本身已经逐字签了字，
     * 四个叶子全部复用仓内已有类型；真正新发明的只有 `ops[]` / `skipped[]` 的元素形状。
     */
    origin: AssetOriginSchema.optional(),
  })
  .strict()
export type Asset = z.infer<typeof AssetSchema>
