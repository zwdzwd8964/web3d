import type { SceneDocument } from '@w3/schema'
import type { LogLevel } from '../eca/types.js'
import { AbortError } from '../eca/types.js'

/**
 * T-163 · the scene's audio.
 *
 * Everything a rule started, everything `stopMedia('all')` stops, everything that goes quiet
 * when preview mode is left. Auditioning a clip in the media library deliberately does NOT
 * go through here (T-161): that is not part of the scene, and routing it through the bus
 * would mean a preview clip died when a rule fired, or kept playing when the user pressed
 * stop in the viewport.
 *
 * **Autoplay is the risk this class exists to contain (V3).** Browsers refuse to play audio
 * before the user has interacted with the page, and the refusal arrives as a rejected
 * promise. Letting that rejection through would abort the whole rule chain — 「响完铃再弹
 * 面板」 becomes 「铃没响，面板也没弹」, and the user sees nothing at all rather than one
 * missing sound. So a blocked play RESOLVES and warns: the rest of the sequence runs.
 *
 * The elements themselves are pooled per media id, because creating an `<audio>` per play
 * leaks decoders on a scene where a rule fires every few seconds.
 */

export interface MediaBusOptions {
  /** Resolves a media asset's bytes. Injected — core does no I/O of its own. */
  readonly resolve: (url: string) => Promise<ArrayBuffer>
  /**
   * Creates a media element. Injected so the whole bus — pooling, volume, loop, abort,
   * the autoplay fallback — runs in plain Node (C8). Absent means this build cannot play
   * anything, which is what the parity harness and the ECA tests are.
   */
  readonly createElement?: (type: 'audio' | 'video') => MediaElementLike
  readonly log?: (level: LogLevel, message: string, data?: unknown) => void
}

/** The slice of `HTMLMediaElement` the bus touches. */
export interface MediaElementLike {
  src: string
  volume: number
  loop: boolean
  currentTime: number
  play(): Promise<void>
  pause(): void
  addEventListener(type: 'ended', listener: () => void): void
  removeEventListener(type: 'ended', listener: () => void): void
}

interface Entry {
  readonly element: MediaElementLike
  /** Set while this media is playing; cleared on stop or end. */
  onEnded: (() => void) | null
  playing: boolean
}

export class MediaBus {
  private entries = new Map<string, Entry>()
  private objectUrls = new Map<string, string>()
  private document: SceneDocument | null = null

  constructor(private readonly options: MediaBusOptions) {}

  /**
   * The document media ids are resolved against. Re-set on every load and patch batch.
   *
   * Anything the new document no longer contains is STOPPED and released (M12 审查所得).
   * Deleting a clip while it plays otherwise leaves it sounding for ever with nothing left
   * to stop it: the media panel's row is gone, so there is no 停止 button, and the document
   * no longer mentions it — the user's only remaining option is reloading the page.
   */
  setDocument(doc: SceneDocument): void {
    this.document = doc
    const live = new Set(doc.media.map((m) => m.id))
    for (const id of [...this.entries.keys()]) {
      if (live.has(id)) continue
      this.stop(id)
      this.entries.delete(id)
      const url = this.objectUrls.get(id)
      if (url !== undefined) {
        URL.revokeObjectURL(url)
        this.objectUrls.delete(id)
      }
    }
  }

  /** Media ids currently playing. The set `stopMedia('all')` acts on. */
  get playingIds(): readonly string[] {
    return [...this.entries.entries()].filter(([, entry]) => entry.playing).map(([id]) => id)
  }

  isPlaying(mediaId: string): boolean {
    return this.entries.get(mediaId)?.playing === true
  }

  /**
   * Starts a clip. Resolves when it has STARTED, not when it ends — awaiting the end is the
   * action's job (D19), because only the action knows whether the rule asked for it.
   *
   * Resolves rather than rejects when the browser refuses to autoplay. See the class note.
   */
  async play(mediaId: string, options: { loop?: boolean; volume?: number } = {}): Promise<void> {
    const entry = await this.entryFor(mediaId)
    if (!entry) return

    entry.element.loop = options.loop ?? false
    entry.element.volume = clampVolume(options.volume)
    // From the top: replaying a clip that already finished must not be a silent no-op.
    entry.element.currentTime = 0

    const finished = () => {
      entry.playing = false
    }
    // One listener per play, removed on stop — otherwise a clip played thirty times has
    // thirty listeners and the last stop clears none of them.
    if (entry.onEnded) entry.element.removeEventListener('ended', entry.onEnded)
    entry.onEnded = finished
    entry.element.addEventListener('ended', finished)

    try {
      await entry.element.play()
      entry.playing = true
    } catch (error) {
      // V3 · autoplay policy. The sequence must keep running.
      entry.playing = false
      this.options.log?.(
        'warn',
        `媒体「${this.nameOf(mediaId)}」未能播放：浏览器在用户与页面交互前不允许自动播放。规则会继续执行，声音这一步被跳过。`,
        error,
      )
    }
  }

  /** Stops one clip, or every clip. Idempotent — stopping what is not playing is fine. */
  stop(mediaId: string | 'all'): void {
    const ids = mediaId === 'all' ? [...this.entries.keys()] : [mediaId]
    for (const id of ids) {
      const entry = this.entries.get(id)
      if (!entry) continue
      entry.element.pause()
      entry.element.currentTime = 0
      entry.playing = false
      if (entry.onEnded) {
        entry.element.removeEventListener('ended', entry.onEnded)
        entry.onEnded = null
      }
    }
  }

  /**
   * Waits for a clip to end, or for the signal to abort.
   *
   * Listens for the real `ended` event, so a clip whose actual length differs from the
   * recorded `durationS` still finishes on time. The ACTION supplies the timeout half
   * (D19: headless advances a fake clock by `durationS`) — whichever arrives first wins.
   */
  waitForEnd(mediaId: string, signal?: AbortSignal): Promise<void> {
    const entry = this.entries.get(mediaId)
    if (!entry || !entry.playing) return Promise.resolve()

    return new Promise<void>((resolve, reject) => {
      const done = () => {
        entry.element.removeEventListener('ended', onEnded)
        signal?.removeEventListener('abort', onAbort)
      }
      const onEnded = () => {
        entry.playing = false
        done()
        resolve()
      }
      const onAbort = () => {
        done()
        reject(new AbortError())
      }
      entry.element.addEventListener('ended', onEnded)
      signal?.addEventListener('abort', onAbort)
    })
  }

  /** Releases every element and object URL. Called from `dispose` and on document swap. */
  disposeAll(): void {
    this.stop('all')
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url)
    this.objectUrls.clear()
    this.entries.clear()
  }

  private nameOf(mediaId: string): string {
    return this.document?.media.find((m) => m.id === mediaId)?.name ?? mediaId
  }

  /**
   * The pooled element for a media id, creating and loading it on first use.
   *
   * Lazy rather than eager: a scene with forty narration clips should not fetch forty files
   * because one rule might play one of them.
   */
  private async entryFor(mediaId: string): Promise<Entry | null> {
    const existing = this.entries.get(mediaId)
    if (existing) return existing

    const create = this.options.createElement
    const media = this.document?.media.find((m) => m.id === mediaId)
    const asset = media ? this.document?.assets.find((a) => a.id === media.assetId) : undefined
    if (!create || !media || !asset) {
      if (create && !media) this.options.log?.('warn', `找不到媒体记录：${mediaId}`)
      return null
    }

    let bytes: ArrayBuffer
    try {
      bytes = await this.options.resolve(asset.url)
    } catch (error) {
      this.options.log?.('error', `媒体文件读取失败：${asset.name}`, error)
      return null
    }

    const url = URL.createObjectURL(new Blob([bytes]))
    this.objectUrls.set(mediaId, url)

    const element = create(media.type === 'video' ? 'video' : 'audio')
    element.src = url
    const entry: Entry = { element, onEnded: null, playing: false }
    this.entries.set(mediaId, entry)
    return entry
  }
}

/** Volume is 0–1; anything else is a mistake that would otherwise throw inside the element. */
const clampVolume = (volume: number | undefined): number =>
  volume === undefined || !Number.isFinite(volume) ? 1 : Math.min(1, Math.max(0, volume))

/** The browser element factory, or nothing outside a browser. */
export function browserMediaElements(): MediaBusOptions['createElement'] | undefined {
  if (typeof document === 'undefined') return undefined
  return (type) => document.createElement(type) as unknown as MediaElementLike
}
