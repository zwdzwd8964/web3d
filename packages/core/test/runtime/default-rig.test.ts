import type { Asset, Light, SceneDocument } from '@w3/schema'
import { createGoldenPathDocument, identityTransform, migrate } from '@w3/schema'
import { readFileSync } from 'node:fs'
import { AmbientLight, DirectionalLight } from 'three'
import type { Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { createMemoryResolver } from '../../src/runtime/loader.js'
import { NullHotspotRenderer } from '../../src/runtime/hotspot-layer.js'
import { SceneRuntime } from '../../src/runtime/scene-runtime.js'

/**
 * T-134 · D14 · the default light rig, and gate G0.5-6.
 *
 * Two claims are made here, and they pull in opposite directions:
 *
 *   1. a v0.5 document that lights itself must NOT also get the built-in rig, or every
 *      intensity the user picks is wrong by three invisible lights;
 *   2. a v1 document must look EXACTLY as it did in v0 — not "close", not "still fine".
 *
 * The second one is why the parameters below are written out as literals instead of being
 * read from the implementation. A test that asserts `rig.intensity === rig.intensity`
 * cannot fail, and this is precisely the assertion a promotion gate is made of.
 */

/** v0's rig, transcribed from `scene-runtime.ts` as it stood at the end of v0. */
const V0_RIG = {
  ambient: { colour: 'ffffff', intensity: 0.6 },
  key: { colour: 'fff6e4', intensity: 2.1, position: [4, 6, 3] },
  fill: { colour: '7fa8c4', intensity: 0.55, position: [-5, 2.4, -3.6] },
} as const

const spot: Light = {
  kind: 'spot',
  color: '#ffd9a0',
  intensity: 3,
  range: 0,
  decay: 2,
  angleDeg: 30,
  penumbra: 0.2,
  shadow: { enabled: false, quality: 'medium', bias: -0.0005 },
}

const LIGHT_ID = 'nd_light001'
const HDRI_ID = 'ast_hdri0001'

const hdriAsset: Asset = {
  id: HDRI_ID,
  type: 'hdri',
  name: '工业厂房.hdr',
  hash: `sha256:${'c1d2e3f405162738'.repeat(4)}`,
  url: 'assets/c1/d2/env.hdr',
  version: 1,
  lineageId: HDRI_ID,
  stats: { tris: 0, materials: 0, textures: 1, bytes: 1024, textureBytes: 4096, nodes: 0, animations: [] },
}

const withLight = (doc: SceneDocument): SceneDocument => ({
  ...doc,
  nodes: [
    ...doc.nodes,
    {
      id: LIGHT_ID,
      name: '聚光灯',
      parent: null,
      order: 9000,
      assetRef: null,
      primitive: null,
      light: spot,
      transform: identityTransform(),
      visible: true,
      locked: false,
      overrides: {},
    },
  ],
})

const withHdri = (doc: SceneDocument): SceneDocument => ({
  ...doc,
  assets: [...doc.assets, hdriAsset],
  meta: { ...doc.meta, environment: { ...doc.meta.environment, hdriAssetId: HDRI_ID } },
})

const canvas = () => ({ clientWidth: 800, clientHeight: 600 }) as HTMLCanvasElement

function makeRuntime(doc: SceneDocument) {
  return new SceneRuntime(doc, {
    canvas: canvas(),
    resolver: createMemoryResolver(new Map()),
    mode: 'play',
    createRenderer: () =>
      ({
        info: { memory: { geometries: 0, textures: 0 } },
        shadowMap: { enabled: false, type: -1 },
        render: () => undefined,
        setSize: () => undefined,
        dispose: () => undefined,
        domElement: {} as HTMLCanvasElement,
      }) as never,
    hotspotRenderer: new NullHotspotRenderer(),
    now: () => 0,
    onLog: () => undefined,
  })
}

const rigNames = (rig: readonly Object3D[]) => rig.map((l) => l.name).sort()

describe('the default light rig (D14)', () => {
  it('is attached for a document with no lights and no environment', () => {
    const runtime = makeRuntime(createGoldenPathDocument())
    expect(rigNames(runtime.defaultLightRig)).toEqual(['w3:default-ambient', 'w3:default-fill', 'w3:default-key'])
    runtime.dispose()
  })

  it('stands down as soon as the document has one light of its own', () => {
    const runtime = makeRuntime(withLight(createGoldenPathDocument()))
    expect(runtime.defaultLightRig).toEqual([])
    runtime.dispose()
  })

  it('stands down for an environment map, even with no light nodes at all', () => {
    // An HDRI lights the scene on its own. Leaving the rig on top of it is how a carefully
    // chosen environment ends up looking flat and nobody can say why.
    const runtime = makeRuntime(withHdri(createGoldenPathDocument()))
    expect(runtime.defaultLightRig).toEqual([])
    runtime.dispose()
  })

  it('leaves and comes back as the last light is added and removed, through patches', () => {
    const plain = createGoldenPathDocument()
    const lit = withLight(plain)
    const runtime = makeRuntime(plain)
    expect(runtime.defaultLightRig).toHaveLength(3)

    runtime.applyPatch([{ op: 'add', path: ['nodes', 3], value: lit.nodes[3]! }], lit, plain)
    expect(runtime.defaultLightRig, '加了第一盏灯，默认灯架必须当帧退场').toEqual([])

    runtime.applyPatch([{ op: 'remove', path: ['nodes', 3] }], plain, lit)
    expect(runtime.defaultLightRig, '删光了灯，默认灯架要回来').toHaveLength(3)
    expect(runtime.fullRebuildCount).toBe(0)
    runtime.dispose()
  })

  it('leaves when the environment is set by patch, and comes back when it is cleared', () => {
    const plain = createGoldenPathDocument()
    const lit = withHdri(plain)
    const runtime = makeRuntime(plain)

    runtime.applyPatch([{ op: 'replace', path: ['meta', 'environment', 'hdriAssetId'], value: HDRI_ID }], lit, plain)
    expect(runtime.defaultLightRig).toEqual([])

    runtime.applyPatch([{ op: 'replace', path: ['meta', 'environment', 'hdriAssetId'], value: null }], plain, lit)
    expect(runtime.defaultLightRig).toHaveLength(3)
    runtime.dispose()
  })

  it('is not part of the document graph, so it can never be picked or highlighted', () => {
    // The rig hangs off `scene`, not off `graph.root`. The picker ray-casts the document
    // graph, so this is structural rather than a filter someone has to remember.
    const runtime = makeRuntime(createGoldenPathDocument())
    const inGraph: string[] = []
    runtime.graph.root.traverse((o) => inGraph.push(o.name))
    for (const light of runtime.defaultLightRig) {
      expect(inGraph, `${light.name} 不该出现在文档场景图里`).not.toContain(light.name)
      expect(runtime.graph.nodeIdFor(light), '默认灯架不属于任何文档节点').toBeNull()
    }
    runtime.dispose()
  })
})

describe('G0.5-6 · a v1 document still looks the way v0 drew it', () => {
  /** The frozen v1 fixture, migrated the way the editor and the player both open it. */
  function v1Document(): SceneDocument {
    const path = new URL('../../../schema/test/fixtures/v1/golden-path.json', import.meta.url)
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return migrateOrThrow(raw)
  }

  it('gets the rig, with v0’s parameters, one by one', () => {
    const runtime = makeRuntime(v1Document())
    const rig = runtime.defaultLightRig
    expect(rig).toHaveLength(3)

    const ambient = rig.find((l) => l.name === 'w3:default-ambient') as AmbientLight
    const key = rig.find((l) => l.name === 'w3:default-key') as DirectionalLight
    const fill = rig.find((l) => l.name === 'w3:default-fill') as DirectionalLight

    expect(ambient.color.getHexString()).toBe(V0_RIG.ambient.colour)
    expect(ambient.intensity).toBe(V0_RIG.ambient.intensity)

    expect(key.color.getHexString()).toBe(V0_RIG.key.colour)
    expect(key.intensity).toBe(V0_RIG.key.intensity)
    expect(key.position.toArray()).toEqual(V0_RIG.key.position)

    expect(fill.color.getHexString()).toBe(V0_RIG.fill.colour)
    expect(fill.intensity).toBe(V0_RIG.fill.intensity)
    expect(fill.position.toArray()).toEqual(V0_RIG.fill.position)
    runtime.dispose()
  })

  it('draws it against v0’s background and v0’s tone mapping', () => {
    // The other half of "looks the same": a migrated document must not pick up an
    // environment, an exposure curve, or a different backdrop from its new fields.
    const doc = v1Document()
    const runtime = makeRuntime(doc)
    expect(runtime.scene.environment).toBeNull()
    expect(runtime.scene.environmentIntensity).toBe(1)
    expect(runtime.scene.background, 'v1 的背景色必须原样保留').not.toBeNull()
    runtime.dispose()
  })

  it('the migrated v1 document really has no lights of its own — the premise, asserted', () => {
    // If the migration ever started injecting the rig as document nodes (the thing D14
    // forbids), every assertion above would still pass while meaning the opposite.
    const doc = v1Document()
    expect(doc.nodes.filter((n) => n.light !== null)).toEqual([])
    expect(doc.meta.environment.hdriAssetId).toBeNull()
  })
})

/** Runs the shipped migration chain, failing loudly rather than silently opening nothing. */
function migrateOrThrow(raw: unknown): SceneDocument {
  const result = migrate(raw)
  if (!result.ok) throw new Error(`v1 fixture failed to migrate: ${JSON.stringify(result.error)}`)
  return result.value.document
}
