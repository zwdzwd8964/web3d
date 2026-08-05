import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { Plane } from 'three'
import { describe, expect, it } from 'vitest'
import { SceneRuntime } from '../../src/runtime/scene-runtime.js'
import { createMemoryResolver } from '../../src/runtime/loader.js'
import { NullHotspotRenderer } from '../../src/runtime/hotspot-layer.js'

describe('probe', () => {
  it('整份 nodes 被替换时新建的剖切面要生效', async () => {
    const renderer = {
      clippingPlanes: [] as Plane[], localClippingEnabled: false,
      info: { memory: { geometries: 0, textures: 0 }, programs: [] },
      shadowMap: { enabled: false, type: -1 }, extensions: { has: () => false },
      getPixelRatio: () => 1, getSize: (t: { set: (w: number, h: number) => unknown }) => t.set(800, 600),
      setRenderTarget: () => {}, getRenderTarget: () => null, clear: () => {},
      render: () => {}, setSize: () => {}, setPixelRatio: () => {}, dispose: () => {},
      domElement: {} as HTMLCanvasElement,
    }
    const doc = createGoldenPathDocument()
    const runtime = new SceneRuntime(doc, {
      canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
      resolver: createMemoryResolver(new Map()), mode: 'edit',
      createRenderer: () => renderer as never, hotspotRenderer: new NullHotspotRenderer(), now: () => 0,
    })
    await runtime.load(doc)
    expect(renderer.clippingPlanes).toHaveLength(0)

    const node = { section: { scope: 'scene' as const, size: [4, 4] as [number, number] }, explode: null, explodeOffset: null, prefabRef: null, assetRef: null, primitive: null, light: null, id: 'nd_new00001', name: '剖切', parent: null, order: 9999, transform: { p: [0, 0.8, 0] as [number,number,number], r: [0,0,0,1] as [number,number,number,number], s: [1,1,1] as [number,number,number] }, visible: true, locked: false, overrides: {} }
    const next = { ...doc, nodes: [...doc.nodes, node] } as SceneDocument
    runtime.applyPatch([{ op: 'replace', path: ['nodes'], value: next.nodes }], next, doc)

    console.log('fullRebuild:', runtime.fullRebuildCount, 'planes:', renderer.clippingPlanes.length)
    expect(renderer.clippingPlanes).toHaveLength(1)
    runtime.dispose()
  })
})
