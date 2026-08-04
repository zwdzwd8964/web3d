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

export class HighlightLayer {
  private active = new Map<string, Snapshot>()

  constructor(
    private readonly graph: SceneGraph,
    private readonly materials: MaterialRegistry,
  ) {}

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

    const material = this.materials.acquireWritable(nodeId, this.graph) as EmissiveMaterial | null
    if (!material || !(material.emissive instanceof Color)) return false

    // The MaterialRegistry replaces a node's material whenever its override is removed
    // and re-applied — the clone we snapshotted gets disposed and a fresh one takes its
    // place. A stale snapshot would then restore onto the DEAD material, leaving the node
    // lit with no way to turn it off. Drop it and snapshot the material actually bound.
    const existing = this.active.get(nodeId)
    if (existing && existing.material !== material) this.active.delete(nodeId)

    // Snapshot BEFORE the first write only. Re-highlighting with a different preset must
    // still restore to the pre-highlight state, not to the previous highlight.
    if (!this.active.has(nodeId)) {
      this.active.set(nodeId, {
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

  private clearOne(nodeId: string): boolean {
    const snapshot = this.active.get(nodeId)
    if (!snapshot) return false
    this.active.delete(nodeId)

    // Same reason as above, from the other side: if the node no longer uses the material
    // we snapshotted, restoring onto it would write to something nothing renders — and
    // the material the node DOES use was cloned fresh from the source, so it carries no
    // highlight to undo.
    if (this.boundMaterial(nodeId) !== snapshot.material) return true

    const material = snapshot.material as EmissiveMaterial
    if (material.emissive instanceof Color) material.emissive.set(snapshot.emissive)
    material.emissiveIntensity = snapshot.emissiveIntensity
    material.needsUpdate = true
    return true
  }

  /** The material currently bound to a node, without cloning anything. */
  private boundMaterial(nodeId: string): Material | null {
    const mesh = this.graph.objectFor(nodeId) as Mesh | undefined
    if (!mesh?.isMesh || Array.isArray(mesh.material)) return null
    return mesh.material
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
