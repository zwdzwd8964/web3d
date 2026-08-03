import { DB_NAME } from '@w3/storage'
import type { Page } from '@playwright/test'

/**
 * T-202 · clears whatever the editor actually persists to, before a spec runs.
 *
 * Six specs used to hard-code the database name in an `indexedDB.deleteDatabase` call. That
 * is correct today
 * and becomes silently wrong the moment the provider changes: v1.5 swaps in
 * `HttpApiProvider`, the delete call keeps succeeding against a database nobody reads any
 * more, every spec stays green, and each one starts inheriting the previous one's data.
 * v0.5's teaching (d) is precisely this shape, and it is listed in 黄金路径 V 步 2 as the
 * most likely false-green of the whole v1.5 milestone.
 *
 * Importing the name from `@w3/storage` does not fix that on its own — it makes the seam
 * exist, so that when the provider changes there is one function to change rather than six
 * string literals to find.
 *
 * @param page      the Playwright page, before its first navigation
 * @param sessionKey a per-spec flag name. `addInitScript` runs on EVERY navigation, and
 *                   unguarded it wiped the database a test had just written to on reload.
 */
export async function resetStorage(page: Page, sessionKey: string): Promise<void> {
  await page.addInitScript(
    ({ dbName, key }: { dbName: string; key: string }) => {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
      void indexedDB.deleteDatabase(dbName)
    },
    { dbName: DB_NAME, key: sessionKey },
  )
}
