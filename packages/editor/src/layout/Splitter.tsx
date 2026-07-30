import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * T-060 · a draggable divider that writes a CSS custom property.
 *
 * Writing a variable rather than React state on every pointermove keeps the drag off the
 * render path entirely: the browser re-lays out the grid, and no component re-renders.
 * With a 3D viewport in the middle, a re-render per mouse move is visible.
 *
 * Keyboard resizing is here because ADR-0010 put accessibility on us — a pointer-only
 * splitter is unusable without a mouse, and this is the cheapest place to fix that.
 */

export interface SplitterProps {
  /** The custom property to drive, e.g. `--left-w`. */
  readonly variable: string
  readonly orientation: 'vertical' | 'horizontal'
  readonly min: number
  readonly max: number
  /** Dragging right/down decreases the value (for a right-hand or bottom pane). */
  readonly invert?: boolean
  readonly label: string
}

export function Splitter({ variable, orientation, min, max, invert = false, label }: SplitterProps) {
  const [dragging, setDragging] = useState(false)
  const start = useRef({ pointer: 0, value: 0 })

  const readValue = useCallback(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(variable)
    return Number.parseFloat(raw) || min
  }, [variable, min])

  const write = useCallback(
    (value: number) => {
      document.documentElement.style.setProperty(variable, `${Math.min(max, Math.max(min, value))}px`)
    },
    [variable, min, max],
  )

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    start.current = {
      pointer: orientation === 'vertical' ? event.clientX : event.clientY,
      value: readValue(),
    }
    setDragging(true)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    const current = orientation === 'vertical' ? event.clientX : event.clientY
    const delta = (current - start.current.pointer) * (invert ? -1 : 1)
    write(start.current.value + delta)
  }

  const stop = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const forward = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
    const backward = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
    if (event.key !== forward && event.key !== backward) return
    event.preventDefault()
    const step = (event.shiftKey ? 40 : 8) * (event.key === forward ? 1 : -1) * (invert ? -1 : 1)
    write(readValue() + step)
  }

  // A drag that ends outside the window would otherwise leave the splitter latched.
  useEffect(() => {
    if (!dragging) return
    const cancel = () => setDragging(false)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
    }
  }, [dragging])

  return (
    <div
      className={`splitter splitter--${orientation === 'vertical' ? 'v' : 'h'}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      data-dragging={dragging}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onKeyDown={onKeyDown}
    />
  )
}
