import type { Asset, Material, SceneDocument } from '@w3/schema'
import {
  DEFAULT_MATERIAL_NAME,
  checkIntegrity,
  createGoldenPathDocument,
  createMaterial,
  defaultFactoryContext,
  ensureDefaultMaterial,
  errorsOf,
} from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { describeRemoval } from '../src/panels/removal.js'
import { createDocumentStore } from '../src/store/document-store.js'

/**
 * T-257 · 删材质 / 删资产。
 *
 * 「删材质 / 删资产」在 13 份领域设计里**零命中**——节点有删除入口，这两样没有。
 * 用户建错一条材质就永远删不掉，而一张导错的贴图会一直把字节带进 `.w3p`。
 *
 * ## 这份测试盯着的那条不对称
 *
 * 材质被引用时**照删**（回落到默认材质），资产被引用时**拒绝删**。理由是有没有安全落点：
 * 删完材质文档仍然完整可渲染；删掉一份还有人指的资产，节点要么变空壳、要么外观静默改变，
 * 而那是「文档还合法、画面已经错了」——最难归因的一类缺陷。
 *
 * 所以下面每一组都成对写：**能删的那一支断「删完仍然干净」，不能删的那一支断「真的被拦住了」**。
 */

const PUMP = 'nd_r5t8y1u3'
const BODY = 'nd_v7w9x2z4'
const COVER = 'nd_b3n5m7k9'

/** 一份带一条自定义材质、且被三个 mesh 共用的文档。 */
function sharedMaterialDocument(): { doc: SceneDocument; materialId: string } {
  const base = createGoldenPathDocument()
  const shared: Material = createMaterial({ name: '不锈钢', ctx: defaultFactoryContext })
  const doc: SceneDocument = {
    ...base,
    materials: [...base.materials, shared],
    nodes: base.nodes.map((n) =>
      [PUMP, BODY, COVER].includes(n.id) ? { ...n, overrides: { ...n.overrides, materialId: shared.id } } : n,
    ),
  }
  return { doc, materialId: shared.id }
}

/** 给一份文档加一条资产记录，`referenced` 决定有没有节点指着它。 */
function withAsset(doc: SceneDocument, id: string, name: string, referenced: boolean): SceneDocument {
  const template = doc.assets[0]
  if (!template) throw new Error('黄金路径文档应当至少有一份资产')
  const asset: Asset = { ...template, id, name, url: `assets/${name}` }
  return {
    ...doc,
    assets: [...doc.assets, asset],
    nodes: referenced
      ? doc.nodes.map((n) =>
          n.id === COVER && n.assetRef ? { ...n, assetRef: { ...n.assetRef, assetId: id } } : n,
        )
      : doc.nodes,
  }
}

describe('T-257 · describeRemoval 的三种文案', () => {
  it('① 被引用的材质：文案里有引用数，也有前几个引用者的名字', () => {
    const { doc, materialId } = sharedMaterialDocument()
    const request = describeRemoval(doc, 'material', materialId)

    expect(request).not.toBeNull()
    expect(request!.referenceCount, '三个 mesh 都指着它').toBe(3)
    // 卡面点名的那个「3」。一句「该材质正在被使用」既不可验也帮不上忙。
    expect(request!.question).toContain('3')
    expect(request!.question).toContain('不锈钢')
    expect(request!.question).toContain('回到默认材质')
    // 名字是给用户的锚点：他要能认出被波及的是哪几个。
    expect(request!.referenceNames.length).toBeGreaterThan(0)
    for (const name of request!.referenceNames) expect(request!.question).toContain(name)
    expect(request!.blocked, '被引用的材质照样可以删').toBeNull()
  })

  it('② 没人用的材质：文案说清「没有对象在使用它」', () => {
    const base = createGoldenPathDocument()
    const lonely = createMaterial({ name: '临时材质', ctx: defaultFactoryContext })
    const doc: SceneDocument = { ...base, materials: [...base.materials, lonely] }

    const request = describeRemoval(doc, 'material', lonely.id)
    expect(request!.referenceCount).toBe(0)
    expect(request!.question).toContain('没有对象在使用它')
    expect(request!.blocked).toBeNull()
  })

  it('③ 默认材质：不可删，且原因说清它是别人的落点', () => {
    const doc = createGoldenPathDocument()
    const draft: SceneDocument = { ...doc, materials: [...doc.materials] }
    const defaultId = ensureDefaultMaterial(draft, defaultFactoryContext)

    const request = describeRemoval(draft, 'material', defaultId)
    expect(request!.blocked, '默认材质删不得').not.toBeNull()
    // 删了它，下一次回落无处可去；而 ensureDefaultMaterial 会立刻重建一条，
    // 用户看到的是「删了又冒出来」。
    expect(request!.question).toContain('回落目标')
    expect(request!.question).toBe(request!.blocked)
    expect(request!.subtree, '拦住了就不该给出任何待删 id').toEqual([])
  })

  it('目标不存在时返回 null，不抛', () => {
    const doc = createGoldenPathDocument()
    expect(describeRemoval(doc, 'material', 'mat_00000000')).toBeNull()
    expect(describeRemoval(doc, 'asset', 'ast_00000000')).toBeNull()
    expect(describeRemoval(doc, 'node', 'nd_00000000')).toBeNull()
  })
})

describe('T-257 · 删一条被 3 个 mesh 共用的材质', () => {
  it('三个节点回落到默认材质，且 checkIntegrity 零 error', () => {
    const { doc, materialId } = sharedMaterialDocument()
    const store = createDocumentStore(doc, { now: () => 0 })
    const request = describeRemoval(store.getState().doc, 'material', materialId)!

    store.getState().commit(`删除材质 ${request.name}`, (draft) => {
      const fallback = ensureDefaultMaterial(draft, defaultFactoryContext)
      for (const node of draft.nodes) {
        if (node.overrides.materialId === request.id) node.overrides.materialId = fallback
      }
      const at = draft.materials.findIndex((m) => m.id === request.id)
      if (at >= 0) draft.materials.splice(at, 1)
    })

    const after = store.getState().doc
    const fallbackId = after.materials.find((m) => m.name === DEFAULT_MATERIAL_NAME)?.id
    expect(fallbackId, '落点应当存在').toBeDefined()
    expect(after.materials.some((m) => m.id === materialId), '那条材质没了').toBe(false)

    for (const nodeId of [PUMP, BODY, COVER]) {
      expect(after.nodes.find((n) => n.id === nodeId)!.overrides.materialId, nodeId).toBe(fallbackId)
    }
    // 这一条才是关键。只断言「材质少了一条」的话，一个不回落的实现同样绿，
    // 而它留下的是三条悬空引用。
    expect(errorsOf(checkIntegrity(after)), '删完仍然是一份完整的文档').toHaveLength(0)
  })

  it('一次删除一条撤销，撤销之后三个节点指回原材质', () => {
    const { doc, materialId } = sharedMaterialDocument()
    const store = createDocumentStore(doc, { now: () => 0 })
    store.getState().commit('删除材质 不锈钢', (draft) => {
      const fallback = ensureDefaultMaterial(draft, defaultFactoryContext)
      for (const node of draft.nodes) {
        if (node.overrides.materialId === materialId) node.overrides.materialId = fallback
      }
      draft.materials.splice(
        draft.materials.findIndex((m) => m.id === materialId),
        1,
      )
    })
    expect(store.getState().historyDepth).toBe(1)

    store.getState().undo()
    const back = store.getState().doc
    expect(back.materials.some((m) => m.id === materialId)).toBe(true)
    for (const nodeId of [PUMP, BODY, COVER]) {
      expect(back.nodes.find((n) => n.id === nodeId)!.overrides.materialId).toBe(materialId)
    }
  })
})

describe('T-257 · 删资产', () => {
  it('被引用的贴图：被拒，且中文原因说清被谁引用', () => {
    const doc = withAsset(createGoldenPathDocument(), 'ast_tex00001', '铭牌贴图', true)
    const request = describeRemoval(doc, 'asset', 'ast_tex00001')

    expect(request!.blocked, '还有人指着它，不许删').not.toBeNull()
    expect(request!.referenceCount).toBeGreaterThan(0)
    expect(request!.question).toContain('无法删除')
    expect(request!.question).toContain('铭牌贴图')
    // 「无法删除」不带下一步就是死路一条。
    expect(request!.question).toContain('再回来删它')
    expect(request!.subtree).toEqual([])
  })

  it('无人引用的贴图：可以删，且文案点明它不会再进发布包', () => {
    const doc = withAsset(createGoldenPathDocument(), 'ast_tex00002', '没人用的贴图', false)
    const request = describeRemoval(doc, 'asset', 'ast_tex00002')

    expect(request!.blocked).toBeNull()
    expect(request!.referenceCount).toBe(0)
    expect(request!.question).toContain('发布包')
    expect(request!.subtree).toEqual(['ast_tex00002'])
  })

  it('删掉之后文档里不再有那条记录，且仍然干净', () => {
    // 「`.w3p` 里不再有它的字节」由 `package.test.ts` 守着（T-233 起打包只写被引用的资产）。
    // 这里能断的、也是本卡真正负责的，是那条记录确实从文档里消失了。
    const doc = withAsset(createGoldenPathDocument(), 'ast_tex00002', '没人用的贴图', false)
    const store = createDocumentStore(doc, { now: () => 0 })
    store.getState().commit('删除资产 没人用的贴图', (draft) => {
      draft.assets.splice(
        draft.assets.findIndex((a) => a.id === 'ast_tex00002'),
        1,
      )
    })

    const after = store.getState().doc
    expect(after.assets.some((a) => a.id === 'ast_tex00002')).toBe(false)
    expect(after.assets.length, '别的资产不许被波及').toBe(doc.assets.length - 1)
    expect(errorsOf(checkIntegrity(after))).toHaveLength(0)
  })

  it('引用消失之后，同一个 id 就从「不能删」变成「能删」', () => {
    // 对话框重新推导而不是拍快照，为的就是这一种情形。
    const referenced = withAsset(createGoldenPathDocument(), 'ast_tex00001', '铭牌贴图', true)
    expect(describeRemoval(referenced, 'asset', 'ast_tex00001')!.blocked).not.toBeNull()

    const freed: SceneDocument = { ...referenced, nodes: referenced.nodes.filter((n) => n.id !== COVER) }
    expect(describeRemoval(freed, 'asset', 'ast_tex00001')!.blocked).toBeNull()
  })
})

describe('T-257 · 节点那一支跟着搬进来，行为不变', () => {
  it('被引用的节点仍然是「引用会失效」那句话', () => {
    const request = describeRemoval(createGoldenPathDocument(), 'node', COVER)
    expect(request!.question).toContain('引用会失效')
    expect(request!.blocked, '节点从来都是照删的').toBeNull()
  })

  it('有子节点时说清会连带删掉几个 —— 而且子节点不算「会失效的引用」', () => {
    // 本卡修掉的一处死分支：每个子节点都通过 `parent` 指着父节点，所以原来那句
    // 「将同时删除 N 个子对象」永远走不到，用户看到的一律是「被 N 个对象引用」——
    // 读起来像外部依赖要断，而那 N 个正跟着一起被删。
    const request = describeRemoval(createGoldenPathDocument(), 'node', PUMP)
    expect(request!.subtree.length).toBeGreaterThan(1)
    expect(request!.question).toContain(`${request!.subtree.length - 1} 个子对象`)
    expect(request!.referenceCount, '两个子节点不该被数成外部引用').toBe(0)
  })

  it('外部引用与子节点同时存在时，两句话都说', () => {
    // 泵组本来只有两个子节点、零外部引用（上一条断的就是这个）。把热点挂到泵组身上，
    // 它才同时具备两种情形。
    const base = createGoldenPathDocument()
    const both: SceneDocument = {
      ...base,
      hotspots: base.hotspots.map((h) => ({ ...h, anchor: { ...h.anchor, nodeId: PUMP } })),
    }
    const request = describeRemoval(both, 'node', PUMP)
    expect(request!.question).toContain('2 个子对象')
    expect(request!.question).toContain('引用会失效')
    expect(request!.question).toContain('个热点')
    expect(request!.referenceCount, '热点是货真价实的外部引用').toBe(1)
  })
})
