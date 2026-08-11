import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMMANDS, EVENT_NAMES } from '../../src/embed/index.js'

/**
 * T-277 · 对外文档与代码的双向一致性。
 *
 * ## 为什么是**双向**
 *
 * 「文档里提到的命令都存在」只挡住一半——另一半是**注册表里有而文档里没有的**。
 * 后者才是真正会发生的那种：加一条命令时改代码是必须的，写文档是可选的。于是文档
 * 慢慢变成一份不完整的清单，而它看起来一直是对的。
 *
 * ## 快速开始为什么要逐字比对
 *
 * 一份「大意相同」的快速开始，读者照着抄下来跑不通。而它跑不通的时候，读者不会怀疑
 * 文档——他会怀疑产品。所以文档里那段代码与样板页里那段必须是同一段，用
 * `<!-- doc:quickstart:start/end -->` 与 `// doc:quickstart:start/end` 切片比对。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const DOC = join(ROOT, 'docs', 'EMBED_API.md')
const SAMPLE = join(ROOT, 'samples', 'host-demo', 'index.html')

/** 两个标记之间的内容，去掉首尾空行与统一缩进。 */
function slice(text: string, start: string, end: string): string {
  const from = text.indexOf(start)
  const to = text.indexOf(end)
  if (from < 0 || to < 0) throw new Error(`找不到切片标记：${start} / ${end}`)
  const body = text.slice(from + start.length, to)
  const lines = body.split(/\r?\n/).filter((line) => line.trim() !== '')
  // 去掉共同缩进：文档里的代码块顶格，样板页里嵌在两层缩进下。
  const indent = Math.min(...lines.map((line) => line.length - line.trimStart().length))
  return lines.map((line) => line.slice(indent)).join('\n')
}

describe('T-277 · 快速开始与样板页逐字相同', () => {
  it('两段代码一字不差', () => {
    const doc = slice(readFileSync(DOC, 'utf8'), '<!-- doc:quickstart:start -->', '<!-- doc:quickstart:end -->')
      // 文档那份包在 ```html 围栏里，样板页那份是裸 JS——去掉围栏与 <script> 外壳。
      .replace(/^```html$/m, '')
      .replace(/^```$/m, '')
    const sample = slice(readFileSync(SAMPLE, 'utf8'), '// doc:quickstart:start', '// doc:quickstart:end')

    // 文档那段还带着 <div> 与 <script src>，样板页那段只有 JS。比的是**共有的那部分**：
    // 从 `W3Player.mount(` 到片段结尾。
    const from = (text: string) => {
      const at = text.indexOf('W3Player.mount(')
      expect(at, '两边都应当有 W3Player.mount(').toBeGreaterThanOrEqual(0)
      return text
        .slice(at)
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.trim() !== '' && !line.includes('</script>') && !line.startsWith('```'))
        .join('\n')
    }

    const docCode = from(doc)
    const sampleCode = from(sample)
    // 缩进在两个宿主里不同（文档顶格、HTML 里嵌两层），所以按行去缩进再比。
    const normalise = (text: string) => text.split('\n').map((l) => l.trim()).join('\n')
    expect(normalise(sampleCode)).toBe(normalise(docCode))
    // 而且真的比了东西，不是两个空串。
    expect(docCode.split('\n').length).toBeGreaterThan(8)
  })
})

describe('T-277 · 命令表双向一致', () => {
  const doc = readFileSync(DOC, 'utf8')

  /** 命令表里那一列的反引号名字。 */
  const documented = new Set(
    [...doc.matchAll(/^\|\s*`(\w+)`\s*\|/gm)].map((m) => m[1]!).filter((name) => name in COMMANDS),
  )

  it('注册表里的每条命令，文档里都有一行', () => {
    // **这一半才是会出事的那一半**：加命令时改代码是必须的，写文档是可选的。
    const missing = Object.keys(COMMANDS).filter((name) => !documented.has(name))
    expect(missing, `这些命令注册了但没写进 EMBED_API.md：${missing.join(', ')}`).toEqual([])
  })

  it('文档里提到的每条命令，注册表里都有', () => {
    // 反向：文档里写了一条不存在的命令，读者会照着调然后拿到 unknown-command。
    const rows = [...doc.matchAll(/^\|\s*`(\w+)`\s*\|/gm)].map((m) => m[1]!)
    const commandRows = rows.filter((name) => !EVENT_NAMES.includes(name as never))
    const bogus = commandRows.filter((name) => !(name in COMMANDS))
    expect(bogus, `文档里这些命令不存在：${bogus.join(', ')}`).toEqual([])
  })

  it('断言不是空跑的 —— 文档里真的认出了命令行', () => {
    expect(documented.size).toBe(Object.keys(COMMANDS).length)
    expect(documented.size).toBeGreaterThanOrEqual(9)
  })
})

describe('T-277 · 事件表双向一致', () => {
  const doc = readFileSync(DOC, 'utf8')
  const documented = new Set([...doc.matchAll(/^\|\s*`(\w+)`\s*\|/gm)].map((m) => m[1]!))

  it('可订阅的每种事件，文档里都有一行', () => {
    const missing = EVENT_NAMES.filter((name) => !documented.has(name))
    expect(missing, `这些事件没写进 EMBED_API.md：${missing.join(', ')}`).toEqual([])
  })

  it('文档里没有编造的事件名', () => {
    // 事件表那一段里的名字，必须全在 EVENT_NAMES 里。
    const at = doc.indexOf('## 3. 事件表')
    const until = doc.indexOf('## 4.')
    const section = doc.slice(at, until)
    const names = [...section.matchAll(/^\|\s*`(\w+)`\s*\|/gm)].map((m) => m[1]!)
    expect(names.length, '事件表里应当有行').toBeGreaterThan(5)
    const bogus = names.filter((name) => !EVENT_NAMES.includes(name as never))
    expect(bogus, `文档里这些事件不存在：${bogus.join(', ')}`).toEqual([])
  })
})

describe('ADR-0042 决策 5 · 样板页只 mount 一次', () => {
  /**
   * 第一版调了两次 `W3Player.mount`（快速开始切片一次、样板自身接线一次），容器同一个。
   *
   * 后果不是「多了一个 iframe」这么轻：两套完整运行时（两个 WebGL2 上下文、两条 rAF
   * 循环、包与策略各下载两遍），两个 iframe 一上一下排开，第二个整个溢出 540px 的容器
   * 压在按钮行上，而**四个按钮绑的恰好是溢出到框外的那一个**——用户看到的那个只收到
   * 快速开始那三条命令。
   *
   * 当时没有任何东西挡得住：`docs-sync` 只比文本切片，没有任何 E2E 打开过这一页。
   */
  const sample = readFileSync(SAMPLE, 'utf8')

  it('全文只有一处 `W3Player.mount(`', () => {
    const calls = [...sample.matchAll(/W3Player\.mount\(/g)]
    expect(calls.length, `样板页 mount 了 ${calls.length} 次`).toBe(1)
  })

  it('快速开始里那次 mount 的结果被存下来复用', () => {
    // 只数一次调用还不够：把第二次 mount 换成「不存句柄、按钮全绑不上」也是一次调用。
    expect(sample).toMatch(/const\s+ready\s*=\s*W3Player\.mount\(/)

    // ⚠ 第一版这条断言是**空跑的**：它对整份文件匹配 `ready.then(`，而快速开始切片自己
    // 就有一行 `ready.then(async (player) => {`。把样板页自己的接线整段删掉（四个按钮
    // 一个都绑不上、#log 一个字不写），11 条照样全绿。而快速开始那一行又被同文件的
    // 「逐字相同」测试钉死在 EMBED_API.md 上——于是这条断言由那条测试蕴含，什么都没多查。
    //
    // 改成只看 `doc:quickstart:end` **之后**的那一段：样板页自己的接线必须复用句柄。
    const wiring = sample.slice(sample.indexOf('// doc:quickstart:end'))
    expect(wiring, '样板页自己的接线要复用那个句柄').toMatch(/\bready\s*\n?\s*\.then\(/)
    expect(wiring, '接线段里不许再 mount 一次').not.toContain('W3Player.mount(')
  })

  it('快速开始带 `.catch` —— 客户照抄的就是这一段', () => {
    const doc = readFileSync(DOC, 'utf8')
    const slice = (text: string, a: string, b: string) => text.slice(text.indexOf(a), text.indexOf(b))
    for (const [name, text] of [
      ['样板页', slice(sample, '// doc:quickstart:start', '// doc:quickstart:end')],
      ['EMBED_API.md', slice(doc, '<!-- doc:quickstart:start -->', '<!-- doc:quickstart:end -->')],
    ] as const) {
      expect(text, `${name} 的快速开始没有 .catch`).toContain('.catch(')
    }
  })
})

describe('T-277 · 样板页零外链', () => {
  it('没有一个 http(s):// 地址', () => {
    // C6：内网部署下任何外链都是白屏。样板页是我们交给客户抄的东西，它得是能抄的。
    const sample = readFileSync(SAMPLE, 'utf8')
    const external = [...sample.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0])
    expect(external, `样板页里有外链：${external.join(', ')}`).toEqual([])
  })

  it('引的是相对路径的 embed.js', () => {
    expect(readFileSync(SAMPLE, 'utf8')).toContain('src="/player/embed.js"')
  })
})
