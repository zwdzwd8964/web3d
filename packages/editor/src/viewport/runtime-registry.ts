import type { SceneRuntime } from '@w3/core'

/**
 * The one live SceneRuntime, so the document store's `onPatch` can reach it.
 *
 * A module-level handle rather than React context because the store is created before
 * the tree mounts and outlives it: threading it through context would mean the store had
 * to be recreated whenever the viewport remounted, which would drop the undo history.
 *
 * This holds a RUNTIME object, not business state — C1 is about persistable state, and a
 * renderer handle is neither persistable nor state.
 */
let active: SceneRuntime | null = null
/** Set by the app so the DEV document hook can read the store without importing it. */
let activeDoc: (() => unknown) | null = null

/** Registers the live document reader. DEV hooks only; production never calls it. */
export function setActiveDocumentReader(read: (() => unknown) | null): void {
  activeDoc = read
}

export function setActiveRuntime(runtime: SceneRuntime | null): void {
  active = runtime
}

export function getActiveRuntime(): SceneRuntime | null {
  return active
}

/** D1's fallback counter, surfaced for the status bar and for the E2E assertion. */
export function fullRebuildCount(): number {
  return active?.fullRebuildCount ?? 0
}


/**
 * DEV-only locator, for the golden-path E2E.
 *
 * Stripped from production builds by the guard. It forwards to `SceneRuntime.projectToScreen`
 * — a real runtime capability — rather than reimplementing the projection, so the thing the
 * test clicks is the thing the renderer says is there.
 *
 * Read-only: it exposes no way to change anything, so it cannot become a back door around
 * the commit channel.
 */
if (import.meta.env.DEV) {
  ;(globalThis as Record<string, unknown>)['__w3DevLocate'] = (nodeId: string) =>
    active?.projectToScreen(nodeId) ?? null

  /**
   * DEV-only read-back of the live document.
   *
   * For the assertions the DOM cannot make: 「包围盒底面对齐地面」 is a number in
   * `transform.p`, and no panel shows it to three decimal places. Read-only — it hands back
   * the same frozen object the store holds, and there is no setter anywhere near it.
   */
  ;(globalThis as Record<string, unknown>)['__w3DevDoc'] = () => activeDoc?.() ?? null

  /**
   * DEV-only read-back of the runtime's media state.
   *
   * Golden path II step 11 asserts that clicking the pump starts the alarm. It must NOT
   * assert the sound card: CI has no audio device, so 「真的响了」 is unassertable and any
   * attempt at it is a flaky test wearing a confident face (进化规划 §2 says so outright).
   * What IS a real claim is that the runtime considers it playing — the same state
   * `stopMedia('all')` acts on and the same one the player would report.
   *
   * Read-only, like the other two hooks.
   */
  ;(globalThis as Record<string, unknown>)['__w3DevMediaPlaying'] = (mediaId: string): boolean =>
    active?.isMediaPlaying(mediaId) ?? false

  /**
   * DEV-only read-back of the material the RENDERER is holding for a node.
   *
   * The golden-path E2E has to be able to tell "the document says roughness 0.05" from
   * "the thing on screen is drawn with roughness 0.05" — those are two different claims,
   * and the whole point of D1's patch path is that the second follows from the first.
   * Reading the panel back only ever proves the first. Pixels could prove the second, but
   * a roughness change on a flat quad can move a specular lobe by less than one 8-bit
   * step, so a pixel assertion there would be a coin flip dressed up as a test.
   *
   * Duck-typed rather than imported from three: the editor owns no 3D behaviour (C3) and
   * has no `import 'three'` anywhere, and one test hook is not a reason to start.
   * Read-only, like `__w3DevLocate` — it exposes no way to change anything.
   */
  ;(globalThis as Record<string, unknown>)['__w3DevMaterialOf'] = (nodeId: string): MaterialProbe | null => {
    const object = active?.graph.objectFor(nodeId)
    if (!object) return null
    const found: MaterialProbe[] = []
    object.traverse((child) => {
      if (found.length > 0) return
      const mesh = child as unknown as { isMesh?: boolean; material?: unknown }
      if (mesh.isMesh !== true) return
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      if (material === null || typeof material !== 'object') return
      const read = material as {
        roughness?: unknown
        metalness?: unknown
        opacity?: unknown
        transmission?: unknown
        color?: { getHexString?: () => string }
        map?: { name?: unknown } | null
        type?: unknown
      }
      found.push({
        roughness: typeof read.roughness === 'number' ? read.roughness : null,
        metalness: typeof read.metalness === 'number' ? read.metalness : null,
        opacity: typeof read.opacity === 'number' ? read.opacity : null,
        transmission: typeof read.transmission === 'number' ? read.transmission : null,
        color: typeof read.color?.getHexString === 'function' ? `#${read.color.getHexString()}` : null,
        // M11 · 「文档里写着一张贴图」 and 「渲染器手上有一张贴图」 are two different claims,
        // and the second is the one the user sees. Nothing checked it until this review:
        // the panel and the E2E both read the document back. The texture's NAME rather than
        // a boolean, so a test can tell WHICH texture arrived.
        map: read.map != null && typeof read.map.name === 'string' ? read.map.name : null,
        base: typeof read.type === 'string' ? read.type : null,
      })
    })
    return found[0] ?? null
  }
}

/** What `__w3DevMaterialOf` reports: the live three material's numbers, or null per field. */
interface MaterialProbe {
  readonly roughness: number | null
  readonly metalness: number | null
  readonly opacity: number | null
  readonly transmission: number | null
  readonly color: string | null
  /** The Texture's name — the asset's file name — or null when the slot is empty. */
  readonly map: string | null
  /** three's class name, so a base change can be observed rather than inferred. */
  readonly base: string | null
}
