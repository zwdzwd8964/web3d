import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * T-272 · 嵌入协议的分层，写成机器。
 *
 * ## 两条断言，各挡一种回潮
 *
 * 1. **`packages/core/src/embed/` 里不许出现浏览器全局**（`window` / `document` /
 *    `postMessage` / `MessageEvent` / `location`）。控制器传输无关是它能在纯 Node 里被
 *    穷举的全部原因——一个 `window.` 溜进去，那 26 条测试就得先建一个 jsdom。
 *
 * 2. **`postMessage(x, '*')` 全仓只许出现在握手那一处**。回发时用 `'*'` 等于把回执广播
 *    给宿主页面上的每一个人，包括那些我们刚拒绝掉的。
 *
 * ## 守卫自己也要做变异检验（v0.5 T-117 的教训）
 *
 * 一条永远不会红的守卫，与一条不存在的守卫是同一件事。T-272 的变异 ⑤ 就是对着这个文件
 * 做的：往 `protocol.ts` 里临时写一句 `const _ = window`，这个脚本必须 fail。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EMBED_CORE = join(ROOT, 'packages/core/src/embed')

/** core 的嵌入层不许碰的东西。**它们是「这一层认识浏览器了」的信号，不是风格问题。** */
const BROWSER_GLOBALS = ['window', 'document', 'postMessage', 'MessageEvent', 'location', 'navigator']

/** 允许出现 `postMessage(x, '*')` 的地方。握手那一处——此时还不知道对方是谁。 */
const WILDCARD_TARGET_ALLOWED = ['packages/player/src/embed/boot.ts']

function sourceFiles(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path)
  }
  return out
}

/** 去掉注释与字符串字面量，好让「注释里提到 window」不算违规。 */
function stripped(text) {
  // 手写扫描而不是几条正则：字符串字面量的转义规则用正则表达出来是三行难读的反斜杠，
  // 而这个函数的正确性直接决定守卫会不会误报（注释里提一句 `window` 就红）。
  let out = ''
  let mode = 'code'
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (mode === 'code') {
      if (ch === '/' && next === '/') {
        mode = 'line'
        continue
      }
      if (ch === '/' && next === '*') {
        mode = 'block'
        i++
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        mode = ch
        continue
      }
      out += ch
      continue
    }
    if (mode === 'line') {
      if (ch === '\n') {
        mode = 'code'
        out += ch
      }
      continue
    }
    if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mode = 'code'
        i++
      }
      continue
    }
    // 字符串里：反斜杠吃掉下一个字符，换行照抄（好让行号对得上）。
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === mode) mode = 'code'
    else if (ch === '\n') out += ch
  }
  return out
}

const violations = []

/* 规则 1 · core 的嵌入层零浏览器全局 -------------------------------------- */
const coreFiles = sourceFiles(EMBED_CORE)
// 扫描面下限：一个空目录会让这条检查「通过」。
if (coreFiles.length < 3) {
  violations.push(`packages/core/src/embed 里只找到 ${coreFiles.length} 个源文件（至少 3 个）——目录搬走了还是正则坏了？`)
}
for (const file of coreFiles) {
  const text = stripped(readFileSync(file, 'utf8'))
  for (const global of BROWSER_GLOBALS) {
    // `String.raw` 是必须的：普通模板字面量里 `\w` 会被求值成 `w`，字符类因此退化成
    // `[w.$]`——`xdocument` 之类会溜过去，而守卫看起来一切正常。
    //
    // 右侧还要排除 `:`：`document: () => SceneDocument` 是 `CommandDeps` 的一个字段名，
    // 不是浏览器全局。第一版没排，守卫上来就误报了它。
    const pattern = new RegExp(String.raw`(?<![\w.$])${global}(?![\w$]|\s*:)`)
    const lines = text.split(/\r?\n/)
    const at = lines.findIndex((line) => pattern.test(line))
    if (at >= 0) {
      violations.push(
        `${relative(ROOT, file)}:${at + 1}  嵌入控制器里出现了浏览器全局「${global}」——` +
          `传输无关是它能在纯 Node 里被穷举的全部原因，一个 ${global} 溜进去，那些测试就得先建一个 jsdom`,
      )
    }
  }
}

/* 规则 2 · `postMessage(x, '*')` 只许出现在握手那一处 ---------------------- */
const scanRoots = ['packages/core/src', 'packages/player/src', 'packages/editor/src'].map((r) => join(ROOT, r))
let scanned = 0
for (const root of scanRoots) {
  for (const file of sourceFiles(root)) {
    scanned++
    // Windows 上 `relative` 给的是反斜杠分隔，白名单里写的是正斜杠。
    const rel = relative(ROOT, file).split(sep).join('/')
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      // `postMessage(..., '*')` **以及注入口 `postTo(..., '*')`**。
      //
      // ⚠ 第一版只扫 `postMessage(`，而传输层调的是注入进来的 `postTo(` —— 把回发的
      // target origin 改成 `'*'` 之后守卫**照样通过**。这是变异检验当场抓到的守卫缺陷：
      // 一条只认得出直接调用的扫描，对着一个把调用注入出去的分层设计是瞎的。
      if (!/(?:postMessage|postTo)\s*\([^)]*['"]\*['"]/.test(line)) return
      if (WILDCARD_TARGET_ALLOWED.includes(rel)) return
      violations.push(
        `${rel}:${i + 1}  postMessage 的 target origin 是 '*'——这会把回执广播给宿主页面上的每一个人，` +
          `包括刚被拒绝掉的那些。只有握手（${WILDCARD_TARGET_ALLOWED.join(' / ')}）例外`,
      )
    })
  }
}
if (scanned < 50) {
  violations.push(`只扫到 ${scanned} 个源文件（至少 50 个）——扫描面塌了，下面的「通过」不算数`)
}

if (violations.length > 0) {
  console.log(`FAIL  嵌入分层 · core 传输无关 + 无通配 target  — ${violations.length} 处`)
  for (const v of violations) console.log(`      ${v}`)
  process.exit(1)
}

console.log(`  嵌入层源文件 ${coreFiles.length} 个 / 全仓扫描 ${scanned} 个 / 通配 target 白名单 ${WILDCARD_TARGET_ALLOWED.length} 处`)
console.log('PASS  嵌入分层 · core 传输无关 + 无通配 target')
