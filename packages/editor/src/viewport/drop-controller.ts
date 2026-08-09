import type { Bounds, SceneUnit, UpAxis } from '@w3/core'
import type { Node, SceneDocument, Vec3 } from '@w3/schema'
import { ensureDefaultMaterial } from '@w3/schema'
import type { ImportResult } from '../lib/import-flow.js'
import { applyImport } from '../lib/import-flow.js'
import type { LibraryItem, PrimitiveTemplate } from '../lib/library.js'
import { addPrimitive } from '../lib/library.js'
import type { DragPayload } from './drag.js'

/** 内置库的文件是我们自己做的：米，Y 朝上。写成常量而不是散在调用点。 */
export interface ImportDeclaration {
  readonly sourceUnit: SceneUnit
  readonly sourceUpAxis: UpAxis
}
export const LIBRARY_DECLARATION: ImportDeclaration = { sourceUnit: 'm', sourceUpAxis: 'Y' }
import { offsetToRestOn } from './place.js'
import { snapPosition } from './snap.js'

/**
 * T-146 · the drag-and-drop lifecycle, as a plain object.
 *
 * Lives outside the component for the same reason `handleShortcut` does: the editor's tests
 * run in plain Node with no DOM, and a rule that only exists inside a JSX event handler can
 * be described in a test but never executed. M10's review found two features that had been
 * marked done in exactly that blind spot.
 *
 * **The ghost is a real document node.** It is written through the `preview` channel, so it
 * renders through the normal patch path (no second rendering road, C3) and leaves no undo
 * entry; `previewCommit` collapses the whole drag into one. The alternative — a three object
 * the editor pokes directly — is 铁律 2 twice over and would need its own materials, its own
 * disposal and its own patch path.
 *
 * **Library models get no ghost.** A model's size is unknowable until its bytes are fetched
 * and built, so there is nothing to draw while the cursor moves. This is a registered
 * difference from T-142's card text, not an omission: showing a stand-in box that resizes on
 * drop would be a worse lie than showing nothing.
 */

/** Resolves the current pointer to a document position for a primitive of known size. */
export type PlacePrimitive = (primitive: PrimitiveTemplate['primitive'], exclude: ReadonlySet<string>) => Vec3

/** Resolves the current pointer to the raw surface hit, for things not yet measurable. */
export type ResolveHit = () => Vec3

export interface DropDeps {
  readonly previewStart: () => void
  readonly preview: (recipe: (draft: SceneDocument) => void) => void
  readonly previewCommit: (label: string) => void
  readonly previewAbort: () => void
  readonly select: (nodeIds: readonly string[]) => void
  /** Measures a built subtree. Null when it encloses nothing. */
  readonly boundsOf: (nodeIds: readonly string[]) => Bounds | null
  /**
   * T-259 · 第三条导入入口。带上声明，与另外两条同路。
   *
   * 拖进视口的库条目今天一律是米 · Y 朝上，所以调用点传的是常量而不是问一句——
   * 内置库的文件是我们自己做的，问用户「展示台是什么单位」没有意义。**但参数必须在**：
   * 三条入口里少接一条，那一条就是下一次「模型进来是一堵墙」的来源。
   */
  readonly importItem: (item: LibraryItem, declaration: ImportDeclaration) => Promise<ImportResult>
  /**
   * Resolves once the patches written so far have reached the renderer.
   *
   * Asset patches are applied asynchronously (the bytes have to be parsed first), so
   * without this the measurement below runs against a scene graph the imported nodes have
   * not arrived in — `boundsOf` returns null and the model never gets lifted onto the
   * surface it was dropped on.
   */
  readonly settle?: () => Promise<void>
  readonly onError?: (message: string) => void
}

export class DropController {
  private ghostId: string | null = null
  private busy = false

  constructor(private readonly deps: DropDeps) {}

  /** True while a ghost is on screen. */
  get hasGhost(): boolean {
    return this.ghostId !== null
  }

  /**
   * One `dragover` frame.
   *
   * The first call opens the preview and creates the ghost; the rest only move it. Recreating
   * it per frame would churn a node id (and a scene-graph object) sixty times a second.
   */
  over(payload: DragPayload, place: PlacePrimitive): void {
    if (payload.kind !== 'primitive') return

    // The ghost is in the scene, so the ray would hit it and the object would climb one
    // bounding box per frame. This exclusion is what `resolveDropPoint`'s option was for.
    const exclude = this.ghostId ? new Set([this.ghostId]) : new Set<string>()
    const position = snapPosition(place(payload.template.primitive, exclude))

    if (this.ghostId === null) {
      this.deps.previewStart()
      this.deps.preview((draft) => {
        // 'existing': the ghost never CREATES the shared material record. Undoing that
        // creation on a cancelled drag is a material remove, which the runtime answers
        // with a full scene rebuild (铁律 11's alarm, on a "changed my mind" gesture).
        this.ghostId = addPrimitive(draft, payload.template, { position, material: 'existing' }).id
      })
      return
    }

    const id = this.ghostId
    this.deps.preview((draft) => {
      const node = draft.nodes.find((n) => n.id === id)
      if (node) node.transform.p = position
    })
  }

  /**
   * The pointer left the viewport, or the drag was cancelled.
   *
   * `previewAbort` rolls the document back to before the ghost existed. Without it a drag
   * that wandered out of the window would leave a stray object behind — and because the
   * ghost never reached the history, no amount of Ctrl+Z would remove it.
   */
  leave(): void {
    if (this.ghostId === null) return
    this.ghostId = null
    this.deps.previewAbort()
  }

  /** Drops whatever is being dragged. Resolves once the object is in the document. */
  async drop(payload: DragPayload, place: PlacePrimitive, hit: ResolveHit): Promise<void> {
    if (payload.kind === 'primitive') {
      this.dropPrimitive(payload.template, place)
      return
    }
    await this.dropLibraryItem(payload.item, hit)
  }

  private dropPrimitive(template: PrimitiveTemplate, place: PlacePrimitive): void {
    // Also covers a drop with no preceding dragover (a synthetic event, or a browser that
    // skipped it): `over` opens the preview, so there is always exactly one entry.
    this.over({ kind: 'primitive', template }, place)

    const id = this.ghostId
    this.ghostId = null
    // The real thing gets a real material record (D15: an unmateriated primitive renders
    // with a colour the material panel cannot show or edit). Inside the same preview, so
    // it is still one undo entry.
    if (id) {
      this.deps.preview((draft) => {
        const node = draft.nodes.find((n) => n.id === id)
        if (node) node.overrides.materialId = ensureDefaultMaterial(draft)
      })
    }
    this.deps.previewCommit(`放置 ${template.label}`)
    if (id) this.deps.select([id])
  }

  /**
   * A library model: resolve the landing point NOW (the pointer is only valid during the
   * event), import, then measure and place.
   *
   * All of it inside one preview, so the intermediate state — the model sitting at the hit
   * point before it has been lifted onto the surface — never reaches the undo stack.
   */
  private async dropLibraryItem(item: LibraryItem, hit: ResolveHit): Promise<void> {
    if (this.busy) return
    this.busy = true
    const target = snapPosition(hit())
    this.leave()

    try {
      const result = await this.deps.importItem(item, LIBRARY_DECLARATION)
      const roots: string[] = []

      this.deps.previewStart()
      this.deps.preview((draft) => {
        applyImport(draft, result)
        for (const node of result.nodes) {
          if (node.parent !== null) continue
          const live = draft.nodes.find((n) => n.id === node.id)
          if (!live) continue
          live.transform.p = target
          roots.push(node.id)
        }
      })

      await this.deps.settle?.()
      const bounds = this.deps.boundsOf(roots)
      if (bounds) {
        const delta = offsetToRestOn(target, bounds)
        this.deps.preview((draft) => {
          for (const id of roots) {
            const node = draft.nodes.find((n) => n.id === id)
            if (node) node.transform.p = add(node.transform.p, delta)
          }
        })
      }

      this.deps.previewCommit(`放置 ${item.name}`)
      if (roots.length > 0) this.deps.select(roots)
    } catch (error) {
      // The preview must not be left open: every later commit would be refused as
      // "mid-preview" and the editor would look frozen.
      this.deps.previewAbort()
      this.deps.onError?.(`引入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.busy = false
    }
  }
}

const add = (a: Node['transform']['p'], b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
