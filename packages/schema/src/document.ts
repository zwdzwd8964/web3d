import { z } from 'zod'
import { Animation } from './animations.js'
import { Asset } from './assets.js'
import { Action } from './eca/actions.js'
import { Rule } from './eca/rules.js'
import { Hotspot, Viewpoint } from './hotspots.js'
import { ProjectId } from './ids.js'
import { Material } from './materials.js'
import { SceneNode } from './nodes.js'
import { Timestamp } from './primitives.js'
import { Constraint, Environment, Flow, MediaItem, Page } from './reserved.js'
import { Variable } from './variables.js'

/**
 * Constitution C4 · schemaVersion is monotonic and every bump ships a migration.
 *
 * Bumping this constant without adding a migration to migrations.ts and a fixture to
 * test/fixtures/ is anti-pattern A4: historical snapshots break silently, and the
 * damage surfaces during the customer's trial period at the latest.
 */
export const CURRENT_SCHEMA_VERSION = 1

export const SCENE_UNITS = ['m', 'cm', 'mm'] as const
export const UP_AXES = ['Y', 'Z'] as const

export const DocumentMeta = z
  .object({
    unit: z.enum(SCENE_UNITS),
    upAxis: z.enum(UP_AXES),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    /** Free-form; shown in the project list. */
    description: z.string(),
  })
  .strict()
export type DocumentMeta = z.infer<typeof DocumentMeta>

/**
 * Constitution C1 · this object is the single source of truth.
 *
 * If a feature needs to remember something across a reload, it is a field here.
 * If it cannot be pointed at a field here, the feature is designed wrong — that is
 * the one question every change has to answer (NORTH_STAR §2 C1).
 *
 * Runtime state (current playback head, hovered object, which panel is open right
 * now) is explicitly NOT in this document. It is derived, it is per-session, and
 * putting it here would make every mouse move a document mutation.
 */
export const SceneDocument = z
  .object({
    schemaVersion: z.number().int().positive(),
    projectId: ProjectId,
    name: z.string().min(1),
    meta: DocumentMeta,

    assets: z.array(Asset),
    nodes: z.array(SceneNode),
    materials: z.array(Material),
    animations: z.array(Animation),
    hotspots: z.array(Hotspot),
    viewpoints: z.array(Viewpoint),
    variables: z.array(Variable),
    rules: z.array(Rule),

    environment: Environment,

    // --- defined in v0, no runtime until v1 (MVP_V0 §1.2) ---
    pages: z.array(Page),
    media: z.array(MediaItem),
    flows: z.array(Flow),
    constraints: z.array(Constraint),
  })
  .strict()
export type SceneDocument = z.infer<typeof SceneDocument>

/** Collections that are keyed by a generated id and participate in integrity checks. */
export const ID_COLLECTIONS = [
  'assets',
  'nodes',
  'materials',
  'animations',
  'hotspots',
  'viewpoints',
  'variables',
  'rules',
  'pages',
  'media',
  'flows',
] as const
export type IdCollection = (typeof ID_COLLECTIONS)[number]

/** Narrow helper so call sites stay readable when walking rule actions. */
export function ruleActions(rule: Rule): readonly Action[] {
  return rule.then
}
