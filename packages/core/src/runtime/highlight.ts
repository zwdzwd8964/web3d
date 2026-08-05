import { Color } from 'three'
import type { Material, Mesh } from 'three'
import { HIGHLIGHT_PRESETS } from '../highlight-presets.js'
import type { MaterialRegistry } from './material-registry.js'
import type { SceneGraph } from './scene-graph.js'

/**
 * T-040 · highlighting, v0.
 *
 * Implemented as an emissive overlay, deliberately NOT as a post-processing outline:
 * MVP_V0 §1.3 keeps EffectComposer out of v0 entirely so that R07's three-way conflict
 * (post-processing vs transparent background vs anti-aliasing) is solved once in v1
 * rather than half-solved twice.
 *
 * The preset NAMES are the contract. When v1 swaps the implementation for
 * postprocessing's OutlineEffect, `outline_amber` keeps meaning the same thing and no
 * document changes — that is the C5 demonstration the incubation plan asks for.
 *
 * Every write goes through MaterialRegistry.acquireWritable, so highlighting one part
 * never lights up its siblings (R08).
 */

// T-215 · the table moved to `../highlight-presets.js` so the rule editor's dropdown can be
// generated from it. Re-exported here because `HighlightLayer` is what everything else
// imports, and a preset is meaningless without the layer that applies it.
export { HIGHLIGHT_PRESETS } from '../highlight-presets.js'
export type { HighlightPreset } from '../highlight-presets.js'

/** Exactly what was there before, so clearing restores field by field. */
interface Snapshot {
  readonly material: Material
  readonly emissive: string
  readonly emissiveIntensity: number
}

type EmissiveMaterial = Material & { emissive?: Color; emissiveIntensity?: number }

/**
 * T-240 · 高亮怎么画。
 *
 * 两种实现：{@link EmissiveStrategy}（改材质自发光，v0 起就是这个）与 `OutlineLayer`
 * （后处理描边，v1.0）。**`HighlightLayer` 只管「谁被高亮成什么预设」，怎么画交给策略**
 * ——这条分界是描边能被换进来而 `apply-patch.ts` / `scene-runtime.ts` 的调用点零 diff
 * 的唯一原因。
 */
export interface HighlightStrategy {
  readonly kind: 'emissive' | 'outline'
  /** @returns 是否真的画上了。false = 这个节点画不了（没有可着色几何体 / 未知预设）。 */
  apply(nodeId: string, preset: string, spec: HighlightPresetSpec): boolean
  clear(nodeId: string): void
  /** 换策略或销毁时把自己画的东西全撤掉。 */
  clearAll(): void
}

/** 预设的形状。从 `HIGHLIGHT_PRESETS` 的值类型来，不在这里再写一遍。 */
type HighlightPresetSpec = (typeof HIGHLIGHT_PRESETS)[keyof typeof HIGHLIGHT_PRESETS]

/**
 * v0 的实现：把材质的自发光改掉，清除时按字段还原。
 *
 * **逐行搬过来的，没有顺手优化。** 那两条既有测试（材质被替换后重新校验快照、
 * clip 之后仍能清除）是「语义没变」的唯一证据，而这个类里每一行都是为它们中的一条
 * 存在的。
 */
export class EmissiveStrategy implements HighlightStrategy {
  readonly kind = 'emissive' as const

  private snapshots = new Map<string, Snapshot>()

  constructor(
    private readonly graph: SceneGraph,
    private readonly materials: MaterialRegistry,
  ) {}

  apply(nodeId: string, _preset: string, spec: HighlightPresetSpec): boolean {
    const material = this.materials.acquireWritable(nodeId, this.graph) as EmissiveMaterial | null
    if (!material || !(material.emissive instanceof Color)) return false

    // The MaterialRegistry replaces a node's material whenever its override is removed
    // and re-applied — the clone we snapshotted gets disposed and a fresh one takes its
    // place. A stale snapshot would then restore onto the DEAD material, leaving the node
    // lit with no way to turn it off. Drop it and snapshot the material actually bound.
    const existing = this.snapshots.get(nodeId)
    if (existing && existing.material !== material) this.snapshots.delete(nodeId)

    // Snapshot BEFORE the first write only. Re-highlighting with a different preset must
    // still restore to the pre-highlight state, not to the previous highlight.
    if (!this.snapshots.has(nodeId)) {
      this.snapshots.set(nodeId, {
        material,
        emissive: `#${material.emissive.getHexString()}`,
        emissiveIntensity: material.emissiveIntensity ?? 1,
      })
    }

    material.emissive.set(spec.emissive)
    material.emissiveIntensity = spec.emissiveIntensity
    material.needsUpdate = true
    return true
  }

  clear(nodeId: string): void {
    const snapshot = this.snapshots.get(nodeId)
    if (!snapshot) return
    this.snapshots.delete(nodeId)

    // Same reason as above, from the other side: if the node no longer uses the material
    // we snapshotted, restoring onto it would write to something nothing renders — and
    // the material the node DOES use was cloned fresh from the source, so it carries no
    // highlight to undo.
    if (this.boundMaterial(nodeId) !== snapshot.material) return

    const material = snapshot.material as EmissiveMaterial
    if (material.emissive instanceof Color) material.emissive.set(snapshot.emissive)
    material.emissiveIntensity = snapshot.emissiveIntensity
    material.needsUpdate = true
  }

  clearAll(): void {
    for (const nodeId of [...this.snapshots.keys()]) this.clear(nodeId)
  }

  /** The material currently bound to a node, without cloning anything. */
  private boundMaterial(nodeId: string): Material | null {
    const mesh = this.graph.objectFor(nodeId) as Mesh | undefined
    if (!mesh?.isMesh || Array.isArray(mesh.material)) return null
    return mesh.material
  }
}

export class HighlightLayer {
  /** 谁被高亮成什么预设。**只有状态，没有实现细节**——快照归 EmissiveStrategy 自己。 */
  private active = new Map<string, string>()

  private strategy: HighlightStrategy

  constructor(
    private readonly graph: SceneGraph,
    private readonly materials: MaterialRegistry,
  ) {
    this.strategy = new EmissiveStrategy(graph, materials)
  }

  /**
   * 换一种画法。切换时把旧策略画的东西全撤掉，再用新策略重画当前这批。
   *
   * 不重画的话，开关描边的那一瞬间已经高亮的节点会「消失」——而用户没有取消过高亮。
   */
  setStrategy(next: HighlightStrategy): void {
    if (next === this.strategy) return
    const current = [...this.active.entries()]
    this.strategy.clearAll()
    this.strategy = next
    for (const [nodeId, preset] of current) {
      const spec = HIGHLIGHT_PRESETS[preset]
      if (spec) next.apply(nodeId, preset, spec)
    }
  }

  /** 当前策略。测试与 `scene-runtime` 判断该不该换时读它。 */
  get strategyKind(): HighlightStrategy['kind'] {
    return this.strategy.kind
  }

  /** 这个节点当前的高亮预设名，没有就是 null。**`RuntimeContext.highlightOf` 的实现。** */
  presetOf(nodeId: string): string | null {
    return this.active.get(nodeId) ?? null
  }

  get activeNodeIds(): string[] {
    return [...this.active.keys()]
  }

  isHighlighted(nodeId: string): boolean {
    return this.active.has(nodeId)
  }

  presetNames(): string[] {
    return Object.keys(HIGHLIGHT_PRESETS)
  }

  /**
   * Applies or clears a highlight. `preset === null` clears.
   * An unknown preset name is refused rather than silently rendering nothing.
   */
  set(nodeId: string, preset: string | null, options: { includeDescendants?: boolean } = {}): boolean {
    const targets = options.includeDescendants ? this.subtreeOf(nodeId) : [nodeId]
    let ok = false
    for (const id of targets) ok = this.setOne(id, preset) || ok
    return ok
  }

  private setOne(nodeId: string, preset: string | null): boolean {
    if (preset === null) return this.clearOne(nodeId)

    const spec = HIGHLIGHT_PRESETS[preset]
    if (!spec) return false

    // 策略说画不上就不记状态：一个「记着被高亮、实际什么都没画」的节点，
    // `highlightOf` 会返回预设名而画面上什么都没有 —— 比不记更难查。
    if (!this.strategy.apply(nodeId, preset, spec)) return false
    this.active.set(nodeId, preset)
    return true
  }

  private clearOne(nodeId: string): boolean {
    if (!this.active.has(nodeId)) return false
    this.active.delete(nodeId)
    this.strategy.clear(nodeId)
    return true
  }

  clearAll(): void {
    for (const nodeId of [...this.active.keys()]) this.clearOne(nodeId)
  }

  private subtreeOf(nodeId: string): string[] {
    const object = this.graph.objectFor(nodeId)
    if (!object) return [nodeId]
    const out: string[] = []
    object.traverse((child) => {
      const id = this.graph.nodeIdFor(child)
      if (id && !out.includes(id)) out.push(id)
    })
    return out.length > 0 ? out : [nodeId]
  }
}
