import type { SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D } from 'three'
import type { AssetSource, LoadedAsset } from '../../src/runtime/types.js'
import { IDS } from '../helpers.js'

/**
 * A stand-in for a loaded pump.glb.
 *
 * The important detail is that Body and ValveCover SHARE one MeshStandardMaterial
 * instance. That is the normal glTF situation and the exact setup R08 is about — a
 * fixture where every mesh had its own material would make the clone-on-write tests
 * pass without testing anything.
 */
export interface PumpAsset {
  readonly asset: LoadedAsset
  readonly source: AssetSource
  readonly sharedMaterial: MeshStandardMaterial
  readonly bodyMesh: Mesh
  readonly coverMesh: Mesh
}

export function createPumpAsset(assetId = IDS_ASSET): PumpAsset {
  const sharedMaterial = new MeshStandardMaterial({ name: '钢', color: 0x8a959e, roughness: 0.8, metalness: 0.2 })

  const root = new Group()
  root.name = 'Root'
  const pump = new Group()
  pump.name = 'Pump'
  root.add(pump)

  const bodyMesh = new Mesh(new BoxGeometry(1, 1, 1), sharedMaterial)
  bodyMesh.name = 'Body'
  const coverMesh = new Mesh(new BoxGeometry(0.6, 0.2, 0.6), sharedMaterial)
  coverMesh.name = 'ValveCover'
  pump.add(bodyMesh, coverMesh)

  const objects = new Map<string, Object3D>([
    ['Root', root],
    ['Root/Pump', pump],
    ['Root/Pump/Body', bodyMesh],
    ['Root/Pump/ValveCover', coverMesh],
  ])

  const asset: LoadedAsset = { assetId, scene: root, clips: [], objects }
  return {
    asset,
    source: { get: (id) => (id === assetId ? asset : undefined) },
    sharedMaterial,
    bodyMesh,
    coverMesh,
  }
}

const IDS_ASSET = 'ast_9k2m4p7q'

/** The golden path document, optionally mutated. */
export function doc(mutate?: (d: SceneDocument) => SceneDocument): SceneDocument {
  const base = createGoldenPathDocument()
  return mutate ? mutate(base) : base
}

/** Gives 泵体 the same material override 阀盖 already has — two nodes, one definition. */
export function docWithBothOverridden(): SceneDocument {
  const base = createGoldenPathDocument()
  return {
    ...base,
    nodes: base.nodes.map((n) =>
      n.id === IDS.body ? { ...n, overrides: { materialId: base.materials[0]!.id } } : n,
    ),
  }
}
