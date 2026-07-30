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
  })
  .strict()
export type Asset = z.infer<typeof AssetSchema>
