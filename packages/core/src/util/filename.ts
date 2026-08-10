/**
 * T-266 · 文件名清洗，全仓一份。
 *
 * 从 `packages/editor/src/publish/publish.ts` 上移到这里。**上移不是整理，是修一处
 * 将来必然发生的分叉**：出图要产出文件名，发布也要产出文件名，两处各写一份的话，
 * 「同一个场景名导出的图和发布的包不同名」会成为一个没人能一眼看出成因的现象。
 *
 * 清洗规则要保守：这些字符串会变成用户磁盘上的文件名，而 Windows 与 POSIX 的禁字符集
 * 不一样。取两者的并集，宁可多替换一个。
 */

/**
 * Windows 禁止的字符，POSIX 只禁 `/` 与 NUL——取并集。
 *
 * **空格不在里面**：空格在两个平台上都是合法文件名字符，替换它只会让用户认不出自己起的
 * 名字。首尾空格由下面的 trim 处理（Windows 会静默吃掉它们）。
 *
 * ⚠ 第一版在类的结尾写了「空格 + 减号」，让人以为空格在集合里，**而实测它没被替换**——
 * 测试期望值当时是照着「以为」写的，红了才发现。一个字符类里看起来像范围的东西，是这类
 * 「读着对、跑起来不对」的常见来源。
 */
const ILLEGAL = /[<>:"/\\|?*]/g

/** 控制字符。写进正则会触发 `no-control-regex`，所以按码点过滤：它们在文件名里合法却不可见。 */
const isControl = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0
  return code < 0x20 || code === 0x7f
}

/** Windows 保留设备名。`CON.png` 在资源管理器里是打不开的。 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** 名字为空 / 全是非法字符时的落点。 */
const FALLBACK = 'scene'

/**
 * 把任意字符串变成一个安全的文件名主干（不含扩展名）。
 *
 * @param name 用户给的名字，通常是场景名
 * @param maxLength 主干最大长度。默认 80——路径总长在 Windows 上有 260 的限制，
 *   而这个主干之外还有目录、时间戳与扩展名。
 */
export function sanitiseFilename(name: string, maxLength = 80): string {
  const cleaned = [...name]
    .map((ch) => (isControl(ch) ? '_' : ch))
    .join('')
    .replace(ILLEGAL, '_')
    // 首尾的点与空格在 Windows 上会被静默吃掉，于是 `报告 .png` 存下来变成 `报告.png`，
    // 而代码里记的还是带空格那个——一处对不上的地方。
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, maxLength)
    .trim()

  if (cleaned === '') return FALLBACK
  // 保留设备名加一个后缀而不是整个换掉：用户仍然认得出自己起的名字。
  return RESERVED.test(cleaned) ? `${cleaned}_` : cleaned
}

/**
 * 一次导出的完整文件名。
 *
 * 带时间戳，因为**导出同一个视角两次是常态**（调完参数再导一张），而同名文件在浏览器
 * 下载目录里会变成 `报告 (1).png` —— 那个序号与两张图的先后没有关系，用户排不出顺序。
 *
 * @param stamp 注入的时间戳，形如 `2026-08-05T12-30-00`。生产传格式化过的当前时间；
 *   注入而不是内部取 `new Date()`，是因为这个函数要能在测试里被逐字断言。
 */
export function captureFilename(sceneName: string, format: 'png' | 'jpeg', stamp: string, custom?: string): string {
  const extension = format === 'jpeg' ? 'jpg' : 'png'
  // 用户填了名字就用他的，一个字都不加：他填名字通常正是为了让文件名可预期
  // （要贴进一份文档、或者要覆盖上一张）。
  if (custom !== undefined && custom.trim() !== '') return `${sanitiseFilename(custom)}.${extension}`
  return `${sanitiseFilename(sceneName)}_${sanitiseFilename(stamp, 32)}.${extension}`
}
