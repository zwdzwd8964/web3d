import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NullAiProvider, resolveAiProvider } from '../../src/ai/ai-provider.js'
import type { AiProvider, AiSuggestion } from '../../src/ai/ai-provider.js'

/**
 * T-299 · 插座存在，且默认关闭。
 *
 * 整份测试只证三件事，而第一件是最容易做假的：**「默认关闭」必须由行为证明，
 * 不能由一个布尔字段自证。**
 */

const AI_DIR = join(import.meta.dirname, '../../src/ai')

describe('AI 插座', () => {
  /**
   * 卡面要求两个断言写在**同一条测试**里，这不是排版偏好。
   *
   * 只写 `enabled === false` 的话，把 `suggest()` 从 throw 改成 `return []` 这次变异是
   * **绿的**——而那正是「插座看起来关着、实际上会安静地回答」的形状。布尔字段自证不了
   * 任何行为；能自证的只有那次调用。
   */
  it('默认关闭，而且调它会明确报错（不是返回空数组）', async () => {
    const provider = resolveAiProvider()
    expect(provider.enabled).toBe(false)
    await expect(provider.suggest({ kind: 'rule', prompt: 'x' })).rejects.toThrow('AI 能力未启用')
  })

  it('resolveAiProvider 认注入进来的实现', async () => {
    const fake: AiProvider = {
      kind: 'fake',
      enabled: true,
      suggest: async (): Promise<AiSuggestion[]> => [{ title: '一条', detail: '正文' }],
    }
    const provider = resolveAiProvider(fake)
    expect(provider.kind).toBe('fake')
    expect(provider.enabled).toBe(true)
    expect(await provider.suggest({ kind: 'rule', prompt: 'x' })).toHaveLength(1)
  })

  it('不传 override 时每次拿到的是同一个实例（无状态，不必每次新建）', () => {
    expect(resolveAiProvider()).toBe(resolveAiProvider())
    expect(resolveAiProvider()).toBeInstanceOf(NullAiProvider)
  })

  /**
   * **插座本身不许有网络能力。**
   *
   * 接不接得上是 v2 的事；而一个「预留接口」里出现 `fetch`，意味着它已经不是接口了。
   * 与 T-209 的 C7 网络原语守卫同一条纪律，这里在包内再钉一次。
   */
  it('本目录零网络原语', () => {
    const forbidden = /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|\bimport\s*\(/
    for (const name of readdirSync(AI_DIR)) {
      const text = readFileSync(join(AI_DIR, name), 'utf8')
      // 注释里出现这些词是允许的（文件头就在解释为什么不许有），所以先把注释剥掉。
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      expect(forbidden.test(code), `${name} 里出现了网络原语`).toBe(false)
    }
  })

  /** `resolveAiProvider` 里不许有任何环境探测——有一条，「默认关闭」就变成「看部署环境」。 */
  it('resolveAiProvider 不读环境变量、不读配置、不探测端点', () => {
    const source = readFileSync(join(AI_DIR, 'ai-provider.ts'), 'utf8')
    const body = source.slice(source.indexOf('export function resolveAiProvider'))
    for (const probe of ['process.env', 'import.meta.env', 'localStorage', 'globalThis.']) {
      expect(body.includes(probe), `resolveAiProvider 里出现了 ${probe}`).toBe(false)
    }
  })
})
