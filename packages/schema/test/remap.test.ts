import { describe, expect, it } from 'vitest'
import type { Asset } from '../src/asset.js'
import type { SceneDocument } from '../src/document.js'
import { checkIntegrity, warningsOf } from '../src/integrity.js'
import type { Node } from '../src/node.js'
import { applyManualRemap, commonSuffixScore, remapAssetRefs, summarizeMigrationReport } from '../src/remap.js'
import { PUMP_OBJECTS_V2, createGoldenPathDocument } from '../src/samples.js'
import { getNode } from '../src/selectors.js'

/** T-017 · SCHEMA_SPEC §5.3, technical assessment R02. */

const NEW_ASSET_ID = 'ast_2222bbbb'

/** The golden path references only two objects; add nodes for the rest of pump.glb. */
function extendedDocument(): SceneDocument {
  const doc = createGoldenPathDocument()
  const assetId = doc.assets[0]!.id
  const pump = doc.nodes[0]!
  const blank = { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] } as Node['transform']
  const extra: Node[] = [
    {
      id: 'nd_11111111',
      name: '固定螺栓',
      parent: pump.id,
      order: 3000,
      assetRef: { assetId, objectPath: 'Root/Pump/Valve/Bolt', objectName: 'Bolt', missing: false },
      transform: blank,
      visible: true,
      locked: false,
      overrides: {},
    },
    {
      id: 'nd_22222222',
      name: '密封垫',
      parent: pump.id,
      order: 4000,
      assetRef: { assetId, objectPath: 'Root/Pump/Valve/Gasket', objectName: 'Gasket', missing: false },
      transform: blank,
      visible: true,
      locked: false,
      overrides: {},
    },
    {
      id: 'nd_33333333',
      name: '泵总成',
      parent: pump.id,
      order: 5000,
      assetRef: { assetId, objectPath: 'Root/Pump', objectName: 'Pump', missing: false },
      transform: blank,
      visible: true,
      locked: false,
      overrides: {},
    },
  ]
  return structuredClone({ ...doc, nodes: [...doc.nodes, ...extra] })
}

function newAssetRecord(from: Asset): Asset {
  return { ...from, id: NEW_ASSET_ID, version: 2, lineageId: from.id, hash: `sha256:${'cd34'.repeat(16)}` }
}

function run(objects = PUMP_OBJECTS_V2) {
  const original = extendedDocument()
  const oldAsset = original.assets[0]!
  const newAsset = newAssetRecord(oldAsset)
  const { doc: remapped, report } = remapAssetRefs(original, oldAsset.id, newAsset, objects)
  return { original, remapped, report, oldAsset, newAsset }
}

const idOf = (doc: SceneDocument, name: string) => doc.nodes.find((n) => n.name === name)!.id

describe('commonSuffixScore()', () => {
  it('counts matching trailing segments', () => {
    expect(commonSuffixScore('Root/Pump/Valve/Bolt', 'Root/Pump/Assembly/Valve/Bolt')).toBe(2)
    expect(commonSuffixScore('Root/Pump/Valve/Bolt', 'Root/Pump/Assembly/Flange/Bolt')).toBe(1)
    expect(commonSuffixScore('A/B', 'C/D')).toBe(0)
    expect(commonSuffixScore('A/B', 'A/B')).toBe(2)
    expect(commonSuffixScore('Bolt', 'X/Y/Bolt')).toBe(1)
  })
})

describe('remapAssetRefs() — the five outcomes', () => {
  it('1 · exact: an untouched path keeps its coordinates', () => {
    const { remapped, report } = run()
    expect(report.exact.map((e) => e.nodeName).sort()).toEqual(['泵体', '泵总成'])
    expect(getNode(remapped, idOf(remapped, '泵体'))!.assetRef).toEqual({
      assetId: NEW_ASSET_ID,
      objectPath: 'Root/Pump/Body',
      objectName: 'Body',
      missing: false,
    })
  })

  it('2 · byName: a moved object with a still-unique name is followed', () => {
    const { remapped, report } = run()
    expect(report.byName.map((e) => e.nodeName)).toEqual(['阀盖'])
    expect(report.byName[0]).toMatchObject({ from: 'Root/Pump/ValveCover', to: 'Root/Pump/Assembly/ValveCover' })
    expect(getNode(remapped, idOf(remapped, '阀盖'))!.assetRef?.missing).toBe(false)
  })

  it('3 · byPathScore: the candidate sharing more trailing segments wins', () => {
    const { remapped, report } = run()
    expect(report.byPathScore.map((e) => e.nodeName)).toEqual(['固定螺栓'])
    expect(report.byPathScore[0]!.to).toBe('Root/Pump/Assembly/Valve/Bolt')
    expect(getNode(remapped, idOf(remapped, '固定螺栓'))!.assetRef?.objectPath).toBe('Root/Pump/Assembly/Valve/Bolt')
  })

  it('4 · ambiguous: a tie is reported with its candidates, never guessed', () => {
    const { remapped, report } = run([
      { path: 'X/Left/Bolt', name: 'Bolt' },
      { path: 'X/Right/Bolt', name: 'Bolt' },
    ])
    const bolt = report.ambiguous.find((e) => e.nodeName === '固定螺栓')
    expect(bolt).toBeDefined()
    expect(bolt!.candidates).toEqual(['X/Left/Bolt', 'X/Right/Bolt'])
    expect(bolt!.to).toBeUndefined()
    expect(getNode(remapped, bolt!.nodeId)!.assetRef?.missing).toBe(true)
  })

  it('5 · orphaned: a deleted object is marked, and the node is NOT removed', () => {
    const { original, remapped, report } = run()
    expect(report.orphaned.map((e) => e.nodeName)).toEqual(['密封垫'])

    const gasket = getNode(remapped, idOf(remapped, '密封垫'))
    expect(gasket).toBeDefined()
    expect(gasket!.assetRef?.missing).toBe(true)
    // The coordinates we were searching for survive, so the UI can say what it wanted.
    expect(gasket!.assetRef?.objectPath).toBe('Root/Pump/Valve/Gasket')
    expect(remapped.nodes).toHaveLength(original.nodes.length)
  })

  it('counts every node that pointed at the old asset', () => {
    const { report, oldAsset } = run()
    expect(report.total).toBe(5)
    expect(report.oldAssetId).toBe(oldAsset.id)
    expect(report.newAssetId).toBe(NEW_ASSET_ID)
  })
})

describe('remapAssetRefs() — surrounding guarantees', () => {
  it('leaves everything except node.assetRef untouched', () => {
    const { original, remapped } = run()
    expect(remapped.rules).toEqual(original.rules)
    expect(remapped.materials).toEqual(original.materials)
    expect(remapped.hotspots).toEqual(original.hotspots)
    expect(remapped.animations).toEqual(original.animations)
    expect(remapped.nodes.map((n) => n.id)).toEqual(original.nodes.map((n) => n.id))
    expect(remapped.nodes.map((n) => n.order)).toEqual(original.nodes.map((n) => n.order))
  })

  it('does not mutate the input document', () => {
    const doc = extendedDocument()
    const before = JSON.stringify(doc)
    remapAssetRefs(doc, doc.assets[0]!.id, newAssetRecord(doc.assets[0]!), PUMP_OBJECTS_V2)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('ignores nodes that reference a different asset', () => {
    const doc = extendedDocument()
    const { report, doc: out } = remapAssetRefs(doc, 'ast_99999999', newAssetRecord(doc.assets[0]!), PUMP_OBJECTS_V2)
    expect(report.total).toBe(0)
    expect(out.nodes).toEqual(doc.nodes)
  })

  it('orphans everything against an empty new asset, still without deleting a node', () => {
    const { original, remapped, report } = run([])
    expect(report.orphaned).toHaveLength(5)
    expect(remapped.nodes).toHaveLength(original.nodes.length)
    expect(remapped.nodes.every((n) => n.assetRef === null || n.assetRef.missing)).toBe(true)
  })

  it('summarises the way R02 requires the UI to phrase it', () => {
    const { report } = run()
    expect(summarizeMigrationReport(report)).toBe('已迁移 4 项 / 需确认 0 项 / 失效 1 项')
  })
})

describe('manual re-pointing', () => {
  it('clears the missing flag for a hand-repointed node', () => {
    const { remapped } = run()
    const gasketId = idOf(remapped, '密封垫')
    const fixed = applyManualRemap(remapped, gasketId, {
      assetId: NEW_ASSET_ID,
      objectPath: 'Root/Pump/Assembly/Valve/ValveCover',
      objectName: 'ValveCover',
    })
    const gasket = getNode(fixed, gasketId)!
    expect(gasket.assetRef?.missing).toBe(false)
    expect(gasket.assetRef?.objectPath).toBe('Root/Pump/Assembly/Valve/ValveCover')
  })

  it('touches only the named node', () => {
    const { remapped } = run()
    const fixed = applyManualRemap(remapped, idOf(remapped, '密封垫'), {
      assetId: NEW_ASSET_ID,
      objectPath: 'X',
      objectName: 'X',
    })
    expect(fixed.nodes.filter((n) => n.name !== '密封垫')).toEqual(remapped.nodes.filter((n) => n.name !== '密封垫'))
  })
})

describe('the remapped document stays publishable-with-warnings', () => {
  it('produces warnings for the orphan but no blocking errors', () => {
    const { original, remapped, newAsset } = run()
    const withBothAssets: SceneDocument = { ...remapped, assets: [...original.assets, newAsset] }
    const issues = checkIntegrity(withBothAssets)
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0)
    expect(warningsOf(issues).some((w) => w.code === 'I7')).toBe(true)
  })
})
