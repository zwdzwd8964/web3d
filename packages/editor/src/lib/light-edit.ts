import type { FactoryContext, Light, LightKind, Node, SceneDocument, Vec3 } from '@w3/schema'
import { LIGHT_KINDS, LIGHT_LABELS, SHADOW_CAPABLE_KINDS, createLightNode, identityTransform } from '@w3/schema'

/**
 * T-137 · creating and editing lights, from the editor.
 *
 * The gap this closes was found by writing T-170's E2E: core had the whole lighting stack —
 * five kinds, shadows, IBL, the conditional default rig, `setLight`, helpers and picking,
 * all tested and green — and **nothing in the editor ever created a `node.light`**.
 * `createLightNode` sat in `@w3/schema` with zero callers. Every ring of the chain was
 * assigned to a card except the one the user touches.
 *
 * D12 · a light is a NODE. Everything here therefore goes through the ordinary node paths:
 * the hierarchy tree, the gizmo, undo, visibility, `locked`, incremental patching. The only
 * light-specific code is choosing the initial parameters and editing them.
 *
 * D13 · direction comes from the node's rotation (local -Z), and there is no target object.
 * So "aim the spotlight" is "rotate the node", which the gizmo already does — there is
 * nothing to add here for it, and that is the point of the decision.
 */

/** The default parameters for each kind, written out. */
export function defaultLight(kind: LightKind): Light {
  switch (kind) {
    case 'ambient':
      return { kind, color: '#ffffff', intensity: 0.6 }
    case 'hemisphere':
      return { kind, skyColor: '#ffffff', groundColor: '#444444', intensity: 0.6 }
    case 'directional':
      return { kind, color: '#ffffff', intensity: 1.5, shadow: { enabled: false, quality: 'medium', bias: -0.0005 } }
    case 'point':
      return {
        kind,
        color: '#ffffff',
        intensity: 1,
        range: 0,
        decay: 2,
        shadow: { enabled: false, quality: 'medium', bias: -0.0005 },
      }
    case 'spot':
      return {
        kind,
        color: '#ffffff',
        intensity: 2,
        range: 0,
        decay: 2,
        angleDeg: 30,
        penumbra: 0.2,
        shadow: { enabled: false, quality: 'medium', bias: -0.0005 },
      }
  }
}

export interface LightTemplate {
  readonly kind: LightKind
  readonly label: string
  readonly light: Light
  /**
   * Where a new one is placed, RELATIVE to the drop point or view centre.
   *
   * Lights that shine from somewhere start above the scene rather than inside it: a
   * spotlight created at the origin is inside whatever it was meant to illuminate, which
   * looks exactly like a light that does not work. `ambient` and `hemisphere` have no
   * position at all in the render — theirs is cosmetic, so the tree row has somewhere to be.
   */
  readonly offset: Vec3
}

/** The five kinds, in the order the panel lists them: ambient first, most-configurable last. */
export const LIGHT_TEMPLATES: readonly LightTemplate[] = LIGHT_KINDS.map((kind) => ({
  kind,
  label: LIGHT_LABELS[kind],
  light: defaultLight(kind),
  offset: kind === 'ambient' || kind === 'hemisphere' ? [0, 2, 0] : [0, 3, 2],
}))

/** True for the kinds that can cast a shadow — the others have no direction to cast one from. */
export const castsShadow = (kind: LightKind): boolean => SHADOW_CAPABLE_KINDS.includes(kind)

/**
 * Adds a light to the document.
 *
 * Mutates a draft — call inside one `commit`, so creating a light is one undo entry.
 *
 * The default rotation is deliberate: a directional or spot light created with the identity
 * quaternion shines along -Z, which is horizontal, so it lights nothing on the ground and
 * reads as broken. Tilting it down means a newly created light does something visible
 * immediately, which is the whole difference between a feature people use and one they try
 * once. The value is a plain rotation the gizmo can then take over (D13).
 */
export function addLight(
  draft: SceneDocument,
  template: LightTemplate,
  options: { position?: Vec3; name?: string; ctx?: FactoryContext } = {},
): Node {
  const position = options.position ?? template.offset
  const node = createLightNode(draft, {
    name: options.name ?? template.label,
    light: template.light,
    transform: {
      ...identityTransform(),
      p: [...position],
      ...(aimsSomewhere(template.kind) ? { r: [...TILTED_DOWN] as [number, number, number, number] } : {}),
    },
    ...(options.ctx ? { ctx: options.ctx } : {}),
  })
  draft.nodes.push(node)
  return node
}

/** The kinds whose rotation matters. Ambient and hemisphere shine from everywhere. */
const aimsSomewhere = (kind: LightKind): boolean => kind === 'directional' || kind === 'spot'

/**
 * A ~50° downward tilt about X, as a quaternion.
 *
 * Written as literal numbers rather than computed, so the document's initial state is
 * inspectable and a change to it is a visible diff rather than a changed formula.
 * `q = (sin(-25°), 0, 0, cos(-25°))` — a rotation of -50° about X.
 */
const TILTED_DOWN: [number, number, number, number] = [-0.422618, 0, 0, 0.906308]

/** Finds a light node in a draft. Undefined rather than throwing — the panel may lag a delete. */
const findLight = (draft: SceneDocument, nodeId: string): Node | undefined => {
  const node = draft.nodes.find((n) => n.id === nodeId)
  return node && node.light !== null ? node : undefined
}

/**
 * Writes one or more light parameters.
 *
 * Takes a partial and merges, because every control in the panel edits one field of a
 * discriminated union — and replacing the whole `light` object per keystroke would drop
 * whichever fields the caller did not happen to mention.
 *
 * `kind` is NOT editable here: changing it changes which fields exist, so it goes through
 * `setLightKind`, which rebuilds from that kind's defaults.
 */
export function setLightParams(draft: SceneDocument, nodeId: string, patch: Record<string, unknown>): void {
  const node = findLight(draft, nodeId)
  if (!node || node.light === null) return
  node.light = { ...node.light, ...patch } as Light
}

/**
 * Changes a light's kind.
 *
 * Rebuilds from that kind's defaults and carries across only what BOTH kinds have. A
 * discriminated union cannot be merged field-wise: a spot's `angleDeg` on a point light is
 * a field zod rejects, so the document would save and then fail to open — the worst shape a
 * bug takes here. Intensity and colour survive because they are what the user was looking
 * at when they switched.
 */
export function setLightKind(draft: SceneDocument, nodeId: string, kind: LightKind): void {
  const node = findLight(draft, nodeId)
  if (!node || node.light === null) return
  const previous = node.light
  const next = defaultLight(kind)

  const intensity = previous.intensity
  const colour = 'color' in previous ? previous.color : undefined

  node.light = {
    ...next,
    intensity,
    ...(colour !== undefined && 'color' in next ? { color: colour } : {}),
  } as Light
}

/** Writes a shadow setting. A no-op for the kinds that cannot cast one. */
export function setLightShadow(
  draft: SceneDocument,
  nodeId: string,
  patch: { enabled?: boolean; quality?: 'low' | 'medium' | 'high'; bias?: number },
): void {
  const node = findLight(draft, nodeId)
  if (!node || node.light === null) return
  if (!castsShadow(node.light.kind)) return
  const current = 'shadow' in node.light ? node.light.shadow : { enabled: false, quality: 'medium' as const, bias: -0.0005 }
  node.light = { ...node.light, shadow: { ...current, ...patch } } as Light
}

/**
 * True when the document has no light of its own — re-exported, NOT re-implemented.
 *
 * `needsDefaultLightRig` is the schema's own predicate and the one `SceneRuntime` uses to
 * decide whether the built-in rig stands down (D14). A second copy here would be a second
 * definition of the same truth, and the day they disagreed the panel would say the rig is
 * gone while the renderer still had it — the exact class of divergence the contract test
 * exists to catch elsewhere. Caught by review before it could drift.
 */
export { needsDefaultLightRig as usingDefaultRig } from '@w3/schema'
