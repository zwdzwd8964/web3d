import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  BROWSER_RESERVED,
  CHORD_RE,
  HELP_GROUP_ORDER,
  SHORTCUTS,
  allChords,
  chordOf,
  handleShortcut,
  helpSections,
  isTypingInto,
  renderChord,
  shortcutFor,
} from '../src/shortcuts.js'
import type { ShortcutDeps, ShortcutEvent } from '../src/shortcuts.js'
import { getUi, resetUi } from '../src/store/ui-store.js'

/**
 * T-290 · 快捷键表的三道机械检查 + 路由行为。
 *
 * 三道检查的共同点：它们守的都是**「以后加一条时会不会出错」**，而不是今天这十二条对不对。
 * 今天这十二条我读一遍就能确认；一年后第十三条由别人加，那时没有人会重读全表。
 */

const SRC = join(import.meta.dirname, '../src')

describe('机械检查 ① · 键位不重复', () => {
  it('主键位与同义键位放在一起也没有重复', () => {
    const seen = new Map<string, string>()
    for (const { chord, id } of allChords()) {
      const owner = seen.get(chord)
      // 报错要**点名两个 id**：只说「有重复」的话，一张十几条的表要人肉扫一遍才知道是谁。
      expect(owner, `键位 ${chord} 被「${owner}」和「${id}」同时占用`).toBeUndefined()
      seen.set(chord, id)
    }
  })

  it('id 也不重复', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length)
  })
})

describe('机械检查 ② · 写法与修饰键顺序', () => {
  it('每个键位都过 CHORD_RE', () => {
    for (const { chord, id } of allChords()) {
      expect(CHORD_RE.test(chord), `「${id}」的键位「${chord}」写法不合法`).toBe(true)
    }
  })

  /**
   * 顺序固定为 `Ctrl+Alt+Shift+键`。
   *
   * 不固定的话 `Ctrl+Shift+Z` 与 `Shift+Ctrl+Z` 会是两条记录，而**查重看不出它们是同一个
   * 键位**——于是机械检查 ① 会在一个真有冲突的表上绿。
   */
  it('修饰键顺序固定', () => {
    const order = ['Ctrl', 'Alt', 'Shift']
    for (const { chord, id } of allChords()) {
      const mods = chord.split('+').slice(0, -1)
      const sorted = [...mods].sort((a, b) => order.indexOf(a) - order.indexOf(b))
      expect(mods, `「${id}」的修饰键顺序应为 ${sorted.join('+')}`).toEqual(sorted)
    }
  })
})

describe('机械检查 ③ · 不抢浏览器的键', () => {
  it('九个保留键位一个都不在表里', () => {
    const taken = allChords().filter(({ chord }) => (BROWSER_RESERVED as readonly string[]).includes(chord))
    // 抢不过来是次要的，抢一半才是灾难：有的平台能拦、有的不能，于是「关标签页」变成随机的。
    expect(taken, `占用了浏览器保留键位：${taken.map((t) => `${t.id}→${t.chord}`).join('、')}`).toEqual([])
  })

  it('保留清单正好九条', () => {
    expect(BROWSER_RESERVED).toHaveLength(9)
  })
})

describe('机械检查 ④ · 全编辑器只有一个 keydown 监听', () => {
  /**
   * 这条是本卡的起因。
   *
   * `Ctrl+S` 原来住在 `useAutoSave.ts` 的第二个监听里，因此**不经过 `isTypingInto`
   * 守卫**——而 `shortcuts.ts` 的注释自称是「唯一定义」。一份声称唯一的注释，和一个
   * 绕过它的监听器，在代码里长得一模一样；只有数一数才看得出来。
   */
  it('只剩一处 addEventListener(\'keydown\'', () => {
    const hits: string[] = []
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8')
      const count = (text.match(/addEventListener\('keydown'/g) ?? []).length
      for (let i = 0; i < count; i += 1) hits.push(file.slice(SRC.length + 1).split('\\').join('/'))
    }
    expect(hits, `keydown 监听出现在：${hits.join('、')}`).toEqual(['shortcuts.ts'])
  })

  /** 同一形状的第二条：删除的问句只有一处推导。 */
  it('describeRemoval 只有 removal.ts 一处定义', () => {
    const definitions: string[] = []
    for (const file of walk(SRC)) {
      if (/function describeRemoval|const describeRemoval/.test(readFileSync(file, 'utf8'))) {
        definitions.push(file.slice(SRC.length + 1).split('\\').join('/'))
      }
    }
    expect(definitions).toEqual(['panels/removal.ts'])
  })

  /**
   * `describeReferences` 的使用面。
   *
   * 卡面写的是「只命中 `removal.ts` 一处」，实测另有两处**读展示摘要**的合法用法
   * （媒体面板的「被 N 条规则引用」、热点面板同形），它们不做删除判断。所以这里收成
   * 一张三条的名单：`HierarchyTree` 掉出去，正是本卡要的那件事。
   */
  it('describeReferences 的使用面收在三个文件里，层级树不在其中', () => {
    const users: string[] = []
    for (const file of walk(SRC)) {
      if (readFileSync(file, 'utf8').includes('describeReferences')) {
        users.push(file.slice(SRC.length + 1).split('\\').join('/'))
      }
    }
    expect(users.sort()).toEqual(['lib/media-edit.ts', 'panels/HotspotPanel.tsx', 'panels/removal.ts'])
  })
})

describe('速查面板', () => {
  it('每条快捷键都出现在面板渲染出来的分组里', () => {
    const rendered = new Set(helpSections().flatMap((s) => s.items.map((i) => i.id)))
    const missing = SHORTCUTS.filter((s) => !rendered.has(s.id))
    // 面板只渲染 HELP_GROUP_ORDER 里的组，所以「加了一条但给了个没进表的分组」会在这里红。
    expect(missing.map((m) => m.id), '这些快捷键在面板上看不到').toEqual([])
  })

  it('分组顺序就是 HELP_GROUP_ORDER', () => {
    expect(helpSections().map((s) => s.group)).toEqual(HELP_GROUP_ORDER.filter((g) => SHORTCUTS.some((s) => s.group === g)))
  })

  it('renderChord 在苹果键盘上把 Ctrl 换成 ⌘', () => {
    expect(renderChord('Ctrl+S')).toBe('Ctrl+S')
    expect(renderChord('Ctrl+S', true)).toBe('⌘S')
  })
})

describe('chordOf', () => {
  it('把事件归一成表里的写法', () => {
    expect(chordOf({ key: 's', ctrlKey: true, metaKey: false, shiftKey: false })).toBe('Ctrl+S')
    expect(chordOf({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: true })).toBe('Ctrl+Shift+Z')
    expect(chordOf({ key: 'Delete', ctrlKey: false, metaKey: false, shiftKey: false })).toBe('Delete')
    expect(chordOf({ key: 'F2', ctrlKey: false, metaKey: false, shiftKey: false })).toBe('F2')
  })

  it('⌘ 归一成 Ctrl —— 表里只写一份', () => {
    expect(chordOf({ key: 's', ctrlKey: false, metaKey: true, shiftKey: false })).toBe('Ctrl+S')
  })

  /** `?` 本身要按 Shift 才打得出来，把 Shift 也算进去的话它永远匹配不上表里的 `?`。 */
  it('? 不带 Shift', () => {
    expect(chordOf({ key: '?', ctrlKey: false, metaKey: false, shiftKey: true })).toBe('?')
    expect(shortcutFor(chordOf({ key: '?', ctrlKey: false, metaKey: false, shiftKey: true }))?.id).toBe('help')
  })
})

describe('文本框守卫', () => {
  let saved = 0
  let deps: ShortcutDeps

  beforeEach(() => {
    resetUi()
    saved = 0
    deps = {
      undo: () => {},
      redo: () => {},
      commit: () => {},
      select: () => {},
      saveNow: () => (saved += 1),
      focusSearch: () => {},
      getState: () => ({ doc: createGoldenPathDocument() as SceneDocument, selection: [] }),
    }
  })

  const press = (chord: { key: string; ctrl?: boolean; shift?: boolean }, tagName?: string) => {
    let prevented = false
    const event: ShortcutEvent = {
      key: chord.key,
      ctrlKey: chord.ctrl ?? false,
      metaKey: false,
      shiftKey: chord.shift ?? false,
      target: tagName ? { tagName } : null,
      preventDefault: () => (prevented = true),
    }
    handleShortcut(event, deps)
    return prevented
  }

  it('Ctrl+S 在画布上保存', () => {
    expect(press({ key: 's', ctrl: true })).toBe(true)
    expect(saved).toBe(1)
  })

  /**
   * **今天（本卡之前）这一条是会保存的。**
   *
   * `Ctrl+S` 住在 `useAutoSave` 的第二个监听里，那个监听不认识 `isTypingInto`。
   */
  it('Ctrl+S 在输入框里不保存', () => {
    expect(press({ key: 's', ctrl: true }, 'INPUT')).toBe(false)
    expect(saved).toBe(0)
  })

  it('表里没有的键位一律不拦', () => {
    expect(press({ key: 'k', ctrl: true })).toBe(false)
  })

  it('isTypingInto 认 INPUT / TEXTAREA / SELECT 与 contentEditable', () => {
    expect(isTypingInto({ tagName: 'INPUT' })).toBe(true)
    expect(isTypingInto({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isTypingInto({ tagName: 'DIV' })).toBe(false)
    expect(isTypingInto(null)).toBe(false)
  })

  it('? 开面板，Esc 先关面板再谈取消选择', () => {
    press({ key: '?', shift: true })
    expect(getUi().helpOpen).toBe(true)
    press({ key: 'Escape' })
    expect(getUi().helpOpen).toBe(false)
  })

  it('Delete 只提出请求，不直接删', () => {
    deps = { ...deps, getState: () => ({ doc: createGoldenPathDocument() as SceneDocument, selection: ['nd_00000001'] }) }
    expect(press({ key: 'Delete' })).toBe(true)
    // 真正的删除要先过确认对话框——树上的 ✕ 走的是同一条路。
    expect(getUi().pendingDelete).toBe('nd_00000001')
  })
})

/** `src` 下所有 ts / tsx 文件。 */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}
