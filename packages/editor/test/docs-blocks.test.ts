import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHORTCUTS, applyBlock, markersOf, readBlock, renderShortcutTable } from '../src/shortcuts.js'

/**
 * T-290 · 用户手册里的快捷键表是**生成的**，不是手抄的。
 *
 * 手抄的文档不会报错，它只会慢慢变旧——而快捷键表恰好是「改一条、忘一处」代价最直接的
 * 东西：用户按手册上写的键，什么都没发生，然后他得出的结论是这个工具不稳定。
 *
 * 默认**比对**；`UPDATE_DOCS=1` 时**重写**。两条路共用 `renderShortcutTable`，所以
 * 「修好的样子」与「比对的期望」不可能分家。
 */

const MANUAL = join(import.meta.dirname, '../../../docs/验收材料/用户手册.md')
const BLOCK = 'shortcuts'

describe('生成块 · 用户手册的快捷键节', () => {
  it('与 SHORTCUTS 一致（不一致时用 UPDATE_DOCS=1 重跑本测试即可修好）', () => {
    const text = readFileSync(MANUAL, 'utf8').replace(/\r\n/g, '\n')
    const expected = renderShortcutTable()

    if (process.env['UPDATE_DOCS']) {
      writeFileSync(MANUAL, applyBlock(text, BLOCK, expected))
      return
    }

    expect(
      readBlock(text, BLOCK),
      `用户手册的快捷键节与 SHORTCUTS 不一致。跑 UPDATE_DOCS=1 pnpm -F @w3/editor test docs-blocks 重写它。`,
    ).toBe(expected)
  })

  /**
   * 卡面点名的那条：**「`UPDATE_DOCS=1` 写成什么都不做」这条变异要能红。**
   *
   * 上面那条断言对它无感——文档本来就是一致的，什么都不做也一致。所以这里直接测
   * 重写逻辑：把块改坏，`applyBlock` 要能把它修回去。
   */
  it('改坏之后 applyBlock 能修回去', () => {
    const text = readFileSync(MANUAL, 'utf8').replace(/\r\n/g, '\n')
    const broken = applyBlock(text, BLOCK, '| 乱写的 | 一行 |')
    expect(readBlock(broken, BLOCK)).toBe('| 乱写的 | 一行 |')

    const repaired = applyBlock(broken, BLOCK, renderShortcutTable())
    expect(readBlock(repaired, BLOCK)).toBe(renderShortcutTable())
    // 修回去之后应当与磁盘上那份逐字相同——否则「修好」和「本来就对」是两个样子。
    expect(repaired).toBe(text)
  })

  it('标记缺一半时抛，不是悄悄追加一个新块', () => {
    const { open, close } = markersOf(BLOCK)
    // 追加的话文档里会有两份快捷键表，而读文档的人只会看见先出现的那一份。
    expect(() => applyBlock(`前言\n${open}\n表\n`, BLOCK, '新')).toThrow(/成对/)
    expect(() => applyBlock(`前言\n${close}\n`, BLOCK, '新')).toThrow(/成对/)
    expect(() => readBlock('什么都没有', BLOCK)).toThrow(/成对/)
  })

  it('渲染出来的表覆盖全部快捷键', () => {
    const table = renderShortcutTable()
    for (const shortcut of SHORTCUTS) {
      expect(table, `手册里没有「${shortcut.id}」`).toContain(shortcut.what)
      expect(table).toContain(`\`${shortcut.chord}\``)
    }
    expect(table).not.toContain('没有被渲染出来')
  })
})
