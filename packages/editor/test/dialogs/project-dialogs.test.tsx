// @vitest-environment jsdom
import type { ProjectSummary } from '@w3/storage'
import { MemoryProvider } from '@w3/storage'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectButton } from '../../src/App.jsx'
import { NewProjectDialog } from '../../src/dialogs/NewProjectDialog.jsx'
import { ProjectListDialog } from '../../src/dialogs/ProjectListDialog.jsx'
import { ProjectProvider } from '../../src/project/ProjectContext.jsx'
import { createProject } from '../../src/project/project-lifecycle.js'
import { ProjectSession } from '../../src/project/session.js'
import { StoreProvider } from '../../src/store/StoreContext.jsx'
import { createDocumentStore } from '../../src/store/document-store.js'

/**
 * T-282 · 项目层的界面部分。
 *
 * ADR-0038 的范式：逐文件 `@vitest-environment jsdom` + `react-dom/client` + React 19 的
 * `act`。React 给 input 装了自己的 value setter，所以改输入框的值要走原型上的那个。
 *
 * ## 这里测的是**纯逻辑测不到的那三件事**
 *
 * 1. 当前打开的那一份在列表里**没有「打开」按钮**——点它会走一遍 `replaceDocument` 把
 *    撤销栈清掉，而用户点的是「打开」，界面上没有任何东西预告过这件事；
 * 2. 删除**要确认**，且确认框里写的是工程名（删的是存储里的另一条记录，本端 Ctrl+Z
 *    够不着它）；
 * 3. 删掉**当前打开**的那一份之后落到新建对话框且不崩。留在原地的话，用户面对的是一个
 *    编辑着一份已经不存在的工程的编辑器，而下一次自动保存会把它又写回去。
 */

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

/** React 装了自己的 value setter，直接赋值不会触发 onChange。 */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const button = (label: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)

const rowFor = (text: string): HTMLLIElement =>
  [...host.querySelectorAll('li')].find((li) => li.textContent?.includes(text))!

const rowButton = (row: HTMLElement, label: string): HTMLButtonElement =>
  [...row.querySelectorAll('button')].find((b) => b.textContent === label)!

const summary = (id: string, name: string): ProjectSummary => ({
  projectId: id,
  name,
  updatedAt: '2026-08-11T00:00:00.000Z',
})

describe('T-282 · 新建对话框', () => {
  it('空名与纯空白名时「新建空工程」是灰的', () => {
    act(() => {
      root.render(<NewProjectDialog onCreateEmpty={async () => {}} onCreateBuiltin={async () => {}} onClose={() => {}} />)
    })
    expect(button('新建空工程')!.disabled, '一开始名字是空的').toBe(true)

    const input = host.querySelector('input')!
    act(() => type(input, '   '))
    expect(button('新建空工程')!.disabled, '纯空白也算空').toBe(true)

    act(() => type(input, '3 号泵房'))
    expect(button('新建空工程')!.disabled).toBe(false)
  })

  it('内置样板那一列是从表里渲染的，不是另抄一份清单', () => {
    // 另抄一份的话，T-283 加泵组样板时会出现「表里有、界面上没有」——或者反过来，
    // 而反过来更坏：用户点得到一个打得开却发布不了的选项。
    const fake = [
      {
        projectId: 'prj_fake0001',
        label: '假样板',
        description: '只在测试里存在',
        create: () => ({}) as never,
        materialise: false,
      },
    ]
    act(() => {
      root.render(
        <NewProjectDialog builtins={fake} onCreateEmpty={async () => {}} onCreateBuiltin={async () => {}} onClose={() => {}} />,
      )
    })
    expect(host.textContent).toContain('假样板')
    expect(host.textContent).toContain('只在测试里存在')
  })

  it('新建失败时把中文原因显示出来，而不是静默', async () => {
    act(() => {
      root.render(
        <NewProjectDialog
          onCreateEmpty={async () => {
            throw new Error('存储满了')
          }}
          onCreateBuiltin={async () => {}}
          onClose={() => {}}
        />,
      )
    })
    act(() => type(host.querySelector('input')!, '随便'))
    await act(async () => {
      button('新建空工程')!.click()
    })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('存储满了')
  })
})

describe('T-282 · 工程列表对话框', () => {
  const projects = [summary('prj_current1', '当前工程'), summary('prj_other001', '另一份')]

  const render = (overrides: Partial<Parameters<typeof ProjectListDialog>[0]> = {}) => {
    const props = {
      projects,
      currentProjectId: 'prj_current1',
      onOpen: async () => {},
      onRename: async () => {},
      onDelete: async () => {},
      onNew: () => {},
      onClose: () => {},
      ...overrides,
    }
    act(() => root.render(<ProjectListDialog {...props} />))
    return props
  }

  it('**当前打开的那一份没有「打开」按钮**', () => {
    render()
    // 打开当前这一份会走一遍 replaceDocument 把撤销栈清掉，而用户点的是「打开」。
    expect([...rowFor('当前工程').querySelectorAll('button')].map((b) => b.textContent)).not.toContain('打开')
    expect([...rowFor('另一份').querySelectorAll('button')].map((b) => b.textContent)).toContain('打开')
    expect(rowFor('当前工程').textContent).toContain('当前')
  })

  it('重命名：输入框预填当前名字，空名时「确定」是灰的', () => {
    render()
    act(() => rowButton(rowFor('另一份'), '重命名').click())
    const input = host.querySelector('input')!
    expect(input.value, '预填的是当前名字').toBe('另一份')

    act(() => type(input, '  '))
    expect(button('确定')!.disabled).toBe(true)
    act(() => type(input, '新名字'))
    expect(button('确定')!.disabled).toBe(false)
  })

  it('重命名把 projectId 与新名字交给回调', async () => {
    const onRename = vi.fn(async () => {})
    render({ onRename })
    act(() => rowButton(rowFor('另一份'), '重命名').click())
    act(() => type(host.querySelector('input')!, '改过的名字'))
    await act(async () => {
      button('确定')!.click()
    })
    expect(onRename).toHaveBeenCalledWith('prj_other001', '改过的名字')
  })

  it('删除**要确认**，确认框里写的是工程名，点取消什么都不发生', async () => {
    const onDelete = vi.fn(async () => {})
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false)
    render({ onDelete })
    await act(async () => rowButton(rowFor('另一份'), '删除').click())

    expect(confirm).toHaveBeenCalled()
    expect(String(confirm.mock.calls[0]?.[0])).toContain('另一份')
    expect(String(confirm.mock.calls[0]?.[0])).toContain('不能撤销')
    expect(onDelete).not.toHaveBeenCalled()
  })
})

describe('T-282 · 删掉当前打开的工程', () => {
  it('落到新建对话框，且不崩', async () => {
    const storage = new MemoryProvider()
    const session = new ProjectSession({ storage })
    const current = await createProject(session, '当前工程')
    const store = createDocumentStore(current)
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true)

    await act(async () => {
      root.render(
        <ProjectProvider session={session}>
          <StoreProvider store={store}>
            <ProjectButton />
          </StoreProvider>
        </ProjectProvider>,
      )
    })

    await act(async () => button('项目')!.click())
    await act(async () => rowButton(rowFor('当前工程'), '删除').click())

    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('新建工程')
    expect(await storage.loadDocument(current.projectId)).toBeNull()
  })
})
