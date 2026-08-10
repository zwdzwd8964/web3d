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
