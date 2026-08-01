import { createGoldenPathDocument } from '@w3/schema'
import type { Hotspot, SceneDocument } from '@w3/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DomHotspotRenderer } from '../../src/runtime/hotspot-layer.js'

/**
 * T-162 · media inside a hotspot panel.
 *
 * Runs in plain Node (C8) against a minimal DOM stub. What is being tested is not the
 * browser's rendering — it is the LIFECYCLE: every object URL created gets revoked, and the
 * count reaches zero. That leak is the expensive kind, because an object URL pins the whole
 * file in memory for the life of the tab: a viewer who opens twelve video hotspots while
 * walking through a machine is holding twelve videos until they reload.
 */

/** The smallest element that satisfies what the renderer touches. */
interface StubElement {
  className: string
  textContent: string
  readonly dataset: Record<string, string>
  readonly style: Record<string, string>
  readonly children: StubElement[]
  readonly tag: string
  src?: string
  controls?: boolean
  preload?: string
  type?: string
  appendChild(child: StubElement): void
  append(...children: StubElement[]): void
  remove(): void
  addEventListener(): void
  ownerDocument: { createElement(tag: string): StubElement }
}

function stubElement(tag: string): StubElement {
  const element: StubElement = {
    tag,
    className: '',
    textContent: '',
    dataset: {},
    style: {},
    children: [],
    appendChild(child) {
      element.children.push(child)
    },
    append(...children) {
      element.children.push(...children)
    },
    remove() {
      /* detached from a parent this stub does not model */
    },
    addEventListener() {
      /* the renderer wires a click handler it never fires here */
    },
    ownerDocument: { createElement: stubElement },
  }
  return element
}

/** The golden path plus one media record of the given type. */
function docWithMedia(type: 'image' | 'video'): { doc: SceneDocument; hotspot: Hotspot } {
  const base = createGoldenPathDocument()
  const doc = {
    ...base,
    assets: [...base.assets, { ...base.assets[0]!, id: 'ast_med00001', type, name: `讲解.${type}` }],
    media: [{ id: 'med_00000001', type, assetId: 'ast_med00001', name: '讲解' }],
    hotspots: base.hotspots.map((h) => ({ ...h, content: { ...h.content, mediaId: 'med_00000001' } })),
  } as SceneDocument
  return { doc, hotspot: doc.hotspots[0]! }
}

let created: string[]
let revoked: string[]

beforeEach(() => {
  created = []
  revoked = []
  let n = 0
  vi.stubGlobal('URL', {
    createObjectURL: () => {
      const url = `blob:stub/${++n}`
      created.push(url)
      return url
    },
    revokeObjectURL: (url: string) => void revoked.push(url),
  })
  vi.stubGlobal('Blob', class {})
})

afterEach(() => vi.unstubAllGlobals())

const makeRenderer = (resolveMedia?: (url: string) => Promise<ArrayBuffer>) =>
  new DomHotspotRenderer({
    container: stubElement('div') as unknown as HTMLElement,
    ...(resolveMedia ? { resolveMedia } : {}),
  })

/** Lets the renderer's own async attach settle. */
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

describe('rendering the media', () => {
  it('hangs an <img> in the panel for an image', async () => {
    const { doc, hotspot } = docWithMedia('image')
    const renderer = makeRenderer(async () => new ArrayBuffer(8))

    renderer.setPanelOpen(hotspot, true, doc)
    await flush()

    expect(renderer.liveObjectUrls).toBe(1)
    expect(created).toHaveLength(1)
  })

  it('gives a video native controls', async () => {
    // A bespoke transport bar is a v1 feature; the browser's own is keyboard-accessible and
    // familiar in a way a hand-rolled one would not be.
    const { doc, hotspot } = docWithMedia('video')
    const container = stubElement('div')
    const renderer = new DomHotspotRenderer({
      container: container as unknown as HTMLElement,
      resolveMedia: async () => new ArrayBuffer(8),
    })

    renderer.setPanelOpen(hotspot, true, doc)
    await flush()

    const panel = container.children.find((c) => c.className === 'w3-hotspot-panel')!
    const media = panel.children.find((c) => c.className === 'w3-hotspot-media')!
    expect(media.tag).toBe('video')
    expect(media.controls).toBe(true)
    // 自适应展示, stated inline: these classes have no stylesheet anywhere, so a 4000 px
    // photo would otherwise blow the panel off the screen.
    expect(media.style['maxWidth']).toBe('100%')
  })

  it('shows the text immediately and does not wait on the media', () => {
    // A panel that appears only once a video's first bytes arrive reads as a broken click.
    const { doc, hotspot } = docWithMedia('video')
    const container = stubElement('div')
    const renderer = new DomHotspotRenderer({
      container: container as unknown as HTMLElement,
      resolveMedia: () => new Promise<ArrayBuffer>(() => {}), // never resolves
    })

    renderer.setPanelOpen(hotspot, true, doc)

    expect(renderer.isPanelOpen(hotspot.id)).toBe(true)
    expect(container.children.some((c) => c.className === 'w3-hotspot-panel')).toBe(true)
  })

  it('renders text only when this build has no resolver', async () => {
    // The parity harness and the v0 tests construct it without one, and that is a valid
    // configuration rather than a broken renderer.
    const { doc, hotspot } = docWithMedia('image')
    const renderer = makeRenderer()

    renderer.setPanelOpen(hotspot, true, doc)
    await flush()

    expect(renderer.liveObjectUrls).toBe(0)
    expect(renderer.isPanelOpen(hotspot.id)).toBe(true)
  })

  it('survives a file that cannot be read, and SAYS so', async () => {
    // Two halves. The panel must not go down — the text is still worth showing. And the
    // failure must not vanish: a picture that never appears with nothing in the console is
    // a bug report with no information in it.
    const { doc, hotspot } = docWithMedia('image')
    const warnings: string[] = []
    const renderer = new DomHotspotRenderer({
      container: stubElement('div') as unknown as HTMLElement,
      resolveMedia: async () => {
        throw new Error('missing')
      },
      onWarn: (message) => void warnings.push(message),
    })

    renderer.setPanelOpen(hotspot, true, doc)
    await flush()

    expect(renderer.liveObjectUrls).toBe(0)
    expect(renderer.isPanelOpen(hotspot.id), '文字还是值得显示的').toBe(true)
    expect(warnings[0], '要说清是哪个热点的哪个文件').toMatch(/媒体读取失败/)
    expect(warnings[0]).toContain('讲解.image')
  })
})

describe('the object-URL lifecycle (卡片验收：revoke 计数归零无泄漏)', () => {
  it('revokes when the panel closes', async () => {
    const { doc, hotspot } = docWithMedia('image')
    const renderer = makeRenderer(async () => new ArrayBuffer(8))

    renderer.setPanelOpen(hotspot, true, doc)
    await flush()
    expect(renderer.liveObjectUrls).toBe(1)

    renderer.setPanelOpen(hotspot, false, doc)

    expect(renderer.liveObjectUrls).toBe(0)
    expect(revoked).toEqual(created)
  })

  it('revokes every one of them when all panels close', async () => {
    const base = docWithMedia('image')
    const doc: SceneDocument = {
      ...base.doc,
      hotspots: [base.hotspot, { ...base.hotspot, id: 'hs_22223333' }],
    } as SceneDocument
    const renderer = makeRenderer(async () => new ArrayBuffer(8))

    renderer.setPanelOpen(doc.hotspots[0]!, true, doc)
    renderer.setPanelOpen(doc.hotspots[1]!, true, doc)
    await flush()
    expect(renderer.liveObjectUrls).toBe(2)

    renderer.closeAllPanels()

    expect(renderer.liveObjectUrls).toBe(0)
    expect(revoked.sort()).toEqual(created.sort())
  })

  it('creates NOTHING for a panel closed while its bytes were in flight', async () => {
    // The subtle leak: the URL is created after the panel is gone, so nothing is left to
    // revoke it. Closing has to be observable to the attach that is still running.
    const { doc, hotspot } = docWithMedia('image')
    let release: (bytes: ArrayBuffer) => void = () => {}
    const renderer = makeRenderer(() => new Promise<ArrayBuffer>((resolve) => void (release = resolve)))

    renderer.setPanelOpen(hotspot, true, doc)
    renderer.setPanelOpen(hotspot, false, doc)
    release(new ArrayBuffer(8))
    await flush()

    expect(created, '面板都没了，就不该再造 URL').toHaveLength(0)
    expect(renderer.liveObjectUrls).toBe(0)
  })

  it('does not leak when the same panel is opened twice', async () => {
    const { doc, hotspot } = docWithMedia('image')
    const renderer = makeRenderer(async () => new ArrayBuffer(8))

    renderer.setPanelOpen(hotspot, true, doc)
    await flush()
    renderer.setPanelOpen(hotspot, true, doc) // already open: a no-op
    await flush()

    expect(created).toHaveLength(1)
    expect(renderer.liveObjectUrls).toBe(1)
  })
})
