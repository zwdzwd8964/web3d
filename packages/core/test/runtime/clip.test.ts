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
    startS: 0,
    endS: null,
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

/* ========================================================================== */
/* T-237 · action 缓存回收与整图重建                                           */
/* ========================================================================== */

/** three 内部那条 action 列表。回收有没有真的发生，只有这里看得见。 */
const actionsOf = (object: object) =>
  (player as unknown as { mixers: Map<string, { _actions: unknown[] }> }).mixers.get(
    (object as { uuid: string }).uuid,
  )?._actions ?? []

describe('T-237 · 反复播放不再往 mixer 里堆 action', () => {
  it('play ×20 之后 mixer 里仍然只有一条 action', async () => {
    const doc = docWithClip()
    graph.build(doc)
    const body = graph.objectFor(IDS.body)!

    for (let i = 0; i < 20; i++) {
      void player.play(animationOf(doc), doc, i * 10).catch(() => undefined)
    }

    // **断的是 three 内部那条列表的长度，不是 `activeCount`。** 后者早就是 1 了——
    // 每次 play 前的 `stop` 把上一条从 playing 里摘掉，而堆在 mixer 里的那 20 条
    // AnimationAction 与它们各自的 PropertyMixer 一条都没走。
    expect(actionsOf(body)).toHaveLength(1)
    expect(player.mixerCount).toBe(1)
    player.stopAll()
  })

  it('seek ×20 也不堆 —— 它走的是另一条 bind 路径', async () => {
    const doc = docWithClip()
    graph.build(doc)
    const body = graph.objectFor(IDS.body)!

    for (let i = 0; i < 20; i++) player.seek(animationOf(doc), doc, (i % 10) / 10)

    expect(actionsOf(body)).toHaveLength(1)
  })

  it('releaseFor 把那条动画的缓存交回去', async () => {
    const doc = docWithClip()
    graph.build(doc)
    const body = graph.objectFor(IDS.body)!
    player.seek(animationOf(doc), doc, 0.5)
    expect(actionsOf(body)).toHaveLength(1)

    player.releaseFor('anm_11111111')

    expect(actionsOf(body)).toHaveLength(0)
    // 交回去之后还能再用：下一次 bind 重新造一份
    player.seek(animationOf(doc), doc, 0.5)
    expect(actionsOf(body)).toHaveLength(1)
  })

  it('releaseFor 只动被点名的那条动画', async () => {
    const doc = docWithClip()
    graph.build(doc)
    const body = graph.objectFor(IDS.body)!
    player.seek(animationOf(doc), doc, 0.5)

    player.releaseFor('anm_99999999')

    expect(actionsOf(body), '别的动画的缓存不该被顺手清掉').toHaveLength(1)
  })
})

describe('T-237 · clearMixers 与整图重建', () => {
  it('clearMixers 之后 mixer 数为 0', async () => {
    const doc = docWithClip()
    graph.build(doc)
    void player.play(animationOf(doc), doc, 0).catch(() => undefined)
    expect(player.mixerCount).toBe(1)

    player.clearMixers()

    expect(player.mixerCount).toBe(0)
    expect(player.activeCount).toBe(0)
  })

  it('**连做 5 次 build + clear，mixerCount 不随次数增长**', async () => {
    // 只断「调用后为 0」是假绿：那条在 clearMixers 根本没被接进 resetScene 时也成立。
    // 这一条断的是**跨轮次不累积**，也就是「反复排练一段拆装流程」真正会踩的形状。
    const doc = docWithClip()
    const seen: number[] = []
    for (let round = 0; round < 5; round++) {
      graph.build(doc)
      void player.play(animationOf(doc), doc, round * 10).catch(() => undefined)
      player.update(round * 10 + 5)
      seen.push(player.mixerCount)
      player.clearMixers()
    }
    expect(seen, '每一轮的峰值都该一样').toEqual([1, 1, 1, 1, 1])
  })

  it('重建之后不再驱动旧对象 —— 旧的不动，新的在动', async () => {
    const doc = docWithClip()
    graph.build(doc)
    const ghost = graph.objectFor(IDS.body)!
    void player.play(animationOf(doc), doc, 0).catch(() => undefined)
    player.update(100)
    expect(ghost.position.y, '前提：它本来是在被驱动的').not.toBe(0)
    const ghostY = ghost.position.y

    // 整图重建：`graph.build` 造的是全新的 Object3D，旧的那批已经没人渲染了
    player.clearMixers()
    graph.build(doc)
    const fresh = graph.objectFor(IDS.body)!
    expect(fresh, '前提：重建真的换了对象').not.toBe(ghost)

    void player.play(animationOf(doc), doc, 0).catch(() => undefined)
    player.update(400)

    expect(fresh.position.y, '新对象要在动').not.toBe(0)
    expect(ghost.position.y, '幽灵对象一动都不许再动').toBe(ghostY)
    player.stopAll()
  })
})

describe('T-237 · 绝对时间驱动', () => {
  it('姿态由「现在是第几秒」决定，不受被跳过的帧影响', async () => {
    // 累加式驱动里，中间少调几次 update 就等于少推几次时间，末态会停在别处。
    const doc = docWithClip()
    graph.build(doc)
    void player.play(animationOf(doc), doc, 0).catch(() => undefined)
    for (let t = 20; t <= 600; t += 20) player.update(t)
    const stepped = bodyY()

    player.stopAll()
    graph.build(doc)
    void player.play(animationOf(doc), doc, 0).catch(() => undefined)
    // 同样走到 600ms，但中间只有一帧——累加式会差出一大截
    player.update(10)
    player.update(600)

    expect(bodyY()).toBeCloseTo(stepped, 6)
    player.stopAll()
  })

  it('循环片段按取模回绕，而不是一路涨上去', async () => {
    const doc = docWithClip({ loop: true })
    graph.build(doc)
    void player.play(animationOf(doc), doc, 0).catch(() => undefined)

    player.update(300)
    const at300 = bodyY()
    // 片段长 1s：1300ms 与 300ms 应当是同一帧
    player.update(1300)

    expect(bodyY()).toBeCloseTo(at300, 6)
    player.stopAll()
  })

  it('非循环片段钳在末帧，不会算过头', async () => {
    const doc = docWithClip({ clampWhenFinished: true })
    graph.build(doc)
    void player.play(animationOf(doc), doc, 0).catch(() => undefined)

    player.update(1000)
    const atEnd = bodyY()
    player.update(5000)

    expect(bodyY()).toBeCloseTo(atEnd, 6)
  })
})
