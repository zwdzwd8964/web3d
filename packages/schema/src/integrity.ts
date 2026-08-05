import { explodeOffsets } from './explode-math.js'
import { ID_COLLECTIONS, ID_COLLECTION_NAMES } from './document.js'
import type { SceneDocument } from './document.js'
import type { ActionRefResolver, RefTarget } from './index-builder.js'
import { PHYSICAL_ONLY_PARAMS } from './material.js'
import type { Condition, Rule, ValueExpr } from './rule.js'
import { getUnreachableNodes } from './selectors.js'
import { isValueOfType } from './variable.js'

/**
 * SCHEMA_SPEC §9 · reference and logic integrity. Zod answers "is the shape right";
 * this answers "does any of it actually resolve".
 *
 * Three levels, and the distinction is load-bearing:
 *   error — publishing is blocked (MVP_V0 D8). The document describes something
 *           impossible.
 *   warn  — shown, never blocking. An orphaned assetRef after a re-import is the
 *           canonical case: the user's rules, materials and hotspots on that node are
 *           still valuable, and deleting their work is not an acceptable response to a
 *           model whose node names changed (§5.3).
 *   info  — an observation, e.g. an animation nothing ever triggers.
 */

export type IntegrityLevel = 'error' | 'warn' | 'info'

export interface IntegrityIssue {
  /** The SCHEMA_SPEC §9 check id: I1 … I10. */
  readonly code: string
  readonly level: IntegrityLevel
  /** Bracketed document path, e.g. `rules[0].when`. */
  readonly path: string
  readonly message: string
  readonly refKind?: string
  readonly refId?: string
}

export interface CheckIntegrityOptions {
  /**
   * Resolves the ids inside an action's `params`. Supplied by core, whose action
   * registry is the only place that knows what a given action's params mean.
   * Without it, I3/I8/I9 cannot see into action parameters — and this module says so
   * (`I3-actions-unchecked`) rather than reporting a clean bill of health it did not earn.
   */
  readonly actionRefs?: ActionRefResolver
}

/**
 * Chinese labels for every kind a reference can name.
 *
 * T-201 · derived from `ID_COLLECTIONS` rather than hand-copied. It used to be a literal
 * whose nine entries had to be kept in step with a separate eleven-entry I1 table and a
 * separate eight-entry `sets` — three lists, no mechanical relationship, and a label
 * silently falling back to the English kind name when one of them was missed.
 *
 * `step` is added on top because it is the one referenceable kind that is not a top-level
 * collection: steps live inside a flow. It is listed here explicitly rather than derived
 * from `nested`, because `nested` records where ids live, not what a `RefKind` is called —
 * conflating the two would make `overlays` look like a reference kind, which it is not.
 */
/**
 * 注册表推不出来的四个引用种类。
 *
 * `ID_COLLECTIONS` 的 `refKind` 记的是「v2 时谁会被指」——`pages` / `flows` 当时是
 * `null`，因为那会儿没有任何字段指向它们。v3 之后不成立了：`overlay.props.flowId` 指
 * 流程（I41）、`pageEnter.pageId` 指页面、`overlayClick.overlayId` 指覆盖层，而 `step`
 * 从来就不是顶层集合。
 *
 * **写在这里而不是去改注册表的 `refKind`**：那个字段同时被 `selectors` / `remap` /
 * `index-builder` 读，改它是 T-227 的活，本卡只独占 `integrity.ts`。两处都要改的东西
 * 分两张卡改，比一张卡越界改两处安全。
 */
const EXTRA_REF_KINDS = {
  page: { label: '页面', ids: (doc: SceneDocument) => doc.pages.map((p) => p.id) },
  flow: { label: '流程', ids: (doc: SceneDocument) => doc.flows.map((f) => f.id) },
  overlay: { label: '覆盖层', ids: (doc: SceneDocument) => doc.pages.flatMap((p) => p.overlays.map((o) => o.id)) },
  step: { label: '流程步骤', ids: (doc: SceneDocument) => doc.flows.flatMap((f) => f.steps.map((st) => st.id)) },
} as const

const KIND_LABEL: Record<string, string> = {
  ...Object.fromEntries(
    ID_COLLECTION_NAMES.map((name) => ID_COLLECTIONS[name])
      .filter((spec) => spec.refKind !== null)
      .map((spec) => [spec.refKind, spec.label]),
  ),
  ...Object.fromEntries(Object.entries(EXTRA_REF_KINDS).map(([kind, spec]) => [kind, spec.label])),
}

export function checkIntegrity(doc: SceneDocument, options: CheckIntegrityOptions = {}): IntegrityIssue[] {
  const issues: IntegrityIssue[] = []
  const add = (
    code: string,
    level: IntegrityLevel,
    path: string,
    message: string,
    ref?: { kind: string; id: string },
  ) => {
    issues.push({ code, level, path, message, ...(ref ? { refKind: ref.kind, refId: ref.id } : {}) })
  }

  // T-201 · one derivation, not a second hand-written list. A collection whose `refKind` is
  // null contributes nothing: nothing in the document points at a rule, a page or a flow.
  const sets: Record<string, Set<string>> = {}
  for (const name of ID_COLLECTION_NAMES) {
    const spec = ID_COLLECTIONS[name]
    if (spec.refKind === null) continue
    sets[spec.refKind] = new Set(doc[name].map((record) => record.id))
  }
  // 与 KIND_LABEL 同一张表推出来。
  //
  // **`step` 之前只有 label 没有 set**，于是任何一条 step 引用走到 `requireRef` 都会
  // 撞上 `sets['step'] === undefined` → `?.` 短路 → **必报 error**。那不是「永远通过」，
  // 是「永远误报」，而 v1.0 之前没有任何字段指向 step，所以它一次都没被触发过。
  for (const [kind, spec] of Object.entries(EXTRA_REF_KINDS)) {
    sets[kind] = new Set(spec.ids(doc))
  }

  const requireRef = (code: string, kind: string, id: string | null | undefined, path: string) => {
    if (id == null) return
    if (!sets[kind]?.has(id)) {
      add(code, 'error', path, `引用了不存在的${KIND_LABEL[kind] ?? kind}：${id}`, { kind, id })
    }
  }

  /**
   * 四张索引，**一次建好**。
   *
   * 原来每处需要「按 id 取一条记录」都写 `doc.assets.find(...)`，而这些地方分别嵌在
   * 「每个材质的每个贴图槽」「每个视点」「每条动画」的循环里——于是 assets 这根轴上
   * 是真二次的。规划 §4.2 点名了它，T-226 的多轴 scale 测试把它量了出来：
   * assets 轴增长 3.639、variables 轴 3.887（线性应当是 2）。
   */
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]))
  const assetById = new Map(doc.assets.map((a) => [a.id, a]))
  const mediaById = new Map(doc.media.map((m) => [m.id, m]))
  const variableById = new Map(doc.variables.map((v) => [v.id, v]))
  /** 父 id → 子节点，按 `order` 升序。I21 / I22 / I24 都要它。 */
  const childrenOf = new Map<string, typeof doc.nodes[number][]>()
  for (const n of doc.nodes) {
    if (n.parent === null) continue
    const list = childrenOf.get(n.parent)
    if (list) list.push(n)
    else childrenOf.set(n.parent, [n])
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.order - b.order)

  /**
   * v3 · a node's own "type", by a **priority ladder**.
   *
   * `assetRef` / `primitive` / `light` / `section` 至多一个非空（I11），而 `explode`
   * 与它们正交——一个爆炸分组通常没有任何承载体。阶梯顺序 section > explodeGroup >
   * light > node 是规划 §4.1.1 逐字定的。
   *
   * **它不是装饰**：`RefTarget.expectType` 的整条链都靠它。让 node 永远返回 `'node'`
   * 会让 I28（`explode` 动作指向一个没有 explode 配置的节点）形同虚设，而那正是 T-176
   * 那条存活 blocker 的形状。
   */
  const typeOf = (kind: string, id: string): string | undefined => {
    if (kind === 'asset') return assetById.get(id)?.type
    if (kind === 'media') return mediaById.get(id)?.type
    if (kind === 'node') {
      const node = nodeById.get(id)
      if (!node) return undefined
      if (node.section !== null) return 'section'
      if (node.explode !== null) return 'explodeGroup'
      if (node.light !== null) return 'light'
      return 'node'
    }
    return undefined
  }

  /**
   * v2 · enforces a `RefTarget.expectType` constraint reported by the action resolver.
   *
   * Silent when the id does not resolve (requireRef already said so — two errors about
   * one typo is noise) and when the kind has no `type` of its own.
   */
  const requireType = (code: string, target: { kind: string; id: string; expectType?: string }, by: string, path: string) => {
    if (!target.expectType) return
    const actual = typeOf(target.kind, target.id)
    if (actual === undefined || actual === target.expectType) return
    const label = KIND_LABEL[target.kind] ?? target.kind
    add(code, 'error', path, `动作「${by}」只能引用 ${target.expectType} 类型的${label}，实际是 ${actual}`, {
      kind: target.kind,
      id: target.id,
    })
  }

  /* --- I1 · ids unique within each collection ---------------------------- */
  // T-201 · driven by the registry, so a collection added in T-225 is checked the day it is
  // registered. The literal this replaced is the reason `pages` and `flows` went two whole
  // versions with no I1 coverage at all: they were added to the document and to nothing else.
  const collections: [string, readonly { id: string }[]][] = ID_COLLECTION_NAMES.map((name) => [name, doc[name]])
  for (const [name, items] of collections) {
    const first = new Map<string, number>()
    items.forEach((item, i) => {
      const at = first.get(item.id)
      if (at !== undefined) add('I1', 'error', `${name}[${i}].id`, `id 重复：${item.id}（首次出现在 ${name}[${at}]）`)
      else first.set(item.id, i)
    })
  }
  for (const [i, flow] of doc.flows.entries()) {
    const first = new Map<string, number>()
    flow.steps.forEach((step, j) => {
      const at = first.get(step.id)
      if (at !== undefined) add('I1', 'error', `flows[${i}].steps[${j}].id`, `流程步骤 id 重复：${step.id}`)
      else first.set(step.id, j)
    })
  }

  /* --- I2 · parent resolves, and the parent chain is acyclic -------------- */
  const parentOf = new Map<string, string | null>()
  doc.nodes.forEach((node, i) => {
    parentOf.set(node.id, node.parent)
    if (node.parent === node.id) {
      add('I2', 'error', `nodes[${i}].parent`, `对象不能是自己的父级：${node.id}`, { kind: 'node', id: node.id })
    } else {
      requireRef('I2', 'node', node.parent, `nodes[${i}].parent`)
    }
  })

  // Colour-marking DFS so an N-node loop is reported once, not N times.
  const state = new Map<string, 1 | 2>()
  const reportedCycle = new Set<string>()
  for (const node of doc.nodes) {
    if (state.get(node.id) === 2) continue
    const stack: string[] = []
    let cursor: string | null = node.id
    while (cursor != null && state.get(cursor) !== 2) {
      if (state.get(cursor) === 1) {
        if (!reportedCycle.has(cursor)) {
          const loop = stack.slice(stack.indexOf(cursor))
          for (const id of loop) reportedCycle.add(id)
          add('I2', 'error', 'nodes', `父子关系成环：${[...loop, cursor].join(' -> ')}`, { kind: 'node', id: cursor })
        }
        break
      }
      state.set(cursor, 1)
      stack.push(cursor)
      cursor = parentOf.has(cursor) ? (parentOf.get(cursor) ?? null) : null
    }
    for (const id of stack) state.set(id, 2)
  }

  /* --- I3 · every reference resolves -------------------------------------- */
  doc.assets.forEach((asset, i) => {
    if (asset.lineageId !== asset.id) requireRef('I3', 'asset', asset.lineageId, `assets[${i}].lineageId`)
    if (asset.version === 1 && asset.lineageId !== asset.id) {
      add('I3', 'warn', `assets[${i}].lineageId`, `version 为 1 的资产其 lineageId 应等于自身 id`)
    }
  })

  doc.nodes.forEach((node, i) => {
    if (node.assetRef) requireRef('I3', 'asset', node.assetRef.assetId, `nodes[${i}].assetRef.assetId`)
    requireRef('I3', 'material', node.overrides.materialId, `nodes[${i}].overrides.materialId`)
  })

  // Existence only; the slot's ASSET TYPE is I13's job (v2) and is stricter than the
  // check that used to live here — it accepted `image` as well, and v0.5 splits the two
  // deliberately: `texture` is what a material samples, `image` is what a media record
  // shows (SCHEMA_SPEC §6.7). Two checks with two different rules on one field is how a
  // reviewer ends up unable to say which one is the rule.
  doc.materials.forEach((material, i) => {
    for (const [slot, assetId] of Object.entries(material.params.maps)) {
      if (assetId == null) continue
      requireRef('I3', 'asset', assetId, `materials[${i}].params.maps.${slot}`)
    }
  })

  doc.hotspots.forEach((hotspot, i) => {
    requireRef('I3', 'node', hotspot.anchor.nodeId, `hotspots[${i}].anchor.nodeId`)
    requireRef('I3', 'media', hotspot.content.mediaId, `hotspots[${i}].content.mediaId`)
  })

  doc.media.forEach((media, i) => requireRef('I3', 'asset', media.assetId, `media[${i}].assetId`))

  doc.flows.forEach((flow, i) => {
    requireRef('I3', 'variable', flow.variableId, `flows[${i}].variableId`)
    const stepIds = new Set(flow.steps.map((s) => s.id))
    flow.steps.forEach((step, j) => {
      if (step.next != null && !stepIds.has(step.next)) {
        add('I3', 'error', `flows[${i}].steps[${j}].next`, `指向了不存在的流程步骤：${step.next}`, {
          kind: 'step',
          id: step.next,
        })
      }
      // T-226 ③ · **onEnter 里的动作引用同样要过解析器。**
      //
      // 「这些动作不会被执行」（I49）与「这些动作引用了一个不存在的对象」是两件事。
      // 后者今天完全没人查：`options.actionRefs` 只在 `rules[].then` 那个循环里被调用，
      // 而 onEnter 是文档里第二个能藏动作参数的地方。一份 v1.2 的文档在 v1.0 编辑器里
      // 删掉一个节点，onEnter 里指向它的引用会静默悬空到 v1.2 通电那天。
      //
      // 按 X-14 的裁决**仍然遍历**——字段永不获得运行时，不代表它可以藏着坏引用。
      if (options.actionRefs) {
        step.onEnter.forEach((action, k) => {
          for (const target of options.actionRefs!(action)) {
            requireRef('I3', target.kind, target.id, `flows[${i}].steps[${j}].onEnter[${k}].params`)
          }
        })
      }

      // I49 · `onEnter` 配了动作但永不执行（ADR-0035）。
      //
      // **warn 不是 error**：C4 说一份能打开的文档永远要能打开，而这个字段自 v0 就在
      // schema 里，报 error 等于让一份合法保存过的文档打不开。
      //
      // 文案必须写出替代路径。只说「不执行」是告诉用户他错了却不告诉他怎么办，而这条
      // warn 的全部价值就在那半句上。
      if (step.onEnter.length > 0) {
        add(
          'I49',
          'warn',
          `flows[${i}].steps[${j}].onEnter`,
          `流程「${flow.name}」的步骤「${step.name}」配了 ${step.onEnter.length} 个进入动作，` +
            `但 v1 不执行它们（ADR-0035）。请改用 flowStepEnter 规则表达同一件事`,
          { kind: 'step', id: step.id },
        )
      }
    })
  })

  /* --- I6 · animations ----------------------------------------------------- */
  doc.animations.forEach((animation, i) => {
    if (animation.kind === 'imported') {
      requireRef('I3', 'asset', animation.assetId, `animations[${i}].assetId`)
      const asset = assetById.get(animation.assetId)
      if (asset && asset.type !== 'model') {
        add('I3', 'error', `animations[${i}].assetId`, `导入动画必须来自模型资产（当前 type=${asset.type}）`)
      }
      if (asset && asset.stats.animations.length > 0 && !asset.stats.animations.includes(animation.clipName)) {
        add('I6', 'error', `animations[${i}].clipName`, `资产「${asset.name}」中不存在名为「${animation.clipName}」的动画片段`)
      }
    } else {
      if (animation.targets.length === 0) {
        add('I6', 'error', `animations[${i}].targets`, '补间动画必须至少有一个目标对象')
      }
      animation.targets.forEach((t, j) => requireRef('I6', 'node', t.nodeId, `animations[${i}].targets[${j}].nodeId`))
    }
  })

  /* --- I5 · enum variables ------------------------------------------------- */
  doc.variables.forEach((variable, i) => {
    if (variable.type === 'enum') {
      if (!variable.options || variable.options.length === 0) {
        add('I5', 'error', `variables[${i}].options`, `枚举变量「${variable.id}」必须提供 options`)
      } else if (typeof variable.default !== 'string' || !variable.options.includes(variable.default)) {
        add('I5', 'error', `variables[${i}].default`, `枚举变量「${variable.id}」的默认值不在 options 中`)
      }
    } else if (!isValueOfType(variable.default, variable.type)) {
      add('I5', 'error', `variables[${i}].default`, `变量「${variable.id}」声明为 ${variable.type}，默认值类型不匹配`)
    }
  })

  /* --- I4 / I8 · rules ----------------------------------------------------- */
  const missingNodeIds = new Set(doc.nodes.filter((n) => n.assetRef?.missing === true).map((n) => n.id))
  const referencedAnimations = new Set<string>()

  doc.rules.forEach((rule, i) => {
    checkRuleRefs(rule, `rules[${i}]`, requireRef)
    checkRuleConditionTypes(rule, `rules[${i}]`, doc, add, variableById)

    if (rule.when.event === 'animationEnd') referencedAnimations.add(rule.when.animationId)
    for (const cond of [...rule.if, ...rule.ifAny]) {
      if (cond.op === 'isPlaying') referencedAnimations.add(cond.animationId)
    }

    if (options.actionRefs) {
      rule.then.forEach((action, j) => {
        for (const target of options.actionRefs!(action)) {
          requireRef('I3', target.kind, target.id, `rules[${i}].then[${j}].params`)
          // I14, third clause · the referrer may constrain the target's own `type`.
          // Reported here rather than in the I14 block below because only this loop has
          // the action that imposed the constraint, and naming it is what makes the
          // message actionable ("playMedia 只能播放音频" beats "类型不匹配").
          requireType('I14', target, action.action, `rules[${i}].then[${j}].params`)
          if (target.kind === 'animation') referencedAnimations.add(target.id)
          if (rule.enabled && target.kind === 'node' && missingNodeIds.has(target.id)) {
            add(
              'I8',
              'warn',
              `rules[${i}].then[${j}]`,
              `规则「${rule.name}」引用了资产映射已失效的对象，运行时该步骤会被跳过`,
              { kind: 'node', id: target.id },
            )
          }
        }
      })
    }
  })

  if (!options.actionRefs && doc.rules.some((r) => r.then.length > 0)) {
    add(
      'I3-actions-unchecked',
      'info',
      'rules',
      '未提供动作参数解析器，规则动作内的引用未被检查（由 @w3/core 的动作注册表提供）',
    )
  }

  /* --- I7 · orphaned asset references ------------------------------------- */
  doc.nodes.forEach((node, i) => {
    if (node.assetRef?.missing === true) {
      add(
        'I7',
        'warn',
        `nodes[${i}].assetRef`,
        `对象「${node.name}」在资产中已找不到对应物体（${node.assetRef.objectPath}），需人工重新指定。配置已保留。`,
        { kind: 'asset', id: node.assetRef.assetId },
      )
    }
  })

  /* --- I9 · animations nothing ever triggers ------------------------------- */
  if (options.actionRefs) {
    doc.animations.forEach((animation, i) => {
      if (!referencedAnimations.has(animation.id)) {
        add('I9', 'info', `animations[${i}]`, `动画「${animation.name}」未被任何规则引用`)
      }
    })
  }

  /* --- I10 · unreachable nodes --------------------------------------------- */
  for (const node of getUnreachableNodes(doc)) {
    const i = doc.nodes.findIndex((n) => n.id === node.id)
    add('I10', 'error', `nodes[${i}]`, `对象「${node.name}」的父级链无法回到根节点，它不会出现在场景中`, {
      kind: 'node',
      id: node.id,
    })
  }

  /* ======================================================================== */
  /* v2 增量 · I11 – I15（v0.5 进化规划 §4.2）                                 */
  /* ======================================================================== */

  /* --- I11 · at most one carrier per node ---------------------------------- */
  // The rule the schema deliberately does NOT express as a zod union: a union would make
  // the field layout depend on the carrier, and D1's patch dispatch reads
  // `/nodes/3/light/intensity` as a stable path (SCHEMA_SPEC §4.1-6).
  doc.nodes.forEach((node, i) => {
    const carriers: string[] = []
    if (node.assetRef !== null) carriers.push('assetRef')
    if (node.primitive !== null) carriers.push('primitive')
    if (node.light !== null) carriers.push('light')
    // v3 · section 是第四种承载体。**explode 不在这张名单里**：爆炸分组与承载体正交，
    // 一个分组节点通常什么都不承载，把它算进来会让每个带子件的分组都误报。
    if (node.section !== null) carriers.push('section')
    if (carriers.length > 1) {
      add(
        'I11',
        'error',
        `nodes[${i}]`,
        `对象「${node.name}」同时设置了 ${carriers.join(' 与 ')}：一个对象至多只能有一种承载体`,
        { kind: 'node', id: node.id },
      )
    }
  })

  /* --- I12 · environment reference and the background that depends on it ---- */
  const hdriId = doc.meta.environment.hdriAssetId
  if (hdriId != null) {
    requireRef('I12', 'asset', hdriId, 'meta.environment.hdriAssetId')
    const hdri = assetById.get(hdriId)
    if (hdri && hdri.type !== 'hdri') {
      add('I12', 'error', 'meta.environment.hdriAssetId', `环境贴图必须是 hdri 资产（当前 type=${hdri.type}）`, {
        kind: 'asset',
        id: hdriId,
      })
    }
  }
  if (doc.meta.background.type === 'hdri' && hdriId == null) {
    // Not a cosmetic mismatch: with no environment map there is nothing to draw as the
    // backdrop, so the scene publishes and then renders black with no error anywhere.
    add('I12', 'error', 'meta.background.type', '背景设为 hdri，但 meta.environment.hdriAssetId 为空，没有可用的环境贴图')
  }

  /* --- I13 · texture slots point at texture assets -------------------------- */
  doc.materials.forEach((material, i) => {
    for (const [slot, assetId] of Object.entries(material.params.maps)) {
      if (assetId == null) continue
      const asset = assetById.get(assetId)
      // Missing is I3's business; this check is only about the type of what IS there.
      if (asset && asset.type !== 'texture') {
        add('I13', 'error', `materials[${i}].params.maps.${slot}`, `贴图槽位必须引用 texture 资产（当前 type=${asset.type}）`, {
          kind: 'asset',
          id: assetId,
        })
      }
    }
  })

  /* --- I14 · media types line up ------------------------------------------- */
  // The third clause — "playMedia may only point at audio" — is enforced in the rules
  // loop above via `RefTarget.expectType`, because only there is the action that imposed
  // the constraint available to name in the message.
  doc.media.forEach((media, i) => {
    const asset = assetById.get(media.assetId)
    if (asset && asset.type !== media.type) {
      add('I14', 'error', `media[${i}].assetId`, `媒体声明为 ${media.type}，但引用的资产 type=${asset.type}`, {
        kind: 'asset',
        id: media.assetId,
      })
    }
  })

  doc.hotspots.forEach((hotspot, i) => {
    const mediaId = hotspot.content.mediaId
    if (mediaId == null) return
    const media = mediaById.get(mediaId)
    // Existence is I3's; if it is missing this stays quiet rather than piling on.
    if (media && media.type !== 'image' && media.type !== 'video') {
      add(
        'I14',
        'error',
        `hotspots[${i}].content.mediaId`,
        `热点面板只能展示图片或视频，「${media.name}」是 ${media.type}`,
        { kind: 'media', id: mediaId },
      )
    }
  })

  /* ======================================================================== */
  /* v3 增量 · I16 – I45（v1 进化规划 §4.2 · v1.0 段 30 条）                     */
  /*                                                                          */
  /* 分组：表现力 15（I16–I30）· 资产与动画区间 4（I31–I34）·                    */
  /*       引用与集合 8（I35–I42）· 嵌入 3（I43–I45）                            */
  /*                                                                          */
  /* ⚠ **I34 不在下面**：规划 §4.2 给「clipName 不在资产的 stats.animations 里」  */
  /*   分配了 I34，而这条检查自 v0.5 起就以 **I6** 存在（上面 animations 那一段， */
  /*   逐字同义）。加一条 I34 只会让同一个拼写错误报两遍 error。保留 I6，此处     */
  /*   记名不实现——**编号表与实现对不上时，对不上的那一条要被写下来，不是被补齐**。*/
  /* ======================================================================== */

  const fog = doc.meta.fog
  const outline = doc.meta.effects.outline

  /* --- I16 · 线性雾的 near/far 顺序 ----------------------------------------- */
  // 三个子句分开写而不是 &&：measured in v0.5 E18 —— 合成一个条件之后，
  // 「雾没开」和「雾开了但 near/far 反了」这两种情况共用一条断言，
  // 变异检验里把 enabled 那半删掉，测试照样绿。
  if (fog.enabled && fog.type === 'linear' && fog.near >= fog.far) {
    add(
      'I16',
      'error',
      'meta.fog',
      `线性雾的 near（${fog.near}）不小于 far（${fog.far}），远近颠倒后整个画面会被雾色填满`,
    )
  }

  /* --- I17 · 雾色与背景色不一致 --------------------------------------------- */
  if (fog.enabled && doc.meta.background.type === 'color' && fog.color.toLowerCase() !== doc.meta.background.color.toLowerCase()) {
    add(
      'I17',
      'info',
      'meta.fog.color',
      `雾色 ${fog.color} 与背景色 ${doc.meta.background.color} 不同，远处物体会淡入一个与画面底色不一样的颜色`,
    )
  }

  /* --- I18 / I19 / I20 · 描边开关与 highlight 预设的三种错配 ----------------- */
  //
  // 预设名按 `outline_` 前缀匹配，**不 import core 的预设表**：那张表住在 @w3/core，
  // 而 schema 不许依赖任何内部包（check-deps-direction）。前缀是两侧共同遵守的命名约定，
  // 由 core 的 highlight-presets.ts 保证。
  const highlightPresets = new Set<string>()
  let highlightActionCount = 0
  for (const rule of doc.rules) {
    for (const action of rule.then) {
      if (action.action !== 'highlight') continue
      highlightActionCount++
      const preset = action.params.preset
      if (typeof preset === 'string' && preset.length > 0) highlightPresets.add(preset)
    }
  }
  const outlinePresets = [...highlightPresets].filter((p) => p.startsWith('outline_'))

  if (!outline.enabled && outlinePresets.length > 0) {
    add(
      'I18',
      'info',
      'meta.effects.outline.enabled',
      `描边总开关是关的，但文档里有 ${outlinePresets.length} 种描边预设在用（${outlinePresets.join('、')}），它们会回落成自发光`,
    )
  }
  if (highlightPresets.size >= 3) {
    add(
      'I19',
      'info',
      'meta.effects.outline',
      `文档用到 ${highlightPresets.size} 种高亮预设，同一时刻最多 2 种能以描边呈现，第 3 种起回落自发光`,
    )
  }
  if (outline.enabled && highlightActionCount === 0) {
    add('I20', 'info', 'meta.effects.outline.enabled', '描边总开关开着，但全文档没有任何 highlight 动作，这条通道不会被用到')
  }

  /* --- I21 – I24 · 爆炸分组 -------------------------------------------------- */
  doc.nodes.forEach((node, i) => {
    if (node.explode !== null) {
      const children = childrenOf.get(node.id) ?? []

      /* I21 · 分组里没有可散开的东西 */
      if (children.length <= 1) {
        add(
          'I21',
          'warn',
          `nodes[${i}].explode`,
          `对象「${node.name}」配了爆炸分组，但它只有 ${children.length} 个子对象，散不开`,
          { kind: 'node', id: node.id },
        )
      }

      /* I22 · 径向模式下全部子件锚点重合 */
      if (node.explode.mode === 'radial' && children.length > 1) {
        // **问 `explodeOffsets` 而不是自己再算一遍质心。**
        //
        // 「锚点全部重合」在几何上就等于「径向派生位移全为零」——两种说法，一份实现。
        // 原来这里逐轴取 min/max 比 1e-6，是「散开怎么算」的第二份定义；两份定义一旦
        // 对不上（比如将来 radial 改成按包围盒中心而不是质心），这条检查会开始对着
        // 一个已经不成立的模型报警。
        //
        // 用派生值判定还顺带覆盖了一种 min/max 版看不见的情形：某个成员钉了
        // `explodeOffset`，那它就不该算进「散不开」——它有确定的去处。
        const derived = explodeOffsets(doc, node.id, children)
        const coincident = [...derived.values()].every((v) => Math.hypot(v[0], v[1], v[2]) < 1e-6)
        if (coincident) {
          add(
            'I22',
            'warn',
            `nodes[${i}].explode`,
            `「${node.name}」用径向模式，但 ${children.length} 个子件的锚点全部重合，径向散开没有方向可依。` +
              `建议改用轴向模式或为每个零件设置爆炸偏移`,
            { kind: 'node', id: node.id },
          )
        }
      }

      /* I23 · 轴向模式的零向量轴 */
      if (node.explode.mode === 'axis') {
        const [ax, ay, az] = node.explode.axis
        if (Math.hypot(ax, ay, az) < 1e-9) {
          add(
            'I23',
            'error',
            `nodes[${i}].explode.axis`,
            `「${node.name}」的轴向爆炸方向是零向量，归一化时会产生 NaN 并让整个分组消失`,
            { kind: 'node', id: node.id },
          )
        }
      }
    }

    /* I24 · 爆炸偏移挂在了不属于任何分组的节点上 */
    if (node.explodeOffset !== null) {
      const parent = node.parent === null ? null : nodeById.get(node.parent)
      if (parent == null || parent.explode === null) {
        add(
          'I24',
          'info',
          `nodes[${i}].explodeOffset`,
          `「${node.name}」设了爆炸偏移，但它的父级不是爆炸分组，这个偏移不会被任何人读到`,
          { kind: 'node', id: node.id },
        )
      }
    }

    /* I26 · 剖切平面被缩放过 */
    if (node.section !== null) {
      const [sx, sy, sz] = node.transform.s
      if (sx !== 1 || sy !== 1 || sz !== 1) {
        add(
          'I26',
          'info',
          `nodes[${i}].transform.s`,
          `剖切面「${node.name}」被缩放成 [${sx}, ${sy}, ${sz}]，剖切结果只看位置与朝向，缩放只影响你看得见的指示矩形`,
          { kind: 'node', id: node.id },
        )
      }
    }
  })

  /* --- I25 / I27 · 剖切平面的两条全局约束 ------------------------------------ */
  const activeSections = doc.nodes.filter((n) => n.section !== null && n.visible)
  if (activeSections.length > 3) {
    add(
      'I25',
      'warn',
      'nodes',
      `启用中的剖切面有 ${activeSections.length} 个，渲染器只吃 3 条，按层级树顺序取前 3 条，其余被忽略`,
    )
  }
  if (activeSections.length > 0) {
    // `shadow` 只长在能投影的那几种灯上（ambient / hemisphere 没有），所以要先探键。
    const shadowCasters = doc.nodes.filter((n) => n.light !== null && 'shadow' in n.light && n.light.shadow.enabled)
    if (shadowCasters.length > 0) {
      add(
        'I27',
        'warn',
        'nodes',
        `场景里同时有剖切面与 ${shadowCasters.length} 盏投影灯：被剖掉的部分仍然会投下影子（three 的裁剪不参与阴影贴图渲染）`,
      )
    }
  }

  /* --- I70 · 剖切 × 描边（T-252 实测，破例批准的编号）------------------------- */
  //
  // T-252 在真浏览器里量出来的：开描边之后加一把刀只改变 39012 像素，而直连路径上是
  // 183212——差 4.7 倍，与「被剖掉的那一侧仍然画着轮廓」一致。成因在 three 里读得出来：
  // `OutlinePass` 的 mask / depth 材质是 `ShaderMaterial` 且没设 `clipping: true`，而
  // `WebGLRenderer` 只对非 ShaderMaterial 或 `clipping === true` 绑裁剪 uniform。
  //
  // 这是 v1.0 的**已知限制**，不是缺陷——修它要改 three 的 pass。所以给一条 warn：
  // 没有机械提示的话，这件事只活在一份文档里，而用户会以为是自己配错了。
  if (doc.meta.effects.outline.enabled && doc.nodes.some((n) => n.section !== null)) {
    add(
      'I70',
      'warn',
      'meta.effects.outline.enabled',
      '同时开启了剖切与描边：被剖掉的那一侧仍然会画出轮廓（three 的描边通道不参与裁剪），剖面处的描边可能不正确',
    )
  }

  /* --- I29 · 热点编号重复 ---------------------------------------------------- */
  const labelSeen = new Map<string, number>()
  doc.hotspots.forEach((hotspot, i) => {
    const label = hotspot.style.label
    if (label === undefined || label === '') return
    const first = labelSeen.get(label)
    if (first === undefined) {
      labelSeen.set(label, i)
      return
    }
    add(
      'I29',
      'warn',
      `hotspots[${i}].style.label`,
      `热点编号「${label}」重复了（hotspots[${first}] 也是它）。编号会被印进手册与验收材料`,
      { kind: 'hotspot', id: hotspot.id },
    )
  })

  /* --- I30 · 视点缩略图 ------------------------------------------------------ */
  doc.viewpoints.forEach((viewpoint, i) => {
    const assetId = viewpoint.thumbnailAssetId
    if (assetId === undefined) return
    requireRef('I30', 'asset', assetId, `viewpoints[${i}].thumbnailAssetId`)
    const asset = assetById.get(assetId)
    if (asset && asset.type !== 'image') {
      add('I30', 'error', `viewpoints[${i}].thumbnailAssetId`, `视点缩略图必须是 image 资产（当前 type=${asset.type}）`, {
        kind: 'asset',
        id: assetId,
      })
    }
  })

  /* --- I31 / I32 / I33 · 资产溯源与动画区间 ---------------------------------- */
  doc.assets.forEach((asset, i) => {
    const origin = asset.origin
    if (origin !== undefined) {
      /* I31 · 溯源记录与资产本体对不上 */
      if (origin.hash !== asset.hash) {
        add(
          'I31',
          'error',
          `assets[${i}].origin.hash`,
          `资产「${asset.name}」的溯源记录指向另一份字节（origin.hash 与 asset.hash 不同），这份溯源不属于它`,
          { kind: 'asset', id: asset.id },
        )
      }
      const t = origin.transcode
      if (t !== undefined && t.ops.length === 0 && t.skipped.length === 0) {
        add(
          'I31',
          'error',
          `assets[${i}].origin.transcode`,
          `资产「${asset.name}」记了一次转码，但既没有执行任何操作也没有跳过任何操作——这条记录不说明任何事`,
          { kind: 'asset', id: asset.id },
        )
      }
    }

    /* I32 · clipDurations 里有资产本身没有的片段 */
    const clipNames = new Set(asset.stats.animations)
    for (const name of Object.keys(asset.stats.clipDurations)) {
      if (clipNames.has(name)) continue
      add(
        'I32',
        'warn',
        `assets[${i}].stats.clipDurations`,
        `资产「${asset.name}」记了片段「${name}」的时长，但它的 animations 里没有这个片段。区间校验拿这张表当真值`,
        { kind: 'asset', id: asset.id },
      )
    }
  })

  /* I33 · 动画区间自洽 */
  doc.animations.forEach((animation, i) => {
    if (animation.kind !== 'imported') return
    const { startS, endS } = animation
    if (endS === null) return
    if (endS <= startS) {
      add('I33', 'error', `animations[${i}].endS`, `动画「${animation.name}」的区间终点（${endS}s）不晚于起点（${startS}s）`)
      return
    }
    const duration = assetById.get(animation.assetId)?.stats.clipDurations[animation.clipName]
    if (duration !== undefined && endS > duration) {
      add(
        'I33',
        'error',
        `animations[${i}].endS`,
        `动画「${animation.name}」的区间终点 ${endS}s 超过了片段「${animation.clipName}」的实际时长 ${duration}s`,
      )
    }
  })

  /* --- I35 · overlay id 与 step id 全文档唯一 -------------------------------- */
  //
  // 「全文档」而不是「同页 / 同流程内」：两个页面各有一个 ov_00000001 时，
  // `overlayClick` 规则指过去是二义的，而 I1 只查顶层集合，看不见嵌套 id。
  const nestedSeen = new Map<string, string>()
  const claimNested = (id: string, where: string, kind: string) => {
    const first = nestedSeen.get(id)
    if (first === undefined) {
      nestedSeen.set(id, where)
      return
    }
    add('I35', 'error', where, `id ${id} 已经被 ${first} 用掉了，${KIND_LABEL[kind] ?? kind} id 必须全文档唯一`, {
      kind,
      id,
    })
  }
  doc.pages.forEach((page, i) => {
    page.overlays.forEach((overlay, j) => claimNested(overlay.id, `pages[${i}].overlays[${j}].id`, 'overlay'))
  })
  doc.flows.forEach((flow, i) => {
    flow.steps.forEach((step, j) => claimNested(step.id, `flows[${i}].steps[${j}].id`, 'step'))
  })

  /* --- I36 – I39 · 流程 ------------------------------------------------------ */
  doc.flows.forEach((flow, i) => {
    /* I36 · 流程变量必须是 string */
    const variable = variableById.get(flow.variableId)
    if (variable && variable.type !== 'string') {
      add(
        'I36',
        'error',
        `flows[${i}].variableId`,
        `流程「${flow.name}」的当前步骤存在变量「${variable.name}」里，而它是 ${variable.type} 型——步骤 id 是字符串`,
        { kind: 'variable', id: flow.variableId },
      )
    }

    const stepIds = new Set(flow.steps.map((st) => st.id))

    /* I37 · 入口步骤必须属于本流程 */
    if (flow.startStepId !== null && !stepIds.has(flow.startStepId)) {
      add(
        'I37',
        'error',
        `flows[${i}].startStepId`,
        `流程「${flow.name}」的入口步骤 ${flow.startStepId} 不在本流程里`,
        { kind: 'step', id: flow.startStepId },
      )
    }

    /* I38 · 从入口沿 next 走成环 */
    if (flow.startStepId !== null && stepIds.has(flow.startStepId)) {
      const nextOf = new Map(flow.steps.map((st) => [st.id, st.next]))
      const seen = new Set<string>()
      let cursor: string | null = flow.startStepId
      while (cursor !== null) {
        if (seen.has(cursor)) {
          add('I38', 'error', `flows[${i}].steps`, `流程「${flow.name}」的步骤链在 ${cursor} 处成环，走不到终点`, {
            kind: 'step',
            id: cursor,
          })
          break
        }
        seen.add(cursor)
        cursor = nextOf.get(cursor) ?? null
      }
    }

    /* I39 · 每个步骤至多被一个 next 指向 */
    const inbound = new Map<string, number>()
    for (const st of flow.steps) {
      if (st.next === null) continue
      inbound.set(st.next, (inbound.get(st.next) ?? 0) + 1)
    }
    for (const [target, count] of inbound) {
      if (count <= 1) continue
      add(
        'I39',
        'error',
        `flows[${i}].steps`,
        `流程「${flow.name}」里有 ${count} 个步骤都指向 ${target}，「上一步」按钮无法确定该回到哪一个`,
        { kind: 'step', id: target },
      )
    }
  })

  /* --- I40 / I41 · 覆盖层的两类引用 ------------------------------------------ */
  doc.pages.forEach((page, i) => {
    page.overlays.forEach((overlay, j) => {
      const at = `pages[${i}].overlays[${j}]`

      if (overlay.type === 'image' || overlay.type === 'panel') {
        const mediaId = overlay.props.mediaId
        if (mediaId != null) {
          requireRef('I40', 'media', mediaId, `${at}.props.mediaId`)
          const media = mediaById.get(mediaId)
          if (media) {
            // 与 I14 对热点面板的规则逐字对齐：image 支只吃 image，panel 支吃 image | video
            const allowed = overlay.type === 'image' ? ['image'] : ['image', 'video']
            if (!allowed.includes(media.type)) {
              add(
                'I40',
                'error',
                `${at}.props.mediaId`,
                `${overlay.type === 'image' ? '图片' : '面板'}覆盖层只能展示 ${allowed.join(' 或 ')}，「${media.name}」是 ${media.type}`,
                { kind: 'media', id: mediaId },
              )
            }
          }
        }
      }

      if (overlay.type === 'text' || overlay.type === 'panel') {
        if (overlay.props.flowId != null) requireRef('I41', 'flow', overlay.props.flowId, `${at}.props.flowId`)
      }
    })
  })

  /* --- I42 · prefab 引用与 prefab 内部 id 的命名空间 ------------------------- */
  //
  // prefab 里的 nodes / materials 与文档主集合**同一命名空间**（规划 §4.1.3），
  // 所以「组内唯一」和「不与主集合撞车」是两条，缺一条都会让实例化时静默覆盖。
  const mainIds = new Set<string>([...doc.nodes.map((n) => n.id), ...doc.materials.map((m) => m.id)])
  doc.prefabs.forEach((prefab, i) => {
    const inside = new Set<string>()
    const claim = (id: string, where: string) => {
      if (inside.has(id)) {
        add('I42', 'error', where, `预制件「${prefab.name}」内部 id ${id} 重复`, { kind: 'prefab', id: prefab.id })
      } else if (mainIds.has(id)) {
        add('I42', 'error', where, `预制件「${prefab.name}」内部的 ${id} 与文档主集合里的同名 id 撞车，实例化时会互相覆盖`, {
          kind: 'prefab',
          id: prefab.id,
        })
      }
      inside.add(id)
    }
    prefab.nodes.forEach((n, j) => claim(n.id, `prefabs[${i}].nodes[${j}].id`))
    prefab.materials.forEach((m, j) => claim(m.id, `prefabs[${i}].materials[${j}].id`))
  })
  doc.nodes.forEach((node, i) => {
    if (node.prefabRef === null) return
    requireRef('I42', 'prefab', node.prefabRef.prefabId, `nodes[${i}].prefabRef.prefabId`)
  })

  /* --- I43 / I44 / I45 · openLink 的三条 ------------------------------------- */
  //
  // `OpenLinkParams.url` 是 `z.string().min(1)`，**零 scheme 校验**——一个
  // `javascript:` 的 url 今天存得进、发布得出。**这三条必须留在完整性检查里而不是收进
  // schema**：C4 说一份能打开的文档永远要能打开，把它做成 zod 约束会让一份历史文档
  // 从「能打开但被闸门拦住」变成「打不开」。
  const SAFE_SCHEME = /^https?:\/\//i
  const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i
  doc.rules.forEach((rule, i) => {
    rule.then.forEach((action, j) => {
      if (action.action !== 'openLink') return
      const at = `rules[${i}].then[${j}].params`
      const url = typeof action.params.url === 'string' ? action.params.url : ''
      const target = action.params.target

      /* I43 · 危险 scheme */
      if (url !== '' && !SAFE_SCHEME.test(url) && ANY_SCHEME.test(url)) {
        const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1] ?? '?'
        add('I43', 'error', `${at}.url`, `规则「${rule.name}」的链接使用了 ${scheme}: 协议，只允许 http、https 或相对路径`)
      }

      /* I44 · 嵌入播放时不导航 */
      if (target === '_self') {
        add('I44', 'info', `${at}.target`, `规则「${rule.name}」的链接在当前窗口打开：嵌入播放时不会导航，宿主只会收到一条 openLink 事件`)
      }

      /* I45 · 外部域名 */
      if (SAFE_SCHEME.test(url)) {
        add('I45', 'info', `${at}.url`, `规则「${rule.name}」的链接指向外部地址 ${url}，断网或内网部署时打不开`)
      }
    })
  })

  /* --- I15 · physical-only parameters on a non-physical material ------------ */
  // Warn, not error: the renderer ignores them, so the document is renderable — it is the
  // user's intent that is broken, and blocking a publish over an ignored number would be
  // out of proportion.
  doc.materials.forEach((material, i) => {
    if (material.base === 'physical') return
    const stray = PHYSICAL_ONLY_PARAMS.filter((key) => material.params[key] !== undefined)
    if (stray.length > 0) {
      add(
        'I15',
        'warn',
        `materials[${i}].params`,
        `材质「${material.name}」的 base 是 ${material.base}，以下参数只有 physical 材质才生效，当前被忽略：${stray.join('、')}`,
        { kind: 'material', id: material.id },
      )
    }
  })

  return issues
}

/* -------------------------------------------------------------------------- */

type RequireRefFn = (code: string, kind: string, id: string | null | undefined, path: string) => void
type AddFn = (
  code: string,
  level: IntegrityLevel,
  path: string,
  message: string,
  ref?: { kind: string; id: string },
) => void

function valueExprRefs(expr: ValueExpr): RefTarget[] {
  if ('var' in expr) return [{ kind: 'variable', id: expr.var }]
  if ('prop' in expr) return [{ kind: 'node', id: expr.prop.nodeId }]
  return []
}

function conditionRefs(cond: Condition): RefTarget[] {
  switch (cond.op) {
    case 'isVisible':
      return [{ kind: 'node', id: cond.nodeId }]
    case 'isPlaying':
      return [{ kind: 'animation', id: cond.animationId }]
    case 'isPanelOpen':
      return [{ kind: 'hotspot', id: cond.hotspotId }]
    case 'isPageVisible':
      // v3 · 页面今天不是引用目标（`ID_COLLECTIONS.pages.refKind === null`），所以这里没有
      // 可登记的引用。**显式列出来而不是让它掉进 default**：default 那一支要读 `left`/`right`，
      // 而本条件没有这两个字段。把 pages 变成引用目标是 T-227 的活。
      return []
    case 'in':
      return valueExprRefs(cond.left)
    default:
      return [...valueExprRefs(cond.left), ...valueExprRefs(cond.right)]
  }
}

function checkRuleRefs(rule: Rule, base: string, requireRef: RequireRefFn): void {
  const w = rule.when
  switch (w.event) {
    case 'click':
    case 'hoverEnter':
    case 'hoverLeave':
      if ('nodeId' in w.target) requireRef('I3', 'node', w.target.nodeId, `${base}.when.target.nodeId`)
      break
    case 'hotspotClick':
      requireRef('I3', 'hotspot', w.hotspotId, `${base}.when.hotspotId`)
      break
    case 'animationEnd':
      requireRef('I3', 'animation', w.animationId, `${base}.when.animationId`)
      break
    case 'variableChange':
      requireRef('I4', 'variable', w.variableId, `${base}.when.variableId`)
      break
    // v3 的三个新事件。**漏掉它们的症状是「规则配得出、存得进、发布得出、永远不触发，
    // 而所有单测都是绿的」**——因为 `default: break` 对任何未列出的事件都安静通过。
    case 'pageEnter':
      requireRef('I3', 'page', w.pageId, `${base}.when.pageId`)
      break
    case 'flowStepEnter':
      requireRef('I3', 'flow', w.flowId, `${base}.when.flowId`)
      requireRef('I3', 'step', w.stepId, `${base}.when.stepId`)
      break
    case 'overlayClick':
      requireRef('I3', 'overlay', w.overlayId, `${base}.when.overlayId`)
      break
    default:
      break
  }

  const groups: ['if' | 'ifAny', readonly Condition[]][] = [
    ['if', rule.if],
    ['ifAny', rule.ifAny],
  ]
  for (const [key, list] of groups) {
    list.forEach((cond, j) => {
      for (const target of conditionRefs(cond)) {
        requireRef(target.kind === 'variable' ? 'I4' : 'I3', target.kind, target.id, `${base}.${key}[${j}]`)
      }
    })
  }
}

/** I4's second half: a comparison whose literal cannot match the variable's type. */
/**
 * @param variableById  **调用方建好传进来**，不在这里建。
 *
 * 这个函数每条规则调用一次，而它原来第一行就 `new Map(doc.variables.map(...))`——
 * 于是「规则数 × 变量数」是一个货真价实的二次项。T-226 的多轴 scale 测试实测
 * variables 轴增长 3.887（线性应当是 2），这里是它的来源。
 */
function checkRuleConditionTypes(
  rule: Rule,
  base: string,
  doc: SceneDocument,
  add: AddFn,
  variableById: ReadonlyMap<string, SceneDocument['variables'][number]>,
): void {

  const literalOf = (expr: ValueExpr): string | number | boolean | undefined =>
    'const' in expr ? expr.const : undefined
  const variableOf = (expr: ValueExpr) => ('var' in expr ? variableById.get(expr.var) : undefined)

  const groups: ['if' | 'ifAny', readonly Condition[]][] = [
    ['if', rule.if],
    ['ifAny', rule.ifAny],
  ]

  for (const [key, list] of groups) {
    list.forEach((cond, j) => {
      const path = `${base}.${key}[${j}]`
      if (cond.op === 'in') {
        const variable = variableOf(cond.left)
        if (!variable) return
        const bad = cond.right.filter((v) => !isValueOfType(v, variable.type))
        if (bad.length > 0) {
          add('I4', 'error', path, `变量「${variable.id}」声明为 ${variable.type}，候选值中有 ${bad.length} 项类型不符`, {
            kind: 'variable',
            id: variable.id,
          })
        }
        return
      }
      if (cond.op === 'isVisible' || cond.op === 'isPlaying' || cond.op === 'isPanelOpen') return
      // v3 · 同上：本条件没有 left/right，下面那段读它们。
      if (cond.op === 'isPageVisible') return

      for (const [a, b] of [
        [cond.left, cond.right],
        [cond.right, cond.left],
      ] as const) {
        const variable = variableOf(a)
        const literal = literalOf(b)
        if (!variable || literal === undefined) continue
        if (!isValueOfType(literal, variable.type)) {
          add(
            'I4',
            'error',
            path,
            `变量「${variable.id}」声明为 ${variable.type}，此处与 ${typeof literal} 比较；求值不做隐式转换，条件将永远为假`,
            { kind: 'variable', id: variable.id },
          )
        }
      }
    })
  }
}

/* -------------------------------------------------------------------------- */

export const hasErrors = (issues: readonly IntegrityIssue[]): boolean => issues.some((i) => i.level === 'error')

export const errorsOf = (issues: readonly IntegrityIssue[]) => issues.filter((i) => i.level === 'error')
export const warningsOf = (issues: readonly IntegrityIssue[]) => issues.filter((i) => i.level === 'warn')

/** Rendered verbatim by the publish dialog and the issue panel. */
export function formatIntegrityIssues(issues: readonly IntegrityIssue[]): string {
  if (issues.length === 0) return '完整性检查通过，无问题。'
  const label: Record<IntegrityLevel, string> = { error: '阻断', warn: '提示', info: '信息' }
  const order: IntegrityLevel[] = ['error', 'warn', 'info']
  const lines: string[] = []
  for (const level of order) {
    const group = issues.filter((i) => i.level === level)
    if (group.length === 0) continue
    lines.push(`${group.length} 项${label[level]}：`)
    for (const i of group) lines.push(`  [${i.code}] ${i.path} — ${i.message}`)
  }
  return lines.join('\n')
}
