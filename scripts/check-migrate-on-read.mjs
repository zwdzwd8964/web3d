#!/usr/bin/env node
/**
 * V14 · **读外部字节的地方必须 `migrate`，不能 `validate`。**
 *
 * 差别就是宪法 C4 的全部内容：`schemaVersion` 是 `z.literal(CURRENT_VERSION)`，所以一份
 * 旧版本存下的文档 `validate` 必然失败。编辑器那条路曾经就是这么写的，失败时回落到样例
 * 场景——用户的工作还在盘上，但他**看到**的是样例，与数据丢失无从分辨。v1 是唯一版本
 * 时这条 bug 完全不可见。
 *
 * T-229 的卡面把这件事做成了两条回归 + 一张写在 IMPL_NOTES 里的判定表。回归看住了两条
 * 路径，而**判定表只是一张表**：第三条路径、以及将来新增的第四条，仍然只靠人记住。
 * 规划 §V14 原本要的是三样东西，这个脚本是第三样。
 *
 * ## 判据
 *
 * 「读取外部字节的模块」不做启发式猜测，用一张显式的清单（`READERS`）。清单里的每个
 * 文件都必须：
 *   1. 出现 `migrate(`；
 *   2. **不**出现顶层的 `validate(`（`migrate` 内部会调，那是 schema 自己的事）。
 *
 * 清单之外的文件不管——`publish.ts` 对内存中的当前文档调 `validate` 是对的，
 * 那份文档刚从编辑器状态里来，不是外部字节。
 *
 * Run: node scripts/check-migrate-on-read.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeReport, printReport, stripComments } from './lib/scan.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 每一条外部字节进入本程序的入口。
 *
 * **这张表只能长，不能悄悄变短。** 少一行就是少守一条路径，而症状要到用户升级那天才出现。
 * 下面有一条断言盯着它的长度。
 */
const READERS = [
  {
    file: 'packages/editor/src/main.tsx',
    what: '编辑器启动时读上次保存的文档（IndexedDB）',
    regression: 'packages/editor/test/restore-migrates.test.ts',
  },
  {
    file: 'packages/editor/src/publish/snapshots.ts',
    what: '回滚到一次历史快照',
    regression: '（暂无专门回归，由本脚本看守）',
  },
  {
    file: 'packages/storage/src/package.ts',
    what: '解包 .w3p —— 播放器读到的每一份文档的必经之路',
    regression: 'packages/storage/test/package-migrates.test.ts',
  },
]

/** 低于这个数说明有人删了行而不是加了行。今天 3 条。 */
const MIN_READERS = 3

const report = makeReport('migrate on read', 'V14')

if (READERS.length < MIN_READERS) {
  report.add('scripts/check-migrate-on-read.mjs', 1, `READERS 只剩 ${READERS.length} 条，下限 ${MIN_READERS} —— 这张表只能长不能短`)
}

for (const reader of READERS) {
  const full = join(ROOT, reader.file)
  if (!existsSync(full)) {
    report.add(reader.file, 1, `清单里的文件不存在了。它搬到哪了？（${reader.what}）`)
    continue
  }
  report.filesScanned++
  const source = stripComments(readFileSync(full, 'utf8'))

  if (!/\bmigrate\s*\(/.test(source)) {
    report.add(reader.file, 1, `读的是外部文档（${reader.what}），却没有调用 migrate()`)
  }

  // `validate(` 在这些文件里出现，几乎一定是把 migrate 换回去了
  const lines = source.split('\n')
  lines.forEach((line, i) => {
    if (!/(?<![.\w])validate\s*\(/.test(line)) return
    report.add(
      reader.file,
      i + 1,
      `读外部文档的模块里出现了 validate( —— 旧版本的文档会校验失败并被静默回落。` +
        `这条路是「${reader.what}」，回归在 ${reader.regression}`,
    )
  })
}

console.log(`  看守 ${READERS.length} 条外部读取路径：`)
for (const r of READERS) console.log(`    ${r.file} —— ${r.what}`)

process.exit(printReport(report, ROOT))
