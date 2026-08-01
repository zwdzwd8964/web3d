import { useEffect, useState } from 'react'
import { ANGLE_STEP_DEG, GRID_STEPS, getSnap, onSnapChange, setSnap } from './snap.js'
import type { SnapSettings } from './snap.js'

/**
 * T-143 · the snap controls.
 *
 * Reads the module-level session store rather than owning the state, because the gizmo —
 * which is not a React component (ADR-0009) — reads the same thing. Two owners of one
 * setting is how "the toolbar says 0.5 m and the drag is free" happens.
 */
export function SnapToolbar() {
  const [snap, setLocal] = useState<SnapSettings>(getSnap)
  useEffect(() => onSnapChange(setLocal), [])

  return (
    <div className="seg" title="吸附只影响拖拽与放置的落点，不进文档">
      <button
        type="button"
        aria-pressed={snap.translate === null}
        onClick={() => setSnap({ translate: null })}
        title="自由移动"
      >
        自由
      </button>
      {GRID_STEPS.map((step) => (
        <button
          key={step}
          type="button"
          aria-pressed={snap.translate === step}
          onClick={() => setSnap({ translate: step })}
          title={`网格 ${step} 米`}
        >
          {step}m
        </button>
      ))}
      <button
        type="button"
        aria-pressed={snap.rotate}
        onClick={() => setSnap({ rotate: !snap.rotate })}
        title={`旋转吸附到 ${ANGLE_STEP_DEG}°`}
      >
        {ANGLE_STEP_DEG}°
      </button>
    </div>
  )
}
