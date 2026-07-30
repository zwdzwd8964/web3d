import type { AssetObjectEntry } from './assets.js'
import type { SceneDocument } from './document.js'

/**
 * D5 / R02 · re-uploading a model must not silently destroy every configured
 * interaction, material override and hotspot.
 *
 * This is the risk register's second-highest item and it always surfaces the *second*
 * time a customer uploads a model — i.e. after they have already invested a day of
 * configuration. The four-tier ladder below is the whole mitigation:
 *
 *   1. objectPath identical                       -> exact
 *   2. objectName unique in the new asset          -> byName
 *   3. objectName ambiguous, but one candidate wins
 *      on longest-common-path-suffix              -> byPathScore
 *   4. nothing matched                             -> orphaned
 *
 * Tiers 3-with-a-tie and 4 are never resolved automatically: they are reported for a
 * human to re-point. And nothing is ever deleted — an unmatched reference is marked
 * `missing`, keeping the rule/material/hotspot that depends on it intact.
 */

export type RemapStrategy = 'exact' | 'byName' | 'byPathScore' | 'ambiguous' | 'orphaned'

export interface RemapEntry {
  readonly nodeId: string
  readonly nodeName: string
  readonly oldPath: string
  readonly oldName: string
  readonly newPath: string | null
  readonly strategy: RemapStrategy
  /** Matching trailing path segments, for byPathScore / ambiguous. */
  readonly score?: number
  /** Every candidate path considered, when the outcome needs a human. */
  readonly candidates?: readonly string[]
}

export interface MigrationReport {
  readonly exact: readonly RemapEntry[]
  readonly byName: readonly RemapEntry[]
  readonly byPathScore: readonly RemapEntry[]
  readonly ambiguous: readonly RemapEntry[]
  readonly orphaned: readonly RemapEntry[]
  /** Number of node references that pointed at the old asset. */
  readonly total: number
  readonly oldAssetId: string
  readonly newAssetId: string
}

export interface RemapResult {
  readonly document: SceneDocument
  readonly report: MigrationReport
}

/** Count of matching trailing segments between two slash-joined paths. */
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
  newAssetId: string,
  newObjects: readonly AssetObjectEntry[],
): RemapResult {
  const byPath = new Map<string, AssetObjectEntry>()
  const byName = new Map<string, AssetObjectEntry[]>()
  for (const obj of newObjects) {
    byPath.set(obj.path, obj)
    const list = byName.get(obj.name)
    if (list) list.push(obj)
    else byName.set(obj.name, [obj])
  }

  const buckets: Record<RemapStrategy, RemapEntry[]> = {
    exact: [],
    byName: [],
    byPathScore: [],
    ambiguous: [],
    orphaned: [],
  }

  const nodes = doc.nodes.map((node) => {
    const ref = node.assetRef
    if (!ref || ref.assetId !== oldAssetId) return node

    const { objectPath: oldPath, objectName: oldName } = ref

    // Tier 1 — the path survived the re-export untouched.
    if (byPath.has(oldPath)) {
      buckets.exact.push({ nodeId: node.id, nodeName: node.name, oldPath, oldName, newPath: oldPath, strategy: 'exact' })
      return { ...node, assetRef: { assetId: newAssetId, objectPath: oldPath, objectName: oldName } }
    }

    const sameName = byName.get(oldName) ?? []

    // Tier 2 — the object moved, but its name is still unique.
    if (sameName.length === 1) {
      const hit = sameName[0]!
      buckets.byName.push({ nodeId: node.id, nodeName: node.name, oldPath, oldName, newPath: hit.path, strategy: 'byName' })
      return { ...node, assetRef: { assetId: newAssetId, objectPath: hit.path, objectName: hit.name } }
    }

    // Tier 3 — several objects share the name; let the surrounding hierarchy decide.
    if (sameName.length > 1) {
      const scored = sameName
        .map((o) => ({ obj: o, score: commonSuffixScore(oldPath, o.path) }))
        .sort((a, b) => b.score - a.score)
      const best = scored[0]!
      const tie = scored.filter((s) => s.score === best.score).length > 1
      const candidates = scored.map((s) => s.obj.path)

      if (!tie && best.score > 0) {
        buckets.byPathScore.push({
          nodeId: node.id,
          nodeName: node.name,
          oldPath,
          oldName,
          newPath: best.obj.path,
          strategy: 'byPathScore',
          score: best.score,
          candidates,
        })
        return { ...node, assetRef: { assetId: newAssetId, objectPath: best.obj.path, objectName: best.obj.name } }
      }

      // Ambiguous: keep the old coordinates so the UI can show what we were looking for.
      buckets.ambiguous.push({
        nodeId: node.id,
        nodeName: node.name,
        oldPath,
        oldName,
        newPath: null,
        strategy: 'ambiguous',
        score: best.score,
        candidates,
      })
      return { ...node, assetRef: { assetId: newAssetId, objectPath: oldPath, objectName: oldName, missing: true } }
    }

    // Tier 4 — gone. Marked, never deleted.
    buckets.orphaned.push({ nodeId: node.id, nodeName: node.name, oldPath, oldName, newPath: null, strategy: 'orphaned' })
    return { ...node, assetRef: { assetId: newAssetId, objectPath: oldPath, objectName: oldName, missing: true } }
  })

  const total =
    buckets.exact.length +
    buckets.byName.length +
    buckets.byPathScore.length +
    buckets.ambiguous.length +
    buckets.orphaned.length

  return {
    document: { ...doc, nodes },
    report: { ...buckets, total, oldAssetId, newAssetId },
  }
}

/**
 * The manual escape hatch the report's "needs confirmation" rows lead to.
 * The UI must offer this for every ambiguous and orphaned entry (D5).
 */
export function applyManualRemap(
  doc: SceneDocument,
  nodeId: string,
  target: { assetId: string; objectPath: string; objectName: string },
): SceneDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId
        ? { ...n, assetRef: { assetId: target.assetId, objectPath: target.objectPath, objectName: target.objectName } }
        : n,
    ),
  }
}

/** "12 项已迁移 / 3 项需人工确认 / 1 项失效" — the sentence MVP_V0 D5 asks the UI to show. */
export function summarizeMigrationReport(report: MigrationReport): string {
  const migrated = report.exact.length + report.byName.length + report.byPathScore.length
  return `${migrated} 项已迁移 / ${report.ambiguous.length} 项需人工确认 / ${report.orphaned.length} 项失效`
}
