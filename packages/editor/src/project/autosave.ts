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
  /**
   * T-288 · 草稿通道的第一步。**在 `save` 之前**写下这一份。
   *
   * 顺序不是风格问题：草稿是在 `save` 失败或者来不及时兜底的那一份，写在 `save`
   * 之后就恰好在唯一需要它的那个窗口里不存在。
   *
   * @param edits 从上一次成功保存到现在累计了多少次编辑。崩溃横幅上那个数字。
   */
  readonly saveDraft?: (doc: SceneDocument, edits: number) => Promise<void>
  /** T-288 · 草稿通道的第三步。**只在 `save` 成功之后**调。 */
  readonly clearDraft?: () => Promise<void>
  /** Quiet period before a write. Long enough that a gizmo drag is one save, not sixty. */
  readonly delayMs?: number
  /**
   * @param code 失败时存储侧的错误码（`quota-exceeded` 等），用来决定 UI 上要不要给
   *   一个「清理本地数据」的入口。文案本身走 `error`。
   */
  readonly onStateChange?: (state: SaveState, error?: string, code?: string) => void
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

/**
 * 一条要给用户看的失败文案。
 *
 * 存储层的 `StorageError` 自带 `userMessage`（T-286），优先用它：配额写满时浏览器抛的是
 * `QuotaExceededError: Failed to execute 'put' on 'IDBObjectStore'`，把那句话贴到界面上
 * 等于没说——用户既不知道发生了什么，也不知道能做什么。
 *
 * 用鸭子判断而不是 `instanceof StorageError`：编辑器与存储包各自打包时，跨包的
 * `instanceof` 会在某些构建下悄悄变成永远为假，而那时候回落的正是上面那句英文。
 */
function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'userMessage' in error) {
    const message = (error as { userMessage: unknown }).userMessage
    if (typeof message === 'string' && message.length > 0) return message
  }
  return error instanceof Error ? error.message : String(error)
}

/** 失败的机器可读码，没有就是 `undefined`。 */
function codeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

export class AutoSaver {
  private handle: unknown = null
  private latest: SceneDocument | null = null
  private inflight: Promise<void> | null = null
  /** Set when a change lands mid-write: the write in flight is already stale. */
  private dirtyDuringSave = false
  private disposed = false
  /** T-288 · 从上一次成功落盘到现在累计了多少次编辑。 */
  private edits = 0
  /** 正在写的那份草稿，以及写完之后要补写的那一份。见 `writeDraft`。 */
  private draftInflight: Promise<void> | null = null
  private draftPending: SceneDocument | null = null

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
    // T-288 · 计的是**编辑次数**，不是保存次数。崩溃横幅要说「有 N 处修改没保存」，
    // 而防抖的存在意义就是把很多次编辑合并成一次保存——用保存次数去数，那个 N 恒为 1。
    this.edits += 1
    // T-288 修 · **草稿在这里就写，不等防抖。**
    //
    // 只在 `flush` 里写草稿的话，能被救回来的窗口只有「一次保存正在进行中」的那十几
    // 毫秒；而崩溃最常发生的位置是**安静期里**——用户改完一笔、防抖还没到期的那 1.2 秒。
    // 换句话说，那样的崩溃恢复覆盖的是每 1210 毫秒里的 10 毫秒。写 E2E 时才发现。
    //
    // 不 await：草稿是兜底，不是主路径，让它阻塞输入是本末倒置。
    void this.writeDraft(doc)
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
      const edits = this.edits
      try {
        // T-288 · 三步，次序是**草稿 → 正式 → 清草稿**，而且有一条顺序断言盯着。
        await this.options.saveDraft?.(doc, edits)
        await this.options.save(doc)
      } catch (error) {
        // **失败时不清草稿。** 这是整条通道唯一真正要保护的那一刻：正式保存失败了，
        // 草稿是这份工作仅存的一份，清掉它就等于把失败变成数据丢失。
        this.options.onStateChange?.('error', messageOf(error), codeOf(error))
        return
      }

      // 写入期间又变脏了：**不清草稿**，让紧接着那一轮 flush 重写一份新的再清。
      // 清了的话，从这一刻到下一轮写完之间，那批新编辑没有任何地方存着。
      if (this.dirtyDuringSave) return

      this.edits = Math.max(0, this.edits - edits)
      try {
        await this.options.clearDraft?.()
      } catch (error) {
        // 正式保存已经成功了，所以这不是保存失败——但草稿留着会让下一次开机误报崩溃。
        console.warn('[autosave] 草稿清理失败，下次开机可能会多问一次是否恢复。', error)
      }
      // Only report success if nothing arrived while we were writing; otherwise "已保存"
      // would be claiming something about a document that is no longer the current one.
      this.options.onStateChange?.('saved')
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

  /** T-288 · 还没落盘的编辑次数。崩溃横幅上那个数字的来源。 */
  get unsavedEdits(): number {
    return this.edits
  }

  /**
   * 写一份草稿，**同一时刻只有一次在飞**。
   *
   * 合并而不是排队：连着改二十笔，排队会得到二十次库写入，而只有最后一次的内容是
   * 有用的。在飞时记下最新的那一份，写完再补一次。
   */
  private async writeDraft(doc: SceneDocument): Promise<void> {
    if (!this.options.saveDraft) return
    if (this.draftInflight) {
      this.draftPending = doc
      return
    }
    this.draftInflight = (async () => {
      try {
        await this.options.saveDraft?.(doc, this.edits)
      } catch (error) {
        // 草稿写不进去不该打断编辑。它只影响「崩了之后能不能救回来」，而那件事
        // 此刻还没发生——把它变成一条保存失败提示，是拿一个假设的坏消息盖住真状态。
        console.warn('[autosave] 草稿写入失败，这次崩溃将无法恢复。', error)
      }
    })()
    await this.draftInflight
    this.draftInflight = null

    const pending = this.draftPending
    if (pending && !this.disposed) {
      this.draftPending = null
      await this.writeDraft(pending)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.handle !== null) this.clearTimer(this.handle)
    this.handle = null
  }
}
