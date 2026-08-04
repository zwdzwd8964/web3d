import { z } from 'zod'
import { DataSourceIdSchema, VariableIdSchema } from './id.js'

/**
 * v1.0 · 外部数据源。**形状在 v1.0 冻死，v1.5 才通电**（冲突登记 X-24）。
 *
 * 整块的默认值是「什么都不做」：`enabled` 默认 `false`，`dataSources` 默认 `[]`。
 * **升级到 v3 不会让任何一份现存文档开始发网络请求**——这是 C6 在这条线上的保证，
 * 也是迁移观感回归里那条 `dataSources.length === 0` 断言守的东西。
 */

/**
 * `a.b[0].c` 语法，外加对三个段名的 refine。
 *
 * **原型污染是真实危害，而 RFC 6901 JSON Pointer 表达不了这条防线**——它的转义规则里
 * `__proto__` 是一个完全合法的段名。所以这里不用 JSON Pointer。
 */
const DANGEROUS_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export const DataPathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/, '期望形如 a.b[0].c 的取值路径')
  .refine(
    (path) => !path.split(/[.[\]]+/).some((seg) => DANGEROUS_SEGMENTS.has(seg)),
    '路径里不允许出现 __proto__ / constructor / prototype',
  )
export type DataPath = z.infer<typeof DataPathSchema>

/**
 * 认证。**不存明文凭据**——`secretRef` 指向部署侧的密钥，值不进文档。
 *
 * ⚠ **`kind` 的枚举成员是签字之后补的**（SCHEMA_V3_FREEZE §1.8，2026-08-04，产品负责人授权）。
 * 决定性理由是完整性规则 **I69**：它写着「`auth.kind !== 'none'` 时 `secretRef` 非空且跨源
 * 不重名」——**只留 `none` 会让那条已签字的规则变成死条**（条件恒假）。
 *
 * 不做判别联合：切到 `bearer` 再切回 `none`，`secretRef` 与 `headerName` 还在。
 * 与 `meta.fog` 的「字段全留」同一条理由。
 *
 * `.strict()` 是这一块最要紧的一行——它兜住「顺手塞一个 token 进来」。
 */
export const DATA_SOURCE_AUTH_KINDS = ['none', 'bearer', 'basic', 'header'] as const
export const DataSourceAuthKindSchema = z.enum(DATA_SOURCE_AUTH_KINDS)
export type DataSourceAuthKind = z.infer<typeof DataSourceAuthKindSchema>

export const DataSourceAuthSchema = z
  .object({
    kind: DataSourceAuthKindSchema.default('none'),
    /** 部署侧密钥的名字，不是密钥本身。 */
    secretRef: z.string().max(200).default(''),
    /** 仅 `kind === 'header'` 有意义；schema 不做判别联合，由 UI 层约束。 */
    headerName: z.string().max(64).default(''),
  })
  .strict()
export type DataSourceAuth = z.infer<typeof DataSourceAuthSchema>

export const DEFAULT_DATA_SOURCE_AUTH: DataSourceAuth = { kind: 'none', secretRef: '', headerName: '' }

export const DataMappingSchema = z
  .object({
    path: DataPathSchema,
    variableId: VariableIdSchema,
    cast: z.enum(['none', 'number', 'string', 'boolean']).default('none'),
  })
  .strict()
export type DataMapping = z.infer<typeof DataMappingSchema>

export const DataSourceSchema = z
  .object({
    id: DataSourceIdSchema,
    name: z.string().min(1).max(60),
    /** 默认 **false**：升级到 v3 不会让任何一份现存文档开始发网络请求（C6 的保证）。 */
    enabled: z.boolean().default(false),
    /** `sample` 是「断网也能完整使用」这个卖点的直接兑现，不是测试用具。 */
    mode: z.enum(['live', 'sample']).default('live'),
    /**
     * 不用 `z.string().url()`。
     *
     * C4：一份能打开的文档永远要能打开。一个写了一半的 url 不该让整份文档校验失败——
     * 它该由完整性检查报 warn，而不是由 schema 拒收。
     */
    url: z.string().max(2048).default(''),
    method: z.enum(['get', 'post']).default('get'),
    body: z.string().max(4096).nullable().default(null),
    auth: DataSourceAuthSchema.default(DEFAULT_DATA_SOURCE_AUTH),
    /**
     * **默认 30 000 而不是 5 000。**
     *
     * 下限写进 schema 的论证是「防止 20 台瘦客户端每秒 20 次打 MES」；那么默认值也该保守。
     */
    intervalMs: z.number().int().min(1000).max(3_600_000).default(30_000),
    timeoutMs: z.number().int().min(1000).max(60_000).default(10_000),
    startOn: z.enum(['sceneReady', 'manual']).default('sceneReady'),
    onError: z.enum(['keep', 'default']).default('keep'),
    map: z.array(DataMappingSchema).max(64).default([]),
    sample: z.array(z.string().max(8192)).max(20).default([]),
  })
  .strict()
export type DataSource = z.infer<typeof DataSourceSchema>
