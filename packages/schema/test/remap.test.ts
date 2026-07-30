import { describe, expect, it } from 'vitest'
import { checkIntegrity } from '../src/integrity.js'
import { applyManualRemap, commonSuffixScore, remapAssetRefs, summarizeMigrationReport } from '../src/remap.js'
import { SAMPLE_PUMP_OBJECTS_V2, createGoldenPathDocument } from '../src/samples.js'
import { findNode } from '../src/tree.js'

const NEW_ASSET = 'ast_000002'

function run() {
  const doc = createGoldenPathDocument()
  const oldAssetId = doc.assets[0]!.id
  return { doc, oldAssetId, ...remapAssetRefs(doc, oldAssetId, NEW_ASSET, SAMPLE_PUMP_OBJECTS_V2) }
}

const nodeIdByName = (doc: ReturnType<typeof createGoldenPathDocument>, name: string) =>
  doc.nodes.find((n) => n.name === name)!.id

describe('commonSuffixScore()', () => {
  it('counts matching trailing segments', () => {
    expect(commonSuffixScore('Root/Pump/Valve/Bolt', 'Root/Pump/Assembly/Valve/Bolt')).toBe(2)
    expect(commonSuffixScore('Root/Pump/Valve/Bolt', 'Root/Pump/Assembly/Flange/Bolt')).toBe(1)
    expect(commonSuffixScore('A/B', 'C/D')).toBe(0)
    expect(commonSuffixScore('A/B', 'A/B')).toBe(2)
  })
})

describe('remapAssetRefs() — D5 / R02', () => {
  it('walks all four tiers on a realistically restructured re-export', () => {
    const { doc, report, document } = run()

    expect(report.total).toBe(5)
    expect(report.exact.map((e) => e.nodeName).sort()).toEqual(['泵体', '泵组'])
    expect(report.byName.map((e) => e.nodeName)).toEqual(['阀盖'])
    expect(report.byPathScore.map((e) => e.nodeName)).toEqual(['固定螺栓'])
    expect(report.orphaned.map((e) => e.nodeName)).toEqual(['密封垫'])
    expect(report.ambiguous).toHaveLength(0)

    // exact: path preserved
    expect(findNode(document, nodeIdByName(doc, '泵体'))!.assetRef).toEqual({
      assetId: NEW_ASSET,
      objectPath: 'Root/Pump/Body',
      objectName: 'Body',
    })

    // byName: moved, followed by name
    expect(findNode(document, nodeIdByName(doc, '阀盖'))!.assetRef?.objectPath).toBe('Root/Pump/Assembly/Valve/Cover')

    // byPathScore: the candidate sharing more trailing segments wins
    expect(findNode(document, nodeIdByName(doc, '固定螺栓'))!.assetRef?.objectPath).toBe('Root/Pump/Assembly/Valve/Bolt')
    expect(report.byPathScore[0]!.score).toBe(2)
    expect(report.byPathScore[0]!.candidates).toHaveLength(2)
  })

  it('never deletes a node whose object disappeared — it marks it', () => {
    const { doc, document } = run()
    const gasket = findNode(document, nodeIdByName(doc, '密封垫'))
    expect(gasket).toBeDefined()
    expect(gasket!.assetRef?.missing).toBe(true)
    // The old coordinates are kept so the UI can say what it was looking for.
    expect(gasket!.assetRef?.objectPath).toBe('Root/Pump/Valve/Gasket')
    expect(document.nodes).toHaveLength(doc.nodes.length)
  })

  it('leaves everything else in the document untouched', () => {
    const { doc, document } = run()
    expect(document.rules).toEqual(doc.rules)
    expect(document.materials).toEqual(doc.materials)
    expect(document.hotspots).toEqual(doc.hotspots)
    expect(document.animations).toEqual(doc.animations)
  })

  it('does not mutate the input document', () => {
    const doc = createGoldenPathDocument()
    const before = JSON.stringify(doc)
    remapAssetRefs(doc, doc.assets[0]!.id, NEW_ASSET, SAMPLE_PUMP_OBJECTS_V2)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('ignores nodes that reference a different asset', () => {
    const doc = createGoldenPathDocument()
    const { report } = remapAssetRefs(doc, 'ast_999999', NEW_ASSET, SAMPLE_PUMP_OBJECTS_V2)
    expect(report.total).toBe(0)
  })

  it('reports ambiguity instead of guessing when candidates tie', () => {
    const doc = createGoldenPathDocument()
    const tie = [
      { path: 'X/Left/Bolt', name: 'Bolt', hasMesh: true },
      { path: 'X/Right/Bolt', name: 'Bolt', hasMesh: true },
    ]
    const { report, document } = remapAssetRefs(doc, doc.assets[0]!.id, NEW_ASSET, tie)
    const bolt = report.ambiguous.find((e) => e.nodeName === '固定螺栓')
    expect(bolt).toBeDefined()
    expect(bolt!.candidates).toEqual(['X/Left/Bolt', 'X/Right/Bolt'])
    expect(findNode(document, bolt!.nodeId)!.assetRef?.missing).toBe(true)
  })

  it('summarises the way the UI is required to phrase it', () => {
    const { report } = run()
    expect(summarizeMigrationReport(report)).toBe('4 项已迁移 / 0 项需人工确认 / 1 项失效')
  })

  it('applyManualRemap clears the missing flag for a hand-repointed node', () => {
    const { doc, document } = run()
    const gasketId = nodeIdByName(doc, '密封垫')
    const fixed = applyManualRemap(document, gasketId, {
      assetId: NEW_ASSET,
      objectPath: 'Root/Pump/Assembly/Valve/Cover',
      objectName: 'Cover',
    })
    const gasket = findNode(fixed, gasketId)!
    expect(gasket.assetRef?.missing).toBeUndefined()
    expect(gasket.assetRef?.objectPath).toBe('Root/Pump/Assembly/Valve/Cover')
  })

  it('the remapped document still passes integrity once the new asset exists', () => {
    const { doc, document } = run()
    const withNewAsset = {
      ...document,
      assets: [...doc.assets, { ...doc.assets[0]!, id: NEW_ASSET, version: 2, supersedes: doc.assets[0]!.id }],
    }
    const report = checkIntegrity(withNewAsset)
    expect(report.errors).toHaveLength(0)
    // The orphan surfaces as a warning that asks for a human, not as a blocker.
    expect(report.warnings.some((w) => w.code === 'orphaned-asset-ref')).toBe(true)
  })
})
