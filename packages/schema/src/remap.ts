import type { Asset } from './asset.js'
import type { SceneDocument } from './document.js'

/**
 * SCHEMA_SPEC §5.3 · re-uploading a model must not destroy the configuration built on
 * top of it. Technical assessment R02, the register's second-highest risk — and it only
 * ever fires on the *second* upload, i.e. after the customer has already invested a day
 * of work.
 *
 * The ladder, tried in order per node whose `assetRef.assetId` matches:
 *   1. objectPath identical                                   -> exact
 *   2. objectName unique among the new objects                -> byName
 *   3. name ambiguous, one candidate wins on longest common
 *      path suffix (counted in `/` segments)                  -> byPathScore
 *   4. top score is a tie                                     -> ambiguous
 *   5. no candidate at all                                    -> orphaned
 *
 * Tiers 4 and 5 are never resolved automatically. And nothing is ever deleted: the node
 * keeps its `objectPath`/`objectName` so the UI can say what it was looking for, and
 * carries `missing: true` for a human to re-point. Deleting a node whose material,
 * animation, hotspot and rules the user configured is not an acceptable response to a
 * re-export with renamed groups.
 *
 * On tiers 4/5 the node's `assetId` still moves to the new asset. "Keep the old ref"
 * means keep the coordinates being searched for, not keep pointing at the superseded
 * asset — otherwise a partially-remapped scene would silently render from two asset
 * versions at once. Recorded in ADR-0007.
 */

export interface RemapEntry {
  readonly nodeId: string
  readonly nodeName: string
  /** The objectPath we were looking for. */
  readonly from: string
  /** Where it landed. Absent for ambiguous / orphaned. */
  readonly to?: string
}

export interface AmbiguousRemapEntry extends RemapEntry {
  readonly candidates: string[]
  readonly score: number
}

export interface MigrationReport {
  readonly total: number
  readonly exact: RemapEntry[]
  readonly byName: RemapEntry[]
  readonly byPathScore: RemapEntry[]
  readonly ambiguous: AmbiguousRemapEntry[]
  readonly orphaned: RemapEntry[]
  readonly oldAssetId: string
  readonly newAssetId: string
}

export interface AssetObject {
  readonly path: string
  readonly name: string
}

export interface RemapResult {
  readonly doc: SceneDocument
  readonly report: MigrationReport
}

/** Matching trailing `/`-segments between two object paths. */
export function commonSuffixScore(a: string, b: string): number {
  const sa = a.split('/')
  const sb = b.split('/')
  let n = 0
  while (n < sa.length && n < sb.length && sa[sa.length - 1 - n] === sb[sb.length - 1 - n]) n++
  return n
}

export function remapAssetRefs(
  doc: SceneDocument,
  oldAssetId: string,
  newAsset: Asset,
  newObjects: readonly AssetObject[],
): RemapResult {
  const byPath = new Set(newObjects.map((o) => o.path))
  const byName = new Map<string, AssetObject[]>()
  for (const obj of newObjects) {
    const list = byName.get(obj.name)
    if (list) list.push(obj)
    else byName.set(obj.name, [obj])
  }

  const exact: RemapEntry[] = []
  const byNameHits: RemapEntry[] = []
  const byPathScore: RemapEntry[] = []
  const ambiguous: AmbiguousRemapEntry[] = []
  const orphaned: RemapEntry[] = []

  const nodes = doc.nodes.map((node) => {
    const ref = node.assetRef
    if (!ref || ref.assetId !== oldAssetId) return node

    const from = ref.objectPath
    const base = { nodeId: node.id, nodeName: node.name, from }
    const moveTo = (objectPath: string, objectName: string) => ({
      ...node,
      assetRef: { assetId: newAsset.id, objectPath, objectName, missing: false },
    })
    const keepSearching = () => ({
      ...node,
      assetRef: { assetId: newAsset.id, objectPath: from, objectName: ref.objectName, missing: true },
    })

    // 1 — the path survived the re-export untouched.
    if (byPath.has(from)) {
      exact.push({ ...base, to: from })
      return moveTo(from, ref.objectName)
    }

    const sameName = byName.get(ref.objectName) ?? []

    // 2 — it moved, but its name is still unique.
    if (sameName.length === 1) {
      const hit = sameName[0]!
      byNameHits.push({ ...base, to: hit.path })
      return moveTo(hit.path, hit.name)
    }

    // 3 / 4 — several share the name; let the surrounding hierarchy break the tie.
    if (sameName.length > 1) {
      const scored = sameName
        .map((o) => ({ obj: o, score: commonSuffixScore(from, o.path) }))
        .sort((a, b) => b.score - a.score || a.obj.path.localeCompare(b.obj.path))
      const best = scored[0]!
      const tied = scored.filter((s) => s.score === best.score).length > 1
      const candidates = scored.map((s) => s.obj.path)

      if (!tied && best.score > 0) {
        byPathScore.push({ ...base, to: best.obj.path })
        return moveTo(best.obj.path, best.obj.name)
      }
      ambiguous.push({ ...base, candidates, score: best.score })
      return keepSearching()
    }

    // 5 — gone.
    orphaned.push(base)
    return keepSearching()
  })

  const total = exact.length + byNameHits.length + byPathScore.length + ambiguous.length + orphaned.length

  return {
    doc: { ...doc, nodes },
    report: {
      total,
      exact,
      byName: byNameHits,
      byPathScore,
      ambiguous,
      orphaned,
      oldAssetId,
      newAssetId: newAsset.id,
    },
  }
}

/** The manual escape hatch every ambiguous / orphaned row in the report leads to. */
export function applyManualRemap(
  doc: SceneDocument,
  nodeId: string,
  target: { assetId: string; objectPath: string; objectName: string },
): SceneDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId
        ? { ...n, assetRef: { assetId: target.assetId, objectPath: target.objectPath, objectName: target.objectName, missing: false } }
        : n,
    ),
  }
}

/** "已迁移 N 项 / 需确认 M 项 / 失效 K 项" — the wording R02 requires the UI to show. */
export function summarizeMigrationReport(report: MigrationReport): string {
  const migrated = report.exact.length + report.byName.length + report.byPathScore.length
  return `已迁移 ${migrated} 项 / 需确认 ${report.ambiguous.length} 项 / 失效 ${report.orphaned.length} 项`
}
