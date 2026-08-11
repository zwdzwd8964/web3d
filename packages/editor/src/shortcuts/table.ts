/**
 * T-290 · 快捷键，写成一张表。
 *
 * ## 为什么值得从 `if` 改成表
 *
 * `shortcuts.ts` 的注释自称是「唯一定义」，而 `Ctrl+S` **不在里面**——它住在
 * `useAutoSave.ts` 的第二个 keydown 监听里。后果不是洁癖问题：那个监听**不经过
 * `isTypingInto` 文本框守卫**，于是在重命名输入框里按 `Ctrl+S` 会触发一次保存。
 * 一份「唯一定义」的注释，和一个绕过它的监听器，在代码里长得一模一样。
 *
 * 表让三件事变成可断言的：**没有重复的键位**、**每个键位的写法一致**、
 * **速查面板与真实行为同源**。这三条以前只能靠人读。
 */

/** 面板上的分组。**闭集**——`helpSections` 只渲染这里列出的组。 */
export const HELP_GROUP_ORDER = ['文件', '编辑', '选择', '帮助'] as const
export type ShortcutGroup = (typeof HELP_GROUP_ORDER)[number]

export interface Shortcut {
  /** 稳定标识。面板、测试、文档三处都按它对齐，所以改名等于换一条。 */
  readonly id: string
  readonly group: ShortcutGroup
  /** 主键位。写法由 `CHORD_RE` 约束，修饰键顺序固定 `Ctrl+Alt+Shift+键`。 */
  readonly chord: string
  /** 同义键位。与 `chord` 一起参与查重。 */
  readonly alias?: readonly string[]
  /** 一句话中文说明。面板与用户手册显示的都是它。 */
  readonly what: string
  /**
   * 在输入框 / 文本域里也生效吗。**默认 false。**
   *
   * 这个字段是 `Ctrl+S` 那个 bug 的直接产物：以前它没有开关，因为它压根不在表里。
   */
  readonly allowInTextField?: boolean
}

/**
 * 全部快捷键。
 *
 * 新增一条要同时满足三件事，否则机械检查会红：键位不与已有的重复、写法过
 * `CHORD_RE`、`group` 在 `HELP_GROUP_ORDER` 里（否则面板渲染不到它）。
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'save', group: '文件', chord: 'Ctrl+S', what: '立即保存（编辑后也会自动保存）' },
  { id: 'undo', group: '编辑', chord: 'Ctrl+Z', what: '撤销' },
  { id: 'redo', group: '编辑', chord: 'Ctrl+Y', alias: ['Ctrl+Shift+Z'], what: '重做' },
  { id: 'copy', group: '编辑', chord: 'Ctrl+C', what: '复制选中的对象' },
  { id: 'paste', group: '编辑', chord: 'Ctrl+V', what: '粘贴（整棵子树一次撤销）' },
  { id: 'duplicate', group: '编辑', chord: 'Ctrl+D', what: '就地复制一份并选中它' },
  { id: 'remove', group: '编辑', chord: 'Delete', alias: ['Backspace'], what: '删除选中的对象（先问一句）' },
  { id: 'rename', group: '编辑', chord: 'F2', what: '重命名选中的对象' },
  { id: 'selectAll', group: '选择', chord: 'Ctrl+A', what: '全选' },
  { id: 'deselect', group: '选择', chord: 'Escape', what: '取消选择（面板开着时先关面板）' },
  { id: 'search', group: '选择', chord: 'Ctrl+F', what: '定位到层级树的搜索框' },
  { id: 'help', group: '帮助', chord: '?', alias: ['F1'], what: '打开 / 关闭这张快捷键速查表' },
]

/**
 * 一个键位的合法写法。
 *
 * 修饰键**顺序固定**为 `Ctrl+Alt+Shift+键`。不固定的话 `Ctrl+Shift+Z` 与
 * `Shift+Ctrl+Z` 会是两条不同的记录，而查重看不出它们是同一个键位。
 */
export const CHORD_RE = /^(Ctrl\+)?(Alt\+)?(Shift\+)?([A-Z0-9?]|F\d{1,2}|Delete|Backspace|Escape|Tab|Enter|Space)$/

/**
 * 浏览器自己占着的九个键位。表里出现任何一个都判红。
 *
 * 抢不过来是次要的，**抢一半才是灾难**：`Ctrl+W` 在有的平台能拦、有的不能，于是
 * 「关标签页」这件事变成随机的。
 */
export const BROWSER_RESERVED = [
  'Ctrl+T',
  'Ctrl+N',
  'Ctrl+W',
  'Ctrl+Q',
  'Ctrl+Shift+T',
  'Ctrl+Shift+N',
  'Ctrl+Shift+W',
  'Ctrl+Tab',
  'F5',
] as const

/** 一个键盘事件对应的键位写法。修饰键顺序与 `CHORD_RE` 一致。 */
export function chordOf(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey?: boolean
  shiftKey: boolean
}): string {
  const parts: string[] = []
  // metaKey 归一成 Ctrl：macOS 上 ⌘ 才是「主修饰键」，而表里只写一份。
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  // `?` 本身要按 Shift 才打得出来，把 Shift 也算进去的话它永远匹配不上。
  if (event.shiftKey && event.key !== '?') parts.push('Shift')
  parts.push(normaliseKey(event.key))
  return parts.join('+')
}

/** `KeyboardEvent.key` 归一成表里的写法。 */
function normaliseKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  return key
}

/**
 * 给人看的键位。
 *
 * v1.0 只做一件事：把 `Ctrl` 在 macOS 上显示成 `⌘`。判据由调用方传进来而不是在这里
 * 读 `navigator`——这个模块要能在纯 Node 里测。
 */
export function renderChord(chord: string, apple = false): string {
  return apple ? chord.replace('Ctrl+', '⌘') : chord
}

/** 表里全部键位（主键位 ∪ 同义键位），按出现顺序。 */
export function allChords(shortcuts: readonly Shortcut[] = SHORTCUTS): { chord: string; id: string }[] {
  return shortcuts.flatMap((s) => [{ chord: s.chord, id: s.id }, ...(s.alias ?? []).map((chord) => ({ chord, id: s.id }))])
}

/** 键位 → 快捷键。同义键位也在里面。 */
export function shortcutFor(chord: string, shortcuts: readonly Shortcut[] = SHORTCUTS): Shortcut | null {
  return shortcuts.find((s) => s.chord === chord || s.alias?.includes(chord)) ?? null
}

/** 速查面板的分组。**只渲染 `HELP_GROUP_ORDER` 里的组**——见 `ShortcutHelp` 的注释。 */
export function helpSections(shortcuts: readonly Shortcut[] = SHORTCUTS): { group: ShortcutGroup; items: Shortcut[] }[] {
  return HELP_GROUP_ORDER.map((group) => ({ group, items: shortcuts.filter((s) => s.group === group) })).filter(
    (section) => section.items.length > 0,
  )
}
