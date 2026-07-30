/**
 * Constitution C5 · extension by registry, not by editing the engine.
 *
 * Every event and every action declares its parameters as *data*. Three consumers
 * read that data and none of them needs a code change when a new capability lands:
 *
 *   1. the rule editor  — generates its form from the field list (MVP_V0 §1.1);
 *   2. checkIntegrity() — walks fields whose `ref` is set and scans for dangling ids;
 *   3. the test-case generator (R14) — turns a rule table into acceptance skeletons.
 *
 * This is the concrete meaning of the north-star metric "files changed to add one
 * action type <= 3": catalog entry, runtime implementation, test.
 */

/** Which document collection a reference parameter points at. */
export const REF_KINDS = ['node', 'material', 'animation', 'viewpoint', 'hotspot', 'variable'] as const
export type RefKind = (typeof REF_KINDS)[number]

/** How the rule editor should render a parameter. */
export type ParamKind =
  | 'nodeRef'
  | 'materialRef'
  | 'animationRef'
  | 'viewpointRef'
  | 'hotspotRef'
  | 'variableRef'
  | 'number'
  | 'duration'
  | 'string'
  | 'text'
  | 'boolean'
  | 'enum'
  | 'url'
  | 'valueExpr'

/** The one place that maps an editor control back to a document collection. */
export const REF_BY_PARAM_KIND: Partial<Record<ParamKind, RefKind>> = {
  nodeRef: 'node',
  materialRef: 'material',
  animationRef: 'animation',
  viewpointRef: 'viewpoint',
  hotspotRef: 'hotspot',
  variableRef: 'variable',
}

export interface ParamOption {
  readonly value: string
  readonly label: string
}

export interface ParamField {
  readonly key: string
  /** Chinese label shown in the rule editor. */
  readonly label: string
  readonly kind: ParamKind
  /** false = the field may be null/absent, and integrity skips it when empty. */
  readonly required: boolean
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly options?: readonly ParamOption[]
  readonly help?: string
}

export function refKindOf(field: ParamField): RefKind | null {
  return REF_BY_PARAM_KIND[field.kind] ?? null
}
