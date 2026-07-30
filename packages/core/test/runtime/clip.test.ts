import type { ImportedAnimation, SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { ClipPlayer } from '../../src/runtime/animator/clip.js'
import { AssetLoader, createMemoryResolver } from '../../src/runtime/loader.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import type { AssetSource, LoadedAsset } from '../../src/runtime/types.js'
import { buildPumpGlb } from '../assets/glb.js'
import { IDS } from '../helpers.js'

/**
 * T-037 · imported clip playback.
 *
 * Everything here runs against a REAL GLB carrying a real animation channel — built in
 * memory, parsed by three's GLTFLoader, in plain Node. The binding logic is the part
 * worth testing: a clip addresses `Body`, the document node may be called 泵体, and the
 * two have to meet through `assetRef.objectName`.
 */

const ASSET_ID = 'ast_9k2m4p7q'
const CLIP = 'Disassemble'

let graph: SceneGraph
let loaded: LoadedAsset
let assets: AssetSource
let player: ClipPlayer
let ended: { id: string; completed: boolean }[]
let warnings: string[]

/** The golden path document, with 泵体 pointed at the animated `Body` object. */
function docWithClip(overrides: Partial<ImportedAnimation> = {}): SceneDocument {
  const base = createGoldenPathDocument()
  const animation: ImportedAnimation = {
    kind: 'imported',
    id: 'anm_11111111',
    name: '拆解',
    assetId: ASSET_ID,
    clipName: CLIP,
    speed: 1,
    loop: false,
    clampWhenFinished: true,
    ...overrides,
  }
  return { ...base, animations: [...base.animations, animation] }
}

const animationOf = (doc: SceneDocument) => doc.animations.find((a) => a.kind === 'imported') as ImportedAnimation

beforeEach(async () => {
  const bytes = await buildPumpGlb({ animationName: CLIP, animationSeconds: 1 })
  const loader = new AssetLoader({ resolver: createMemoryResolver(new Map()) })
  loaded = await loader.parse(ASSET_ID, bytes)
  assets = { get: (id) => (id === ASSET_ID ? loaded : undefined) }

  graph = new SceneGraph({ assets })
  ended = []
  warnings = []
  player = new ClipPlayer(graph, assets, {
    onAnimationEnd: (id, completed) => ended.push({ id, completed }),
    onWarn: (message) => warnings.push(message),
  })
})

const bodyY = () => graph.objectFor(IDS.body)!.position.y

describe('the fixture really carries an animation', () => {
  it('exposes the clip and its track', () => {
    expect(loaded.clips.map((c) => c.name)).toEqual([CLIP])
    expect(loaded.clips[0]!.tracks.length).toBeGreaterThan(0)
    expect(loaded.clips[0]!.duration).toBeCloseTo(1, 3)
  })
})

describe('playback', () => {
  it('drives the bound object over time', async () => {
    const doc = docWithClip()
    graph.build(doc)
    const promise = player.play(animationOf(doc), doc, 0)

    player.update(0)
    expect(bodyY()).toBeCloseTo(0, 3)

    player.update(500)
    expect(bodyY(), '半程应该走了一半').toBeGreaterThan(0.3)
    expect(bodyY()).toBeLessThan(0.7)

    player.update(1000)
    await promise
    expect(bodyY()).toBeCloseTo(1, 2)
  })

  it('D6 · resolves only at natural completion, and reports animationEnd', async () => {
    const doc = docWithClip()
    graph.build(doc)
    let settled = false
    void player.play(animationOf(doc), doc, 0).then(() => {
      settled = true
    })

    player.update(0)
    player.update(999)
    await Promise.resolve()
    expect(settled).toBe(false)

    player.update(1000)
    await Promise.resolve()
    expect(settled).toBe(true)
    expect(ended).toEqual([{ id: 'anm_11111111', completed: true }])
  })

  it('D6 / B2 · a looping clip resolves IMMEDIATELY and keeps running', async () => {
    const doc = docWithClip({ loop: true })
    graph.build(doc)

    await expect(player.play(animationOf(doc), doc, 0)).resolves.toBeUndefined()
    expect(player.isPlaying('anm_11111111')).toBe(true)

    player.update(0)
    player.update(2500)
    expect(player.isPlaying('anm_11111111'), '循环片段不会自行结束').toBe(true)
  })

  it('honours speed', async () => {
    const doc = docWithClip({ speed: 2 })
    graph.build(doc)
    const promise = player.play(animationOf(doc), doc, 0)
    player.update(0)
    player.update(500)
    await promise
    expect(bodyY()).toBeCloseTo(1, 1)
  })
})

describe('binding (the part that actually breaks)', () => {
  it('binds through assetRef.objectName, so renaming the node does not break the clip', async () => {
    const doc = docWithClip()
    // The user renames 泵体 on day one. An animation that stopped working because of a
    // rename would be indistinguishable from a broken export.
    const renamed: SceneDocument = {
      ...doc,
      nodes: doc.nodes.map((n) => (n.id === IDS.body ? { ...n, name: '主壳体（改过名）' } : n)),
    }
    graph.build(renamed)

    const promise = player.play(animationOf(renamed), renamed, 0)
    player.update(0)
    player.update(1000)
    await promise
    expect(bodyY()).toBeCloseTo(1, 2)
  })

  it('drives only its own target, not a same-named object elsewhere', async () => {
    const doc = docWithClip()
    graph.build(doc)
    const coverBefore = graph.objectFor(IDS.cover)!.position.y

    const promise = player.play(animationOf(doc), doc, 0)
    player.update(0)
    player.update(1000)
    await promise

    expect(graph.objectFor(IDS.cover)!.position.y).toBe(coverBefore)
  })

  it('warns and resolves when the clip name is not in the asset', async () => {
    const doc = docWithClip({ clipName: 'NoSuchClip' })
    graph.build(doc)
    await expect(player.play(animationOf(doc), doc, 0)).resolves.toBeUndefined()
    expect(warnings.some((w) => w.includes('不存在名为'))).toBe(true)
    expect(warnings.some((w) => w.includes(CLIP)), '提示里应列出可用的片段').toBe(true)
  })

  it('warns and resolves when the asset is not loaded yet', async () => {
    const doc = docWithClip({ assetId: 'ast_99999999' })
    graph.build(doc)
    await expect(player.play(animationOf(doc), doc, 0)).resolves.toBeUndefined()
    expect(warnings.some((w) => w.includes('尚未加载'))).toBe(true)
  })

  it('D5 · says so when every target was orphaned by a re-import, rather than silently doing nothing', async () => {
    const doc = docWithClip()
    const orphaned: SceneDocument = {
      ...doc,
      nodes: doc.nodes.map((n) => (n.assetRef ? { ...n, assetRef: { ...n.assetRef, missing: true } } : n)),
    }
    graph.build(orphaned)
    await expect(player.play(animationOf(orphaned), orphaned, 0)).resolves.toBeUndefined()
    expect(warnings.some((w) => w.includes('没有对应的场景对象'))).toBe(true)
  })
})

describe('interruption', () => {
  it('stop leaves the object where it is and rejects', async () => {
    const doc = docWithClip()
    graph.build(doc)
    const promise = player.play(animationOf(doc), doc, 0)
    promise.catch(() => undefined)

    player.update(0)
    player.update(400)
    const mid = bodyY()

    player.stop('anm_11111111')

    expect(bodyY()).toBeCloseTo(mid, 6)
    expect(player.isPlaying('anm_11111111')).toBe(false)
    expect(ended).toEqual([{ id: 'anm_11111111', completed: false }])
    await expect(promise).rejects.toThrow()
  })

  it('an AbortSignal stops it', async () => {
    const doc = docWithClip()
    graph.build(doc)
    const controller = new AbortController()
    const settled = player.play(animationOf(doc), doc, 0, { signal: controller.signal }).then(
      () => 'resolved',
      () => 'rejected',
    )
    player.update(0)
    player.update(200)
    controller.abort()
    expect(await settled).toBe('rejected')
  })

  it('an already-aborted signal rejects without starting', async () => {
    const doc = docWithClip()
    graph.build(doc)
    const controller = new AbortController()
    controller.abort()
    await expect(player.play(animationOf(doc), doc, 0, { signal: controller.signal })).rejects.toThrow()
    expect(player.activeCount).toBe(0)
  })

  it('replaying restarts rather than stacking', async () => {
    const doc = docWithClip()
    graph.build(doc)
    void player.play(animationOf(doc), doc, 0).catch(() => undefined)
    player.update(0)
    void player.play(animationOf(doc), doc, 200).catch(() => undefined)
    expect(player.activeCount).toBe(1)
  })

  it('stopAll and dispose leave nothing running', async () => {
    const doc = docWithClip()
    graph.build(doc)
    void player.play(animationOf(doc), doc, 0).catch(() => undefined)
    player.stopAll()
    expect(player.activeCount).toBe(0)
    expect(ended, 'stopAll 不发结束事件').toEqual([])
    expect(() => player.dispose()).not.toThrow()
  })
})

describe('seek', () => {
  it('positions without starting playback', async () => {
    const doc = docWithClip()
    graph.build(doc)
    player.seek(animationOf(doc), doc, 0.5)
    expect(bodyY()).toBeGreaterThan(0.3)
    expect(player.isPlaying('anm_11111111')).toBe(false)
  })
})
