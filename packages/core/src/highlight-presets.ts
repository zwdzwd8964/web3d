/**
 * T-215 · the highlight preset table, in the one place both halves can read it.
 *
 * It used to live in `runtime/highlight.ts` and the rule editor's option list was typed out
 * by hand next to it. The two drifted immediately: the table had five presets, the hand-written
 * list had four, and **`outline_white` was a preset no user could ever select.** Nothing
 * caught it because there was nothing to compare against — a hand-written list agrees with
 * itself.
 *
 * Why a new module rather than importing the table from `runtime/`: the direction inside
 * `@w3/core` is `runtime → eca`, never back (`camera-controller`, `environment`, `media-bus`
 * and `playback-session` all import from `eca/`, and nothing in `eca/` imports from
 * `runtime/`). The action definitions live in `eca/actions/`, so reaching into `runtime/` for
 * the option list would invert that — and `runtime/highlight.ts` imports `three`, which would
 * drag a renderer into ECA's plain-Node unit tests (C8).
 *
 * The table is pure data with no `three` in it, so it belongs above both.
 *
 * **The preset names are the contract** (T-040): when the implementation is swapped for a
 * real outline pass, `outline_amber` keeps meaning the same thing and no document changes.
 */

export interface HighlightPreset {
  /** Chinese, shown in the rule editor's dropdown. */
  readonly label: string
  readonly emissive: string
  readonly emissiveIntensity: number
}

export const HIGHLIGHT_PRESETS: Record<string, HighlightPreset> = {
  outline_amber: { label: '琥珀', emissive: '#ffb020', emissiveIntensity: 0.55 },
  outline_cyan: { label: '青', emissive: '#4aa8c7', emissiveIntensity: 0.5 },
  outline_red: { label: '红', emissive: '#e2603f', emissiveIntensity: 0.55 },
  outline_green: { label: '绿', emissive: '#63b37a', emissiveIntensity: 0.5 },
  outline_white: { label: '白', emissive: '#e6eaed', emissiveIntensity: 0.45 },
}

/**
 * The dropdown's options, derived from the table rather than typed alongside it.
 *
 * This is the whole fix. A new preset appears in the editor by being added to the table,
 * and cannot be added to the table without appearing in the editor.
 */
export function highlightPresetOptions(): { value: string; label: string }[] {
  return Object.entries(HIGHLIGHT_PRESETS).map(([value, preset]) => ({ value, label: preset.label }))
}
