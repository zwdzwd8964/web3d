import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGoldenPathDocument } from '@w3/schema'
import { MemoryProvider, unpackScene } from '@w3/storage'
import { describe, expect, it, vi } from 'vitest'
import { publish } from '../src/publish/publish.js'

/**
 * T-269 · 把缩略图字节真的送进 `.w3p`。
 *
 * ## 这条路铺好了没人走
 *
 * `publish()` 从 T-100 起就收 `thumbnail`，`packScene` 从来就会把它写进包，`manifest`
 * 一直记录它——**而全仓没有一个调用方传过它**。发布包里因此从来没有过缩略图，而三个
 * 文件都长得像这件事已经做完了。
 *
 * ## 两条断言，缺一不可
 *
 * 「包里有 thumbnail 条目」不够：一个 0 字节的条目也满足它。所以还要断**魔数**——
 * 拿到一个「有图但打不开」的包，比没有图更糟。
 */

const JPEG_MAGIC = [0xff, 0xd8, 0xff]

/** 一份最小的合法 JPEG 头。够断魔数，不必是一张真图片。 */
const fakeJpeg = (): Uint8Array => new Uint8Array([...JPEG_MAGIC, 0xe0, 0x00, 0x10, 0x4a, 0x46])

/** 黄金路径文档 + 它引用的那份资产的字节。没有字节  会拒绝发布。 */
async function setup() {
  const doc = createGoldenPathDocument()
  const storage = new MemoryProvider()
  // `putBlob` 自己算 hash（D4：同样的字节就是同一份资产），所以反过来——存字节、
  // 拿回 hash、把文档里的资产指过去。发布的前置检查断的是「每个资产的字节都在存储里」。
  const hash = await storage.putBlob(new Uint8Array([1, 2, 3, 4]))
  const withBlobs = { ...doc, assets: doc.assets.map((a) => ({ ...a, hash })) }
  return { doc: withBlobs, storage, coreVersion: '1.0.0-test' }
}

/** 包里那条缩略图的字节。找不到返回 null。 */
function thumbnailOf(bytes: Uint8Array): Uint8Array | null {
  const pkg = unpackScene(bytes)
  return pkg.thumbnail ?? null
}

describe('T-269 · 缩略图进包', () => {
  it('注入的出图函数产出的字节，出现在 `.w3p` 里且是合法 JPEG', async () => {
    const { doc, storage, coreVersion } = await setup()
    const produced = await publish({ doc, storage, coreVersion, captureThumbnail: async () => fakeJpeg() })

    const thumbnail = thumbnailOf(produced.bytes)
    expect(thumbnail, '包里应当有缩略图').not.toBeNull()
    // 魔数：一个 0 字节的条目同样能让「有 thumbnail」为真，而那比没有更糟——
    // 解析它的一方会拿到一个「有图但打不开」的包。
    expect([...thumbnail!.slice(0, 3)]).toEqual(JPEG_MAGIC)
  })

  it('不注入时照常发布，包里没有缩略图', async () => {
    const { doc, storage, coreVersion } = await setup()
    const produced = await publish({ doc, storage, coreVersion })
    expect(thumbnailOf(produced.bytes)).toBeNull()
  })

  it('**出图失败不阻断发布** —— 返回 null 时包照发', async () => {
    const { doc, storage, coreVersion } = await setup()
    const produced = await publish({ doc, storage, coreVersion, captureThumbnail: async () => null })

    expect(produced.bytes.byteLength, '包必须发得出来').toBeGreaterThan(0)
    expect(thumbnailOf(produced.bytes)).toBeNull()
  })

  it('出图**抛异常**时也不阻断发布', async () => {
    // 一个能用的包 + 没有预览图，好过因为一张预览图发不出去。
    const { doc, storage, coreVersion } = await setup()
    const produced = await publish({
      doc,
      storage,
      coreVersion,
      captureThumbnail: async () => {
        throw new Error('显卡资源不足')
      },
    })
    expect(produced.bytes.byteLength).toBeGreaterThan(0)
    expect(thumbnailOf(produced.bytes)).toBeNull()
  })

  it('**零字节也算失败** —— 空 Uint8Array 是 truthy，不能让它进包', async () => {
    // `packScene` 与 `publish` 两处都是 truthy 判断，`new Uint8Array(0)` 会一路通过。
    const { doc, storage, coreVersion } = await setup()
    const produced = await publish({ doc, storage, coreVersion, captureThumbnail: async () => new Uint8Array(0) })
    expect(thumbnailOf(produced.bytes)).toBeNull()
  })

  it('显式传的 `thumbnail` 胜过出图 —— 出图函数一次都不该被调', async () => {
    const { doc, storage, coreVersion } = await setup()
    const capture = vi.fn(async () => fakeJpeg())
    const produced = await publish({ doc, storage, coreVersion, thumbnail: fakeJpeg(), captureThumbnail: capture })

    expect(capture, '已经有字节了就不该再出一次图').not.toHaveBeenCalled()
    expect(thumbnailOf(produced.bytes)).not.toBeNull()
  })
})

describe('T-269 · 视点缩略图的字段形状', () => {
  /**
   * ⚠ **卡面的验收第三条按字面执行必然失败。**
   *
   * 它写的是 `grep -rn "thumbnailUrl" packages/` 零命中，而 `AssetSchema.thumbnailUrl`
   * 是一条**活着的、v3 冻结清单没有删除**的字段：`TexturePicker` 正在渲染它、
   * `import-flow` 正在写它、`migrate.ts` 里那句 `const { thumbnailUrl: _dropped, ... }`
   * 是 C4 要求的迁移代码——删掉就是老文档打不开。
   *
   * 规划 §1378 的原始验收是收窄过的：**只断「无一条写向 viewpoint」**。下面按那个版本断。
   */
  const sourceFiles = (dir: string): string[] => {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...sourceFiles(path))
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path)
    }
    return out
  }

  it('生产代码里没有一处把 `thumbnailUrl` 写向 viewpoint', () => {
    // 从本文件（packages/editor/test/）往上两级到仓库根。
    const repoRoot = join(import.meta.dirname, '..', '..', '..')
    const roots = [join(repoRoot, 'packages', 'editor', 'src'), join(repoRoot, 'packages', 'core', 'src')]
    const offenders: string[] = []
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const text = readFileSync(file, 'utf8')
        // 「写向 viewpoint」= 同一行里既提 viewpoint 又提 thumbnailUrl。
        for (const [i, line] of text.split(/\r?\n/).entries()) {
          if (/thumbnailUrl/.test(line) && /viewpoint/i.test(line)) offenders.push(`${file}:${i + 1}`)
        }
      }
    }
    expect(offenders, 'v3 已经把它改名成 thumbnailAssetId（X-07）').toEqual([])
  })

  it('资产上的 `thumbnailUrl` 仍然活着 —— 它与视点那条是两回事', () => {
    // 这条断言存在的理由是防止有人照着卡面的字面把资产缩略图一起删掉。
    const asset = createGoldenPathDocument().assets[0]
    expect(asset, '黄金路径应当有资产').toBeDefined()
    expect('thumbnailUrl' in (asset as object), 'AssetSchema.thumbnailUrl 是活字段').toBe(true)
  })
})
