import type { Media, SceneDocument } from '@w3/schema'
import { buildIndex } from '@w3/schema'
import { createActionRefResolver } from '@w3/core'

/**
 * T-161 · what the media panel does to the document.
 *
 * Outside the JSX, for the reason M10 and M11 both made expensive: the editor's tests have
 * no DOM, so a rule living inside an event handler cannot be executed by any test.
 */

export interface MediaRowOptions {
  /** Injected in tests. Production uses the real action registry. */
  readonly actionRefs?: Parameters<typeof buildIndex>[1] extends { actionRefs?: infer R } ? R : never
}

/** A media record with what the panel shows next to it. */
export interface MediaRow {
  readonly media: Media
  /** File size in bytes, from the asset it points at. Zero when the asset is missing. */
  readonly bytes: number
  /** How many hotspots and rules point at this media record. */
  readonly refCount: number
  /** Human-readable list of what refers to it, for the delete confirmation. */
  readonly refSummary: string
}

/** `1:05` / `12.5 秒`. Seconds under a minute keep their decimal — 「0:12」 loses it. */
export function formatDuration(durationS: number | undefined): string {
  if (durationS === undefined) return '时长未知'
  if (durationS < 60) return `${durationS.toFixed(1)} 秒`
  const minutes = Math.floor(durationS / 60)
  const seconds = Math.round(durationS % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * Everything the panel needs about every media record, including who refers to it.
 *
 * References come from the document index rather than from a hand-rolled scan: the index is
 * what integrity checking uses, so the panel and the health report can never disagree about
 * whether something is referenced — and the index already knows about rule ACTION parameters,
 * which a scan of `hotspot.content` alone would miss entirely.
 */
export function mediaRows(doc: SceneDocument, options: MediaRowOptions = {}): readonly MediaRow[] {
  // WITH the action-ref resolver. Without it `buildIndex` cannot see inside rule action
  // parameters — and `playMedia` keeps its media id in exactly that place. The panel would
  // then say 「被 1 个热点引用」 for a clip a rule also plays, and deleting it would break
  // the rule silently. `actionRefsResolved: false` is the index saying so out loud.
  const index = buildIndex(doc, { actionRefs: options.actionRefs ?? createActionRefResolver() })
  const assetById = new Map(doc.assets.map((a) => [a.id, a]))

  return doc.media.map((media) => {
    const refs = index.refsTo.get(media.id) ?? []
    const hotspots = refs.filter((r) => r.from.kind === 'hotspot').length
    const rules = refs.filter((r) => r.from.kind === 'rule').length
    const parts: string[] = []
    if (hotspots > 0) parts.push(`${hotspots} 个热点`)
    if (rules > 0) parts.push(`${rules} 条规则`)

    return {
      media,
      bytes: assetById.get(media.assetId)?.stats.bytes ?? 0,
      refCount: refs.length,
      refSummary: parts.join('、'),
    }
  })
}

/** Renames a media record. The asset's file name never changes — that is the bytes' identity. */
export function renameMedia(draft: SceneDocument, mediaId: string, name: string): void {
  const media = draft.media.find((m) => m.id === mediaId)
  // An empty name would render as a blank row the user cannot click accurately.
  if (media && name.trim().length > 0) media.name = name.trim()
}

/**
 * Removes a media record.
 *
 * The ASSET stays. Bytes are shared and content-addressed: another media entry may point at
 * the same file, and even when none does, deleting the blob is a storage decision (garbage
 * collection at publish time) rather than something a list row should do silently.
 *
 * References are NOT cleaned up here — that is the caller's confirmation to obtain, and the
 * integrity check is what surfaces any that survive. Removing a referenced media record
 * quietly would leave a hotspot showing nothing with no explanation.
 */
export function removeMedia(draft: SceneDocument, mediaId: string): void {
  draft.media = draft.media.filter((m) => m.id !== mediaId)
}

/** The confirmation sentence, or null when nothing points at it and no question is needed. */
export function deleteWarning(doc: SceneDocument, mediaId: string, options: MediaRowOptions = {}): string | null {
  const row = mediaRows(doc, options).find((r) => r.media.id === mediaId)
  if (!row || row.refCount === 0) return null
  return `「${row.media.name}」被 ${row.refSummary}引用，删除后这些引用会失效。确认删除？`
}
