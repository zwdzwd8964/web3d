# ADR-0007 · zod 经由 @w3/schema 转出，core 不直接依赖

- 状态: Accepted
- 日期: 2026-07-30
- 相关宪法条款: C2

## 背景

ECA_SPEC §4.1 要求每个 `ActionDefinition` 携带 `schema: ZodType<P>`，因此 `@w3/core` 需要 zod。
但 CLAUDE.md 的包边界表把 core 的允许依赖列为 `three` + `@w3/schema`。
`shamefully-hoist=false` 使 core 直接 `import 'zod'` 编译失败——这正是该配置该拦住的。

## 选项

1. 给 core 加 zod 直接依赖 —— 最直白；与 CLAUDE.md 的边界表不符，且若两包解析到不同 zod 实例，
   schema 组合与 instanceof 会静默失效。
2. `@w3/schema` 转出 `z` 与 `ZodType`，core 从 schema 导入 —— 边界表字面成立，
   且全仓保证唯一 zod 实例。
3. 自定义一个最小校验接口，不用 zod —— 彻底解耦；等于重写一个校验库，且与 §4.1 的字面不符。

## 决定

选 2。`packages/schema/src/index.ts` 增加 `export { z } from 'zod'` 与 `export type { ZodType }`。

## 代价

- `@w3/schema` 的公共 API 里出现了一个它本不该负责的东西（一个第三方库的再导出）；
- 使用者可能误以为 schema 提供了完整的 zod 封装，实际只转出了 `z` 与两个类型。

## 撤销条件

若将来 core 需要 zod 的更多 API 而转出清单不断变长，说明这层转发在阻碍而非帮助，
应改为给 core 加直接依赖，并用 pnpm 的 `overrides` 锁定单一版本以保住唯一实例。
