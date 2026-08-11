import { setUi, useUi } from '../store/ui-store.js'
import { helpSections, renderChord } from './table.js'

/**
 * T-290 · 快捷键速查面板。
 *
 * **整块从 `SHORTCUTS` 渲染**，一个键位都不手写。手写的面板会跟表分家，而分家的那一天
 * 没有任何东西会红——用户按面板上写的键，什么都没发生。
 *
 * ⚠ 只渲染 `HELP_GROUP_ORDER` 里的分组。这不是疏漏，是**故意留的一道闸**：新增一条
 * 快捷键时如果给了一个没进那张表的分组，它会在面板上消失，而
 * 「每个 id 都出现在面板里」那条断言当场红。自动把未知分组兜到最后的写法看着更宽容，
 * 代价是那条断言永远绿。
 */
export function ShortcutHelp() {
  const { helpOpen } = useUi()
  if (!helpOpen) return null

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="快捷键" onClick={() => setUi({ helpOpen: false })}>
      <div className="modal__body shortcut-help" onClick={(event) => event.stopPropagation()}>
        <h2>快捷键</h2>
        {helpSections().map((section) => (
          <section key={section.group}>
            <h3>{section.group}</h3>
            <table className="shortcut-help__table">
              <tbody>
                {section.items.map((item) => (
                  <tr key={item.id} data-shortcut={item.id}>
                    <td>
                      <kbd>{renderChord(item.chord)}</kbd>
                      {(item.alias ?? []).map((alias) => (
                        <kbd key={alias}>{renderChord(alias)}</kbd>
                      ))}
                    </td>
                    <td>{item.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        <div className="modal__actions">
          <button type="button" className="tbtn" onClick={() => setUi({ helpOpen: false })} autoFocus>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
