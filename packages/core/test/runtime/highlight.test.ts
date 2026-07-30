import { createGoldenPathDocument } from '@w3/schema'
import type { MeshStandardMaterial } from 'three'
import type { Mesh } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { HIGHLIGHT_PRESETS, HighlightLayer } from '../../src/runtime/highlight.js'
import { MaterialRegistry } from '../../src/runtime/material-registry.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { IDS } from '../helpers.js'
import { createPumpAsset } from './fixtures.js'

/** T-040 · 验收：高亮 → 取消后，材质参数与高亮前逐字段相等。 */

let graph: SceneGraph
let registry: MaterialRegistry
let highlights: HighlightLayer
let pump: ReturnType<typeof createPumpAsset>

const materialOf = (nodeId: string) => (graph.objectFor(nodeId) as Mesh).material as MeshStandardMaterial
const snapshot = (m: MeshStandardMaterial) => ({
  color: m.color.getHexString(),
  emissive: m.emissive.getHexString(),
  emissiveIntensity: m.emissiveIntensity,
  roughness: m.roughness,
  metalness: m.metalness,
  opacity: m.opacity,
  transparent: m.transparent,
})

beforeEach(() => {
  pump = createPumpAsset()
  graph = new SceneGraph({ assets: pump.source })
  registry = new MaterialRegistry()
  graph.build(createGoldenPathDocument())
  highlights = new HighlightLayer(graph, registry)
})

describe('HighlightLayer', () => {
  it('applies a preset as an emissive overlay, with no EffectComposer in sight', () => {
    expect(highlights.set(IDS.cover, 'outline_amber')).toBe(true)
    const material = materialOf(IDS.cover)
    expect(`#${material.emissive.getHexString()}`).toBe(HIGHLIGHT_PRESETS.outline_amber!.emissive)
    expect(material.emissiveIntensity).toBe(HIGHLIGHT_PRESETS.outline_amber!.emissiveIntensity)
    expect(highlights.isHighlighted(IDS.cover)).toBe(true)
  })

  it('T-040 验收 · clearing restores every field exactly', () => {
    const before = snapshot(materialOf(IDS.cover))

    highlights.set(IDS.cover, 'outline_amber')
    expect(snapshot(materialOf(IDS.cover))).not.toEqual(before)

    highlights.set(IDS.cover, null)
    expect(snapshot(materialOf(IDS.cover))).toEqual(before)
    expect(highlights.isHighlighted(IDS.cover)).toBe(false)
  })

  it('re-highlighting with a different preset still restores to the PRE-highlight state', () => {
    const before = snapshot(materialOf(IDS.cover))
    highlights.set(IDS.cover, 'outline_amber')
    highlights.set(IDS.cover, 'outline_red')
    highlights.set(IDS.cover, null)
    // Snapshotting on every set would restore to amber instead of to the original.
    expect(snapshot(materialOf(IDS.cover))).toEqual(before)
  })

  it('R08 · highlighting one node does not light up a sibling sharing the material', () => {
    const siblingBefore = snapshot(materialOf(IDS.body))
    highlights.set(IDS.cover, 'outline_amber')
    expect(snapshot(materialOf(IDS.body))).toEqual(siblingBefore)
    expect(pump.sharedMaterial.emissive.getHexString()).toBe('000000')
  })

  it('includeDescendants covers the subtree', () => {
    highlights.set(IDS.pump, 'outline_cyan', { includeDescendants: true })
    expect(highlights.isHighlighted(IDS.body)).toBe(true)
    expect(highlights.isHighlighted(IDS.cover)).toBe(true)

    highlights.set(IDS.pump, null, { includeDescendants: true })
    expect(highlights.activeNodeIds).toEqual([])
  })

  it('refuses an unknown preset instead of rendering nothing silently', () => {
    expect(highlights.set(IDS.cover, 'outline_chartreuse')).toBe(false)
    expect(highlights.isHighlighted(IDS.cover)).toBe(false)
  })

  it('reports false for a node with no material', () => {
    // 泵组 is a grouping node.
    expect(highlights.set(IDS.pump, 'outline_amber')).toBe(false)
  })

  it('clearing something that was never highlighted is a no-op, not an error', () => {
    expect(highlights.set(IDS.cover, null)).toBe(false)
  })

  it('clearAll restores every highlighted node', () => {
    const bodyBefore = snapshot(materialOf(IDS.body))
    const coverBefore = snapshot(materialOf(IDS.cover))

    highlights.set(IDS.body, 'outline_red')
    highlights.set(IDS.cover, 'outline_green')
    highlights.clearAll()

    expect(snapshot(materialOf(IDS.body))).toEqual(bodyBefore)
    expect(snapshot(materialOf(IDS.cover))).toEqual(coverBefore)
    expect(highlights.activeNodeIds).toEqual([])
  })

  it('preset names are semantic, so v1 can swap the implementation without touching documents', () => {
    // The golden path rule uses `outline_amber`; that string is the contract, not the
    // emissive technique behind it (MVP_V0 §1.3's C5 demonstration).
    expect(highlights.presetNames()).toContain('outline_amber')
    expect(createGoldenPathDocument().rules[0]!.then[1]!.params.preset).toBe('outline_amber')
  })
})
