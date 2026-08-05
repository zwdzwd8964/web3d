#!/usr/bin/env node
/**
 * 一次性生成 `legacy-v2-single-scene.w3p` —— 一个 **v1.0 之前打出来的** `.w3p`。
 *
 * ⚠ **人工执行，产物提交进仓库，不在任何 build / CI 路径上。**
 *
 * ## 为什么必须手工拼，不能用 `packScene` 打
 *
 * 卡面写的是「用**当前构建**打一个单场景 .w3p 手工存成 fixture」，但这与文件名
 * （`legacy-v2-…`）和验收（「迁移到 v3 后 sceneId === deriveSceneId(projectId)」、
 * 「manifest.entrySceneId 为 undefined」）三者互斥：**当前构建打不出 v2 的包**，
 * 它写的是 `schemaVersion: 3` 和三个新 manifest 字段。
 *
 * 而这份 fixture 的全部价值恰恰在于它**没有**那三个字段——它是老包兜底那条路径的唯一
 * 真实输入。所以这里按 v1.0 之前的 manifest 形状手工拼：六个键，一个不多。
 *
 * Run: node packages/storage/test/fixtures/make-legacy-package.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TextEncoder } from 'node:util'
import { zipSync } from 'fflate'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../../..')
const OUT = join(HERE, 'legacy-v2-single-scene.w3p')

const scene = readFileSync(join(ROOT, 'packages/schema/test/fixtures/v2/golden-path-2.json'), 'utf8')
const doc = JSON.parse(scene)
if (doc.schemaVersion !== 2) throw new Error(`种子不是 v2（是 ${doc.schemaVersion}），这份 fixture 就没有意义`)

/** v1.0 之前的 manifest：**六个键，没有 projectName / entrySceneId / scenes**。 */
const manifest = {
  schemaVersion: 2,
  coreVersion: '0.0.0-legacy',
  snapshotId: 'snp_legacy01',
  projectId: doc.projectId,
  publishedAt: '2026-05-01T00:00:00.000Z',
  assetCount: 0,
}

const encoder = new TextEncoder()
const bytes = zipSync(
  {
    'manifest.json': encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`),
    // 不放资产字节：老包不带字节不影响解包，而这份 fixture 要证的是 manifest 那一侧
    'scene.json': encoder.encode(scene),
  },
  { level: 6 },
)

writeFileSync(OUT, bytes)
console.log(`写出 ${OUT}（${bytes.length} 字节）`)
console.log(`  manifest 键：${Object.keys(manifest).join(' / ')}`)
console.log(`  scene.json：schemaVersion ${doc.schemaVersion} · projectId ${doc.projectId} · ${doc.nodes.length} 个节点`)
