import type { FactoryContext, IdFactory, Node, Primitive, PrimitiveKind, SceneDocument, Vec3 } from '@w3/schema'
import {
  DEFAULT_MATERIAL_NAME,
  PRIMITIVE_KINDS,
  PRIMITIVE_LABELS,
  createPrimitiveNode,
  ensureDefaultMaterial,
  identityTransform,
} from '@w3/schema'
import type { AssetLoader } from '@w3/core'
import type { StorageProvider } from '@w3/storage'
import { importAsset } from './import-flow.js'
import type { ImportResult } from './import-flow.js'

/**
 * T-141 · the built-in library, as data.
 *
 * Two very different kinds of thing live behind one panel, and keeping them apart is the
 * whole design:
 *
 * **Primitives** are not content. They are seven `kind` values in the schema, and creating
 * one writes a node — no bytes, no asset record, no storage. They are listed here so the
 * panel has one list to render, not because they are library items.
 *
 * **Library items** are files under `packages/editor/public/library/`, described by a
 * manifest this module loads and validates. They become project assets only when the user
 * actually uses one, and they get there through the NORMAL import pipeline (D17): same
 * hash dedup, same health check, same storage. There is no second way into the document.
 *
 * Nothing here reaches the network beyond the app's own origin (C6): the manifest and every
 * file it names are static assets served from the editor's own `public/` directory, exactly
 * like the vendored Draco decoder.
 */

export const LIBRARY_CATEGORIES = ['model', 'texture', 'hdri'] as const
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number]

export interface LibraryItem {
  readonly id: string
  readonly name: string
  readonly category: LibraryCategory
  /** Path relative to the library root. Never a URL — `check-library-manifest.mjs` enforces it. */
  readonly file: string
  readonly preview: string
  readonly license: string
  readonly author: string
  readonly note?: string
}

export interface Library {
  readonly items: readonly LibraryItem[]
  /** What went wrong, if anything. The panel shows this rather than rendering nothing. */
  readonly error: string | null
}

export const EMPTY_LIBRARY: Library = { items: [], error: null }

/** Where the library lives, relative to the app's base URL. */
export const LIBRARY_ROOT = 'library/'

/** Absolute-in-the-app url for a path from the manifest. */
export function libraryUrl(path: string, base: string): string {
  return new URL(`${LIBRARY_ROOT}${path}`, base).toString()
}

const isCategory = (value: unknown): value is LibraryCategory =>
  typeof value === 'string' && (LIBRARY_CATEGORIES as readonly string[]).includes(value)

/**
 * Validates one manifest entry.
 *
 * The build-time script (`check-library-manifest.mjs`) checks the same rules, and this is
 * not redundant: that one guards the repository, this one guards the RUNNING editor against
 * a manifest edited by whoever deploys it. A malformed entry is dropped rather than
 * throwing — one bad row must not empty the panel.
 */
function parseItem(raw: unknown): LibraryItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as Record<string, unknown>
  if (typeof item.id !== 'string' || item.id === '') return null
  if (typeof item.name !== 'string' || item.name === '') return null
  if (!isCategory(item.category)) return null
  if (typeof item.file !== 'string' || typeof item.preview !== 'string') return null
  // Risk V1 · an item with no licence is an item nobody asked the question about. Dropping
  // it is deliberate: showing it would put content of unknown provenance one click from a
  // customer's deliverable.
  if (typeof item.license !== 'string' || item.license === '') return null
  if (typeof item.author !== 'string' || item.author === '') return null
  // C6 · a path, never a URL. The build script blocks this in the repository; a deployment
  // that hand-edited the manifest gets it blocked here too.
  for (const path of [item.file, item.preview]) {
    if (/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(path) || path.includes('..')) return null
  }
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    file: item.file,
    preview: item.preview,
    license: item.license,
    author: item.author,
    ...(typeof item.note === 'string' ? { note: item.note } : {}),
  }
}

export interface LoadLibraryOptions {
  /**
   * Where the app is served from — `document.baseURI` in the browser.
   *
   * Required rather than defaulted. A fallback constant would be an absolute URL literal in
   * the source, which lands in the bundle and is exactly what the C6 guard exists to catch:
   * `http://localhost/` in build output is indistinguishable, to a scanner and to a
   * reviewer, from a real external dependency.
   */
  readonly base: string
  /** Injected in tests. Production passes the browser's own `fetch`. */
  readonly fetch?: typeof globalThis.fetch
}

/**
 * Loads and validates the manifest.
 *
 * Never rejects. A missing or broken library is a panel with a message in it, not an editor
 * that fails to open — the library is an accelerator, and losing it must not cost the user
 * the project they had open.
 */
export async function loadLibrary(options: LoadLibraryOptions): Promise<Library> {
  const doFetch = options.fetch ?? globalThis.fetch
  const { base } = options
  if (!doFetch) return { items: [], error: '当前环境不支持加载内置库' }

  let raw: unknown
  try {
    const response = await doFetch(libraryUrl('manifest.json', base))
    if (!response.ok) return { items: [], error: `内置库清单读取失败（HTTP ${response.status}）` }
    raw = await response.json()
  } catch (error) {
    return { items: [], error: `内置库清单读取失败：${error instanceof Error ? error.message : String(error)}` }
  }

  if (typeof raw !== 'object' || raw === null) return { items: [], error: '内置库清单格式不正确' }
  const manifest = raw as Record<string, unknown>
  if (manifest.version !== 1) return { items: [], error: `内置库清单版本 ${String(manifest.version)} 不受支持` }
  if (!Array.isArray(manifest.items)) return { items: [], error: '内置库清单缺少 items' }

  const items: LibraryItem[] = []
  let dropped = 0
  const seen = new Set<string>()
  for (const entry of manifest.items) {
    const item = parseItem(entry)
    if (!item || seen.has(item.id)) {
      dropped++
      continue
    }
    seen.add(item.id)
    items.push(item)
  }

  return {
    items,
    // Said out loud rather than swallowed: a library that silently shows five of its eight
    // items is indistinguishable from a library with five items.
    error: dropped > 0 ? `内置库中有 ${dropped} 项不合规已跳过（缺少 license 或路径不合法）` : null,
  }
}

export const itemsOf = (library: Library, category: LibraryCategory): readonly LibraryItem[] =>
  library.items.filter((item) => item.category === category)

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

/** `'ensure'` creates the shared 默认材质 record if it is missing; `'existing'` never does. */
export type MaterialPolicy = 'ensure' | 'existing'

export interface PrimitiveTemplate {
  readonly kind: PrimitiveKind
  readonly label: string
  /** The primitive a fresh one is created with — the schema's own defaults, written out. */
  readonly primitive: Primitive
}

/**
 * The seven primitives, in the order the panel lists them.
 *
 * The defaults are the schema's, transcribed. They are written out rather than parsed out
 * of the zod schema because a panel needs a concrete object to commit, and because
 * `PrimitiveSchema.parse({ kind })` would tie the palette to zod's default-filling
 * behaviour — a dependency in the wrong direction for a list of buttons.
 */
export const PRIMITIVE_TEMPLATES: readonly PrimitiveTemplate[] = PRIMITIVE_KINDS.map((kind) => ({
  kind,
  label: PRIMITIVE_LABELS[kind],
  primitive: defaultPrimitive(kind),
}))

/**
 * Adds a primitive to the document, with a real material record.
 *
 * D15 · the material is EXPLICIT. Core will fall back to a neutral grey for an
 * unmateriated primitive, and as the normal path that would be a rendering state the user
 * can see and cannot edit: the material panel shows nothing while the object is clearly
 * not default-coloured. So `ensureDefaultMaterial` puts a shared 「默认材质」 record in the
 * document and the node points at it.
 *
 * Mutates a draft — call it inside `commit`, never on a live document. One call is one
 * undo entry covering both the node and (on the first primitive) the material record.
 */
export function addPrimitive(
  draft: SceneDocument,
  template: PrimitiveTemplate,
  options: { position?: Vec3; name?: string; ctx?: FactoryContext; material?: MaterialPolicy } = {},
): Node {
  // T-146 · `'existing'` is for the drag ghost. Creating the shared record and then undoing
  // that creation is what a cancelled drag would do, and a material REMOVE is one of the
  // few patches the runtime deliberately answers with a full rebuild — so an ordinary
  // "changed my mind" gesture rebuilt the entire scene. The ghost borrows the record if the
  // project already has one and goes without if it does not (core's own neutral grey is the
  // same colour); the drop creates it for real.
  const materialId =
    options.material === 'existing'
      ? (draft.materials.find((m) => m.name === DEFAULT_MATERIAL_NAME)?.id ?? null)
      : ensureDefaultMaterial(draft, options.ctx)
  const node = createPrimitiveNode(draft, {
    name: options.name ?? template.label,
    primitive: template.primitive,
    ...(materialId !== null ? { overrides: { materialId } } : {}),
    ...(options.position ? { transform: { ...identityTransform(), p: options.position } } : {}),
    ...(options.ctx ? { ctx: options.ctx } : {}),
  })
  draft.nodes.push(node)
  return node
}

export interface ImportLibraryItemOptions {
  readonly item: LibraryItem
  readonly doc: SceneDocument
  readonly storage: StorageProvider
  readonly loader: AssetLoader
  /** Where the app is served from. Required — see `LoadLibraryOptions.base`. */
  readonly base: string
  readonly fetch?: typeof globalThis.fetch
  readonly newId?: IdFactory
  readonly now?: () => string
}

/**
 * Brings a library item into the project as an asset.
 *
 * D17's third discipline: **it goes through the normal import pipeline.** Hash dedup, the
 * health check, the thumbnail, the asset record — all of it. A library-specific storage
 * path would be a second way for bytes to enter a project, and the two would drift the
 * first time either one changed.
 *
 * The consequence worth stating: bringing the same item in twice costs nothing and yields
 * the same asset, because the hash is the same. The library is a source of files, not a
 * parallel asset system, and the published `.w3p` never learns that a library exists.
 */
export async function importLibraryItem(options: ImportLibraryItemOptions): Promise<ImportResult> {
  const { item, doc, storage, loader } = options
  const doFetch = options.fetch ?? globalThis.fetch
  const response = await doFetch(libraryUrl(item.file, options.base))
  if (!response.ok) throw new Error(`内置库文件读取失败（HTTP ${response.status}）：${item.file}`)
  const bytes = await response.arrayBuffer()

  return importAsset({
    // The manifest's display name, not the path: 「展示台」 is what the user picked, and
    // `display-stand.glb` is an implementation detail of where it happened to be stored.
    file: { name: fileNameFor(item), bytes },
    doc,
    storage,
    loader,
    ...(options.newId ? { newId: options.newId } : {}),
    ...(options.now ? { now: options.now } : {}),
  })
}

/** `展示台.glb` — the user's name, the file's extension. The extension drives classification. */
function fileNameFor(item: LibraryItem): string {
  const dot = item.file.lastIndexOf('.')
  return dot === -1 ? item.name : `${item.name}${item.file.slice(dot)}`
}

function defaultPrimitive(kind: PrimitiveKind): Primitive {
  switch (kind) {
    case 'box':
      return { kind, size: [1, 1, 1] }
    case 'sphere':
      return { kind, radius: 0.5 }
    case 'cylinder':
      return { kind, radiusTop: 0.5, radiusBottom: 0.5, height: 1 }
    case 'cone':
      return { kind, radius: 0.5, height: 1 }
    case 'torus':
      return { kind, radius: 0.5, tube: 0.15 }
    case 'plane':
      return { kind, width: 1, height: 1 }
    case 'capsule':
      return { kind, radius: 0.3, length: 0.6 }
  }
}
