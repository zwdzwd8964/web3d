/**
 * T-262 · 出图的全部防线：`planCapture`。
 *
 * 一个纯函数，把「用户在对话框里点的东西」翻译成「这台机器今天真的画得出来的尺寸」，
 * 并且**每一次改动都要说话**。它不碰 GPU、不碰 DOM、不碰文档，因此可以在纯 Node 里
 * 把全部边界跑一遍（C8）。
 *
 * 三件事必须一起做，少一件这个函数就没有价值：
 *
 * 1. **拒绝**（4 条）——请求本身自相矛盾或不可解，没有任何一张图能回答它。
 * 2. **钳位**（5 条）——请求可解但要改数字。改了就必须给一句中文，且句子里带上改成了多少。
 *    「静默钳位」是这里最容易犯、也最难发现的错：用户点了 4×、拿到一张 2× 的图、
 *    没有任何提示，他会以为是自己看错了。
 * 3. **降级**（1 条）——透明背景强制走 direct 并丢掉描边（[ADR-0021](../../../docs/adr/0021-撤销-D20-v1.0-引入后处理链.md)）。
 *
 * ⚠ **为什么倍率有两把尺子**：`MAX_EXPORT_SCALE` 是「对话框允许点到几倍」（合同里的 1–4），
 * `maxScaleFor(mode)` 是「这条渲染管线扛得住几倍」（composed 2× / direct 4×）。今天在
 * direct 模式下两者都是 4，看起来重复，但它们回答的是不同的问题——把其中一把拆掉，
 * composed 模式下 4× 会申请约 2.2 GB 显存（ADR-0021 腿 3 的实测表）。
 */

import type { CaptureLimits } from './capability.js'
import { captureDevicePixels, maxCaptureScale } from './capability.js'
import type { PipelineMode } from './render-pipeline.js'

/**
 * 对话框与 `exportImage` 动作允许的最大倍率（规划 §4 的 `scale: 1–4`）。
 *
 * 这是**用户意图**的上限，与管线扛不扛得住无关。
 */
export const MAX_EXPORT_SCALE = 4

/**
 * 导出图片长边的硬上限，单位是输出图片的像素（拍板项 P-12：「就这么定」）。
 *
 * A4 300dpi 够用，A3 不够——要 A3 是变更项，需重评显存与软渲策略后单独计价。
 * 对话框的长边档位 `1920 / 2560 / 3840` 与这个数逐字一致。
 */
export const MAX_EXPORT_EDGE = 3840

/** direct 管线的倍率上限。T-263 的 `resolveExportPipeline` 复用这一个常量，不再抄一份。 */
export const MAX_SCALE_DIRECT = 4

/**
 * composed 管线的倍率上限。
 *
 * 2 不是保守，是算出来的：`OutlinePass` 在 (W,H) 下分配 7 张 target ≈ 19·W·H 字节，
 * composer 侧 ≈ 48·W·H。7680×4320 带两个 pass ≈ 2.8 GB —— 浏览器会直接丢上下文，
 * 现象是整个页面变白，而用户无法把它和「导出失败」联系起来。
 */
export const MAX_SCALE_COMPOSED = 2

/**
 * 三个 GL 上限探针**全部报 0（未知）**时替用的保守边长。
 *
 * 取 4096 而不是 WebGL2 规范下限 2048：2048 连一张 1× 的 2560 宽视口都放不下，而近十年
 * 出厂的任何支持 WebGL2 的设备都到得了 4096。取 4096 的代价写在 [ADR-0041](../../../docs/adr/0041-planCapture-的拒绝与钳位矩阵.md)：
 * 真有一台只到 2048 的机器时，我们会算出一个它画不出来的尺寸，然后在导出那一刻丢上下文。
 */
export const CONSERVATIVE_EDGE_LIMIT = 4096

/**
 * 长边低于这个数就不导了。
 *
 * 两种成因共用这一条线：调用方传了 `longEdge: 10`，或者显卡上限低到只剩 64。两种情况下
 * 产出的都不是一张能用的图，而**给出一张没用的图比明确拒绝更糟**——用户会以为导出成功了。
 */
export const MIN_EXPORT_EDGE = 256

/** 一次出图请求。全部尺寸按 CSS 像素下单，设备像素由 `planCapture` 自己算。 */
export interface CaptureRequest {
  /** 当前视口的 CSS 像素尺寸。 */
  readonly viewport: { readonly width: number; readonly height: number }
  /** 相对当前视口的倍率，默认 1。同时给了 `longEdge` 时被忽略。 */
  readonly scale?: number
  /** 目标长边（输出图片的像素）。给了它就以它为准，`scale` 让位。 */
  readonly longEdge?: number
  /** `'auto'` 按不透明处理；透明是显式选项，因为它会连带丢掉描边。 */
  readonly background: 'auto' | 'transparent' | 'opaque'
  readonly format: 'png' | 'jpeg'
  /** 默认 `true`：出图的头号用途是带编号的设备说明书插图（ADR-0025）。 */
  readonly includeHotspots?: boolean
}

/**
 * 动作与 UI 下单时用的请求形状：**视口由运行时自己填**。
 *
 * 一条 ECA 规则里的 `exportImage` 拿不到画布尺寸，也不该拿到——它写在文档里，而文档
 * 在两台不同分辨率的机器上要产出各自正确的图。让调用方填视口等于把一台机器的尺寸
 * 写死进了文档。
 */
export type CaptureOrder = Omit<CaptureRequest, 'viewport'> & { readonly viewport?: CaptureRequest['viewport'] }

/** 可以执行的一份出图计划。 */
export interface CapturePlan {
  readonly ok: true
  /** 输出图片的像素宽高，恒为 ≥ 1 的整数。 */
  readonly width: number
  readonly height: number
  /** 实际生效的倍率（走 `longEdge` 时可能不是整数）。 */
  readonly scale: number
  readonly pipelineMode: PipelineMode
  readonly background: 'transparent' | 'opaque'
  readonly format: 'png' | 'jpeg'
  readonly includeHotspots: boolean
  /** 透明背景强制 direct 时为 `true`，导出的图不含描边。 */
  readonly droppedOutline: boolean
  /**
   * 面向用户的中文说明，多条以空格连接。**请求被原样满足时是空串。**
   *
   * 非空 ⇔ 计划与请求不一致。调用方必须把它显示出来——这个字段存在的全部理由，
   * 就是不让钳位悄悄发生。
   */
  readonly notice: string
}

/** 无法执行的一次出图请求。 */
export interface CaptureRejection {
  readonly ok: false
  /** 面向用户的中文，说清为什么不能导以及下一步该怎么做。 */
  readonly reason: string
}

/** 这条渲染管线扛得住的倍率上限。 */
export function maxScaleFor(mode: PipelineMode): number {
  return mode === 'composed' ? MAX_SCALE_COMPOSED : MAX_SCALE_DIRECT
}

/**
 * 三个 GL 探针里最紧的那一个；全部未知时用 {@link CONSERVATIVE_EDGE_LIMIT}。
 *
 * 取最小值而不是只看纹理上限：导出走的是多重采样 render target（renderbuffer）并且要
 * 临时改主画布尺寸（viewport），三条限制哪一条先撞上都是一样的结果。
 */
export function effectiveEdgeLimit(limits: CaptureLimits): number {
  const probes = [limits.maxTextureSize, limits.maxRenderbufferSize, limits.maxViewportDim].filter(
    (n) => Number.isFinite(n) && n > 0,
  )
  return probes.length === 0 ? CONSERVATIVE_EDGE_LIMIT : Math.min(...probes)
}

/** 正有限数。`undefined` 不算不合法——那是「没给」，走默认值。 */
function isPositiveFinite(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value > 0)
}

/**
 * 长边模式下喂给 `captureDevicePixels` 的 limits：像素比按 1 算。
 *
 * 不是忽略设备像素比，是长边模式下**目标已经是设备像素了**——再乘一次就会把一张
 * 「3840 像素宽」的请求变成 7680。
 */
const NO_RATIO: CaptureLimits = {
  pixelRatio: 1,
  maxTextureSize: 0,
  maxRenderbufferSize: 0,
  maxViewportDim: 0,
  postFxActive: false,
}

/**
 * 把一次出图请求钳成这台机器画得出来的尺寸，或者说明为什么画不出来。
 *
 * @param request 用户在对话框 / `exportImage` 动作里点的东西
 * @param limits 这台机器与当前管线状态的实测数字
 * @returns `{ ok: true }` 的计划，或 `{ ok: false, reason }` 的拒绝。**不抛异常**——
 *   `captureImage` 永不 reject（规划 §4 的动作表），拒绝必须是一个可以显示的值。
 */
export function planCapture(request: CaptureRequest, limits: CaptureLimits): CapturePlan | CaptureRejection {
  const { width: vw, height: vh } = request.viewport

  // —— 拒绝 1 · JPEG 没有 alpha 通道 ————————————————————————————————
  // 钳位在这里是错的：无论把哪一边悄悄改掉，用户拿到的都不是他点的那两个选项。
  if (request.format === 'jpeg' && request.background === 'transparent') {
    return { ok: false, reason: 'JPEG 格式不支持透明背景。请改用 PNG 格式，或把背景改为不透明。' }
  }

  // —— 拒绝 2 · 视口还没量出来 ————————————————————————————————————
  // 连纵横比都算不出来。这是「画面还没显示就点了导出」的真实形状，不是防御性代码。
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) {
    return { ok: false, reason: '画布尺寸还不可用，无法导出。请等画面显示出来后再试。' }
  }

  // —— 拒绝 3 · 参数本身不合法 ——————————————————————————————————
  // 悄悄回退到默认值会把调用方的 bug 变成一张尺寸莫名其妙的图。
  const tooSmall = request.longEdge !== undefined && request.longEdge < MIN_EXPORT_EDGE
  if (!isPositiveFinite(request.scale) || !isPositiveFinite(request.longEdge) || tooSmall) {
    return {
      ok: false,
      reason: `导出参数不合法：倍率与长边都必须是正数，且长边不小于 ${MIN_EXPORT_EDGE} 像素。`,
    }
  }

  const edgeLimit = effectiveEdgeLimit(limits)

  // —— 拒绝 4 · 这台机器连一张最小的图都放不下 ————————————————————————
  if (edgeLimit < MIN_EXPORT_EDGE) {
    return { ok: false, reason: `当前显卡最大只支持 ${edgeLimit} 像素的画面，无法导出可用的图片。` }
  }

  const notices: string[] = []

  // —— 降级 · 透明背景强制 direct（ADR-0021 腿 2）—————————————————————
  // 成因是 OutlinePass 的 additive 混合在背景像素上得到 RGB > A，存成非预乘 PNG 就是
  // 「边缘发亮」。雾不在此列——雾画在物体像素上，背景像素仍然 alpha 0。
  const wantsTransparent = request.background === 'transparent'
  const droppedOutline = wantsTransparent && limits.postFxActive
  const pipelineMode: PipelineMode = !wantsTransparent && limits.postFxActive ? 'composed' : 'direct'
  if (droppedOutline) notices.push('透明背景导出不包含描边效果。')

  const cssLongEdge = Math.max(vw, vh)
  let scale: number

  if (request.longEdge !== undefined) {
    // —— 钳位 5 · 长边胜出 ————————————————————————————————————————
    if (request.scale !== undefined) {
      notices.push(`同时指定了长边与倍率，以长边 ${request.longEdge} 像素为准，倍率设置已忽略。`)
    }
    // 长边模式下不乘 pixelRatio：用户要的是一张恰好这么大的图，不是「屏幕上这么大」。
    scale = request.longEdge / cssLongEdge
  } else {
    scale = request.scale ?? 1

    // —— 钳位 1 · 对话框允许的倍率上限 ——————————————————————————————
    if (scale > MAX_EXPORT_SCALE) {
      notices.push(`导出倍率上限为 ${MAX_EXPORT_SCALE}×，已按 ${MAX_EXPORT_SCALE}× 导出。`)
      scale = MAX_EXPORT_SCALE
    }

    // —— 钳位 2 · 这条管线扛得住的倍率上限 ————————————————————————————
    const pipelineCeiling = maxScaleFor(pipelineMode)
    if (scale > pipelineCeiling) {
      notices.push(`叠加了描边等画面效果时导出倍率上限为 ${pipelineCeiling}×，已按 ${pipelineCeiling}× 导出。`)
      scale = pipelineCeiling
    }

    // —— 钳位 3 · 显卡上限随像素比收紧 ——————————————————————————————
    // 这里才是 pixelRatio 真正咬人的地方：对话框显示「1920 × 4 = 7680」，而 2× 屏上
    // GPU 被要求的是 15360。桩 limits 让缺了这一行的公式全绿（X-17）。
    const gpuCeiling = maxCaptureScale(cssLongEdge, { ...limits, maxTextureSize: edgeLimit }, scale)
    if (gpuCeiling < scale) {
      notices.push(`当前显卡最大支持 ${edgeLimit} 像素，导出倍率已降到 ${gpuCeiling}×。`)
      scale = gpuCeiling
    }
  }

  let width = captureDevicePixels(vw, scale, request.longEdge === undefined ? limits : NO_RATIO)
  let height = captureDevicePixels(vh, scale, request.longEdge === undefined ? limits : NO_RATIO)

  // —— 钳位 4 · 长边硬上限，两条路径共用 ————————————————————————————
  // 也吃掉长边模式下超出显卡上限的那一份：两者都只是「长边不许超过某个数」。
  const hardEdge = Math.min(MAX_EXPORT_EDGE, edgeLimit)
  const longest = Math.max(width, height)
  if (longest > hardEdge) {
    const shrink = hardEdge / longest
    scale *= shrink
    width = Math.max(1, Math.round(width * shrink))
    height = Math.max(1, Math.round(height * shrink))
    // 两个成因给两句话：合同上限（3840）与这台机器的显卡上限是不同的事，混成一句话之后
    // 用户不知道该换台机器还是该接受 3840。
    notices.push(
      hardEdge === MAX_EXPORT_EDGE
        ? `导出长边上限为 ${MAX_EXPORT_EDGE} 像素，已按 ${width} × ${height} 像素导出。`
        : `当前显卡最大支持 ${edgeLimit} 像素，已按 ${width} × ${height} 像素导出。`,
    )
  }

  return {
    ok: true,
    width,
    height,
    scale,
    pipelineMode,
    background: wantsTransparent ? 'transparent' : 'opaque',
    format: request.format,
    includeHotspots: request.includeHotspots ?? true,
    droppedOutline,
    notice: notices.join(' '),
  }
}

/* ========================================================================== */
/* T-266 · captureImage 的编排与还原保证                                        */
/* ========================================================================== */

/**
 * 出图要临时改动的那一片运行时状态，收成一个接口。
 *
 * **五个字段各有一个读、一个写**，因为还原栈要的是「进来时是什么，出去时还是什么」，
 * 而那需要能读。写成接口而不是直接操作 `SceneRuntime`，是为了让八步链路能在纯 Node 里
 * 被逐步注入故障——真实现里每一步都会碰渲染器。
 */
export interface CaptureSurface {
  size(): { readonly width: number; readonly height: number }
  setSize(width: number, height: number): void
  chromeVisible(): boolean
  setChromeVisible(visible: boolean): void
  background(): 'transparent' | 'opaque'
  setBackground(background: 'transparent' | 'opaque'): void
  /** 帧循环在不在跑。出图期间必须停——半改完的状态画出去就是一帧闪烁。 */
  running(): boolean
  setRunning(running: boolean): void
  capturing(): boolean
  setCapturing(capturing: boolean): void
  /** 准备 overlay：等字体、解码媒体、把打开着的面板重放进 sprite 层。 */
  prepareOverlay(plan: CapturePlan): Promise<void>
  /** 唯一渲染出口。 */
  drawScene(): void
  /** ADR-0025 的那次 overlay pass，`autoClear = false`，**在 `drawScene()` 之后**。 */
  composeOverlay(): void
  /** 把画布读成图片字节。 */
  readPixels(format: 'png' | 'jpeg'): Promise<Blob | null>
}

/** 一次导出的结果。**永不 reject**，失败也是一个可以显示的值。 */
export interface CaptureResult {
  readonly ok: boolean
  readonly width: number
  readonly height: number
  readonly format: 'png' | 'jpeg'
  readonly background: 'transparent' | 'opaque'
  readonly filename: string
  /** 计划里的中文钳位说明，原样带出来给对话框显示。 */
  readonly notice: string
  /** 失败原因；成功时是空串。 */
  readonly reason: string
  /** 图片字节。headless 侧恒为 null（契约测试比的是除它以外的全部字段）。 */
  readonly blob: Blob | null
  /** 打开着的面板有没有被重放进导出图。 */
  readonly panelCount: number
}

/** 出图期间被临时改掉的一项，以及怎么还原它。 */
interface RestoreEntry {
  readonly what: string
  readonly undo: () => void
}

export interface CaptureRunOptions {
  readonly request: CaptureRequest
  readonly limits: CaptureLimits
  readonly surface: CaptureSurface
  readonly filename: string
  /** 打开着的面板数，进结果供调用方断言重放。 */
  readonly openPanelCount?: number
  readonly onWarn?: (message: string) => void
}

/**
 * 八步导出，**任何一步失败都把前面改过的全部还原**。
 *
 * ## 还原栈，而不是 try/finally 里抄一遍
 *
 * 每改一样东西就往栈里压一条「怎么还原」，收尾时倒着弹。抄一遍的写法有两个失效方式：
 * 漏抄一项（那一项永远还原不了），以及**顺序写反**（尺寸在背景之后还原，中间那一帧的
 * 长宽比是错的）。栈让「改了什么」与「还原什么」在同一行代码里，加一样东西不可能忘。
 *
 * ## 为什么永不 reject
 *
 * 规划 §4 的动作表写着 `captureImage` 永不 reject，好让 `await: false` 的 fire-and-forget
 * 不产生未处理拒绝。所以这里所有失败都变成 `{ ok: false, reason }`。
 *
 * ## 重入
 *
 * 第二次调用直接被拒。两次导出交叠会让还原栈互相覆盖——后一次记下的「原尺寸」是前一次
 * 改过的那个，于是导完之后画布停在一个谁也没要过的尺寸上。
 */
export async function runCapture(options: CaptureRunOptions): Promise<CaptureResult> {
  // 逐项读 `options.x` 而不是解构：解构之后这些字段在全仓就再没有一处属性访问，
  // 而 D36 的孤儿闸门正是按属性访问判「有没有消费者」——解构会让一个真被用着的
  // 入参看起来像死字段。
  const surface = options.surface
  const request = options.request
  const limits = options.limits
  const filename = options.filename
  const rejected = (reason: string): CaptureResult => ({
    ok: false,
    width: 0,
    height: 0,
    format: request.format,
    background: request.background === 'transparent' ? 'transparent' : 'opaque',
    filename,
    notice: '',
    reason,
    blob: null,
    panelCount: 0,
  })

  if (surface.capturing()) return rejected('上一次导出还没完成。')

  const plan = planCapture(request, limits)
  if (!plan.ok) return rejected(plan.reason)

  const restore: RestoreEntry[] = []
  /** 压栈并执行。**先记后改**——改完再记的话，中间抛异常就没人还原了。 */
  const change = (what: string, undo: () => void, apply: () => void): void => {
    restore.push({ what, undo })
    apply()
  }

  try {
    /* ① 停帧循环 ---------------------------------------------------------- */
    const wasRunning = surface.running()
    change('帧循环', () => surface.setRunning(wasRunning), () => surface.setRunning(false))

    /* ② 进入出图态（`resize` 从此只记不改，`tick` 不画） ------------------- */
    const wasCapturing = surface.capturing()
    change('出图标志', () => surface.setCapturing(wasCapturing), () => surface.setCapturing(true))

    /* ③ 改到目标分辨率 ---------------------------------------------------- */
    const size = surface.size()
    change('画布尺寸', () => surface.setSize(size.width, size.height), () => surface.setSize(plan.width, plan.height))

    /* ④ 背景 -------------------------------------------------------------- */
    const background = surface.background()
    change('背景', () => surface.setBackground(background), () => surface.setBackground(plan.background))

    /* ⑤ 收起编辑期辅助物（网格与 gizmo 不进图） ---------------------------- */
    const chrome = surface.chromeVisible()
    change('编辑期辅助物', () => surface.setChromeVisible(chrome), () => surface.setChromeVisible(false))

    /* ⑥ 准备 overlay：等字体、解码媒体、重放打开着的面板 ------------------- */
    await surface.prepareOverlay(plan)

    /* ⑦ 画一帧，然后把热点叠上去 ------------------------------------------ */
    // 顺序是契约 K3：overlay 在 `drawScene()` **之后**、`autoClear = false`。反过来的话
    // 热点会被这一帧的场景盖掉，而两种顺序都「画了」。
    surface.drawScene()
    surface.composeOverlay()

    /* ⑧ 读像素 ------------------------------------------------------------ */
    const blob = await surface.readPixels(plan.format)
    if (!blob) return rejected('画布读取失败，导出已取消。')

    return {
      ok: true,
      width: plan.width,
      height: plan.height,
      format: plan.format,
      background: plan.background,
      filename,
      notice: plan.notice,
      reason: '',
      blob,
      panelCount: options.openPanelCount ?? 0,
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    options.onWarn?.(`导出失败：${message}`)
    return rejected(`导出过程中出错，画面已恢复原状：${message}`)
  } finally {
    // 倒着弹。正着弹的话，「还原尺寸」会发生在「退出出图态」之前，而出图态下的
    // `setSize` 只记不改——尺寸就永远回不去了。
    for (let i = restore.length - 1; i >= 0; i--) {
      try {
        restore[i]?.undo()
      } catch {
        // 一项还原失败不许拖垮其余。这里已经在收尾路径上，抛出去只会盖掉真正的原因。
        options.onWarn?.(`还原「${restore[i]?.what}」失败，画面可能停在导出时的状态。`)
      }
    }
  }
}
