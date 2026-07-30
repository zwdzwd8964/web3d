import { useEffect, useRef, useState } from 'react'
import { type MaybeMixed, displayValue, isMixed, parseNumber } from '../lib/selection-values.js'

/**
 * A number input that can also be scrubbed by dragging its label.
 *
 * Both interactions go through MVP_V0 D2's dual channel:
 *   - scrubbing  -> previewStart / preview × N / previewCommit  = one undo entry
 *   - typing     -> commit per change, merged by the store's 500 ms same-label window
 *
 * While the field has focus it keeps its own draft string. Reading the document back on
 * every keystroke would rewrite "0.3" to "0.3" — or, after a rotation round trip, to
 * "0.299999" — under the user's cursor.
 */

export interface NumberFieldProps {
  readonly label: string
  readonly value: MaybeMixed<number> | undefined
  readonly step?: number
  readonly min?: number
  readonly max?: number
  readonly digits?: number
  readonly disabled?: boolean
  /** A committed edit: typing, or the end of a scrub. */
  readonly onCommit: (value: number) => void
  /** A frame of a scrub. Omit to disable scrubbing. */
  readonly onPreview?: (value: number) => void
  readonly onPreviewStart?: () => void
  readonly onPreviewEnd?: () => void
}

export function NumberField(props: NumberFieldProps) {
  const { label, value, step = 0.01, min, max, digits = 3, disabled } = props
  const [draft, setDraft] = useState<string | null>(null)
  const scrub = useRef<{ x: number; base: number } | null>(null)

  const shown = draft ?? displayValue(value, digits)
  const numeric = isMixed(value) || value === undefined ? 0 : value

  const clamp = (n: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n))

  const commit = (raw: string) => {
    setDraft(null)
    // A mixed field left untouched must not write the placeholder to every object.
    if (raw === '' || raw === '—') return
    props.onCommit(clamp(parseNumber(raw, numeric)))
  }

  const onPointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled || !props.onPreview) return
    event.currentTarget.setPointerCapture(event.pointerId)
    scrub.current = { x: event.clientX, base: numeric }
    props.onPreviewStart?.()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (!scrub.current || !props.onPreview) return
    const delta = (event.clientX - scrub.current.x) * step * (event.shiftKey ? 10 : 1)
    props.onPreview(clamp(scrub.current.base + delta))
  }

  const onPointerUp = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (!scrub.current) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    scrub.current = null
    props.onPreviewEnd?.()
  }

  // A scrub that ends off-window would otherwise leave the field latched mid-drag.
  useEffect(() => {
    const cancel = () => {
      if (!scrub.current) return
      scrub.current = null
      props.onPreviewEnd?.()
    }
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
    }
  }, [props])

  return (
    <label className="field">
      <span
        className="field__label"
        style={{ cursor: props.onPreview && !disabled ? 'ew-resize' : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {label}
      </span>
      <input
        className="field__input num"
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={shown}
        placeholder={isMixed(value) ? '—' : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

export function TextField(props: {
  label: string
  value: string
  disabled?: boolean
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="field">
      <span className="field__label">{props.label}</span>
      <input
        className="field__input"
        type="text"
        disabled={props.disabled}
        value={draft ?? props.value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== props.value) props.onCommit(draft)
          setDraft(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

export function CheckField(props: {
  label: string
  value: MaybeMixed<boolean> | undefined
  disabled?: boolean
  onCommit: (value: boolean) => void
}) {
  const mixed = isMixed(props.value)
  return (
    <label className="field field--check">
      <input
        type="checkbox"
        disabled={props.disabled}
        checked={mixed ? false : Boolean(props.value)}
        ref={(el) => {
          // The tri-state marker: neither checked nor unchecked is the honest reading.
          if (el) el.indeterminate = mixed
        }}
        onChange={(event) => props.onCommit(event.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  )
}
