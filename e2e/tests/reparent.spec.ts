import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { resetStorage } from './storage-reset.js'

/**
 * T-258 · 拖拽改父，零件不许在画面上跳。
 *
 * ## 为什么这条必须是 E2E，而且必须断屏幕位置
 *
 * 卡面把这一点写成了变异检验 ①，并且说清了它防的是什么：**如果 E2E 只断言「拖完之后
 * parent 变了」，它对位置跳变完全无感**。而位置跳变正是这张卡要修的缺陷本身——
 * `parent` 改对了、`order` 改对了、`checkIntegrity` 零 error、文档看起来完全正常，
 * 零件却在视口里挪到了几米以外。三个单测全绿，用户看到的是模型散架了。
 *
 * 单测能断的是「新的局部 transform 算得对」。它断不到的是**运行时有没有把这次改动
 * 当成一次增量补丁应用下去**——`parent` 与 `transform` 是两条不同的补丁路径，
 * 一条走 `graph.reparent`、一条走对象的 TRS。两条在同一帧里的顺序错了，或者其中
 * 一条走了全量重建兜底，屏幕上都会看得见，而单测一无所知。
 *
 * ## 观测量：`__w3DevLocate` 而不是像素
 *
 * 读的是渲染器自己的 `projectToScreen`——包围盒中心投到屏幕。不采像素直方图：
 * 一个球挪了两米，在直方图上可能只是几个桶各变几个计数（T-252 记过这条教训，
 * 采样直方图对「这一小片东西还在不在」极不敏感）。投影坐标是直接的、可解释的、
 * 变异一改就大幅偏移的量。
 */

const SETTLE = 400
/** 树行高，与 `HierarchyTree.tsx` 的 `ROW_HEIGHT` 同值。中间三分之一 = 放进去。 */
const ROW_HEIGHT = 24

test.beforeEach(async ({ page }) => {
  await resetStorage(page, 'w3-e2e-reparent')
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[browser error] ${message.text()}`)
  })
})

/* -------------------------------------------------------------------------- */
/* Readers                                                                     */
/* -------------------------------------------------------------------------- */

const statusNumber = (page: Page, label: string) =>
  page.locator('.statusbar span', { hasText: label }).locator('b').first()

const rebuilds = async (page: Page) => Number(await statusNumber(page, '全量重建').innerText())
const undoDepth = async (page: Page) => Number(await statusNumber(page, '历史').innerText())

const row = (page: Page, name: string): Locator => page.locator('.tree-row', { hasText: name }).first()

const nodeIdOf = (page: Page, name: string) =>
  page.evaluate((text: string) => {
    const found = [...document.querySelectorAll('.tree-row')].find((r) => r.textContent?.includes(text))
    return found?.getAttribute('data-node-id') ?? null
  }, name)

/** 渲染器说这个节点在屏幕上的哪里。null = 不在视野内。 */
const screenPointOf = (page: Page, nodeId: string) =>
  page.evaluate((id: string) => {
    const locate = (globalThis as Record<string, unknown>)['__w3DevLocate'] as
      | ((n: string) => { x: number; y: number } | null)
      | undefined
    return locate?.(id) ?? null
  }, nodeId)

/** 文档里这个节点的 parent 与 transform.p。断言要看的两个东西。 */
const nodeStateOf = (page: Page, nodeId: string) =>
  page.evaluate((id: string) => {
    const read = (globalThis as Record<string, unknown>)['__w3DevDoc'] as (() => unknown) | undefined
    const doc = read?.() as { nodes: { id: string; parent: string | null; transform: { p: number[] } }[] } | null
    const node = doc?.nodes.find((n) => n.id === id)
    return node ? { parent: node.parent, p: node.transform.p } : null
  }, nodeId)

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

const tab = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true })
const tile = (page: Page, label: string): Locator => page.locator('.library-grid__item', { hasText: label }).first()

/** 属性面板里某一组的第 `axis` 个输入框（顺序就是 X / Y / Z）。 */
function axisInput(page: Page, group: string, axis: 0 | 1 | 2): Locator {
  return page
    .locator('fieldset.group')
    .filter({ has: page.locator('legend', { hasText: group }) })
    .locator('input.field__input')
    .nth(axis)
}

async function setAxis(page: Page, group: string, axis: 0 | 1 | 2, value: number): Promise<void> {
  const input = axisInput(page, group, axis)
  await input.fill(String(value))
  await input.press('Enter')
  await page.waitForTimeout(SETTLE / 2)
}

/** 拖一行到另一行的正中间 —— 中间三分之一是「放进去（成为子节点）」。 */
async function dragRowInto(page: Page, dragged: string, target: string): Promise<void> {
  await row(page, dragged).dragTo(row(page, target), { targetPosition: { x: 60, y: ROW_HEIGHT / 2 } })
  await page.waitForTimeout(SETTLE)
}

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('canvas.viewport__canvas')).toBeVisible()
  await page.waitForTimeout(SETTLE * 3)
  await tab(page, '资源库').click()
}

/**
 * 建一个「带偏移 + 旋转 + 缩放的分组」与一个要拖进去的零件。
 *
 * 缩放取**均匀**的 2：非均匀缩放 + 旋转会产生剪切，那时候世界位姿本来就保不住
 * （单测里两条正反用例守着这一点）。这条 E2E 要断的是「能保住的时候真的保住了」。
 */
async function buildScene(page: Page): Promise<{ group: string; part: string }> {
  const canvas = page.locator('canvas.viewport__canvas')
  await tile(page, '立方体').dragTo(canvas, { targetPosition: { x: 140, y: 330 } })
  await page.waitForTimeout(SETTLE)
  await tile(page, '球体').dragTo(canvas, { targetPosition: { x: 420, y: 300 } })
  await page.waitForTimeout(SETTLE)

  const group = await nodeIdOf(page, '立方体')
  const part = await nodeIdOf(page, '球体')
  expect(group, '立方体没建出来').not.toBeNull()
  expect(part, '球体没建出来').not.toBeNull()

  // 给分组一个不平凡的位姿。不这么做的话，父级是单位阵，「位姿不变」会自动成立——
  // 那正是这条 E2E 最容易写成的假绿。
  await row(page, '立方体').click()
  await setAxis(page, '位置', 0, 1.5)
  await setAxis(page, '位置', 1, 0.75)
  await setAxis(page, '旋转（度）', 1, 35)
  await setAxis(page, '缩放', 0, 2)
  await setAxis(page, '缩放', 1, 2)
  await setAxis(page, '缩放', 2, 2)

  return { group: group as string, part: part as string }
}

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

test('① 拖进带偏移+旋转+缩放的分组：屏幕位置不变，Ctrl+Z 完全还原，零全量重建', async ({ page }) => {
  test.setTimeout(120_000)
  await openLibrary(page)
  const { group, part } = await buildScene(page)

  const beforeState = await nodeStateOf(page, part)
  const beforePoint = await screenPointOf(page, part)
  expect(beforePoint, '球体不在视野内，后面的断言无从谈起').not.toBeNull()
  expect(beforeState?.parent, '前提：球体还是根一级').toBeNull()
  const beforeUndo = await undoDepth(page)

  await dragRowInto(page, '球体', '立方体')

  /* — ⭐ 这一条是整张卡的核心：画面上不许动 ————————————————————————— */
  //
  // **顺序是有意的：它排在「parent 变了」和「transform 变了」两条之前。** 卡面点名的
  // 变异是「`reparentPreservingWorld` 原样返回旧 transform」，要求「位置不变」这一条转红。
  // 如果把 transform 那条断言写在前面，变异会先撞上它，位置断言一次都跑不到——报告里
  // 看到的是红，但红的不是卡面要的那一条，等于没验。
  const afterPoint = await screenPointOf(page, part)
  expect(afterPoint, '改父之后球体从视野里消失了').not.toBeNull()
  expect(Math.abs(afterPoint!.x - beforePoint!.x), '改父后横向跳了').toBeLessThan(1.5)
  expect(Math.abs(afterPoint!.y - beforePoint!.y), '改父后纵向跳了').toBeLessThan(1.5)

  /* — 改父确实发生了 —————————————————————————————————————————————— */
  const afterState = await nodeStateOf(page, part)
  expect(afterState?.parent, '拖进去之后父级应当是立方体').toBe(group)
  // 局部 transform 被改写了。否则「位置不变」只可能是因为父级是单位阵——
  // 而 buildScene 刚刚保证了它不是。
  expect(afterState?.p, '保持世界位姿必然要改写局部 transform').not.toEqual(beforeState?.p)

  /* — 一次拖拽一条撤销，且撤销把 transform 也还回去 ——————————————————— */
  expect(await undoDepth(page), '一次拖拽 = 一条撤销').toBe(beforeUndo + 1)

  await page.keyboard.press('Control+z')
  await page.waitForTimeout(SETTLE)

  const undone = await nodeStateOf(page, part)
  expect(undone?.parent, 'Ctrl+Z 之后父级要回到根一级').toBeNull()
  // 只还 parent 不还 transform 的话，球体会停在一个新算出来的局部坐标上 —— 比不撤销还糟。
  expect(undone?.p, 'Ctrl+Z 之后局部 transform 也要还回去').toEqual(beforeState?.p)

  const undonePoint = await screenPointOf(page, part)
  expect(Math.abs(undonePoint!.x - beforePoint!.x), '撤销之后没回到原处').toBeLessThan(1.5)
  expect(Math.abs(undonePoint!.y - beforePoint!.y), '撤销之后没回到原处').toBeLessThan(1.5)

  /* — D1 的警报 ————————————————————————————————————————————————— */
  expect(await rebuilds(page), '改父与撤销都必须走增量补丁').toBe(0)
})

test('② 非均匀缩放的父级：给出中文提示，而不是悄悄给个近似值', async ({ page }) => {
  test.setTimeout(120_000)
  await openLibrary(page)
  await buildScene(page)

  // 把分组的缩放改成非均匀。{p,r,s} 表达不了剪切，这一拖注定只能近似。
  //
  // ⚠ **改的是 Z 不是 Y，这一处是有讲究的。** 分组绕 Y 转 35°，而绕 Y 的旋转只搅动
  // X 与 Z 两轴——把 Y 改成 0.5、留下 X = Z = 2 的话，那一层在 XZ 平面上仍然是相似变换，
  // **一点剪切都不会产生**，提示正确地不出现。第一版就是这么写的，红了一次才看明白：
  // 红的是测试的场景，不是产品。非均匀必须落在旋转搅得动的那两根轴上。
  //
  // ⚠ **也不要再点一次立方体那一行。** `toggleSelection(id, additive=false)` 对「当前
  // 唯一选中的就是它」这一种情形是**取消选中**，属性面板会整个空掉，下面这行就找不到
  // 输入框了（第一版在这里挂到超时）。`buildScene` 出来时它本来就是选中的。
  await setAxis(page, '缩放', 2, 0.5)

  await dragRowInto(page, '球体', '立方体')

  const warning = page.getByTestId('reparent-warning')
  await expect(warning, '非均匀缩放的父级必须给提示').toBeVisible()
  await expect(warning).toContainText('非均匀缩放')
  await expect(warning).toContainText('球体')

  // 提示可以关掉，而且关掉不动文档。
  await warning.getByRole('button', { name: '知道了' }).click()
  await expect(warning).toBeHidden()
  expect(await rebuilds(page), '一句提示不该触发重建').toBe(0)
})

test('③ 均匀缩放的父级：一句提示都没有（证明 ② 不是恒真）', async ({ page }) => {
  test.setTimeout(120_000)
  await openLibrary(page)
  await buildScene(page)

  await dragRowInto(page, '球体', '立方体')

  await expect(page.getByTestId('reparent-warning'), '能精确保住的时候不该报警').toBeHidden()
})
