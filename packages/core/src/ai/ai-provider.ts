/**
 * T-299 · AI 能力的插座。**v1 只留插座，不接任何模型。**
 *
 * ## 这个文件的存在理由，只有一句
 *
 * v2 接模型的时候，不必改 `@w3/core` 的公共 API 形状。除此之外它不做任何事。
 *
 * ## 形状照 `StorageProvider` 抄
 *
 * 一个字都不提模型名、厂商名、端点、鉴权。那些是**实现**该知道的事，接口知道了它们，
 * 换实现就变成改接口——而「换一个 provider，业务代码零改动」正是 `StorageProvider`
 * 那条缝存在的全部理由（C7），这里逐字沿用。
 *
 * ## 三条纪律
 *
 * 1. **`suggest()` 未启用时抛，不返回空数组。** 空数组会被调用方读成「问过了，没结果」，
 *    而实际是「压根没问」。那是最难查的一类静默失败：功能整个没接，界面上看起来像
 *    「这次没建议」。
 * 2. **`resolveAiProvider` 没有任何读环境变量 / 读配置文件 / 探测端点的分支。** 有一条，
 *    「默认关闭」就变成「默认取决于部署环境」，而内网部署的那台机器上没人会去验证它。
 * 3. **本目录零网络原语**（`fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` /
 *    动态 `import(`）。插座本身不许有网络能力，接不接得上是 v2 的事。这一条与 T-209 的
 *    C7 网络原语守卫同批被扫。
 *
 * ⚠ 它在豁免表里有一行（owner T-299、到期 v2）。**一个没有 owner、没有到期日的
 * 「预留接口」就是下一条死导出**——那一行是本卡与「又一条预留了但没人接」之间的
 * 全部差别。
 */

/** 问 AI 什么。`kind` 是问题的类别，`prompt` 是问题本身。 */
export interface AiSuggestInput {
  /** 问题类别。v2 接模型时按它分派到不同的提示词模板。 */
  readonly kind: string
  /** 问题本身。**已经是拼好的中文**——拼提示词是调用方的事，不是插座的事。 */
  readonly prompt: string
}

/** 一条建议。 */
export interface AiSuggestion {
  /** 一句话标题，列表里显示这个。 */
  readonly title: string
  /** 展开之后的正文。 */
  readonly detail: string
}

/**
 * AI 能力的唯一插座。
 *
 * @see 文件头的三条纪律。实现这个接口之前先读它们。
 */
export interface AiProvider {
  /** 实现的名字，给日志与体检报告用。 */
  readonly kind: string
  /** 这个实现现在能不能用。**调用 `suggest` 之前先看它。** */
  readonly enabled: boolean
  /**
   * 要一组建议。
   *
   * 铁律 10：返回 Promise 且收 `AbortSignal`——面板关掉时要能把在飞的请求取消掉，
   * 否则一次慢响应会在用户已经离开之后往一个不存在的面板里塞结果。
   *
   * @throws 未启用时抛。**不返回空数组**，理由见文件头纪律 1。
   */
  suggest(input: AiSuggestInput, signal?: AbortSignal): Promise<AiSuggestion[]>
}

/**
 * v1 的唯一实现：**什么都不做，而且说清楚自己什么都不做**。
 *
 * 三行。它不是占位符，它是一个**正确的**实现——「这台部署没有 AI 能力」是一种真实状态，
 * 而这个类就是那种状态的忠实表达。
 */
export class NullAiProvider implements AiProvider {
  readonly kind = 'null'
  readonly enabled = false

  async suggest(): Promise<AiSuggestion[]> {
    throw new Error('AI 能力未启用')
  }
}

/** 进程里那一个。无状态，所以共用一个实例。 */
const NULL_AI_PROVIDER = new NullAiProvider()

/**
 * 拿到当前的 provider。
 *
 * **没有探测，没有环境变量，没有配置文件。** 不传 `override` 就是 `NullAiProvider`，
 * 在任何机器上、任何部署形态下都一样——理由见文件头纪律 2。
 *
 * @param override 宿主自己注入的实现。v2 的接线点就是这个参数。
 */
export function resolveAiProvider(override?: AiProvider): AiProvider {
  return override ?? NULL_AI_PROVIDER
}
