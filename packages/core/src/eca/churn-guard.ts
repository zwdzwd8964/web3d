/**
 * T-204 · the loop guard that survives an `await`. ECA_SPEC §9.2 B10, second half.
 *
 * `MAX_CHAIN_DEPTH` counts how deeply `dispatch` is nested **synchronously**. That equals
 * "how long is this chain" only while the chain is synchronous. The moment a rule's `then`
 * contains any `await` — `wait`, `playAnimation(await:true)`, `playMedia`, anything
 * returning a Promise — that dispatch has already returned, `finally` has already decremented
 * the counter, and the next variable change arrives on a clean stack at depth 1. Forever.
 *
 * Measured, not reasoned: two rules writing each other's variables with a `wait(1)` in
 * between run 300 rounds with **zero warnings and no convergence**; the same pair without the
 * wait reports at exactly depth 16.
 *
 * So this guard's判据 deliberately does not look at the call stack at all. It asks a question
 * whose answer is the same for a synchronous loop and an awaited one: **how many times did
 * this variable change in the last second?**
 *
 * See [ADR-0029](../../../../docs/adr/0029-变量变化的跨-await-循环防线.md) for the decision,
 * its cost — it stops runaway loops, not slow ones — and what reverses it.
 */

/** The sliding window. One second: long enough to see a loop, short enough to forget bursts. */
export const CHURN_WINDOW_MS = 1000

/**
 * How many changes of ONE variable per window are still plausibly deliberate.
 *
 * 240 = 16 ms per frame × up to four writes per frame. **This number is hand-derived, not
 * measured** — the target-machine benchmark (G0.5-8 / H1) has not run, so it must not be
 * quoted as an empirical result. ADR-0029's revocation condition covers replacing it.
 */
export const CHURN_LIMIT = 240

/**
 * Per-variable change-rate limiter with a sliding window.
 *
 * Engine-level, never in the document: how often a variable changed is runtime transience
 * (C1). One consequence is recorded in ADR-0029 cost 4 — the editor preview and the player
 * each keep their own counter.
 */
export class ChurnGuard {
  /** Change timestamps inside the current window, per variable. */
  private readonly recent = new Map<string, number[]>()
  /** Variables already reported. Keeps one runaway loop from producing one error per event. */
  private readonly reported = new Set<string>()

  /**
   * Records one change and answers whether this is the moment to stop.
   *
   * Returns true **on the crossing and only on the crossing**. The caller aborts that
   * dispatch, which severs the chain — so one true is all it takes, and returning true
   * forever afterwards would only turn a broken loop into a wall of identical errors.
   *
   * @param variableId the variable that just changed
   * @param nowMs      engine time from `ctx.now()`. Never `Date.now()` — 铁律 6, and this
   *                   file is the single most tempting place in the engine to break it.
   */
  tripped(variableId: string, nowMs: number): boolean {
    const cutoff = nowMs - CHURN_WINDOW_MS
    const stamps = this.recent.get(variableId) ?? []
    // Prune from the front: the array is append-only in time order, so everything before the
    // first in-window entry is out of window.
    let start = 0
    while (start < stamps.length && stamps[start]! <= cutoff) start++
    const window = start === 0 ? stamps : stamps.slice(start)
    window.push(nowMs)
    this.recent.set(variableId, window)

    if (window.length <= CHURN_LIMIT) {
      // Back under the limit — the variable is allowed to trip again later. Without this,
      // a scene that legitimately recovers would be permanently unable to report a second,
      // genuinely new runaway loop.
      this.reported.delete(variableId)
      return false
    }
    if (this.reported.has(variableId)) return false
    this.reported.add(variableId)
    return true
  }

  /** Forgets everything. Called from `detach()` and `setEnabled(false)`. */
  reset(): void {
    this.recent.clear()
    this.reported.clear()
  }
}
