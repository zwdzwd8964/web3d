# ADR-0001 · monorepo 与包边界

- 状态: Accepted
- 日期: 2026-07-30
- 相关宪法条款: C2, C3, C7

## 背景

技术方案 §1.1 判定编辑器预览与播放器必须运行同一份 Runtime Core，否则验收时"编辑器里是这样、
发布出来不一样"无法辩解。要让这条约束可被机械检查，包边界必须是目录级别可指的，而不是靠约定。
R11（知识产权排他转让）同样要求"底座 vs 定制"的边界能用目录指出来。

## 选项

1. 单包 + 目录约定 —— 零配置；边界靠人自觉，无法静态检查，六周后必然被穿透。
2. pnpm workspace 五包（schema / storage / core / editor / player）—— 边界由 package.json
   声明，`shamefully-hoist=false` 使幻影依赖直接编译失败；代价是构建顺序与配置文件变多。
3. Nx / Turborepo —— 缓存与任务编排更强；引入一层额外工具与其升级负担，v0 规模用不上。

## 决定

选 2。依赖方向 schema ← storage ← core ← {editor, player}，core 不依赖 storage。
`scripts/check-deps-direction.mjs` 同时检查 package.json 声明与源码 import，反向边即 CI 失败。

## 代价

- 五份 tsconfig / tsup / vitest 配置需要保持一致，改一处容易漏改四处；
- 跨包重构要先 build 被依赖方，本地迭代比单包慢；
- `core` 不依赖 `storage` 意味着资产字节必须由外部经 `AssetResolver` 注入，调用方多写一层。
  这层是刻意的：它让 core 在 Node 里用假 resolver 就能跑（C8）。

## 撤销条件

若 v1 结束时 `@w3/editor` 与 `@w3/player` 的公共代码超过各自体量的 40%，说明分包位置切错了，
应重新划分（很可能需要一个 `@w3/ui-kit`），而不是继续往 editor 里塞。
