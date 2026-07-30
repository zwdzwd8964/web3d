import type { Material as MaterialDef } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { Color, LinearSRGBColorSpace, MeshStandardMaterial, SRGBColorSpace, Texture } from 'three'
import type { Mesh } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { MaterialRegistry, TEXTURE_SLOT_COLOR_SPACE, applyParams, countUsers } from '../../src/runtime/material-registry.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { IDS } from '../helpers.js'
import { createPumpAsset, docWithBothOverridden } from './fixtures.js'

/**
 * T-039 · MVP_V0 D3 · technical assessment R08.
 *
 * The fixture deliberately gives Body and ValveCover ONE shared material instance,
 * because that is what glTF actually produces. A fixture where each mesh had its own
 * material would let every test here pass while the bug shipped.
 */

let graph: SceneGraph
let registry: MaterialRegistry
let pump: ReturnType<typeof createPumpAsset>

const defsOf = (materials: readonly MaterialDef[]) => new Map(materials.map((m) => [m.id, m]))
const materialOf = (nodeId: string) => (graph.objectFor(nodeId) as Mesh).material as MeshStandardMaterial

beforeEach(() => {
  pump = createPumpAsset()
  graph = new SceneGraph({ assets: pump.source })
  registry = new MaterialRegistry()
})

describe('R08 · the shared-material trap', () => {
  it('the fixture really does share one material instance', () => {
    graph.build(createGoldenPathDocument())
    expect(materialOf(IDS.body)).toBe(materialOf(IDS.cover))
    expect(countUsers(graph.root, pump.sharedMaterial)).toBe(2)
  })

  it('T-039 验收 · overriding one node leaves its sibling’s material reference AND params untouched', () => {
    const d = createGoldenPathDocument()
    graph.build(d)

    const siblingMaterialBefore = materialOf(IDS.body)
    const siblingRoughnessBefore = siblingMaterialBefore.roughness
    const siblingMetalnessBefore = siblingMaterialBefore.metalness

    // 阀盖 has a material override in the golden path: roughness 0.4, metalness 0.9.
    registry.applyAll(d, graph)

    expect(materialOf(IDS.cover).roughness).toBe(0.4)
    expect(materialOf(IDS.cover).metalness).toBe(0.9)

    expect(materialOf(IDS.body), '兄弟节点的材质引用必须未变').toBe(siblingMaterialBefore)
    expect(materialOf(IDS.body).roughness, '兄弟节点的参数必须未变').toBe(siblingRoughnessBefore)
    expect(materialOf(IDS.body).metalness).toBe(siblingMetalnessBefore)
  })

  it('clones exactly once, and records what it was cloned from', () => {
    const d = createGoldenPathDocument()
    graph.build(d)
    registry.applyAll(d, graph)

    expect(registry.isCloned(IDS.cover)).toBe(true)
    expect(registry.clonedFrom(IDS.cover)).toBe(pump.sharedMaterial)
    expect(registry.cloneCount).toBe(1)

    registry.applyAll(d, graph)
    expect(registry.cloneCount, 'applying twice must not clone twice').toBe(1)
  })

  it('D3 case 1 · a node with no override keeps the source material as-is', () => {
    const d = createGoldenPathDocument()
    graph.build(d)
    registry.applyAll(d, graph)
    expect(materialOf(IDS.body)).toBe(pump.sharedMaterial)
    expect(registry.isCloned(IDS.body)).toBe(false)
  })

  it('ADR-0011 · never writes an asset-owned material, even when it looks unshared', () => {
    const d = createGoldenPathDocument()
    // Drop 泵体 so ValveCover is the sole user — D3's literal wording would write in place.
    const onlyCover = { ...d, nodes: d.nodes.filter((n) => n.id !== IDS.body) }
    graph.build(onlyCover)
    registry.applyAll(onlyCover, graph)

    expect(materialOf(IDS.cover).roughness).toBe(0.4)
    // The asset's material backs the asset cache and may be shared with other scenes.
    expect(pump.sharedMaterial.roughness).toBe(0.8)
    expect(registry.isCloned(IDS.cover)).toBe(true)
  })

  it('applying overrides in sequence never leaks into the source — the bug D3’s wording allowed', () => {
    const d = docWithBothOverridden()
    graph.build(d)
    registry.applyAll(d, graph)
    // Applied literally, the second node would have seen a now-unshared material and
    // written the asset's own roughness to 0.4.
    expect(pump.sharedMaterial.roughness).toBe(0.8)
    expect(pump.sharedMaterial.metalness).toBe(0.2)
  })

  it('two nodes overriding the same definition each get their own clone', () => {
    const d = docWithBothOverridden()
    graph.build(d)
    registry.applyAll(d, graph)

    expect(materialOf(IDS.body)).not.toBe(materialOf(IDS.cover))
    expect(materialOf(IDS.body).roughness).toBe(0.4)
    expect(materialOf(IDS.cover).roughness).toBe(0.4)
  })
})

describe('restoring and updating', () => {
  it('removing an override restores the source material and disposes the clone', () => {
    const d = createGoldenPathDocument()
    graph.build(d)
    registry.applyAll(d, graph)
    expect(registry.isCloned(IDS.cover)).toBe(true)

    registry.applyToNode(IDS.cover, null, defsOf(d.materials), graph)

    expect(materialOf(IDS.cover)).toBe(pump.sharedMaterial)
    expect(registry.isCloned(IDS.cover)).toBe(false)
    expect(registry.cloneCount).toBe(0)
  })

  it('editing a definition updates every node using it, and nothing else', () => {
    const d = docWithBothOverridden()
    graph.build(d)
    registry.applyAll(d, graph)

    const edited: MaterialDef = { ...d.materials[0]!, params: { ...d.materials[0]!.params, roughness: 0.1 } }
    registry.updateDefinition(edited, d, graph)

    expect(materialOf(IDS.body).roughness).toBe(0.1)
    expect(materialOf(IDS.cover).roughness).toBe(0.1)
    expect(pump.sharedMaterial.roughness, '源材质必须没被写').toBe(0.8)
  })

  it('reports false for an unknown node or an unknown material id', () => {
    const d = createGoldenPathDocument()
    graph.build(d)
    expect(registry.applyToNode('nd_99999999', d.materials[0]!.id, defsOf(d.materials), graph)).toBe(false)
    expect(registry.applyToNode(IDS.cover, 'mat_99999999', defsOf(d.materials), graph)).toBe(false)
  })

  it('reports false for a node that is not a mesh', () => {
    const d = createGoldenPathDocument()
    graph.build(d)
    // 泵组 is a grouping node with no geometry.
    expect(registry.applyToNode(IDS.pump, d.materials[0]!.id, defsOf(d.materials), graph)).toBe(false)
  })

  it('dispose() drops every clone it owns', () => {
    const d = docWithBothOverridden()
    graph.build(d)
    registry.applyAll(d, graph)
    expect(registry.cloneCount).toBe(2)
    registry.dispose()
    expect(registry.cloneCount).toBe(0)
  })
})

describe('applyParams()', () => {
  const textures: { get: (id: string) => Texture | undefined } = { get: () => undefined }

  it('SCHEMA_SPEC §6.1 · an absent field means "inherit", so it is left alone', () => {
    const material = new MeshStandardMaterial({ roughness: 0.77, metalness: 0.33 })
    applyParams(material, { id: 'mat_00000001', name: 'x', base: 'standard', preset: 'custom', params: { roughness: 0.1, maps: {} } }, textures)

    expect(material.roughness).toBe(0.1)
    // Resetting this to a default would break "swap the asset, keep the look".
    expect(material.metalness).toBe(0.33)
  })

  it('writes colour, opacity, transparency, emissive and side', () => {
    const material = new MeshStandardMaterial()
    applyParams(
      material,
      {
        id: 'mat_00000001',
        name: 'x',
        base: 'standard',
        preset: 'custom',
        params: {
          color: '#3f6f97',
          opacity: 0.5,
          transparent: true,
          emissive: '#ff0000',
          emissiveIntensity: 2,
          side: 'double',
          maps: {},
        },
      },
      textures,
    )

    expect(`#${material.color.getHexString()}`).toBe('#3f6f97')
    expect(material.opacity).toBe(0.5)
    expect(material.transparent).toBe(true)
    expect(`#${material.emissive.getHexString()}`).toBe('#ff0000')
    expect(material.emissiveIntensity).toBe(2)
    expect(material.side).toBe(2) // THREE.DoubleSide
    // `needsUpdate` is a write-only setter in three: reading it back gives undefined,
    // so the observable effect is the version bump it triggers.
    expect(material.version).toBeGreaterThan(0)
  })

  it('D3 · assigns each texture slot its fixed colour space', () => {
    const map = new Texture()
    const normalMap = new Texture()
    const material = new MeshStandardMaterial()
    applyParams(
      material,
      {
        id: 'mat_00000001',
        name: 'x',
        base: 'standard',
        preset: 'custom',
        params: { maps: { map: 'ast_00000001', normalMap: 'ast_00000002' } },
      },
      { get: (id) => (id === 'ast_00000001' ? map : id === 'ast_00000002' ? normalMap : undefined) },
    )

    // Getting this backwards tints the whole scene and gets blamed on the artist.
    expect(map.colorSpace).toBe(SRGBColorSpace)
    expect(normalMap.colorSpace).toBe(LinearSRGBColorSpace)
    expect(material.map).toBe(map)
    expect(material.normalMap).toBe(normalMap)
  })

  it('the slot table covers every map the schema defines', () => {
    expect(Object.keys(TEXTURE_SLOT_COLOR_SPACE).sort()).toEqual(
      ['aoMap', 'emissiveMap', 'map', 'metalnessMap', 'normalMap', 'roughnessMap'].sort(),
    )
    expect(TEXTURE_SLOT_COLOR_SPACE.map).toBe(SRGBColorSpace)
    expect(TEXTURE_SLOT_COLOR_SPACE.emissiveMap).toBe(SRGBColorSpace)
    expect(TEXTURE_SLOT_COLOR_SPACE.aoMap).toBe(LinearSRGBColorSpace)
  })

  it('skips a texture slot whose asset is not loaded, instead of clearing it', () => {
    const material = new MeshStandardMaterial()
    const existing = new Texture()
    material.map = existing
    applyParams(
      material,
      { id: 'mat_00000001', name: 'x', base: 'standard', preset: 'custom', params: { maps: { map: 'ast_00000001' } } },
      { get: () => undefined },
    )
    expect(material.map).toBe(existing)
  })
})

describe('countUsers()', () => {
  it('counts only meshes actually referencing the instance', () => {
    graph.build(createGoldenPathDocument())
    expect(countUsers(graph.root, pump.sharedMaterial)).toBe(2)
    expect(countUsers(graph.root, new MeshStandardMaterial())).toBe(0)
  })
})

describe('acquireWritable()', () => {
  it('gives the highlight layer a per-node material through the same CoW path', () => {
    graph.build(createGoldenPathDocument())
    const writable = registry.acquireWritable(IDS.cover, graph)!
    expect(writable).not.toBe(pump.sharedMaterial)
    expect(materialOf(IDS.body), 'the sibling must be untouched').toBe(pump.sharedMaterial)
    ;(writable as MeshStandardMaterial).emissive = new Color('#ff0000')
    expect(`#${(materialOf(IDS.body) as MeshStandardMaterial).emissive.getHexString()}`).toBe('#000000')
  })

  it('returns null for a non-mesh or unknown node', () => {
    graph.build(createGoldenPathDocument())
    expect(registry.acquireWritable(IDS.pump, graph)).toBeNull()
    expect(registry.acquireWritable('nd_99999999', graph)).toBeNull()
  })
})

describe('the graph being rebuilt under the registry', () => {
  beforeEach(() => graph.build(createGoldenPathDocument()))

  it('re-applies overrides onto the NEW meshes rather than the disposed ones', () => {
    const doc = createGoldenPathDocument()
    const withOverride = {
      ...doc,
      nodes: doc.nodes.map((n) => (n.id === IDS.cover ? { ...n, overrides: { materialId: doc.materials[0]!.id } } : n)),
    }
    registry.applyAll(withOverride, graph)
    const applied = materialOf(IDS.cover).color.getHexString()

    // Anything that calls `graph.build` again: resetScene, entering preview, and the D1
    // full-rebuild fallback all do. The registry's per-node clones point at Object3Ds
    // that no longer exist after this.
    graph.build(withOverride)
    registry.applyAll(withOverride, graph)

    // Before the fix this read back the asset's own colour: `materialFor` returned the
    // stale clone, wrote the parameters into it, and never attached it to the new mesh.
    // Every material override vanished on any rebuild, with nothing logged.
    expect(materialOf(IDS.cover).color.getHexString()).toBe(applied)
  })

  it('restoring after a rebuild puts back the new mesh own material, not the old mesh one', () => {
    const doc = createGoldenPathDocument()
    const defs = defsOf(doc.materials)
    const original = materialOf(IDS.cover).color.getHexString()

    registry.applyToNode(IDS.cover, doc.materials[0]!.id, defs, graph)
    graph.build(doc)
    registry.applyToNode(IDS.cover, doc.materials[0]!.id, defs, graph)
    registry.applyToNode(IDS.cover, null, defs, graph)

    expect(materialOf(IDS.cover).color.getHexString()).toBe(original)
    expect(registry.isCloned(IDS.cover)).toBe(false)
  })
})
