import { describe, expect, it, vi } from 'vitest'
import { AssetLoader, createMemoryResolver } from '../../src/runtime/loader.js'
import { buildPumpGlb } from '../assets/glb.js'

/**
 * T-255 · `AssetLoader.retainOnly`。
 *
 * 这条测试存在的理由，是同一个 runtime 里**两条资产链行为相反**：换文档时贴图会被淘汰
 * （`TextureCache` 在 `ensure` 末尾调自己的 `retainOnly`），而模型只增不减——
 * `AssetLoader` 从来只往缓存里放，`evict()` 则零调用点。一个编辑一下午、开过十份文档的
 * 会话，十份文档的几何体全在显存里。
 *
 * **两个方向都断。** 卡面点名了这一点：只测「b 被淘汰」的话，一个「全清」的实现同样绿，
 * 而那会把用户正在编辑的那份文档的几何体也一起扔掉。
 */

const A = 'ast_aaaaaaa1'
const B = 'ast_bbbbbbb2'

/** 两份**真的进了缓存**的模型。`parse` 只解析不入缓存，走 `load` 才算数。 */
async function loaderWithTwo() {
  const bytes = await buildPumpGlb({ animationName: 'Disassemble', animationSeconds: 1 })
  const files = new Map<string, ArrayBuffer>([
    ['a.glb', bytes],
    ['b.glb', bytes.slice(0)],
  ])
  const loader = new AssetLoader({ resolver: createMemoryResolver(files) })
  const a = await loader.load({ id: A, url: 'a.glb', type: 'model', name: 'a' } as never)
  const b = await loader.load({ id: B, url: 'b.glb', type: 'model', name: 'b' } as never)
  return { loader, a, b }
}

/**
 * 给这份资产里**每一个不同的**几何体装一个 dispose 探针。
 *
 * 按对象去重，不按网格：glTF 里多个网格共用一份几何体是常态（本 fixture 就是），
 * 逐网格装的话后一个会把前一个的探针覆盖掉，而那个被覆盖的探针永远不会被调用——
 * 一条与被测行为无关的红。
 */
function spyOnGeometries(loaded: { scene: { traverse(fn: (o: unknown) => void): void } }) {
  const seen = new Map<object, ReturnType<typeof vi.fn>>()
  loaded.scene.traverse((object) => {
    const mesh = object as { isMesh?: boolean; geometry?: { dispose: () => void } }
    if (!mesh.isMesh || !mesh.geometry || seen.has(mesh.geometry)) return
    const spy = vi.fn()
    mesh.geometry.dispose = spy
    seen.set(mesh.geometry, spy)
  })
  return [...seen.values()]
}

describe('T-255 · retainOnly', () => {
  it('**留下的还在，没留下的没了，返回值就是被淘汰的那些**', async () => {
    const { loader } = await loaderWithTwo()
    expect(loader.has(A) && loader.has(B), '前提：两份都在').toBe(true)

    const evicted = loader.retainOnly(new Set([A]))

    expect(loader.has(A), '把要留的那份也扔了 —— 「全清」实现在这条下红').toBe(true)
    expect(loader.has(B), '该淘汰的还在 —— 空实现在这条下红').toBe(false)
    expect(evicted).toEqual([B])
  })

  it('被淘汰那份的几何体真的 dispose 了', async () => {
    const { loader, b } = await loaderWithTwo()
    const spies = spyOnGeometries(b)
    expect(spies.length, '这份 fixture 里一个网格都没有，下面的断言无从谈起').toBeGreaterThan(0)

    loader.retainOnly(new Set([A]))

    for (const spy of spies) expect(spy).toHaveBeenCalled()
  })

  it('留下的那份的几何体**没有**被 dispose', async () => {
    // 反向。只断「b 被释放了」的话，「全释放」实现照样绿。
    const { loader, a } = await loaderWithTwo()
    const spies = spyOnGeometries(a)

    loader.retainOnly(new Set([A]))

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('空集合 = 全清；返回值含全部 id', async () => {
    const { loader } = await loaderWithTwo()
    const evicted = loader.retainOnly(new Set())
    expect(loader.size).toBe(0)
    expect([...evicted].sort()).toEqual([A, B])
  })

  it('全留 = 什么都不动，返回空数组', async () => {
    const { loader } = await loaderWithTwo()
    expect(loader.retainOnly(new Set([A, B]))).toEqual([])
    expect(loader.size).toBe(2)
  })

  it('幂等：连调两次，第二次返回空数组', async () => {
    const { loader } = await loaderWithTwo()
    expect(loader.retainOnly(new Set([A]))).toEqual([B])
    expect(loader.retainOnly(new Set([A]))).toEqual([])
  })

  it('**在飞的请求也要拦下** —— 否则它几百毫秒后自己回到缓存里', async () => {
    // 那时已经没有任何文档引用它了，而缓存里多了一份没人要的几何体。
    const bytes = await buildPumpGlb({ animationName: 'Disassemble', animationSeconds: 1 })
    // 初值是个空函数而不是 null：赋值发生在 executor 回调里，TS 的控制流分析看不进去，
    // 到调用点时把它窄化成 null，`release?.()` 于是变成「对 never 取调用」。
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const loader = new AssetLoader({
      resolver: {
        resolve: async (url: string) => {
          if (url.includes('slow')) await gate
          return bytes.slice(0)
        },
      },
    })

    const pending = loader
      .load({ id: B, url: 'slow.glb' } as never)
      .catch(() => undefined)

    loader.retainOnly(new Set([A]))
    release()
    await pending

    expect(loader.has(B), '在飞的那份自己回来了').toBe(false)
  })
})
