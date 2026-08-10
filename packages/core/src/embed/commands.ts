import type { SceneDocument } from '@w3/schema'
import type { EmbedErrorCode } from './protocol.js'

/**
 * T-271 · 命令注册表。
 *
 * ## 「注入缺失时命令不进注册表」是本文件的全部设计
 *
 * `screenshot` / `goToStep` / `goToScene` 各自需要一样宿主未必给得起的东西。三条路：
 *
 * 1. 无条件注册，缺依赖时返回 `unsupported-capability` —— **最坏**。宿主的 `can('screenshot')`
 *    返回 true，调下去永远失败，而它没有别的办法提前知道。一条「存在但永远失败」的命令
 *    比一条不存在的命令更难排查。
 * 2. 无条件注册，缺依赖时静默成功 —— 更坏，宿主以为截图存下来了。
 * 3. **缺依赖就不注册**（本文件）。`ready.commands` 自动少一项，宿主 `can()` 立刻看得见。
 *
 * **这一条同时解决 X-53**：`goToScene` 在 v1.0 没有实现，于是它的依赖注入不进来、命令
 * 不出现在 `ready.commands` 里——而协议里那个名字保留着。v1.5 接上多场景时只要开始注入，
 * 命令自己就出现了，**协议版本号一个数都不用动**。
 */

/** 一条命令能拿到的东西。缺哪一样，依赖它的命令就不注册。 */
export interface CommandDeps {
  readonly document: () => SceneDocument
  readonly play: () => void
  readonly pause: () => void
  readonly getVariable: (id: string) => unknown
  readonly setVariable: (id: string, value: unknown) => void
  readonly hasVariable: (id: string) => boolean
  /** 订阅位图。`null` = 全订。 */
  readonly subscribe: (events: readonly string[] | null) => void
  /** 可选：出图。没有它 `screenshot` 不进注册表。 */
  readonly screenshot?: () => Promise<{ ok: boolean; dataUrl?: string; reason?: string }>
  /** 可选：跳步。没有它 `goToStep` 不进注册表。 */
  readonly goToStep?: (step: number) => Promise<void> | void
  /** 可选：多场景。**v1.0 恒缺**——见文件头的 X-53。 */
  readonly goToScene?: (sceneId: string) => Promise<void> | void
}

/** 一条命令的执行结果。 */
export interface CommandResult {
  readonly ok: boolean
  readonly data?: unknown
  readonly code?: EmbedErrorCode
  readonly message?: string
}

export interface CommandSpec {
  /** 依赖齐了吗。false = 不进注册表。 */
  readonly available: (deps: CommandDeps) => boolean
  readonly run: (deps: CommandDeps, params: Record<string, unknown>) => Promise<CommandResult> | CommandResult
}

const ok = (data?: unknown): CommandResult => (data === undefined ? { ok: true } : { ok: true, data })
const fail = (code: EmbedErrorCode, message: string): CommandResult => ({ ok: false, code, message })

/** 全部命令。**键就是命令名**——`ready.commands` 直接取 `Object.keys`，不手写一份数组。 */
export const COMMANDS: Record<string, CommandSpec> = {
  ready: {
    available: () => true,
    run: () => ok(),
  },
  play: {
    available: () => true,
    run: (deps) => {
      deps.play()
      return ok()
    },
  },
  pause: {
    available: () => true,
    run: (deps) => {
      deps.pause()
      return ok()
    },
  },
  getVariable: {
    available: () => true,
    run: (deps, params) => {
      const id = params['id']
      if (typeof id !== 'string') return fail('bad-params', 'getVariable 需要一个字符串 id。')
      // **先问存不存在，再取值。** 直接透传 `getVar` 的话，一个打错字的变量名会返回
      // 默认值（数字 0 / 空串），宿主据此显示「当前步骤：0」，而真相是那个变量不存在。
      if (!deps.hasVariable(id)) return fail('unknown-variable', `没有名为「${id}」的变量。`)
      return ok(deps.getVariable(id))
    },
  },
  setVariable: {
    available: () => true,
    run: (deps, params) => {
      const id = params['id']
      if (typeof id !== 'string') return fail('bad-params', 'setVariable 需要一个字符串 id。')
      if (!deps.hasVariable(id)) return fail('unknown-variable', `没有名为「${id}」的变量。`)
      deps.setVariable(id, params['value'])
      return ok()
    },
  },
  subscribe: {
    available: () => true,
    run: (deps, params) => {
      const events = params['events']
      if (events === undefined || events === null) {
        deps.subscribe(null)
        return ok()
      }
      if (!Array.isArray(events) || events.some((e) => typeof e !== 'string')) {
        return fail('bad-params', 'subscribe 的 events 必须是字符串数组，或者省略表示全订。')
      }
      deps.subscribe(events as string[])
      return ok()
    },
  },
  screenshot: {
    available: (deps) => deps.screenshot !== undefined,
    run: async (deps) => {
      const result = await deps.screenshot!()
      return result.ok ? ok({ dataUrl: result.dataUrl }) : fail('internal-error', result.reason ?? '导出失败。')
    },
  },
  goToStep: {
    available: (deps) => deps.goToStep !== undefined,
    run: async (deps, params) => {
      const step = params['step']
      if (typeof step !== 'number' || !Number.isFinite(step)) return fail('bad-params', 'goToStep 需要一个数字 step。')
      await deps.goToStep!(step)
      return ok()
    },
  },
  goToScene: {
    // v1.0 恒 false：没有多场景实现，所以这个名字不会出现在 `ready.commands` 里。
    available: (deps) => deps.goToScene !== undefined,
    run: async (deps, params) => {
      const sceneId = params['sceneId']
      if (typeof sceneId !== 'string') return fail('bad-params', 'goToScene 需要一个字符串 sceneId。')
      await deps.goToScene!(sceneId)
      return ok()
    },
  },
}

/** 这一组依赖下，宿主真的能用的命令名。**排序**，好让宿主拿到的清单是稳定的。 */
export function availableCommands(deps: CommandDeps): string[] {
  return Object.keys(COMMANDS)
    .filter((name) => COMMANDS[name]!.available(deps))
    .sort()
}
