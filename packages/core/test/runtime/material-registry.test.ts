import type { Asset, Material as MaterialDef } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import {
  ClampToEdgeWrapping,
  Color,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three'
import type { Mesh } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { TextureCache } from '../../src/runtime/texture-cache.js'
import {
  MaterialRegistry,
  TEXTURE_SLOT_COLOR_SPACE,
  applyParams,
  canRebuildBase,
  countUsers,
  rebuildForBase,
} from '../../src/runtime/material-registry.js'
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
      { get: (id: string) => (id === 'ast_00000001' ? map : id === 'ast_00000002' ? normalMap : undefined) },
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

describe('texture slots and the uv block (T-151)', () => {
  /** A material def with the given maps and uv, spelled out so each test reads on its own. */
  const def = (params: Partial<MaterialDef['params']>): MaterialDef =>
    ({
      id: 'mat_00000001',
      name: '贴图材质',
      base: 'standard',
      preset: 'custom',
      params: { maps: {}, ...params },
    }) as MaterialDef

  const source = (textures: Record<string, Texture>) => ({ get: (id: string) => textures[id] })

  it('CLEARS a slot the material no longer sets', () => {
    // Skipping the undefined case leaves the previous texture on the material, so removing
    // a normal map in the panel does nothing visible — and the user removes it again.
    const normalMap = new Texture()
    const material = new MeshStandardMaterial()
    const textures = source({ ast_00000002: normalMap })

    applyParams(material, def({ maps: { normalMap: 'ast_00000002' } }), textures)
    expect(material.normalMap).toBe(normalMap)

    applyParams(material, def({ maps: {} }), textures)
    expect(material.normalMap, '取消贴图必须真的取消').toBeNull()
  })

  it('leaves a slot alone while its texture is still decoding', () => {
    // Not the same as "unset": blanking the material mid-load makes an image arriving a
    // moment later look like a flicker, and a genuinely missing asset look identical to a
    // slow one.
    const map = new Texture()
    const material = new MeshStandardMaterial()
    applyParams(material, def({ maps: { map: 'ast_00000001' } }), source({ ast_00000001: map }))

    applyParams(material, def({ maps: { map: 'ast_00000001' } }), source({}))
    expect(material.map).toBe(map)
  })

  it('applies repeat / offset / rotation to every slot the material has', () => {
    const map = new Texture()
    const normalMap = new Texture()
    const material = new MeshStandardMaterial()

    applyParams(
      material,
      def({
        maps: { map: 'ast_00000001', normalMap: 'ast_00000002' },
        uv: { repeat: [4, 2], offset: [0.25, 0.5], rotationDeg: 90 },
      }),
      source({ ast_00000001: map, ast_00000002: normalMap }),
    )

    for (const texture of [map, normalMap]) {
      expect([texture.repeat.x, texture.repeat.y]).toEqual([4, 2])
      expect([texture.offset.x, texture.offset.y]).toEqual([0.25, 0.5])
      expect(texture.rotation).toBeCloseTo(Math.PI / 2, 6)
      // Rotating around the uv origin spins the texture off the surface; every authoring
      // tool means "around the middle" by this control.
      expect([texture.center.x, texture.center.y]).toEqual([0.5, 0.5])
    }
  })

  it('wraps when tiling above 1×, clamps otherwise', () => {
    // Without RepeatWrapping the surface shows one copy of the image and stretched edge
    // pixels for the rest of it, which reads as a broken texture rather than as a setting.
    const map = new Texture()
    const material = new MeshStandardMaterial()
    const textures = source({ ast_00000001: map })

    applyParams(material, def({ maps: { map: 'ast_00000001' }, uv: { repeat: [3, 3], offset: [0, 0], rotationDeg: 0 } }), textures)
    expect(map.wrapS).toBe(RepeatWrapping)
    expect(map.wrapT).toBe(RepeatWrapping)

    applyParams(material, def({ maps: { map: 'ast_00000001' }, uv: { repeat: [1, 1], offset: [0, 0], rotationDeg: 0 } }), textures)
    expect(map.wrapS).toBe(ClampToEdgeWrapping)
  })

  it('resets the transform when the material has no uv block', () => {
    // Textures are shared between materials by the cache, so "no uv block" has to mean the
    // schema's identity rather than "leave whatever the last material set" — otherwise a
    // texture arrives pre-tiled from somewhere the user never looked.
    const map = new Texture()
    map.repeat.set(8, 8)
    map.rotation = 1
    const material = new MeshStandardMaterial()

    applyParams(material, def({ maps: { map: 'ast_00000001' } }), source({ ast_00000001: map }))

    expect([map.repeat.x, map.repeat.y]).toEqual([1, 1])
    expect(map.rotation).toBe(0)
  })

  it('pins the ao map to uv0 whatever channel the texture arrived with', () => {
    // Two assertions, and only the second one is about our code. `Texture.channel` defaults
    // to 0 in three 0.185 — asserting that alone would be a test of three, and it passed
    // with the line deleted (变异 H2 存活). What the runtime actually guarantees is that a
    // texture reaching us with channel 1 — a glTF declaring texCoord: 1, or any future path
    // that reuses a loaded texture — still samples the uv set our meshes have.
    expect(new Texture().channel, 'three 0.185 的默认值，变了要知道').toBe(0)

    const aoMap = new Texture()
    aoMap.channel = 1
    const material = new MeshStandardMaterial()
    applyParams(material, def({ maps: { aoMap: 'ast_00000003' } }), source({ ast_00000003: aoMap }))
    expect(aoMap.channel, '通道由运行时决定，不继承贴图从哪来').toBe(0)
  })

  it('does NOT re-upload the texture when only the uv numbers move (T-176 审查所得)', () => {
    // repeat / offset / rotation are uniforms; three recomputes the uv matrix every frame
    // anyway. Marking the texture dirty for them re-uploaded the whole image: dragging a
    // slider for a second on a material with six 2048² maps was ~60 × 100 MB of texImage2D,
    // and because the cache shares one Texture per asset it hit every material using it.
    const map = new Texture()
    const material = new MeshStandardMaterial()
    const textures = source({ ast_00000001: map })
    const withUv = (repeat: [number, number]) =>
      def({ maps: { map: 'ast_00000001' }, uv: { repeat, offset: [0, 0], rotationDeg: 0 } })

    applyParams(material, withUv([2, 2]), textures)
    const settled = map.version

    // Same wrap mode, different numbers — sixty of these is one slider drag.
    for (const r of [[2.5, 2.5], [3, 3], [4, 4]] as [number, number][]) {
      applyParams(material, withUv(r), textures)
    }

    expect(map.version, '只动 uv 数值不该触发重传').toBe(settled)
    expect(map.repeat.x, '但值本身当然要生效').toBe(4)
  })

  it('DOES re-upload when the wrap mode actually changes', () => {
    // The wrap mode is a sampler parameter, so this one genuinely needs the re-bind.
    const map = new Texture()
    const material = new MeshStandardMaterial()
    const textures = source({ ast_00000001: map })
    const withUv = (repeat: [number, number]) =>
      def({ maps: { map: 'ast_00000001' }, uv: { repeat, offset: [0, 0], rotationDeg: 0 } })

    applyParams(material, withUv([1, 1]), textures)
    const clamped = map.version

    applyParams(material, withUv([4, 4]), textures)

    expect(map.version, '从 clamp 换成 repeat 必须重新绑定').toBeGreaterThan(clamped)
    expect(map.wrapS).toBe(RepeatWrapping)
  })

  it('updating uv does not replace the material instance (增量生效)', () => {
    const map = new Texture()
    const material = new MeshStandardMaterial()
    const textures = source({ ast_00000001: map })

    applyParams(material, def({ maps: { map: 'ast_00000001' }, uv: { repeat: [1, 1], offset: [0, 0], rotationDeg: 0 } }), textures)
    const version = material.version
    applyParams(material, def({ maps: { map: 'ast_00000001' }, uv: { repeat: [2, 2], offset: [0, 0], rotationDeg: 0 } }), textures)

    expect(material.map, '同一个 Texture 实例').toBe(map)
    expect(map.repeat.x).toBe(2)
    expect(material.version).toBeGreaterThan(version)
  })
})

describe('铁律 9 with textures (T-151 验收)', () => {
  it('hanging a map on one of two meshes sharing a material leaves the other bare', () => {
    // The textbook symptom of getting this wrong: the user drags a wood texture onto one
    // chair and every chair in the room turns to wood. Colour params already had this
    // regression; a map assignment writes a different property and needed its own.
    const doc = createGoldenPathDocument()
    graph.build(doc)
    expect(materialOf(IDS.body), '前提：两个 mesh 共享同一个材质实例').toBe(materialOf(IDS.cover))

    const map = new Texture()
    registry.setTextureSource({ get: (id: string) => (id === 'ast_tex00001' ? map : undefined) })

    const withMap: MaterialDef = {
      ...doc.materials[0]!,
      params: { ...doc.materials[0]!.params, maps: { map: 'ast_tex00001' } },
    }
    registry.applyToNode(IDS.cover, withMap.id, defsOf([withMap]), graph)

    expect(materialOf(IDS.cover).map, '挂图的那个要有图').toBe(map)
    expect(materialOf(IDS.body).map, '旁边那个必须还是光的').toBeNull()
    expect(materialOf(IDS.body), '而且不能再是同一个实例了').not.toBe(materialOf(IDS.cover))
  })
})

describe('physical parameters (T-153)', () => {
  const def = (base: MaterialDef['base'], params: Partial<MaterialDef['params']> = {}): MaterialDef =>
    ({ id: 'mat_00000001', name: '玻璃', base, preset: 'custom', params: { maps: {}, ...params } }) as MaterialDef

  const noTextures = { get: () => undefined }

  it('writes the glass parameters onto a physical material', () => {
    const material = new MeshPhysicalMaterial()
    applyParams(
      material,
      def('physical', { transmission: 0.9, ior: 1.5, thickness: 0.02, clearcoat: 1, clearcoatRoughness: 0.1 }),
      noTextures,
    )

    expect(material.transmission).toBe(0.9)
    expect(material.ior).toBe(1.5)
    expect(material.thickness).toBe(0.02)
    expect(material.clearcoat).toBe(1)
    expect(material.clearcoatRoughness).toBe(0.1)
  })

  it('does NOT write them onto a standard material', () => {
    // JavaScript would happily accept `standard.transmission = 0.9`: the property lands on
    // the object and the renderer never reads it. The panel would then show a glass slider
    // that does nothing, which is worse than not showing one. I15 tells the user why.
    const material = new MeshStandardMaterial()
    applyParams(material, def('standard', { transmission: 0.9, ior: 1.5 }), noTextures)

    expect((material as unknown as Record<string, unknown>)['transmission']).toBeUndefined()
    expect((material as unknown as Record<string, unknown>)['ior']).toBeUndefined()
  })

  it('transmission above zero forces transparent', () => {
    // three composites transmission through a separate render target that an opaque
    // material never reaches: the glass renders as a solid lump, which reads as
    // "transmission is broken" rather than as a missing checkbox.
    const material = new MeshPhysicalMaterial()
    applyParams(material, def('physical', { transmission: 0.5 }), noTextures)
    expect(material.transparent).toBe(true)
  })

  it('leaves an opaque physical material opaque', () => {
    const material = new MeshPhysicalMaterial()
    applyParams(material, def('physical', { transmission: 0, roughness: 0.2 }), noTextures)
    expect(material.transparent).toBe(false)
  })

  it('produces no NaN anywhere in the glass parameter set (卡片验收)', () => {
    const material = new MeshPhysicalMaterial()
    applyParams(
      material,
      def('physical', {
        color: '#ffffff',
        roughness: 0.05,
        metalness: 0,
        opacity: 1,
        transmission: 1,
        ior: 1.52,
        thickness: 0.01,
        clearcoat: 1,
        clearcoatRoughness: 0,
      }),
      noTextures,
    )

    const checked = [
      'roughness',
      'metalness',
      'opacity',
      'transmission',
      'ior',
      'thickness',
      'clearcoat',
      'clearcoatRoughness',
    ]
    for (const key of checked) {
      const value = (material as unknown as Record<string, number>)[key]!
      expect(Number.isFinite(value), key + ' 变成了 ' + String(value)).toBe(true)
    }
  })
})

describe('switching base rebuilds the instance (T-153)', () => {
  const defs = (base: MaterialDef['base'], params: Partial<MaterialDef['params']> = {}) =>
    defsOf([
      { id: 'mat_c4d6f8h1', name: 'x', base, preset: 'custom', params: { maps: {}, ...params } } as MaterialDef,
    ])

  it('standard to physical, carrying the shared parameters across', () => {
    const doc = createGoldenPathDocument()
    graph.build(doc)
    registry.applyToNode(IDS.cover, 'mat_c4d6f8h1', defs('standard', { roughness: 0.4, metalness: 0.9 }), graph)
    expect(materialOf(IDS.cover).type).toBe('MeshStandardMaterial')

    registry.applyToNode(
      IDS.cover,
      'mat_c4d6f8h1',
      defs('physical', { roughness: 0.4, metalness: 0.9, transmission: 1 }),
      graph,
    )

    const upgraded = materialOf(IDS.cover)
    expect(upgraded.type).toBe('MeshPhysicalMaterial')
    expect(upgraded.roughness, '共有参数不能在换类的时候丢').toBe(0.4)
    expect(upgraded.metalness).toBe(0.9)
    expect((upgraded as MeshPhysicalMaterial).transmission).toBe(1)
  })

  it('carries INHERITED parameters across, not just the ones the def sets', () => {
    // The migration is only observable for fields the def leaves out. SCHEMA_SPEC §6.1: a
    // missing field means "inherit from the source material" — so a base change on a
    // material that only sets `transmission` must keep the asset's roughness 0.8 rather
    // than snapping to three's default of 1. Every other test here specifies roughness,
    // which is why deleting the whole migration loop left them all green (变异 J5 存活).
    const doc = createGoldenPathDocument()
    graph.build(doc)
    expect(pump.sharedMaterial.roughness, '前提：源材质有个显眼的值').toBe(0.8)

    registry.applyToNode(IDS.cover, 'mat_c4d6f8h1', defs('standard'), graph)
    expect(materialOf(IDS.cover).roughness).toBe(0.8)

    registry.applyToNode(IDS.cover, 'mat_c4d6f8h1', defs('physical', { transmission: 1 }), graph)

    const upgraded = materialOf(IDS.cover)
    expect(upgraded.type).toBe('MeshPhysicalMaterial')
    expect(upgraded.roughness, '换成玻璃不该把粗糙度重置成 three 的默认值').toBe(0.8)
    expect(upgraded.metalness).toBe(0.2)
    expect('#' + upgraded.color.getHexString()).toBe('#8a959e')
  })

  it('round-trips without losing parameters (卡片验收)', () => {
    const doc = createGoldenPathDocument()
    graph.build(doc)
    const params = { color: '#ff8800', roughness: 0.33, metalness: 0.66, opacity: 0.5, transparent: true }

    registry.applyToNode(IDS.cover, 'mat_c4d6f8h1', defs('standard', params), graph)
    registry.applyToNode(IDS.cover, 'mat_c4d6f8h1', defs('physical', params), graph)
    registry.applyToNode(IDS.cover, 'mat_c4d6f8h1', defs('standard', params), graph)

    const back = materialOf(IDS.cover)
    expect(back.type).toBe('MeshStandardMaterial')
    expect(back.roughness).toBe(0.33)
    expect(back.metalness).toBe(0.66)
    expect(back.opacity).toBe(0.5)
    expect('#' + back.color.getHexString()).toBe('#ff8800')
  })

  it('does not share the Color OBJECT with the material it replaced', () => {
    // Assigning the reference would tie the two together, so the next colour edit on one
    // would silently change the other — and one of them may still be on screen.
    const doc = createGoldenPathDocument()
    graph.build(doc)
    registry.applyToNode(IDS.cover, 'mat_c4d6f8h1', defs('standard', { color: '#123456' }), graph)
    const before = materialOf(IDS.cover).color

    registry.applyToNode(IDS.cover, 'mat_c4d6f8h1', defs('physical', { color: '#123456' }), graph)
    const after = materialOf(IDS.cover).color

    expect(after).not.toBe(before)
    expect('#' + after.getHexString()).toBe('#123456')
  })

  it('carries the texture slots across a base change', () => {
    // Losing them would look like "changing to glass deleted my textures".
    const doc = createGoldenPathDocument()
    graph.build(doc)
    const map = new Texture()
    registry.setTextureSource({ get: (id: string) => (id === 'ast_tex00001' ? map : undefined) })

    registry.applyToNode(IDS.cover, 'mat_c4d6f8h1', defs('standard', { maps: { map: 'ast_tex00001' } }), graph)
    registry.applyToNode(IDS.cover, 'mat_c4d6f8h1', defs('physical', { maps: { map: 'ast_tex00001' } }), graph)

    expect(materialOf(IDS.cover).map).toBe(map)
  })

  it('is a no-op when the class already matches', () => {
    // This runs on every apply, so "no change" has to be free — and must not churn the
    // instance the gizmo and the highlight layer are holding.
    const doc = createGoldenPathDocument()
    graph.build(doc)
    registry.applyToNode(IDS.cover, 'mat_c4d6f8h1', defs('standard', { roughness: 0.4 }), graph)
    const first = materialOf(IDS.cover)
    registry.applyToNode(IDS.cover, 'mat_c4d6f8h1', defs('standard', { roughness: 0.5 }), graph)

    expect(materialOf(IDS.cover)).toBe(first)
  })

  it('leaves a base this build cannot construct alone, rather than downgrading it', () => {
    // `basic` and `lambert` are in the schema but nothing builds them yet. Silently turning
    // one into a standard material would be a rendering change nobody asked for.
    expect(canRebuildBase('standard')).toBe(true)
    expect(canRebuildBase('physical')).toBe(true)
    expect(canRebuildBase('basic')).toBe(false)
    expect(canRebuildBase('lambert')).toBe(false)

    const material = new MeshStandardMaterial()
    expect(rebuildForBase(material, 'basic')).toBe(material)
  })
})

/**
 * T-181 · one image, two uses that disagree about how to sample it.
 *
 * `colorSpace`, `repeat`, `offset` and `rotation` live on the three `Texture`, not on the
 * material. One shared instance means the last writer wins — and BOTH surviving failures
 * here were invisible to the existing tests, because every one of them injects a stub
 * source that hands back the same Texture regardless of who asked (T-176 审查所得).
 *
 * So these drive the REAL `TextureCache`. A stub cannot fail this way, which is precisely
 * why the bug lived through 44 green tests.
 */
describe('sharing one texture between disagreeing slots (T-181)', () => {
  const asset = (id: string): Asset => ({
    id,
    type: 'texture',
    name: 'surface.png',
    hash: `blob_${id}`,
    url: `blob:${id}`,
    version: 1,
    lineageId: id,
    stats: {
      clipDurations: {}, tris: 0, materials: 0, textures: 1, bytes: 1024, textureBytes: 1024, nodes: 0, animations: [] },
  })

  const realCache = async (id: string) => {
    const cache = new TextureCache({
      resolver: { resolve: async () => new ArrayBuffer(8) },
      decode: async () => ({ width: 4, height: 4 }) as unknown as TexImageSource,
    })
    await cache.load(asset(id))
    return cache
  }

  const def = (params: Partial<MaterialDef['params']>, id = 'mat_00000001'): MaterialDef =>
    ({ id, name: '贴图材质', base: 'standard', preset: 'custom', params: { maps: {}, ...params } }) as MaterialDef

  it('keeps the base colour sRGB when the same image is also the roughness map', async () => {
    // The reproduced failure: 基础色 and 粗糙度 pointing at one image. Roughness is DATA and
    // must be linear; base colour is a COLOUR and must be sRGB. Sharing one Texture means
    // whichever slot is written last decides — and the loop writes roughnessMap after map,
    // so the base colour is sampled linear and the object renders washed out. Nothing in
    // the panel says why, and 「分离材质」 does not help: the material was never shared.
    const cache = await realCache('ast_tex00001')
    const material = new MeshStandardMaterial()

    applyParams(material, def({ maps: { map: 'ast_tex00001', roughnessMap: 'ast_tex00001' } }), cache)

    expect(material.map!.colorSpace, '基础色必须是 sRGB').toBe(SRGBColorSpace)
    expect(material.roughnessMap!.colorSpace, '粗糙度是数据，必须线性').toBe(LinearSRGBColorSpace)
    expect(material.map, '两个槽不能是同一个 Texture 实例').not.toBe(material.roughnessMap)
  })

  it('lets two materials tile one image differently', async () => {
    // 「分离材质」 separates materials. It does not separate the Texture underneath them, so
    // before this the second material's tiling silently overwrote the first's.
    const cache = await realCache('ast_tex00001')
    const wall = new MeshStandardMaterial()
    const floor = new MeshStandardMaterial()

    applyParams(wall, def({ maps: { map: 'ast_tex00001' }, uv: { repeat: [1, 1], offset: [0, 0], rotationDeg: 0 } }), cache)
    applyParams(
      floor,
      def({ maps: { map: 'ast_tex00001' }, uv: { repeat: [8, 8], offset: [0, 0], rotationDeg: 0 } }, 'mat_00000002'),
      cache,
    )

    expect(floor.map!.repeat.toArray(), '后设的材质要拿到自己的平铺').toEqual([8, 8])
    expect(wall.map!.repeat.toArray(), '先设的材质不该被后一个改掉').toEqual([1, 1])
  })

  it('shares the instance again when two uses AGREE — the count stays bounded', async () => {
    // Isolation is only affordable if agreement still shares. A Texture per (material, slot)
    // would put an unbounded number of instances on the GPU, which is the bug this fix would
    // be trading for.
    const cache = await realCache('ast_tex00001')
    const a = new MeshStandardMaterial()
    const b = new MeshStandardMaterial()
    const same: Partial<MaterialDef['params']> = {
      maps: { map: 'ast_tex00001' },
      uv: { repeat: [4, 4], offset: [0, 0], rotationDeg: 0 },
    }

    applyParams(a, def(same), cache)
    applyParams(b, def(same, 'mat_00000002'), cache)

    expect(a.map, '设置相同就该共享同一个实例').toBe(b.map)
    expect(cache.variantCount, '一种采样状态一个实例').toBe(1)
    expect(cache.size, '解码出来的图始终只有一张').toBe(1)
  })

  it('applies uv to EVERY slot, not just up to the first one already wrapped', async () => {
    // `applyUv` RETURNED instead of continuing once a slot's wrap mode already matched, so
    // every slot after it kept the identity uv. Reaching it needs tiling at or below 1×,
    // where the wanted wrap IS the default a fresh texture carries — the first slot matches
    // immediately and the rest of the material is silently skipped. Tiling above 1× never
    // triggers it, which is exactly why an obvious-looking test of this passed either way.
    const cache = await realCache('ast_tex00001')
    const material = new MeshStandardMaterial()

    applyParams(
      material,
      def({
        maps: { map: 'ast_tex00001', normalMap: 'ast_tex00001' },
        uv: { repeat: [1, 1], offset: [0, 0], rotationDeg: 45 },
      }),
      cache,
    )

    const quarter = Math.PI / 4
    expect(material.map!.rotation).toBeCloseTo(quarter)
    expect(material.normalMap!.rotation, '第二个槽也要跟着转，否则法线和基础色错开').toBeCloseTo(quarter)
    // Rotation is around the uv origin unless `center` is moved, which spins the texture
    // clean off the surface — so the skipped slot is visibly wrong, not merely unrotated.
    expect(material.normalMap!.center.toArray(), '旋转中心也要设，否则贴图转出表面').toEqual([0.5, 0.5])
  })

  it('frees the variants when the asset goes, not just the original', async () => {
    // Otherwise the isolation fix becomes a leak: the entry count returns to zero while the
    // clones stay on the GPU forever.
    const cache = await realCache('ast_tex00001')
    const material = new MeshStandardMaterial()
    applyParams(material, def({ maps: { map: 'ast_tex00001', roughnessMap: 'ast_tex00001' } }), cache)
    expect(cache.variantCount).toBe(2)

    cache.dispose()
    expect(cache.variantCount, '销毁要连副本一起回收').toBe(0)
  })
})

/* ========================================================================== */
/* T-256 · retainOnly —— 一处已实测的 clone 泄漏                               */
/* ========================================================================== */

/** 同一份场景，换一整套 nodeId —— 换文档时真正会发生的事。 */
function renamedDocument(doc: ReturnType<typeof createGoldenPathDocument>) {
  const rename = (id: string) => `${id.slice(0, 3)}zz${id.slice(5)}`
  return {
    ...doc,
    nodes: doc.nodes.map((n) => ({ ...n, id: rename(n.id), parent: n.parent === null ? null : rename(n.parent) })),
  }
}

describe('T-256 · retainOnly', () => {
  /** 给某个节点建一份克隆（`acquireWritable` 无条件克隆，见 R08 那一段）。 */
  const clone = (nodeId: string) => registry.acquireWritable(nodeId, graph)

  it('**留下的还在，没留下的释放掉，返回值就是被释放的那些**', () => {
    graph.build(createGoldenPathDocument())
    clone(IDS.body)
    clone(IDS.cover)
    expect(registry.cloneCount).toBe(2)

    const released = registry.retainOnly(new Set([IDS.body]))

    expect(registry.isCloned(IDS.body), '把要留的那份也释放了 —— 「全清」实现在这条下红').toBe(true)
    expect(registry.isCloned(IDS.cover), '该释放的还在 —— 空实现在这条下红').toBe(false)
    expect(released).toEqual([IDS.cover])
    expect(registry.cloneCount).toBe(1)
  })

  it('被释放的那份材质真的 dispose 了', () => {
    graph.build(createGoldenPathDocument())
    const material = clone(IDS.cover)!
    let disposed = 0
    material.dispose = () => void disposed++

    registry.retainOnly(new Set([IDS.body]))

    expect(disposed).toBe(1)
  })

  it('**换文档之后再建克隆，cloneCount 是 1 不是 2**（卡面点名的那条）', () => {
    // 泄漏的形状：注册表按 nodeId 记账，而**换文档时 nodeId 整套都变了**。上一份文档的
    // nodeId 全都还在 `owned` 里，克隆材质也还在显存里，于是数字只增不减。
    //
    // ⚠ **文档 B 必须换一套 id。** 沿用同一套 id 的话 `ownedFor` 会按 nodeId 覆盖掉旧条目，
    // 数字停在 1——那样这条测试对「不调 retainOnly」的实现同样绿，正是卡面要防的假绿。
    const a = createGoldenPathDocument()
    graph.build(a)
    clone(IDS.cover)
    expect(registry.cloneCount).toBe(1)

    const b = renamedDocument(a)
    graph.build(b)
    registry.retainOnly(new Set(b.nodes.map((n) => n.id)))
    clone(b.nodes.find((n) => n.assetRef !== null)!.id)

    expect(registry.cloneCount, '不 retainOnly 的话这里是 2').toBe(1)
  })

  it('`sources` 也要一起删 —— 否则 revert 会把上一份文档某个 mesh 的材质赋给新 mesh', () => {
    // `noteMesh` 里那句 "assigning another mesh's material here would be a silent
    // cross-wire" 说的正是这件事。
    const doc = createGoldenPathDocument()
    graph.build(doc)
    clone(IDS.cover)
    const oldMesh = graph.objectFor(IDS.cover) as Mesh

    registry.retainOnly(new Set())
    graph.build(doc)
    const newMesh = graph.objectFor(IDS.cover) as Mesh
    expect(newMesh, '前提：重建换了对象').not.toBe(oldMesh)
    const beforeRevert = newMesh.material

    // 对新 mesh 撤销覆盖：`sources` 已清，不该有任何东西被赋回去
    registry.applyToNode(IDS.cover, null, defsOf(doc.materials), graph)

    expect(newMesh.material, '把上一份文档的材质赋给了新 mesh').toBe(beforeRevert)
  })

  it('空集合 = 全清；全留 = 什么都不动', () => {
    graph.build(createGoldenPathDocument())
    clone(IDS.body)
    clone(IDS.cover)

    expect(registry.retainOnly(new Set([IDS.body, IDS.cover]))).toEqual([])
    expect(registry.cloneCount).toBe(2)

    expect([...registry.retainOnly(new Set())].sort()).toEqual([IDS.body, IDS.cover].sort())
    expect(registry.cloneCount).toBe(0)
  })
})
