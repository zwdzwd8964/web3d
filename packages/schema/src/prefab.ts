import { z } from 'zod'
import { PrefabIdSchema } from './id.js'
import { MaterialSchema } from './material.js'
import { NodeSchema } from './node.js'

/**
 * v1.0 · 预制体。**形状在 v1.0 冻死，v2 才通电**（D22「冻结即债」）。
 *
 * ⚠ **这是本版最大的一块 placeholder**：v1.0 与 v1.2 **没有任何生产写入路径**。签字时
 * （SCHEMA_V3_FREEZE §4）明确接受了这块债，以及它到期未清会让 CI 转红。
 *
 * 为什么现在就冻：schema 在 v1 只 bump 一次。prefab 的形状影响五个遍历面
 * （`collectAllIds` / `buildIndex` / `checkIntegrity` / `remapAssetRefs` / `applyPatch`），
 * 而 v2 再加一个顶层集合就是第二次 bump。**采纳集合版，不采纳 `nodes[].prefab` 裸串**——
 * 裸串不进那五个遍历面，等于一个索引不到、检查不到、也发布不出去的引用。
 */
export const PrefabSchema = z
  .object({
    id: PrefabIdSchema,
    name: z.string().min(1).max(120),
    note: z.string().max(500).default(''),
    /** 递增整数。v2 的「把更新推给所有实例」只有这一个抓手。 */
    version: z.number().int().min(1).default(1),
    /** prefab 本体。id 与文档主集合同一命名空间，由 I42 保证不撞车。 */
    nodes: z.array(NodeSchema).default([]),
    materials: z.array(MaterialSchema).default([]),
  })
  .strict()
export type Prefab = z.infer<typeof PrefabSchema>

export { PrefabRefSchema } from './prefab-ref.js'
export type { PrefabRef } from './prefab-ref.js'
