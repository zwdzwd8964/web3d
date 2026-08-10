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

/**
 * T-254 · 编辑期预览播放一条动画。
 *
 * **不进文档、不进撤销栈**——播放进度是运行时瞬态（铁律 1 明写的那条例外）。面板不能
 * 自己 `import { getActiveRuntime }` 之后随手调任意方法：那样一来「面板能对运行时做什么」
 * 就没有边界了。这里只开两个方法，各自一行。
 *
 * 返回 false = 此刻没有活着的运行时（视口还没挂载）。调用方据此禁用按钮。
 */
export function previewAnimation(animationId: string): boolean {
  const runtime = active
  if (!runtime) return false
  // fire-and-forget，但要自己吞掉 rejection：一次中断在浏览器里会变成一条用户
  // 会当成 bug 报上来的控制台错误
  void runtime.playAnimation(animationId, {}).catch(() => undefined)
  return true
}

/** T-254 · 停掉编辑期预览。`reset: true` 让对象回到文档姿态。 */
export function stopPreviewAnimation(animationId: string): boolean {
  const runtime = active
  if (!runtime) return false
  runtime.stopAnimation(animationId, { reset: true })
  return true
}

/**
 * T-252 · DEV 只读探针：渲染器此刻编译过多少条着色器程序，以及裁剪平面数。
 *
 * 剖切与后处理两份设计**互相完全不知道对方存在**，而两处耦合只有在浏览器里才量得到：
 * three 把裁剪平面的**数量**放进 shader program 的 cache key，所以开 / 关剖切会让每个
 * 材质重编译一次；composer 的 pass 材质也进同一个缓存。这条探针是那次测量的读数口。
 *
 * 与 `__w3DevLocate` 同一条纪律：**只读**，转发运行时已有的东西，不重新实现任何计算，
 * 生产构建里由守卫剥掉。
 */
export function devRenderStats(): { programs: number; clipPlanes: number } | null {
  const runtime = active
  if (!runtime) return null
  return runtime.renderStats
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
  // T-252 · 剖切 × 描边的两处耦合只有在浏览器里量得到，这是那次测量的读数口
  ;(globalThis as Record<string, unknown>)['__w3DevRenderStats'] = () => devRenderStats()
  ;(globalThis as Record<string, unknown>)['__w3DevLocate'] = (nodeId: string) =>
    active?.projectToScreen(nodeId) ?? null

  /**
   * DEV-only read-back of a light's LIVE parameters.
   *
   * `setLight` writes the three object, never the document (that is what makes it an ECA
   * action rather than an edit). So 「灯变亮了」 and 「退出预览后灯回到 3」 are claims about
   * the RENDERER, and asserting them against `doc.nodes[i].light.intensity` is vacuous —
   * that value never moved. T-170's step ⑪ did exactly that until T-176's review caught it:
   * the assertion passed whether or not the user ever pressed 预览.
   */
  ;(globalThis as Record<string, unknown>)['__w3DevLightOf'] = (nodeId: string) => active?.lightOf(nodeId) ?? null

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

/**
 * T-269 · 出一张发布用的缩略图。**窄口，一件事。**
 *
 * 与 `previewAnimation` 同一条纪律：面板不能自己 `import { getActiveRuntime }` 之后随手
 * 调任意方法。这里把「发布对话框需要的那一次出图」封成一个函数，参数写死——
 * 512 长边、不含热点、不透明、JPEG。**这四项不是调用方的选择**：它们是「缩略图」这个
 * 词的定义，让调用方传进来只会得到四种谁也没要过的组合。
 *
 * @returns 图片字节；此刻没有活着的运行时、或者出图被拒时返回 null。
 */
export async function captureThumbnail(): Promise<Uint8Array | null> {
  const runtime = active
  if (!runtime) return null
  const result = await runtime.captureImage({
    longEdge: THUMBNAIL_LONG_EDGE,
    includeHotspots: false,
    background: 'opaque',
    format: 'jpeg',
  })
  if (!result.ok || !result.blob) return null
  return new Uint8Array(await result.blob.arrayBuffer())
}

/**
 * 缩略图长边。
 *
 * 512 而不是更大：它出现在项目列表的卡片上，而一张 2K 的缩略图会让一个装了二十个项目的
 * 列表在打开时解码 20 张大图。也不能更小——`MIN_EXPORT_EDGE` 是 256，低于它 `planCapture`
 * 会直接拒绝。
 */
export const THUMBNAIL_LONG_EDGE = 512