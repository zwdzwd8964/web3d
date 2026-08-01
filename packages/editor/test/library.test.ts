import { readFileSync } from 'node:fs'
import { checkIntegrity, createGoldenPathDocument, errorsOf, validate } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { MemoryProvider } from '@w3/storage'
import { produce } from 'immer'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  EMPTY_LIBRARY,
  PRIMITIVE_TEMPLATES,
  addPrimitive,
  importLibraryItem,
  itemsOf,
  libraryUrl,
  loadLibrary,
} from '../src/lib/library.js'
import type { LibraryItem } from '../src/lib/library.js'
import { ProjectSession } from '../src/project/session.js'

/**
 * T-141 · the built-in library.
 *
 * The manifest that ships with the repository is the input for most of this: a library
 * whose validator only ever sees hand-written fixtures proves nothing about the eight
 * items a user actually sees.
 */

const REPO_MANIFEST = new URL('../public/library/manifest.json', import.meta.url)

const manifestJson = () => JSON.parse(readFileSync(REPO_MANIFEST, 'utf8')) as Record<string, unknown>

/** A fetch that answers from a map of url → body, and 404s for anything else. */
function fakeFetch(files: Record<string, string | ArrayBuffer>): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
    const key = Object.keys(files).find((k) => url.endsWith(k))
    if (key === undefined) return { ok: false, status: 404 } as Response
    const body = files[key]!
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(body as string) as unknown,
      arrayBuffer: async () => (typeof body === 'string' ? new TextEncoder().encode(body).buffer : body),
    } as Response
  }) as typeof globalThis.fetch
}

let storage: MemoryProvider
let session: ProjectSession

beforeEach(() => {
  storage = new MemoryProvider()
  session = new ProjectSession({ storage })
})

describe('loadLibrary', () => {
  it('loads the manifest this repository actually ships', async () => {
    const library = await loadLibrary({ fetch: fakeFetch({ 'manifest.json': JSON.stringify(manifestJson()) }) })
    expect(library.error).toBeNull()
    expect(library.items.length).toBeGreaterThan(0)
    expect(itemsOf(library, 'model').length).toBeGreaterThan(0)
    expect(itemsOf(library, 'texture').length).toBeGreaterThan(0)
    expect(itemsOf(library, 'hdri').length).toBeGreaterThan(0)
  })

  it('drops an item with no licence, and says how many it dropped', async () => {
    // Risk V1. Showing an unlicensed item would put content of unknown provenance one
    // click away from a customer deliverable; showing 5 of 8 silently is worse than saying so.
    const manifest = manifestJson()
    const items = manifest.items as Record<string, unknown>[]
    delete items[0]!.license
    const library = await loadLibrary({ fetch: fakeFetch({ 'manifest.json': JSON.stringify(manifest) }) })
    expect(library.items).toHaveLength(items.length - 1)
    expect(library.error).toContain('1 项')
  })

  it('drops an item whose path is a URL (C6)', async () => {
    const manifest = manifestJson()
    ;(manifest.items as Record<string, unknown>[])[1]!.file = 'https://cdn.example.com/a.png'
    const library = await loadLibrary({ fetch: fakeFetch({ 'manifest.json': JSON.stringify(manifest) }) })
    expect(library.items.map((i) => i.file).some((f) => f.startsWith('http'))).toBe(false)
    expect(library.error).not.toBeNull()
  })

  it('drops an item whose path escapes the library root', async () => {
    const manifest = manifestJson()
    ;(manifest.items as Record<string, unknown>[])[1]!.file = '../../../etc/passwd'
    const library = await loadLibrary({ fetch: fakeFetch({ 'manifest.json': JSON.stringify(manifest) }) })
    expect(library.items.some((i) => i.file.includes('..'))).toBe(false)
  })

  it('refuses a manifest version it does not understand', async () => {
    const library = await loadLibrary({ fetch: fakeFetch({ 'manifest.json': JSON.stringify({ version: 99, items: [] }) }) })
    expect(library.items).toEqual([])
    expect(library.error).toContain('99')
  })

  it('reports a missing library instead of failing to open the editor', async () => {
    // The library is an accelerator. Losing it must not cost the user the project they had
    // open, so every failure path returns a message and an empty list.
    expect(await loadLibrary({ fetch: fakeFetch({}) })).toEqual({ items: [], error: expect.stringContaining('404') })
    const throwing = (async () => {
      throw new Error('offline')
    }) as unknown as typeof globalThis.fetch
    expect((await loadLibrary({ fetch: throwing })).error).toContain('offline')
  })

  it('builds urls under the app’s own origin, never anywhere else', () => {
    expect(libraryUrl('models/a.glb', 'http://localhost:5180/')).toBe('http://localhost:5180/library/models/a.glb')
    expect(libraryUrl('models/a.glb', 'http://localhost:5180/editor/')).toBe('http://localhost:5180/editor/library/models/a.glb')
  })
})

describe('primitives', () => {
  it('offers all seven, labelled in Chinese', () => {
    expect(PRIMITIVE_TEMPLATES).toHaveLength(7)
    expect(PRIMITIVE_TEMPLATES.map((t) => t.kind)).toEqual([
      'box',
      'sphere',
      'cylinder',
      'cone',
      'torus',
      'plane',
      'capsule',
    ])
    for (const template of PRIMITIVE_TEMPLATES) expect(template.label).not.toBe(template.kind)
  })

  it('every template validates as a document node', () => {
    for (const template of PRIMITIVE_TEMPLATES) {
      const doc = produce(createGoldenPathDocument(), (draft) => void addPrimitive(draft, template))
      expect(validate(doc).ok, template.kind).toBe(true)
      expect(errorsOf(checkIntegrity(doc)), template.kind).toEqual([])
    }
  })

  it('gives the new node a REAL material record, not a hidden default (D15)', () => {
    // Core would draw an unmateriated primitive neutral grey. As the normal path that is a
    // rendering state the user can see and cannot edit — the material panel shows nothing
    // while the object is clearly not default-coloured.
    const doc = produce(createGoldenPathDocument(), (draft) => void addPrimitive(draft, PRIMITIVE_TEMPLATES[0]!))
    const node = doc.nodes[doc.nodes.length - 1]!
    expect(node.primitive).toEqual({ kind: 'box', size: [1, 1, 1] })
    expect(node.overrides.materialId).toBeDefined()
    expect(doc.materials.find((m) => m.id === node.overrides.materialId)?.name).toBe('默认材质')
  })

  it('shares one 默认材质 across every primitive rather than making one each', () => {
    // Sharing is the design (D15): everything made with it changes together, which is what
    // a user expects from something called 默认材质. 「分离材质」 is how you opt out.
    const before = createGoldenPathDocument().materials.length
    const doc = produce(createGoldenPathDocument(), (draft) => {
      addPrimitive(draft, PRIMITIVE_TEMPLATES[0]!)
      addPrimitive(draft, PRIMITIVE_TEMPLATES[1]!)
      addPrimitive(draft, PRIMITIVE_TEMPLATES[2]!)
    })
    expect(doc.materials).toHaveLength(before + 1)
    const ids = new Set(doc.nodes.slice(-3).map((n) => n.overrides.materialId))
    expect(ids.size).toBe(1)
  })

  it('places at the position it is given, and at the origin otherwise', () => {
    const doc = produce(createGoldenPathDocument(), (draft) => {
      addPrimitive(draft, PRIMITIVE_TEMPLATES[0]!, { position: [1, 2, 3] })
      addPrimitive(draft, PRIMITIVE_TEMPLATES[0]!)
    })
    expect(doc.nodes[doc.nodes.length - 2]!.transform.p).toEqual([1, 2, 3])
    expect(doc.nodes[doc.nodes.length - 1]!.transform.p).toEqual([0, 0, 0])
  })
})

describe('importLibraryItem', () => {
  const glb = () => readFileSync(new URL('../public/library/models/display-stand.glb', import.meta.url))
  const item: LibraryItem = {
    id: 'model-display-stand',
    name: '展示台',
    category: 'model',
    file: 'models/display-stand.glb',
    preview: 'previews/model-display-stand.png',
    license: 'CC0-1.0',
    author: '本仓库程序化生成',
  }

  const bytesOf = (buffer: Buffer): ArrayBuffer =>
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

  const run = (doc: SceneDocument) =>
    importLibraryItem({
      item,
      doc,
      storage,
      loader: session.loader,
      base: 'http://localhost/',
      fetch: fakeFetch({ 'models/display-stand.glb': bytesOf(glb()) }),
    })

  it('goes through the normal import pipeline, health check and all (D17)', async () => {
    const result = await run(createGoldenPathDocument())
    expect(result.asset.type).toBe('model')
    // A real audit of real bytes, not a rubber stamp.
    expect(result.audit.audit.findings.length).toBeGreaterThan(0)
    expect(result.nodes.length).toBeGreaterThan(0)
    expect(await storage.hasBlob(result.hash)).toBe(true)
  })

  it('names the asset after the item, keeping the file’s extension', async () => {
    // 「展示台.glb」 — what the user picked plus what drives classification. The path
    // `models/display-stand.glb` is where it happened to be stored, which is not a name.
    const result = await run(createGoldenPathDocument())
    expect(result.asset.name).toBe('展示台.glb')
  })

  it('a second use of the same item costs no storage and reuses the asset', async () => {
    // The point of going through the normal pipeline: the library is a source of files,
    // not a parallel asset system. Same bytes, same hash, same record.
    const first = await run(createGoldenPathDocument())
    const doc = produce(createGoldenPathDocument(), (draft) => {
      draft.assets.push(first.asset)
      draft.nodes.push(...first.nodes.map((n) => ({ ...n })))
    })
    const second = await run(doc)
    expect(second.deduplicated).toBe(true)
    expect(second.asset.id).toBe(first.asset.id)
    // …but it still places another instance. Deduplication is about STORAGE.
    expect(second.nodes.length).toBeGreaterThan(0)
  })

  it('reports a missing library file rather than importing nothing', async () => {
    await expect(
      importLibraryItem({ item, doc: createGoldenPathDocument(), storage, loader: session.loader, base: 'http://localhost/', fetch: fakeFetch({}) }),
    ).rejects.toThrow(/内置库文件读取失败/)
  })
})

describe('EMPTY_LIBRARY', () => {
  it('is a usable empty state', () => {
    expect(itemsOf(EMPTY_LIBRARY, 'model')).toEqual([])
  })
})
