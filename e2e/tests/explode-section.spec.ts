import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { resetStorage } from './storage-reset.js'

/**
 * T-294 · 爆炸与剖切，在真浏览器里。
 *
 * ## 这两件事为什么只能在这里测
 *
 * 两个动作**都不写文档**：
 *
 * - `setExplode` 每帧改三对象的 transform，`doc.nodes[i].transform.p` 从头到尾一动不动；
 * - 剖切的最终产物是 `renderer.clippingPlanes`，而文档里只有一个「有没有这把刀」的节点。
 *
 * 所以「爆炸把零件挪开了」「剖切真的在切」都是**关于渲染器的话**。拿文档去断言它们，
 * 断言在功能被整个删掉时也会通过——这正是 T-176 抓到的 `setLight` 假绿的形状，
 * 而 parity 跑在无 renderer 的 Node 里，够不到 `clippingPlanes`。
 *
 * 两个 DEV 探针（`__w3DevPositionOf` / `__w3DevSectionPlanes`）就是为这两句话造的。
 */

const SETTLE = 400

test.beforeEach(async ({ page }) => {
  await resetStorage(page, 'w3-e2e-explode')
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[browser error] ${message.text()}`)
  })
})

/** 一个节点的世界位置。**读的是三对象，不是文档。** */
async function positionOf(page: Page, nodeId: string): Promise<[number, number, number] | null> {
  return page.evaluate((id) => {
    const probe = (globalThis as Record<string, unknown>)['__w3DevPositionOf']
    if (typeof probe !== 'function') throw new Error('__w3DevPositionOf 不存在（DEV 构建才有）')
    return (probe as (n: string) => [number, number, number] | null)(id)
  }, nodeId)
}

/** 渲染器上真正装着的裁剪平面。**不是文档里那几个 section 节点。** */
async function planesOn(page: Page): Promise<{ normal: number[]; constant: number }[]> {
  return page.evaluate(() => {
    const probe = (globalThis as Record<string, unknown>)['__w3DevSectionPlanes']
    if (typeof probe !== 'function') throw new Error('__w3DevSectionPlanes 不存在（DEV 构建才有）')
    return (probe as () => { normal: number[]; constant: number }[])()
  })
}

/** 同一个节点在**文档**里记着的位置。用来证明「读文档」这条路是空转的。 */
async function docPositionOf(page: Page, nodeId: string): Promise<number[] | null> {
  return page.evaluate((id) => {
    const read = (globalThis as Record<string, unknown>)['__w3DevDoc'] as () => { nodes: { id: string; transform: { p: number[] } }[] } | null
    return read()?.nodes.find((n) => n.id === id)?.transform.p ?? null
  }, nodeId)
}

/** 泵组样板那个爆炸分组下的一颗螺栓。 */
const BOLT = 'nd_verbolt1'

test('① 爆炸：滑到 1 零件真的挪开，关掉回原位 —— 读的是三对象不是文档', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(SETTLE * 3)

  const before = await positionOf(page, BOLT)
  const docBefore = await docPositionOf(page, BOLT)
  expect(before, '探针拿不到螺栓的位置，后面的断言全是空的').not.toBeNull()

  // 工具条只要文档里有爆炸分组就在；滑杆要**先在下拉里选中一个分组**才出现
  // （下拉默认是「爆炸预览：关」）。第一版直接找滑杆，找不到 —— 而那不是缺陷，是流程。
  await expect(page.getByTestId('explode-toolbar'), '泵组样板里有爆炸分组，工具条应当在').toBeVisible()
  await page.getByTestId('explode-tool-group').selectOption({ label: '阀盖' })
  await page.waitForTimeout(SETTLE)

  const slider = page.getByTestId('explode-tool-factor')
  await expect(slider, '选了分组之后滑杆应当出现').toBeVisible()
  await slider.fill('1')
  await page.waitForTimeout(SETTLE * 2)

  const exploded = await positionOf(page, BOLT)
  // **这一条是整个文件的重点。** 位置必须真的变了。
  expect(exploded).not.toEqual(before)

  // 而文档里那个值**一个字都没动**。
  //
  // ⚠ 这一条把「读文档是空转」从注释里的一句说法变成了可执行的断言：爆炸前后各读一次，
  // 两次必须相等。第一版我把它写成了「先把读到的值存进另一个变量，再拿这两个变量相比」
  // ——**拿一个值跟它自己比，恒真**。写测试的人也会写出空转断言，这就是一个。
  expect(await docPositionOf(page, BOLT), '文档里的 transform 也变了？那爆炸就不是叠加层，这份测试的前提要重写').toEqual(
    docBefore,
  )

  await slider.fill('0')
  await page.waitForTimeout(SETTLE * 2)
  const restored = await positionOf(page, BOLT)
  expect(restored, '关掉爆炸之后没回原位').toEqual(before)
})

test('② 剖切：新建一把刀，渲染器上真的多一张平面；关掉它回到 0 张', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(SETTLE * 3)

  // 泵组样板自带一把默认关着的刀（T-284：静息态必须是 0 条平面）。
  expect(await planesOn(page), '静息态应当一张裁剪平面都没有').toHaveLength(0)

  await page.getByRole('button', { name: '场景效果' }).click()
  const panel = page.getByTestId('section-panel')
  await expect(panel).toBeVisible()

  // 打开样板自带的那把刀：在层级树里让它可见（ADR-0039 · 启用判定看世界可见性）。
  const knife = page.locator('.tree-row', { has: page.locator('.tree-row__name', { hasText: '水平剖切面' }) })
  await knife.locator('.tree-row__eye').click()
  await page.waitForTimeout(SETTLE * 2)

  const planes = await planesOn(page)
  // **装上了才算**。剖切层自己算对了不代表它把结果交给了渲染器——T-252 的三条断言
  // 当年全红在 `clipPlanes === 0` 上，坏的正是「算了但没装上」。
  expect(planes.length, '把刀打开了，渲染器上却一张裁剪平面都没有').toBeGreaterThan(0)
  expect(planes[0]!.normal.some((v) => Math.abs(v) > 0.5), '平面法向是零向量，说明没把节点的世界矩阵算进去').toBe(true)

  await knife.locator('.tree-row__eye').click()
  await page.waitForTimeout(SETTLE * 2)
  expect(await planesOn(page), '关掉之后应当回到 0 张').toHaveLength(0)
})
