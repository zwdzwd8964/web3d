import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { resetStorage } from './storage-reset.js'

/**
 * T-289 · 崩溃恢复，三条。
 *
 * 这三条测的是同一件事的三个面：**上一次是怎么结束的**。判定本身（`classifyLease`）
 * 有穷举单测，草稿通道的次序有纯 Node 断言——这里要证的是那些结论在真浏览器里成立：
 * 一次真的刷新、一份真的 IndexedDB、两个真的标签页。
 *
 * ## 为什么第 2 条最容易假绿
 *
 * 「干净退出不该提示」如果只断言「没有横幅」，那么**把整个横幅组件删掉也会绿**。所以
 * 它必须同时断言两件事：编辑内容还在（正向），横幅不存在（反向）。少了正向那一半，
 * 这条测试对「崩溃恢复整个没了」这种失效毫无反应。
 */

const SETTLE = 400

/** 租约判定阈值调到 1 秒。**只调阈值，不调心跳**——理由见 `main.tsx` 的 `leaseRequest`。 */
const FAST_LEASE = '/?w3LeaseStaleMs=1000'

test.beforeEach(async ({ page }) => {
  await resetStorage(page, 'w3-e2e-crash')
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[browser error] ${message.text()}`)
  })
})

/** 改一个节点的名字。三条用例都靠它造出「有没保存的改动」这个前提。 */
async function renameNode(page: Page, from: string, to: string): Promise<void> {
  await page.locator('.tree-row__name', { hasText: from }).first().dblclick()
  const rename = page.locator('.tree-row__rename')
  await rename.fill(to)
  await rename.press('Enter')
}

const banner = (page: Page) => page.locator('.banner--warn')

test('① 崩溃 → 提示带真实数字 → 恢复回来', async ({ page }) => {
  await page.goto(FAST_LEASE)
  await page.waitForTimeout(SETTLE * 2)

  // 先让它把当前状态干净地存一次，于是后面那笔编辑是**确定的**未保存改动。
  await page.keyboard.press('Control+s')
  await expect(page.locator('.savestate')).toHaveText('已保存', { timeout: 10_000 })

  // 伪造崩溃**先于**编辑：心跳停了、pagehide 不再释放租约、正式保存永不返回。
  // 顺序这么排是为了不跟防抖赛跑——崩了之后的每一笔编辑都只会留下草稿。
  await page.evaluate(() => {
    const simulate = (globalThis as Record<string, unknown>)['__w3SimulateCrash']
    if (typeof simulate !== 'function') throw new Error('__w3SimulateCrash 不存在（DEV 构建才有）')
    ;(simulate as () => void)()
  })

  await renameNode(page, '阀盖', '阀盖-崩前改的')
  await page.waitForTimeout(SETTLE * 2)

  // 等到租约过期（阈值 1 秒）再回来。
  await page.waitForTimeout(1_500)
  await page.goto(FAST_LEASE)
  await page.waitForTimeout(SETTLE * 3)

  const bar = banner(page)
  await expect(bar).toBeVisible()

  // **数字是真的**，不是写死的字符串：从横幅上读出来，再要求它是一个正整数。
  // 断言「文案含『有 N 处修改』」而 N 写死的话，一个恒返回 1 的实现照样绿。
  const text = (await bar.innerText()).replace(/\s+/g, '')
  const matched = /有(\d+)处修改没保存/.exec(text)
  expect(matched, `横幅文案里没有真实数字：${text}`).not.toBeNull()
  expect(Number(matched![1])).toBeGreaterThan(0)

  await bar.getByRole('button', { name: '恢复' }).click()
  await expect(page.locator('.tree-row__name', { hasText: '阀盖-崩前改的' })).toBeVisible()
  await expect(bar).toBeHidden()
})

test('② 干净退出 → 不提示，而且编辑还在', async ({ page }) => {
  await page.goto(FAST_LEASE)
  await page.waitForTimeout(SETTLE * 2)

  await renameNode(page, '阀盖', '阀盖-正常改的')
  await page.keyboard.press('Control+s')
  await expect(page.locator('.savestate')).toHaveText('已保存', { timeout: 10_000 })

  // 正常刷新。租约阈值只有 1 秒，所以「心跳早就过期了」这件事必然成立——
  // 只看心跳、不看 `closedCleanly` 的判定会在这里报崩溃。
  await page.reload()
  await page.waitForTimeout(SETTLE * 3)

  // **正向**：编辑还在。少了这一半，把整个横幅组件删掉这条也绿。
  await expect(page.locator('.tree-row__name', { hasText: '阀盖-正常改的' })).toBeVisible()
  // **反向**：没有横幅。
  await expect(banner(page)).toHaveCount(0)

  // ⚠ 这一条**不覆盖** `pagehide` 里那次 `releaseLease`，而我一度以为它覆盖。
  //
  // 试过的写法：在 Ctrl+S 之后再改一笔不保存，好让库里有草稿。它当场红了，横幅写着
  // 「上次没有正常关闭，有 1 处修改没保存」——因为那次 `releaseLease` 是在卸载途中
  // 发起的 IndexedDB 写，常常来不及提交。
  //
  // 但那条红灯**是对的**：那时候确实有一笔改动没落盘，问一句正是该做的。所以问题
  // 出在我造的前提上，不在产品。真正守着「崩了但没草稿也不问」的是下面那条变异
  // （`bannerFor` 不再要求草稿存在 → 本条红），记在 MUTATIONS.md 的 ③′。
})

/**
 * ⚠ 这一条**故意不用 `FAST_LEASE`**。
 *
 * `?w3LeaseStaleMs=1000` 只调过期阈值、不调心跳间隔（心跳仍是 5 秒）——于是 A 自己的
 * 租约会在两次心跳之间就「过期」，B 一开就把它接管了，黄横幅永远不出现。第一次跑就是
 * 这么红的。**这不是产品缺陷，是这个测试开关的作用域**：它是为「让崩溃判定快点发生」
 * 造的，而这一条要的恰恰相反——它要 A 一直活着。
 */
test('③ 两个标签页 → 黄横幅，且 A 的文档没被 B 覆盖', async ({ browser }) => {
  const context = await browser.newContext()
  const a = await context.newPage()
  await resetStorage(a, 'w3-e2e-crash-two')
  await a.goto('/')
  await a.waitForTimeout(SETTLE * 2)

  await renameNode(a, '阀盖', '阀盖-A改的')
  await a.keyboard.press('Control+s')
  await expect(a.locator('.savestate')).toHaveText('已保存', { timeout: 10_000 })

  // B 开同一份工程。A 还活着（心跳在跳），所以 B 该被告知。
  const b = await context.newPage()
  await b.goto('/')
  await b.waitForTimeout(SETTLE * 3)

  const warn = banner(b)
  await expect(warn).toBeVisible()
  await expect(warn).toContainText('另一个标签页')

  // **A 的文档没被 B 覆盖。** 这一条才是这个机制存在的理由——横幅只是它的说明书。
  await a.bringToFront()
  await a.waitForTimeout(SETTLE)
  await expect(a.locator('.tree-row__name', { hasText: '阀盖-A改的' })).toBeVisible()

  await context.close()
})
