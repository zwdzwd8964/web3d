import { z } from 'zod'
import { FlowIdSchema, StepIdSchema, VariableIdSchema } from './id.js'
import { ActionSchema } from './rule.js'

/**
 * v1.0 · 线性流程。**形状在 v1.0 冻死，v1.2 才通电**（冲突登记 X-11 · X-14）。
 *
 * 从 `deferred.ts` 出列（该文件在本卡删除）。
 *
 * flows 是**变量之上薄薄一层**，不是 BPM 引擎：当前步骤存在一个变量里，这就是它保持
 * C1 合规的全部理由——流程状态和别的状态一样在文档里，撤销、发布、播放器一视同仁。
 */

export const FlowStepSchema = z
  .object({
    id: StepIdSchema,
    name: z.string(),
    next: StepIdSchema.nullable(),
    /**
     * v3 · **字段保留，永不获得运行时**（D35 / X-14，见 ADR-0035）。
     *
     * `execute()` 的入参是 `Rule` 不是 `Action[]`；造一个合成 Rule 要先裁决它的
     * `ExecResult.ruleId` 是什么，那是改 `executor.ts` 的 Q4。
     *
     * **步骤动作请用 `flowStepEnter` 规则表达。** 非空时 I49 报 warn——不删掉它是因为
     * 老文档里可能已经配了，静默丢弃比说出来更糟。
     */
    onEnter: z
      .array(ActionSchema)
      .default([])
      // `.describe()` 而不是只写 JSDoc：JSDoc 编译期就没了，而这句话要给**运行时**的读者看
      // ——编辑器将来在流程面板上解释「为什么这里配的动作不执行」时，读的就是它。
      .describe('v1 未实现 —— 步骤动作请用 flowStepEnter 规则'),
  })
  .strict()
export type FlowStep = z.infer<typeof FlowStepSchema>

export const FlowSchema = z
  .object({
    id: FlowIdSchema,
    name: z.string(),
    /**
     * 哪个变量存着当前步骤 —— 这就是 flows 保持 C1 合规的原因。
     *
     * v3 · **收紧为 `VariableIdSchema`**（X-11）。v2 是裸 `z.string()`，于是一个指向
     * 不存在变量的流程可以被保存、发布、并在 v1.2 第一次运行时才炸。迁移在非法时
     * **确定性 mint** 一个变量，不是丢弃。
     */
    variableId: VariableIdSchema,
    /** v3 · 新增。入口步骤。迁移一次性派生，**不是运行时下标引用**，不违 C9。 */
    startStepId: StepIdSchema.nullable().default(null),
    steps: z.array(FlowStepSchema).default([]),
  })
  .strict()
export type Flow = z.infer<typeof FlowSchema>
