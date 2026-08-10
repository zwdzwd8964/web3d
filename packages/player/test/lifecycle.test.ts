// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * T-273 · 播放器的生命周期与门。
 *
 * ## 为什么断的是「hidden 再 visible 之后**仍然是暂停的**」
 *
 * 三个输入量（宿主要不要播 / 标签页可不可见 / 在不在视口里）如果各自 start/stop，
 * 那么标签页切走再切回来会无条件 `start()`——把宿主刚 `pause()` 的播放器又跑起来，
 * **而宿主并没有再点过播放**。这个缺陷只在「先暂停、再切标签页、再切回来」这条三步
 * 路径上出现，任何单步测试都看不见它。
 *
 * 与门让「谁都可以摁住，只有全部松开才跑」成为结构而不是纪律。
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 把与门那段逻辑照 `app.ts` 的形状复刻一遍，好在没有 WebGL 的环境里驱动它。 */
class Gate {
  hostWantsPlay = true
  documentVisible = true
  onScreen = true
  readonly calls: string[] = []

  apply(): void {
    const shouldRun = this.hostWantsPlay && this.documentVisible && this.onScreen
    this.calls.push(shouldRun ? 'start' : 'stop')
  }
  pause(): void {
    this.hostWantsPlay = false
    this.apply()
  }
  resume(): void {
    this.hostWantsPlay = true
    this.apply()
  }
  visibility(visible: boolean): void {
    this.documentVisible = visible
    this.apply()
  }
  intersect(onScreen: boolean): void {
    this.onScreen = onScreen
    this.apply()
  }
  get last(): string | undefined {
    return this.calls[this.calls.length - 1]
  }
}

describe('T-273 · 与门', () => {
  it('**hidden → visible 之后仍然是暂停的**', () => {
    const gate = new Gate()
    gate.pause()
    expect(gate.last).toBe('stop')

    gate.visibility(false)
    gate.visibility(true)

    // 三个输入量各自 start/stop 的写法在这里会给出 'start'——把宿主刚暂停的播放器
    // 又跑起来，而宿主并没有再点过播放。
    expect(gate.last, '标签页切回来不该覆盖宿主的暂停').toBe('stop')
  })

  it('滚出视口再滚回来，同样不覆盖宿主的暂停', () => {
    const gate = new Gate()
    gate.pause()
    gate.intersect(false)
    gate.intersect(true)
    expect(gate.last).toBe('stop')
  })

  it('三个都松开才跑', () => {
    const gate = new Gate()
    gate.pause()
    gate.visibility(false)
    gate.intersect(false)

    gate.resume()
    expect(gate.last, '还有两个摁着').toBe('stop')
    gate.visibility(true)
    expect(gate.last, '还有一个摁着').toBe('stop')
    gate.intersect(true)
    expect(gate.last, '全松开了').toBe('start')
  })

  it('任一个摁下就停', () => {
    for (const press of ['pause', 'visibility', 'intersect'] as const) {
      const gate = new Gate()
      gate.apply()
      expect(gate.last).toBe('start')
      if (press === 'pause') gate.pause()
      if (press === 'visibility') gate.visibility(false)
      if (press === 'intersect') gate.intersect(false)
      expect(gate.last, press).toBe('stop')
    }
  })
})

/**
 * 源码级断言。
 *
 * 上面那组驱动的是复刻件，证明的是**这套逻辑**对。下面这组对着真源码断，证明 `app.ts`
 * 里装的确实是这套逻辑——两组缺一个，另一个就可能对着一份早已分叉的复刻件全绿。
 */
describe('T-273 · app.ts 里装的确实是与门', () => {
  const app = readFileSync(join(SRC, 'app.ts'), 'utf8')

  it('三个输入量各自只被一处赋值', () => {
    const assignments = (name: string) =>
      app.split(/\r?\n/).filter((line) => new RegExp(String.raw`this\.${name}\s*=`).test(line)).length
    // 各一处：`pause`/`resume` 共用 `hostWantsPlay` 那一对，所以它是 2。
    expect(assignments('hostWantsPlay')).toBe(2)
    expect(assignments('documentVisible')).toBe(1)
    expect(assignments('onScreen')).toBe(1)
  })

  it('**`runtime.start()` / `stop()` 只出现在与门里**', () => {
    // 多一处调用点就意味着多一条绕过与门的路。
    const starts = app.split(/\r?\n/).filter((line) => /this\.runtime\?\.(start|stop)\(\)/.test(line))
    expect(starts).toHaveLength(2)
    const gateAt = app.indexOf('private applyRunState')
    for (const line of starts) expect(app.indexOf(line)).toBeGreaterThan(gateAt)
  })

  it('unsupported 分支**不再直接 return**，而是先说出去', () => {
    // 嵌入时宿主看到的是一个黑框，而页面里那句中文提示在 iframe 里，宿主的 JS 读不到。
    const lines = app.split(/\r?\n/)
    const at = lines.findIndex((l) => l.includes("capability.level === 'unsupported'"))
    expect(at).toBeGreaterThan(0)

    // **按行找，且跳过注释行。** 第一版对着整段文本 `indexOf('return')`，而那段注释里
    // 就写着「不能直接 return」——断言匹配到了自己的理由说明。
    const body = lines.slice(at, at + 12).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    const notify = body.findIndex((l) => l.includes('onUnsupported'))
    const returns = body.findIndex((l) => /^\s*return\b/.test(l))
    expect(notify, '必须有一次通知').toBeGreaterThanOrEqual(0)
    expect(returns).toBeGreaterThanOrEqual(0)
    expect(notify, '先说出去，再 return').toBeLessThan(returns)
  })

  it('**不暴露 session / runtime 的 public getter**', () => {
    // 一个 `player.session` 意味着页面上任何拿得到 Player 的代码都能绕过嵌入控制器
    // 直接改场景——而控制器存在的全部理由就是宿主只能通过一条受检的通道说话。
    expect(app).not.toMatch(/^\s*get\s+(session|runtime)\s*\(/m)
    expect(app).toContain('private session')
    expect(app).toContain('private runtime')
  })
})

describe('T-273 · 不带 ?embed=1 时不加载嵌入层', () => {
  const main = readFileSync(join(SRC, 'main.ts'), 'utf8')

  it('嵌入层只经动态 import 进来', () => {
    // 静态 import 会把 boot/transport/policy 打进主 bundle，而独立打开播放器是多数场景。
    expect(main, '不许有静态 import').not.toMatch(/^import .*embed\/boot/m)
    expect(main).toContain("import('./embed/boot.js')")
  })

  it('动态 import 挂在 `EMBEDDED` 判断之下', () => {
    expect(main).toContain("get('embed') === '1'")
    // 两个回调都只在 EMBEDDED 为真时才挂上去——没挂就永远不会走到 import。
    expect(main).toMatch(/EMBEDDED \? \{ onSession/)
    expect(main).toMatch(/EMBEDDED \? \{ onUnsupported/)
  })
})
