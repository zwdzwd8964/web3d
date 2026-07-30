import { z } from 'zod'
import { AssetRef } from './assets.js'
import { MaterialId, NodeId } from './ids.js'
import { Transform } from './primitives.js'

/**
 * A scene node is an *instance*, and it stores only the delta against its source
 * asset (technical assessment §1.2, discipline 3). Swap the source asset and every
 * property the user never touched follows along automatically — that is the whole
 * point of a low-code editor, and it only works if we resist the urge to snapshot
 * the full material/transform state into the document.
 */
export const SceneNode = z
  .object({
    id: NodeId,
    name: z.string(),
    /** null = root. Sibling order is the order of the `nodes` array. */
    parent: NodeId.nullable(),
    /** Absent for nodes the user created (empty groups, pivots). */
    assetRef: AssetRef.nullable(),
    transform: Transform,
    visible: z.boolean(),
    /** Editor-only: blocks selection and gizmo. Still rendered, still scriptable. */
    locked: z.boolean(),
    overrides: z
      .object({
        materialId: MaterialId.nullable(),
      })
      .strict(),
  })
  .strict()
export type SceneNode = z.infer<typeof SceneNode>
