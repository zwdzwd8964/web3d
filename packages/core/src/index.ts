/**
 * @w3/core — the Runtime Core and the ECA engine.
 *
 * Framework-agnostic (C2): no React, no Vue, no storage. The editor's preview and the
 * player run this exact code — never two implementations of the same behaviour (C3).
 *
 * Import from `@w3/core/eca` instead when only the rule engine is wanted: that entry
 * point pulls in no three.js at all, which is what lets the engine be unit-tested with
 * no GPU (C8).
 */

export * from './eca.js'
export * from './assets/index.js'
export * from './runtime/index.js'
export * from './embed/index.js'
export * from './util/filename.js'
// T-299 · AI 能力的插座。v1 只有接口与一个默认关闭的空实现，不接任何模型。
export * from './ai/ai-provider.js'
