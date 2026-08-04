import { z } from 'zod'
import { PrefabIdSchema } from './id.js'

/**
 * v1.0 · 只冻形状，**v2 才有运行时**。
 *
 * Split out of `prefab.ts` for a concrete reason: `PrefabSchema.nodes` is `NodeSchema[]`,
 * and `NodeSchema.prefabRef` is this. Keeping both in one file makes `node.ts` and
 * `prefab.ts` import each other, and one of the two `const` schemas would then be evaluated
 * inside the other's initialiser — a temporal dead zone crash at import time, not a type
 * error. Two files, one direction: `node.ts → prefab-ref.ts` and `prefab.ts → node.ts`.
 */
export const PrefabRefSchema = z
  .object({
    prefabId: PrefabIdSchema,
    /** 实例化时被本地改过的字段路径。v1 只写不读，v2 用它做差量更新。 */
    overridden: z.array(z.string().min(1)).max(200).default([]),
  })
  .strict()
export type PrefabRef = z.infer<typeof PrefabRefSchema>
