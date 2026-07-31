import { validate } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import type { Snapshot, SnapshotSummary, StorageProvider } from '@w3/storage'

/**
 * T-104 · local version snapshots.
 *
 * Every publish leaves one behind. This is the answer to "the version I demoed last week
 * worked, this one doesn't" — without it the only record of what was shipped is the .w3p
 * file on somebody's desktop, and once that is gone the state is unrecoverable.
 *
 * Storage-only, never in the document: a document that contained its own history would
 * double in size on every publish, and the snapshot of a snapshot is meaningless.
 */

export interface RollbackResult {
  readonly document: SceneDocument
  readonly snapshot: Snapshot
}

export async function listSnapshots(storage: StorageProvider, projectId: string): Promise<SnapshotSummary[]> {
  const all = await storage.listSnapshots(projectId)
  // Newest first: the one being looked for during an incident is almost always recent.
  return [...all].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

export async function saveSnapshot(storage: StorageProvider, snapshot: Snapshot): Promise<void> {
  await storage.saveSnapshot(snapshot)
}

/**
 * Reads a snapshot back and validates it before handing it to the editor.
 *
 * A snapshot written by an older build may not parse against today's schema. Rolling back
 * INTO an invalid document would replace the user's working state with something the
 * editor cannot operate on — strictly worse than refusing, because the working state is
 * gone by then.
 */
export async function rollbackTo(storage: StorageProvider, snapshotId: string): Promise<RollbackResult> {
  const snapshot = await storage.loadSnapshot(snapshotId)
  if (!snapshot) throw new Error(`找不到这个快照：${snapshotId}`)

  const parsed = validate(snapshot.document)
  if (!parsed.ok) {
    const detail = parsed.error
      .slice(0, 3)
      .map((e) => `${e.path}：${e.message}`)
      .join('；')
    throw new Error(`该快照未通过校验，已拒绝回滚（当前文档未被改动）。${detail}`)
  }

  return { document: parsed.value, snapshot }
}

/** `2026-07-31T09:12:03.000Z` -> `2026-07-31 09:12`, in the viewer's own timezone. */
export function formatPublishedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
