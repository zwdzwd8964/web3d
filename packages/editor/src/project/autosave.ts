import type { SceneDocument } from '@w3/schema'

/**
 * T-100（部分）· keeping work from evaporating on refresh.
 *
 * The evaluation report's sharpest line was about this: "三次导入、两次编辑，白做。这里我
 * 停下来问自己「这个工具是给谁用的」". An editor that cannot save makes everything the user
 * does disposable, and no amount of polish elsewhere compensates.
 *
 * Written as a plain class with an injected clock and timer so the debounce, the
 * coalescing and the failure path are all testable without a browser (C8's habit applied
 * outside core).
 */

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface AutoSaverOptions {
  readonly save: (doc: SceneDocument) => Promise<void>
  /** Quiet period before a write. Long enough that a gizmo drag is one save, not sixty. */
  readonly delayMs?: number
  readonly onStateChange?: (state: SaveState, error?: string) => void
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

export class AutoSaver {
  private handle: unknown = null
  private latest: SceneDocument | null = null
  private inflight: Promise<void> | null = null
  /** Set when a change lands mid-write: the write in flight is already stale. */
  private dirtyDuringSave = false
  private disposed = false

  private readonly delayMs: number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly options: AutoSaverOptions) {
    this.delayMs = options.delayMs ?? 1200
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  /** Records a new document and (re)starts the quiet period. */
  schedule(doc: SceneDocument): void {
    if (this.disposed) return
    this.latest = doc
    if (this.inflight) {
      this.dirtyDuringSave = true
      return
    }
    if (this.handle !== null) this.clearTimer(this.handle)
    this.options.onStateChange?.('pending')
    this.handle = this.setTimer(() => {
      this.handle = null
      void this.flush()
    }, this.delayMs)
  }

  /** Writes immediately. Ctrl+S and page-hide both land here. */
  async flush(): Promise<void> {
    if (this.handle !== null) {
      this.clearTimer(this.handle)
      this.handle = null
    }
    if (this.inflight) {
      this.dirtyDuringSave = true
      return this.inflight
    }
    const doc = this.latest
    if (!doc) return

    this.options.onStateChange?.('saving')
    const run = (async () => {
      try {
        await this.options.save(doc)
        // Only report success if nothing arrived while we were writing; otherwise "已保存"
        // would be claiming something about a document that is no longer the current one.
        if (!this.dirtyDuringSave) this.options.onStateChange?.('saved')
      } catch (error) {
        this.options.onStateChange?.('error', error instanceof Error ? error.message : String(error))
      }
    })()

    this.inflight = run
    await run
    this.inflight = null

    if (this.dirtyDuringSave && !this.disposed) {
      this.dirtyDuringSave = false
      await this.flush()
    }
  }

  get hasPendingWork(): boolean {
    return this.handle !== null || this.inflight !== null || this.dirtyDuringSave
  }

  dispose(): void {
    this.disposed = true
    if (this.handle !== null) this.clearTimer(this.handle)
    this.handle = null
  }
}
