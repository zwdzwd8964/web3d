import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EMBED_PROTOCOL } from '@w3/core'
import { describe, expect, it } from 'vitest'

/**
 * T-274 · 宿主 SDK 与协议的一致性。
 *
 * ## 这份测试为什么要**读源码文本**
 *
 * SDK 会被拷进客户的页面里，与播放器**分别升级**——客户今年拿到的 SDK 明年可能还在跑，
 * 而那台播放器已经升过三次。所以 SDK 自己写一份 `SUPPORTED_PROTOCOLS = [1]` 字面量，
 * 不 import `EMBED_PROTOCOL`：import 就等于假设两边永远同版本，而那正是「嵌入」这件事
 * 最不成立的假设。
 *
 * 于是一致性只能靠**外部比对**：读 SDK 的源文件、正则抠出那个字面量、与 `EMBED_PROTOCOL`
 * 比。**两边 import 同一个常量的测试永远绿**，而那正是卡面变异 ② 要证明的东西——
 * 观察记在提交信息里。
 */

const SDK = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'embed-sdk', 'index.ts')
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

describe('T-274 · 协议一致性（读源码文本，不 import）', () => {
  const source = readFileSync(SDK, 'utf8')

  it('SDK 自己写的那份字面量包含播放器的协议版本', () => {
    const match = /const\s+SUPPORTED_PROTOCOLS\s*=\s*\[([^\]]*)\]/.exec(source)
    expect(match, 'SDK 里应当有一行手写的 SUPPORTED_PROTOCOLS 字面量').not.toBeNull()

    const versions = match![1]!
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isFinite(n))

    expect(versions.length, '至少写一个版本号').toBeGreaterThan(0)
    expect(versions, `播放器现在是 ${EMBED_PROTOCOL}，而 SDK 只认 ${versions.join(' / ')}`).toContain(EMBED_PROTOCOL)
  })

  it('**SDK 不 import 仓库里的任何东西** —— 它是依赖图的叶子', () => {
    // 一个 import 就意味着「两边同时升级」这个假设回来了。
    const imports = source.split(/\r?\n/).filter((line) => /^\s*import\s/.test(line))
    expect(imports, `SDK 里出现了 import：${imports.join(' | ')}`).toEqual([])
  })

  it('SDK 的**代码里**没有 `EMBED_PROTOCOL` 这个名字', () => {
    // 这一条防的是「先 import 再赋给字面量」那种看起来手写、实际耦合的写法。
    //
    // ⚠ 只看代码，不看注释。第一版对着整份源码断，而文件头的注释里正写着「**不 import**
    // `EMBED_PROTOCOL`」——**断言又一次匹配到了自己的理由说明**（T-273 刚踩过同一个坑）。
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split(/\r?\n/)
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n')
    expect(code).not.toContain('EMBED_PROTOCOL')
  })
})

describe('T-276 · 默认 sandbox 必须带 `allow-same-origin`', () => {
  it('默认值两个都在', () => {
    // 少了它，iframe 落进不透明源：模块脚本按 CORS 取而对自己的服务器也算跨源，
    // `resolveSource` 又拿 `location.origin`（此时是 `"null"`）比对，于是每个 `?src=`
    // 都被判成跨源。症状是宿主等满超时，播放器那边一行日志都没有。
    //
    // 真正的守卫是 `e2e/tests/embed.spec.ts` 的用例 1——它是这条被查出来的地方。
    // 这里再钉一次，是因为 e2e 不在 `pnpm verify` 里，而这个默认值改回去只要删两个词。
    const match = /setAttribute\('sandbox',\s*options\.sandbox \?\? '([^']*)'\)/.exec(readFileSync(SDK, 'utf8'))
    expect(match, '应当有一行给 iframe 设 sandbox 默认值').not.toBeNull()
    expect(match![1]!.split(/\s+/).sort()).toEqual(['allow-same-origin', 'allow-scripts'])
  })
})

describe('T-274 · 产物', () => {
  /** 构建过才有。没构建时跳过而不是红——`pnpm test` 不该强制先跑一次构建。 */
  const built = existsSync(join(DIST, 'embed.js'))

  it.skipIf(!built)('`dist/embed.js` 存在且非空', () => {
    const stat = statSync(join(DIST, 'embed.js'))
    expect(stat.size).toBeGreaterThan(0)
  })

  it.skipIf(!built)('**未压缩 < 12 KB** —— 它只做「建 iframe + 收发消息」', () => {
    // 超过这个数就说明有东西不该在里面。SDK 会被拷进客户的页面。
    const stat = statSync(join(DIST, 'embed.js'))
    expect(stat.size, `${(stat.size / 1024).toFixed(1)} KB`).toBeLessThan(12 * 1024)
  })

  it.skipIf(!built)('ESM 那一份也在', () => {
    expect(existsSync(join(DIST, 'embed.mjs'))).toBe(true)
  })

  it.skipIf(!existsSync(join(DIST, 'index.html')))('`dist/index.html` 的 script src 带 --base 前缀', () => {
    // `build:app --base=/player/` 之后，主应用的入口脚本必须指向 /player/assets/…，
    // 否则部署到子路径下会 404。
    const html = readFileSync(join(DIST, 'index.html'), 'utf8')
    const src = /<script[^>]*\ssrc="([^"]+)"/.exec(html)
    expect(src, 'index.html 里应当有一个入口脚本').not.toBeNull()
    expect(src![1]!.startsWith('/player/'), `实际是 ${src![1]}`).toBe(true)
  })
})

describe('T-274 · SDK 不做成 workspace 包', () => {
  it('它的 package.json 不在 pnpm 工作区里', () => {
    // `check-deps-direction.mjs` 的白名单是硬编码的，而 SDK 是依赖图的叶子——
    // 做成 workspace 包只会让它出现在一张它不该出现的图上。
    const workspace = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'pnpm-workspace.yaml'),
      'utf8',
    )
    expect(workspace).not.toContain('embed-sdk')
  })
})
