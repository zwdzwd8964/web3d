/**
 * T-205 ⑥ · 能力入口体检表 —— every capability, and where a user reaches it.
 *
 * The failure this answers is v0.5's T-137, found by writing an E2E test and discovering the
 * feature did not exist: the whole lighting stack was built, tested and green — five light
 * factories, the shadow pipeline, IBL, `setLight`, helpers, picking — and **no card owned
 * "how does a user create a light"**. `createLightNode` sat in `@w3/schema` with zero callers.
 * The backlog jumped from T-136 straight to T-140.
 *
 * So the rule is: **a capability with no entry in this table is a capability the user cannot
 * reach**, whatever its unit tests say. Every card that delivers one adds a row here.
 *
 * Two halves, deliberately split:
 *
 *  - **Completeness** (`capability-entries.test.ts`, here, today): every registered action and
 *    every event type has a row. Driven by `allActions()` and `EVENT_TYPES`, so a new action
 *    fails this file on the day it is registered.
 *  - **Reachability** (`toBeEnabled()` on each selector, T-296 in `golden-path-3.spec.ts`):
 *    needs a browser. Until it lands, a row here is a claim, not an observation — and the
 *    difference is exactly what M10's lesson was about.
 */

/** One capability and the editor selector that reaches it. */
export interface CapabilityEntry {
  /** `action:<type>` / `event:<type>` / `field:<path>` — matches how the registries name it. */
  readonly capability: string
  /** A CSS selector in the editor. `null` means: deliberately not user-creatable, see `note`. */
  readonly selector: string | null
  /** Why, when `selector` is null. Required in that case — a bare null is an unanswered question. */
  readonly note?: string
}

/**
 * Actions and events are both reached through the rule editor, which generates its whole form
 * from `ActionDefinition.ui.fields` (ECA_SPEC §10). So the entry for an action is its option in
 * the action dropdown, and for an event its option in the trigger dropdown — that is the claim
 * T-296 has to verify with a real click.
 */
export const CAPABILITY_ENTRIES: readonly CapabilityEntry[] = [
  // --- 动作：规则面板 → 新建规则 → 动作下拉 ---
  { capability: 'action:closePanel', selector: '[data-testid="rule-action-type"] option[value="closePanel"]' },
  { capability: 'action:highlight', selector: '[data-testid="rule-action-type"] option[value="highlight"]' },
  { capability: 'action:moveCamera', selector: '[data-testid="rule-action-type"] option[value="moveCamera"]' },
  { capability: 'action:openLink', selector: '[data-testid="rule-action-type"] option[value="openLink"]' },
  { capability: 'action:openPanel', selector: '[data-testid="rule-action-type"] option[value="openPanel"]' },
  { capability: 'action:playAnimation', selector: '[data-testid="rule-action-type"] option[value="playAnimation"]' },
  { capability: 'action:playMedia', selector: '[data-testid="rule-action-type"] option[value="playMedia"]' },
  { capability: 'action:resetScene', selector: '[data-testid="rule-action-type"] option[value="resetScene"]' },
  { capability: 'action:seekAnimation', selector: '[data-testid="rule-action-type"] option[value="seekAnimation"]' },
  { capability: 'action:setLight', selector: '[data-testid="rule-action-type"] option[value="setLight"]' },
  { capability: 'action:setMaterial', selector: '[data-testid="rule-action-type"] option[value="setMaterial"]' },
  { capability: 'action:setVariable', selector: '[data-testid="rule-action-type"] option[value="setVariable"]' },
  { capability: 'action:setVisible', selector: '[data-testid="rule-action-type"] option[value="setVisible"]' },
  { capability: 'action:stopAnimation', selector: '[data-testid="rule-action-type"] option[value="stopAnimation"]' },
  { capability: 'action:stopMedia', selector: '[data-testid="rule-action-type"] option[value="stopMedia"]' },
  { capability: 'action:wait', selector: '[data-testid="rule-action-type"] option[value="wait"]' },

  // --- 事件：规则面板 → 新建规则 → 触发下拉 ---
  {
    capability: 'event:sceneReady',
    selector: '[data-testid="rule-event-type"] option[value="sceneReady"]',
  },
  { capability: 'event:click', selector: '[data-testid="rule-event-type"] option[value="click"]' },
  { capability: 'event:hoverEnter', selector: '[data-testid="rule-event-type"] option[value="hoverEnter"]' },
  { capability: 'event:hoverLeave', selector: '[data-testid="rule-event-type"] option[value="hoverLeave"]' },
  { capability: 'event:hotspotClick', selector: '[data-testid="rule-event-type"] option[value="hotspotClick"]' },
  { capability: 'event:animationEnd', selector: '[data-testid="rule-event-type"] option[value="animationEnd"]' },
  { capability: 'event:variableChange', selector: '[data-testid="rule-event-type"] option[value="variableChange"]' },
  { capability: 'event:timer', selector: '[data-testid="rule-event-type"] option[value="timer"]' },
]
