import { z } from 'zod'
import { AssetIdSchema, MediaIdSchema } from './id.js'

/**
 * SCHEMA_SPEC §6.7 · v0.5 进化规划 §4.1.6 · media records.
 *
 * Moved out of `deferred.ts` in v2 and given a runtime. The shape it had in v1 — id, type,
 * assetId — survives unchanged; v2 only adds two fields. That is the whole return on
 * having defined it in v0 with no implementation behind it: connecting media cost one
 * additive migration instead of a restructuring one.
 *
 * A media record is a thin layer over an asset: the asset owns the bytes, the hash and the
 * import audit, while the record owns what the SCENE calls it and how long it plays. The
 * separation matters when the same file is used twice — two records, one blob.
 *
 * `durationS` is a document field rather than something read from the file at play time
 * on purpose (D19). `playMedia` with `await: true` has to suspend for the right length in
 * a head-less test with a fake clock, where there is no audio element and no `ended`
 * event. Reading it at import and writing it down is what keeps C8 true for media actions.
 */

export const MEDIA_TYPES = ['image', 'video', 'audio'] as const
export const MediaTypeSchema = z.enum(MEDIA_TYPES)
export type MediaType = z.infer<typeof MediaTypeSchema>

export const MediaSchema = z
  .object({
    id: MediaIdSchema,
    type: MediaTypeSchema,
    assetId: AssetIdSchema,
    /** Display name in the media panel. Defaults to the original filename at import. */
    name: z.string().min(1),
    /**
     * Seconds. Read from the element's metadata at import for audio and video; absent for
     * images, and absent when the browser refused to report it — in which case `playMedia`
     * resolves immediately and warns rather than hanging a sequence forever.
     */
    durationS: z.number().positive().optional(),
  })
  .strict()
export type Media = z.infer<typeof MediaSchema>

/** Which asset type each media type must point at. Enforced by integrity check I14. */
export const MEDIA_ASSET_TYPES: Record<MediaType, string> = {
  image: 'texture',
  video: 'hdri',
  audio: 'model',
}
