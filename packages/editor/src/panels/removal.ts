import type { SceneDocument } from '@w3/schema'
import { DEFAULT_MATERIAL_NAME, buildIndex, describeReferences, getSubtreeIds, referencesTo } from '@w3/schema'

/**
 * T-257 · 「删这个东西之前，先说清会发生什么」——三种目标共用的一份纯函数。
 *
 * ## 这张卡为什么存在
 *
 * 「删材质 / 删资产」在 13 份领域设计里**零命中**。节点有删除入口，材质与资产没有。
 * 样板工程要求 16 个零件 + 4 条材质 + 内置纹理，用户建错一条材质就永远删不掉，
 * 而 `.w3p` 会一直带着那张贴图的字节——文件白白胖一圈，且谁也说不清为什么。
 *
 * ## 材质与资产的处置是**相反**的，这是本文件最重要的一条
 *
 * - **材质被引用时照删**，引用它的节点回落到默认材质。理由：有一个安全的落点。
 *   删完仍然是一份完整可渲染的文档，`checkIntegrity` 零 error。
 * - **资产被引用时拒绝删**。理由：**没有落点**。一个网格的源资产没了，节点要么变成
 *   空壳、要么静默换成别的模型；一张贴图没了，材质的外观会无声地变掉。两种都是
 *   「文档还合法、画面已经错了」，而那正是最难归因的一类缺陷。
 *
 * 不对称是有意的，不是遗漏。把它写在这里，是因为下一个读代码的人第一反应一定是
 * 「为什么不统一」。
 */

/** 能删的三种东西。节点那一支是 T-063 就有的，本卡把它并进同一个函数。 */
export type RemovalKind = 'node' | 'material' | 'asset'

export interface RemoveRequest {
  readonly kind: RemovalKind
  readonly id: string
  readonly name: string
  /** 确认框里的问句，或者被拒时的原因。**中文，且带具体数字。** */
  readonly question: string
  /** 真正会被删掉的 id。节点是整棵子树；材质与资产只有它自己。 */
  readonly subtree: readonly string[]
  /** 有多少个东西指着它。0 = 没人用。 */
  readonly referenceCount: number
  /** 前三个引用者的名字，给用户一个「哦是那几个」的锚点。 */
  readonly referenceNames: readonly string[]
  /**
   * 非 null = **不能删**，这一串就是中文原因。
   *
   * 调用方必须把确认按钮禁掉。`question` 在这种情况下与它同值——让一个只显示
   * `question` 的对话框也不至于说错话。
   */
  readonly blocked: string | null
}

/** 名字里最多列几个引用者。三个之后换成「等 N 个」。 */
const MAX_NAMED = 3

/**
 * 删除前的那句话，以及删除真正会波及的范围。
 *
 * 是 `(doc, kind, id)` 的函数而不是点下 ✕ 那一刻拍的快照：待删 id 存在 UI 层，
 * 文档存在文档 store，重新推导才能保证对话框开着的时候文档变了，问句跟着变。
 *
 * @returns 目标不存在时返回 `null`——不抛：这个函数会被渲染路径调用，而待删目标
 *   随时可能已经被撤销拿掉了。
 */
export function describeRemoval(doc: SceneDocument, kind: RemovalKind, id: string): RemoveRequest | null {
  const index = buildIndex(doc)
  const refs = referencesTo(index, id)
  const referenceCount = new Set(refs.map((r) => r.from.id)).size
  const referenceNames = namesOf(doc, refs.map((r) => r.from.id)).slice(0, MAX_NAMED)

  if (kind === 'node') {
    const name = doc.nodes.find((n) => n.id === id)?.name
    if (name === undefined) return null
    const subtree = getSubtreeIds(doc, id)

    // ⚠ **子节点不算「会失效的引用」。** 每个子节点都通过 `parent` 指着它，所以
    // `describeReferences` 会把它们数进去——一个 20 个零件的分组因此被描述成
    // 「被 20 个对象引用，删除后这些引用会失效」，读起来像是外部依赖要断，而实际上
    // 那 20 个正跟着一起被删。**副作用是原来那句「将同时删除 N 个子对象」永远走不到**：
    // 任何有子节点的节点都必然有入边，三元的第一支恒真。本卡把子树内的引用剔掉，
    // 那一支才真的可达。
    const inside = new Set(subtree)
    const outside = refs.filter((r) => !inside.has(r.from.id))
    const outsideCount = new Set(outside.map((r) => r.from.id)).size
    const outsideNames = namesOf(doc, outside.map((r) => r.from.id)).slice(0, MAX_NAMED)
    const breaks = describeReferences(index, id, inside)

    // T-092 · 反向索引在删除**之前**回答「删了会坏什么」，而不是等验收时发现规则断了。
    const withChildren = subtree.length > 1 ? `将同时删除「${name}」及其 ${subtree.length - 1} 个子对象。` : ''
    const question = breaks
      ? `${withChildren}「${name}」被 ${breaks} 引用，删除后这些引用会失效。确认删除？`
      : withChildren
        ? `${withChildren}确认？`
        : `确认删除「${name}」？`
    return { kind, id, name, question, subtree, referenceCount: outsideCount, referenceNames: outsideNames, blocked: null }
  }

  if (kind === 'material') {
    const material = doc.materials.find((m) => m.id === id)
    if (!material) return null
    // 默认材质是所有回落的落点。删掉它，下一次回落就没地方去了——而且它会被
    // `ensureDefaultMaterial` 立刻重建一条新的，用户看到的是「删了又冒出来」。
    if (material.name === DEFAULT_MATERIAL_NAME) {
      const reason = `「${material.name}」是删除其他材质时的回落目标，不能删除。`
      return { kind, id, name: material.name, question: reason, subtree: [], referenceCount, referenceNames, blocked: reason }
    }
    const question =
      referenceCount === 0
        ? `确认删除材质「${material.name}」？没有对象在使用它。`
        : `材质「${material.name}」正被 ${referenceCount} 个对象使用（${listNames(referenceNames, referenceCount)}），` +
          `删除后它们会回到默认材质。确认删除？`
    return { kind, id, name: material.name, question, subtree: [id], referenceCount, referenceNames, blocked: null }
  }

  const asset = doc.assets.find((a) => a.id === id)
  if (!asset) return null
  if (referenceCount > 0) {
    // 拒绝而不是回落：见文件头。资产没有安全落点。
    const reason =
      `资产「${asset.name}」正被 ${referenceCount} 处引用（${listNames(referenceNames, referenceCount)}），无法删除。` +
      `请先删除或改指这些引用，再回来删它。`
    return { kind: 'asset', id, name: asset.name, question: reason, subtree: [], referenceCount, referenceNames, blocked: reason }
  }
  return {
    kind: 'asset',
    id,
    name: asset.name,
    question: `确认删除资产「${asset.name}」？没有对象在引用它，它的字节也不会再进发布包。`,
    subtree: [id],
    referenceCount,
    referenceNames,
    blocked: null,
  }
}

/** 「泵体、阀盖、机封 等 5 个」。少于等于三个时不加「等 N 个」。 */
function listNames(names: readonly string[], total: number): string {
  if (names.length === 0) return '未命名'
  return total > names.length ? `${names.join('、')} 等 ${total} 个` : names.join('、')
}

/** 一批 id 各自的名字，去重且保持出现顺序。 */
function namesOf(doc: SceneDocument, ids: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const named =
      doc.nodes.find((n) => n.id === id) ??
      doc.materials.find((m) => m.id === id) ??
      doc.animations.find((a) => a.id === id) ??
      doc.hotspots.find((h) => h.id === id) ??
      doc.rules.find((r) => r.id === id)
    // 场景设置这类没有 id 的引用方，`describeReferences` 已经数进去了，这里给个可读的替身。
    out.push(named?.name ?? '场景设置')
  }
  return out
}
