/**
 * T-265 · 出图时用什么字体，以及字体没准备好怎么办。
 *
 * ## 为什么这件事需要一个接口
 *
 * 热点的编号与面板文字在 sprite 层是**画进 canvas 的像素**，不是 DOM 文本。canvas 的
 * `fillText` 用哪个字形，取决于调用那一刻浏览器有没有加载好那个字体——而字体加载是异步的。
 * 时序错了的表现是：导出的图上中文全变成方框或退回一个完全不同的字体，而屏幕上一切正常。
 *
 * ## 为什么必须自托管，以及为什么 v1.0 不带字体文件
 *
 * 宪法 C6：不引 CDN，不引 Google Fonts。所以「用一个漂亮的中文字体」意味着把字体文件
 * 放进 `vendor/fonts/`，而一份可用的中文字体子集通常 1–4 MB —— 那是播放器整个体积预算
 * （gzip 400 KB）的数倍。
 *
 * **v1.0 的决定：不带字体文件，用系统字体栈。** 代价是不同机器导出的图字形不同；收益是
 * 体积预算不动、离线部署不受影响。这个接口把「哪天要换成自托管字体」变成一处注入，
 * 而不是散落在栅格化代码里的十几处 `ctx.font = '...'`。
 */

/** 一次栅格化要用的字体信息。 */
export interface FontProvider {
  /**
   * 字体准备好了。**这个 Promise 允许 reject** —— 调用方必须退回系统栈继续画，
   * 而不是让导出整个失败：一张字形不完美的图，好过一个「导出失败」的提示。
   */
  ready(): Promise<void>
  /** `ctx.font` 用的族名部分，如 `'"Noto Sans SC", system-ui, sans-serif'`。 */
  readonly family: string
  /** 给用户看的来源说明，出图对话框会显示它（T-267）。 */
  readonly source: string
}

/**
 * 系统字体栈。v1.0 的默认，也是任何自托管字体加载失败时的落点。
 *
 * 字体栈里中文放在前面：`system-ui` 在中文 Windows 上解析成「微软雅黑」，而在英文
 * 系统上是 Segoe UI —— 后者渲染中文时会逐字回退，字形高矮不一。显式列出常见中文族名
 * 让至少同一个系统上的两次导出是一致的。
 */
export const SYSTEM_FONT_STACK =
  '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif'

/** 永远就绪的系统字体栈。 */
export function systemFontProvider(): FontProvider {
  return {
    ready: () => Promise.resolve(),
    family: SYSTEM_FONT_STACK,
    source: '系统字体',
  }
}

/**
 * 把一个可能失败的字体加载包成「永不失败」的形态。
 *
 * @returns 一个 `ready()` 永不 reject 的 provider；底层失败时 `family` 退回系统栈，
 *   并调一次 `onWarn`。**降级要出声**——一张字形不对的图如果无人提示，最后会被当成
 *   「导出功能有问题」上报，而真正的原因是一个字体文件没加载上。
 */
export function withSystemFallback(inner: FontProvider, onWarn?: (message: string) => void): FontProvider {
  let fallback = false
  return {
    async ready() {
      try {
        await inner.ready()
      } catch (cause) {
        fallback = true
        onWarn?.(`字体「${inner.source}」加载失败，已改用系统字体导出，字形可能与屏幕上不同：${describe(cause)}`)
      }
    },
    get family() {
      return fallback ? SYSTEM_FONT_STACK : inner.family
    },
    get source() {
      return fallback ? '系统字体（自托管字体加载失败）' : inner.source
    },
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
