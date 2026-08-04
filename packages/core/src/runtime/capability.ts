/**
 * T-111 · what this browser can actually do, checked before anything is built.
 *
 * The task card asks for a WebGL1 fallback, on the reasoning that domestic browser
 * cores lag behind. That is not implementable on the pinned dependency: three removed
 * `WebGL1Renderer` in r163 and `WebGLRenderer` only ever requests a `webgl2` context.
 * See ADR-0013 for the decision, its cost, and the condition that would reverse it.
 *
 * What is implementable, and what this file does, is the half that actually protects the
 * user: find out before rendering, and say so in a sentence they can act on. The failure
 * being replaced is a black page with a console message nobody opens.
 *
 * Three distinct failures, deliberately distinguished — they need different advice:
 *   - the browser has no WebGL2 at all            -> upgrade the browser
 *   - it reports WebGL2 but refuses a context     -> hardware acceleration is off
 *   - it gives a context that is software-rendered -> it will work, slowly
 */

export type CapabilityLevel = 'ok' | 'software' | 'unsupported'

export interface CapabilityReport {
  readonly level: CapabilityLevel
  readonly webgl2: boolean
  /** Unmasked GPU string when WEBGL_debug_renderer_info is available. */
  readonly renderer: string | null
  readonly vendor: string | null
  readonly maxTextureSize: number
  /** Chinese, user-facing, and specific enough to act on. */
  readonly message: string
  readonly advice: string
}

/** Substrings that identify a software rasteriser rather than a GPU. */
const SOFTWARE_RENDERERS = ['swiftshader', 'llvmpipe', 'software', 'softpipe', 'microsoft basic render']

/**
 * Probes for WebGL2 using a throwaway canvas.
 *
 * The canvas is discarded immediately: keeping it would occupy one of the browser's
 * small number of live WebGL contexts, and the app is about to ask for its own.
 */
export function detectCapability(
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): CapabilityReport {
  let gl: WebGL2RenderingContext | null = null
  let canvas: HTMLCanvasElement | null = null

  try {
    canvas = createCanvas()
    gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) as WebGL2RenderingContext | null
  } catch {
    gl = null
  }

  if (!gl) {
    // Distinguish "no WebGL2" from "no WebGL at all": the advice differs, and a browser
    // that has WebGL1 but not WebGL2 is exactly the case ADR-0013 is about.
    let hasWebgl1 = false
    try {
      hasWebgl1 = canvas?.getContext('webgl') !== null
    } catch {
      hasWebgl1 = false
    }
    return {
      level: 'unsupported',
      webgl2: false,
      renderer: null,
      vendor: null,
      maxTextureSize: 0,
      message: hasWebgl1
        ? '当前浏览器只支持 WebGL 1，本播放器需要 WebGL 2。'
        : '当前浏览器不支持 WebGL，无法显示三维内容。',
      advice: hasWebgl1
        ? '请升级到 Chrome 56+ / Edge 79+ / Firefox 51+ / Safari 15+，或换用基于较新 Chromium 内核的浏览器。'
        : '请在浏览器设置中开启「使用硬件加速」，或升级显卡驱动后重试。',
    }
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : null
  const vendor = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)) : null
  const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0

  // Release the probe context immediately rather than waiting for GC.
  gl.getExtension('WEBGL_lose_context')?.loseContext()

  const software = isSoftwareRenderer(renderer)
  return {
    level: software ? 'software' : 'ok',
    webgl2: true,
    renderer,
    vendor,
    maxTextureSize,
    message: software
      ? '当前环境使用软件渲染（没有可用的独立显卡或未开启硬件加速），画面会明显卡顿。'
      : '图形环境正常。',
    advice: software ? '请在浏览器设置中开启「使用硬件加速」，并确认显卡驱动为最新版本。' : '',
  }
}

/** True when the reported renderer string names a software rasteriser. */
export function isSoftwareRenderer(renderer: string | null): boolean {
  if (!renderer) return false
  const lower = renderer.toLowerCase()
  return SOFTWARE_RENDERERS.some((needle) => lower.includes(needle))
}

/**
 * Renders a capability failure as a page.
 *
 * Deliberately plain DOM with inline styles and no dependency: this has to work when the
 * thing that failed might be the very first thing the app tried to do, and it must not
 * pull in a stylesheet that could itself be the problem.
 */
export function renderCapabilityNotice(host: HTMLElement, report: CapabilityReport): void {
  const box = document.createElement('div')
  box.className = 'w3-capability'
  box.setAttribute('role', 'alert')
  box.style.cssText = [
    'position:absolute',
    'inset:0',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:10px',
    'padding:32px',
    'text-align:center',
    'font:14px/1.7 system-ui,sans-serif',
    'color:#e6eaed',
    'background:#15191c',
    'z-index:50',
  ].join(';')

  const title = document.createElement('b')
  title.style.fontSize = '16px'
  title.textContent = report.level === 'unsupported' ? '无法显示三维内容' : '性能提示'

  const message = document.createElement('p')
  message.textContent = report.message

  const advice = document.createElement('p')
  advice.style.color = '#8b969e'
  advice.textContent = report.advice

  box.append(title, message, advice)

  if (report.renderer) {
    const detail = document.createElement('code')
    detail.style.cssText = 'color:#6d777e;font-size:12px'
    detail.textContent = `${report.vendor ?? '?'} · ${report.renderer}`
    box.append(detail)
  }

  // A software-rendered page still works, so its notice must be dismissible; an
  // unsupported one has nothing behind it to dismiss to.
  if (report.level === 'software') {
    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.textContent = '仍然继续'
    dismiss.style.cssText =
      'margin-top:8px;padding:5px 14px;background:none;border:1px solid #2a3238;border-radius:4px;color:inherit;cursor:pointer'
    dismiss.addEventListener('click', () => box.remove())
    box.append(dismiss)
  }

  host.append(box)
}

/* -------------------------------------------------------------------------- */
/* T-214 · what a capture is allowed to allocate                              */
/* -------------------------------------------------------------------------- */

/**
 * The hardware and runtime numbers every capture clamp has to respect.
 *
 * `planCapture` (T-262) takes one of these and decides how big an export may actually be.
 * The field that makes this card necessary is `pixelRatio`: an export is requested in CSS
 * pixels and allocated in DEVICE pixels, so on a 2× screen a 4× export is really 8×.
 *
 * ⚠ **Why this could not wait for T-262.** The clamp's unit tests inject a stub `limits`,
 * so a formula that ignores `pixelRatio` passes every one of them and fails only on a real
 * high-DPI machine — with a `webglcontextlost` and a white page. The field and the formula
 * therefore land in the same card as `setPixelRatio` itself (cross-check X-17); T-262 adds
 * the probe fields (`maxRenderbufferSize`, `maxViewportDim`) and the request/plan types.
 */
export interface CaptureLimits {
  /** The renderer's device pixel ratio, already capped by `MAX_PIXEL_RATIO`. */
  readonly pixelRatio: number
  /** `GL_MAX_TEXTURE_SIZE`, or 0 when the probe could not read it (treat as unknown). */
  readonly maxTextureSize: number
}

/**
 * Device pixels along one edge, for a capture of `cssPixels` at `scale`.
 *
 * The whole point of the function is that it is **not** `cssPixels * scale`. That is the
 * formula the export dialog shows the user and the one that is wrong on every retina
 * machine.
 */
export function captureDevicePixels(cssPixels: number, scale: number, limits: CaptureLimits): number {
  return Math.max(1, Math.round(cssPixels * scale * limits.pixelRatio))
}

/**
 * The largest scale that still fits inside the GPU's texture limit.
 *
 * Returns `ceiling` untouched when the probe reported 0 — an unknown limit must not silently
 * clamp everything to 1×, because "unknown" is what an older browser reports for a GPU that
 * is perfectly capable. The refusal for a genuinely impossible request belongs to
 * `planCapture`, which has the request and can word the message.
 */
export function maxCaptureScale(cssLongEdge: number, limits: CaptureLimits, ceiling: number): number {
  if (limits.maxTextureSize <= 0) return ceiling
  const perScaleUnit = Math.max(1, cssLongEdge) * limits.pixelRatio
  const fits = Math.floor(limits.maxTextureSize / perScaleUnit)
  return Math.max(1, Math.min(ceiling, fits))
}
