# ADR-0032 · Draco 取证的第三层从 Node 单测改挂 E2E

- **状态**：Accepted
- **日期**：2026-08-04
- **任务卡**：T-218 · 债 H · 门槛 G1.0-10
- **相关**：ADR-0030（依赖批准）· 宪法 C8（无显卡可测）· ADR-0012（vendor 默认覆盖已撤销）

---

## 背景

T-218 的卡面要求 Node 单测分三层，第三层逐字是：

> `AssetLoader.parse` 的 `indexObjects` 键集合与未压缩同源件**完全相等**

**这一层在 Node 里不可能通过，而失败的理由与产品无关。** 实测（Node v24.18.0）：

- `three/examples/jsm/loaders/DRACOLoader.js:358` 的 `_loadLibrary` 走 three 的 `FileLoader`，
  内部是 `fetch`；Node 的 `fetch` 不支持 `file://`，直接抛
  `TypeError: fetch failed | not implemented... yet...`；
- `:400-401` 无条件加载 `draco_wasm_wrapper.js` + `draco_decoder.wasm` 两个文件；
- 解码本身走 `new Worker(blobURL)`，而 Node 没有全局 `Worker`（实测 `typeof Worker === 'undefined'`）。

`packages/core/vitest.config.ts` 是 `environment: 'node'`，这是宪法 C8 的要求，不是可调项。

## 决定

**第三层改挂 E2E（`e2e/tests/decoders.spec.ts`），Node 侧换成一条更强的断言。**

Node 侧第三层现在用 `@gltf-transform/extensions` 的 `KHRDracoMeshCompression` +
`draco3dgltf` 的 decoder module **真的解一遍**，然后与未压缩同源件比**顶点数与三角面数**，
而不是比键名集合。配一条反例：只注册扩展、不注册 decoder → `readBinary` 必须 reject。

浏览器侧断言解码器**被同源取回**且**回来的是真字节**。

## 代价

明确接受三条：

1. **一条断言跨了两个测试层，读的人要跳文件。** 缓解是两边的文件头注释互相点名，
   并在 `draco-fixture.test.ts` 里逐字写清「这一层为什么不在这里」。

2. **Node 侧解出来的字节不是浏览器解出来的字节。** 两条路走的是不同的解码器实现
   （`draco3dgltf` 的 WASM vs three 打包进来的 `draco_decoder.wasm`）。这条差别是真的：
   Node 侧证明「文件是可解的」，浏览器侧证明「我们的加载器会去解它」，**两条都要有才算取证完整**，
   任何一条单独都能被绕过。

3. **`draco3dgltf` 同时是 fixture 的生产者与 Node 侧的消费者**，用同一份 WASM 编码再解码，
   理论上可能一起错。缓解是第 2 层（`auditGlb` 读 JSON chunk 的 accessor 数，完全不碰
   Draco）与 E2E（three 的独立实现）从两个方向交叉校验同一组数字：三角面 24。

## 撤销条件

1. **three 的 `DRACOLoader` 出现一条不依赖 `fetch` / `Worker` 的路径**（例如接受注入的
   fetcher，或提供同步 API）→ 第三层搬回 Node，E2E 只留同源断言。
2. **vitest 的 core 配置离开 `environment: 'node'`** → 那是 C8 被改了，本条随之重议。
3. `@gltf-transform/extensions` 与 three 对 `KHR_draco_mesh_compression` 的解读出现分歧
   （表现为第 2 层与第 3 层的三角面数对不上）→ 说明交叉校验抓到了东西，届时以 three 为准，
   因为它是产品真正跑的那一份。

## 顺带更正两处卡面

- **卡面变异 ①「注掉 `setDRACOLoader` → 第 2 层必须红」不成立。** 第 2 层是 `auditGlb`，
  它对压缩容器走 `measureFromHeader`（`audit.ts:207-213`），一行 three 都不碰——那正是 T-217
  建的分流。实测：注掉之后 Node 侧 **6/6 全绿**，E2E 红。变异的真实落点是 E2E 导入与第 3 层。
- **卡面 ①「`glb.ts:51` 的 primitive 没有 indices，Draco 要求索引三角面 → 补 `setIndices`」指错了文件。**
  本卡用的是 `buildSamplePumpGlb()`（`sample.ts:22`），它在 `sample.ts:103` **已经**
  `setIndices`。`glb.ts:51` 是另一个函数，且它「没索引」是 T-217 刻意依赖的性质
  （`glb-header.ts:129-130` 的注释逐字写着这件事）；`sample.ts` 还是 T-294 的独占。整条跳过。
