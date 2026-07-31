import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { migrate } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createPackageResolver, packScene, referencedHashes, unpackScene } from '../src/package.js'
import type { BlobHash } from '../src/provider.js'

const FIXTURE = fileURLToPath(
  new URL('../../schema/test/fixtures/v2/golden-path-2.json', import.meta.url),
)

function v2Doc(): SceneDocument {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown
  const parsed = migrate(raw)
  if (!parsed.ok) throw new Error(`fixture did not migrate: ${JSON.stringify(parsed.error)}`)
  return parsed.value.document
}

const bytesFor = (name: string) => new TextEncoder().encode(`payload of ${name}`)

describe('REPRO · publish drops v2 asset kinds', () => {
  it('shows the full pipeline', async () => {
    const doc = v2Doc()

    // --- storage holds EVERY asset's bytes (the user really did import all 5) ---
    const storage = new Map<BlobHash, Uint8Array>()
    for (const a of doc.assets) storage.set(a.hash, bytesFor(a.name))

    // --- publish.ts:68 + 70-75 (precheck) ---
    const referenced = referencedHashes(doc)
    const missingBlobs: string[] = []
    for (const hash of referenced) if (!storage.has(hash)) missingBlobs.push(hash)

    console.log('\n=== precheck ===')
    console.log('doc.assets           =', doc.assets.length)
    console.log('referenced.size      =', referenced.size)
    console.log('missingBlobs         =', missingBlobs.length, '(0 => publish is NOT blocked)')

    // --- publish.ts:109-114 (collect blobs) ---
    const blobs = new Map<BlobHash, Uint8Array>()
    for (const hash of referenced) {
      const b = storage.get(hash)
      if (b) blobs.set(hash, b)
    }

    // --- publish.ts:119 (pack) ---
    const packed = packScene({
      document: doc,
      snapshotId: 'snp_a1b2c3d4',
      publishedAt: '2026-08-01T04:00:00.000Z',
      coreVersion: '0.5.0',
      blobs,
    })

    const entries = Object.keys(unzipSync(packed))
    console.log('\n=== package contents ===')
    for (const e of entries.sort()) console.log('  ', e)

    const pkg = unpackScene(packed)
    console.log('manifest.assetCount  =', pkg.manifest.assetCount)

    // --- player side: createPackageResolver ---
    const resolver = createPackageResolver(pkg)
    console.log('\n=== player resolve() per asset ===')
    const failed: string[] = []
    for (const a of pkg.document.assets) {
      try {
        await resolver.resolve(a.url)
        console.log(`   OK    ${a.type.padEnd(8)} ${a.name}`)
      } catch (e) {
        failed.push(`${a.type}:${a.name}`)
        console.log(`   FAIL  ${a.type.padEnd(8)} ${a.name} — ${(e as Error).message}`)
      }
    }
    console.log('\nfailed =', JSON.stringify(failed))
    console.log('env hdri  =', pkg.document.meta.environment.hdriAssetId)
    console.log('mat maps  =', JSON.stringify(pkg.document.materials.map((m) => m.params.maps)))

    expect(missingBlobs).toEqual([])
    expect(failed).toEqual([])
  })
})
