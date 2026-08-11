import type { Shortcut } from './table.js'
import { HELP_GROUP_ORDER, SHORTCUTS, helpSections } from './table.js'

/**
 * T-290 · 文档里的生成块。
 *
 * 用户手册里的快捷键表是**从 `SHORTCUTS` 生成的**，不是手抄的。手抄的文档不会报错，
 * 它只会慢慢变旧——而快捷键表恰好是那种「改一条、忘一处」代价最直接的东西：用户按
 * 手册上写的键，什么都没发生。
 *
 * 机制两句话：默认**比对**，不一致就红并告诉你怎么修；`UPDATE_DOCS=1` 时**重写**。
 * 两条路共用同一个渲染函数，所以「修好的样子」与「比对的期望」不可能分家。
 */

/** 一个生成块的起止标记。 */
export function markersOf(name: string): { open: string; close: string } {
  return { open: `<!-- GENERATED:${name} -->`, close: `<!-- /GENERATED:${name} -->` }
}

/**
 * 把 `body` 塞进 `text` 里名为 `name` 的生成块。
 *
 * @returns 替换后的全文。
 * @throws 找不到标记、或者只找到一半时抛——**不是静默追加一个块**：那样会得到两份
 *   快捷键表，而读文档的人只会看见先出现的那一份。
 */
export function applyBlock(text: string, name: string, body: string): string {
  const { open, close } = markersOf(name)
  const from = text.indexOf(open)
  const to = text.indexOf(close)
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`文档里找不到成对的生成块标记 ${open} … ${close}`)
  }
  return `${text.slice(0, from + open.length)}\n${body}\n${text.slice(to)}`
}

/** 读出名为 `name` 的生成块里现在写着什么。找不到标记时抛，理由同 `applyBlock`。 */
export function readBlock(text: string, name: string): string {
  const { open, close } = markersOf(name)
  const from = text.indexOf(open)
  const to = text.indexOf(close)
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`文档里找不到成对的生成块标记 ${open} … ${close}`)
  }
  return text.slice(from + open.length, to).trim()
}

/**
 * 快捷键表的 Markdown。
 *
 * 分组顺序、同义键位、说明文字全部来自 `SHORTCUTS`——**包括分组顺序**，所以
 * 「加了一条但面板没显示」与「加了一条但手册没写」是同一次失败。
 */
export function renderShortcutTable(shortcuts: readonly Shortcut[] = SHORTCUTS): string {
  const lines: string[] = []
  for (const section of helpSections(shortcuts)) {
    lines.push(`### ${section.group}`, '', '| 键位 | 作用 |', '|---|---|')
    for (const item of section.items) {
      const chords = [item.chord, ...(item.alias ?? [])].map((c) => `\`${c}\``).join(' 或 ')
      lines.push(`| ${chords} | ${item.what} |`)
    }
    lines.push('')
  }
  // 分组没有全部落进 `HELP_GROUP_ORDER` 时，这一句是唯一的线索。
  const covered = new Set(helpSections(shortcuts).flatMap((s) => s.items.map((i) => i.id)))
  const missing = shortcuts.filter((s) => !covered.has(s.id))
  if (missing.length > 0) {
    lines.push(`> ⚠ 有 ${missing.length} 条快捷键的分组不在 ${HELP_GROUP_ORDER.join(' / ')} 里，没有被渲染出来。`, '')
  }
  return lines.join('\n').trimEnd()
}
