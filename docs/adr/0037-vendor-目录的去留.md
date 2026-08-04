# ADR-0037 · `vendor/` 与 `VENDOR_*` 常量：保留，并给它配一台机器

- **状态**：Accepted
- **日期**：2026-08-04
- **任务卡**：T-220 · 债「被部署、被检查、没人用」
- **相关**：[ADR-0012](0012-解码器路径不再默认覆盖.md)（撤销默认覆盖）· 宪法 C6（断网能跑）· NORTH_STAR §8

---

## 背景

`vendor/` 今天是**死的**，而它看起来完全活着：

- `sync-vendor.mjs --check` 挂在 `pnpm check:constitution` 里，每次都绿；
- `Dockerfile:42` 把它拷进镜像，`deploy/nginx.conf.template` 给它配了 30 天缓存；
- `packages/editor/vite.config.ts:10-13` 的注释写着「vendor/ 由 `sync-vendor.mjs` 拷进构建输出」。

**这三条里有两条是假的。** `sync-vendor --check` 证明的是「拷贝与锁定的 three 一致」，
不是「它被用上了」；那条 vite 注释是错的——`sync-vendor.mjs` 的终点是仓库根的 `vendor/`，
与 `dist` 无关。ADR-0012 撤销默认覆盖之后，`VENDOR_DRACO_PATH` / `VENDOR_KTX2_PATH`
两个常量**零生产调用者**。

## 证据

**卡面说依据 T-218 打印的真实 URL 裁决。那条依据是错配的，且已有更硬的证据。**

T-218 与 T-219 的 E2E 跑在 vite **dev server** 上（`playwright.config.ts:43-57` 起的是
`vite dev`，全仓 E2E 从不跑 `vite build` + preview），它们观测到的是开发期路径：

```
/@fs/C:/…/three/examples/jsm/libs/draco/draco_wasm_wrapper.js   （276,778 字节）
/@fs/C:/…/three/examples/jsm/libs/basis/basis_transcoder.js     （253,964 字节）
```

`/@fs/` 在生产里不存在，**拿它裁决部署形态是错配**。决定性证据在构建产物里，今天就能数：

```
packages/editor/dist/assets/  draco_decoder-C32yEggz.wasm · draco_decoder-Z1_iN-Ht.wasm
                              draco_decoder-fzg4nYZr.js   · draco_wasm_wrapper-DxJM36Ib.js
                              draco_wasm_wrapper-fZCQGLGb.js
                              basis_transcoder-VXdx5NbI.wasm · basis_transcoder-o4Hde_L7.js
packages/player/dist/assets/  同样 7 个
```

打包器通过 `import.meta.url` 把解码器**同源产出到 `dist/assets/`**，带内容哈希。
**`/vendor/` 收到零个请求。** 两条证据指向同一个结论。

## 决定

**保留 `vendor/`，并且给它配一台机器。**

保留的理由不是「以后可能有用」——那是死代码的标准辩护词。理由是 ADR-0012 写下的那一条：
**非打包部署**（把两份 `dist` 与解码器摆到任意静态服务器上、或从共享位置提供解码器）
需要一个显式路径，而 `AssetLoaderOptions.dracoPath` / `ktx2Path` 就是那个入口。
`docs/DEPLOY.md` §5「纯静态托管」正是这种形态。

**但「保留」不等于「什么都不做」。** 本 ADR 同时交付三件事，否则它就是下一次
「被部署、被检查、没人用」：

1. **`sync-vendor --check` 补扫描面下限。** 它今天的判据是
   `srcFiles.length === dstFiles.length && every(...)`，两侧同时为空时是 `0 === 0` 加一个
   空 `every`——**恒真**。这正是 D36 的 M6 形状，而它长在本卡自测所倚仗的那条命令上。
2. **`--require-build` 断言 `dist/assets/` 里仍有解码器产物。**
   这是 ADR-0012 的撤销条件 #2（「升级 three 时必须复验」）**唯一一次变成机器**。
   three 一旦改掉 `import.meta.url` 的解析方式，`dist` 里的解码器会悄悄消失，
   而 `sync-vendor --check` 照样绿——直到内网白屏（反模式 A7）。
3. **两个常量各带一条 `CONSTITUTION-EXCEPTION`，带到期版本号。**

## 代价

明确接受四条：

1. **仓库里留着 10 个文件、约 1.6 MB，生产运行时一次都不读。** 它们进镜像、占带宽、
   进每一次 `git clone`。这是真实成本，不是零。
2. **两个零调用者的导出常量继续存在。** C5 的守卫因此需要一条例外，而例外本身是负债
   （NORTH_STAR §8：「没有到期日的例外，一年后就是新的默认行为」）——所以它们带到期日。
3. **「非打包部署」这条路今天没有任何测试指向它。** 没有 E2E、没有集成测试跑过
   「把 dist 摆到静态服务器上再用显式路径喂解码器」。**这一条是本 ADR 最弱的一环**，
   撤销条件 #1 就是为它写的。
4. **新增一条 ADR 让 `check:docs` 规则 3 的 ADR 计数要同步 +1**（`README.md` 与
   `docs/V1_KICKOFF.md` 两处），这两个文件不在 T-220 独占清单里。

## 撤销条件

1. **到 `v1.2` 收尾时，「非打包部署」仍然没有任何测试指向它** → 删掉 `vendor/`、
   两个常量、`Dockerfile` 的 COPY 与 nginx 的 `location /vendor/`，并把 `sync-vendor.mjs`
   一并删掉。**这是本条最可能被触发的撤销条件**，两条 `CONSTITUTION-EXCEPTION` 的
   到期版本号就写 `v1.2`。
2. `AssetLoaderOptions.dracoPath` / `ktx2Path` 被证明永远不会被任何宿主设置 →
   同上，一并删。
3. three 不再通过 `import.meta.url` 解析解码器（由本卡新增的 `--require-build` 断言抓到）
   → 那时 `vendor/` 从「备用」变成「主路径」，本 ADR 反过来：常量要接上默认值，
   撤销的是 ADR-0012 而不是本条。

## 未采纳的方案

| 方案 | 不采纳的理由 |
|---|---|
| **直接删掉 `vendor/`** | 卡面独占清单列了三条「（若删）」路径，但**卡面自己的两个分支没有一个是删**，而自测栏逐字要求「`sync-vendor --check` 必须仍绿」——删了它必红（走 `MISSING` 分支 exit 1）。「去留裁决」在卡面层面实际只有「留 + 怎么留」。真要删是一次独立的裁决，不该夹在这张卡里做 |
| **按验收③ 把 `vendor/` 登记进 T-205 的豁免表** | **机器上不可能**。那张表的 `symbol` 列是**导出符号**，`check-dead-exports.mjs` 会把一个匹配不到孤儿的行判成 stale 并 exit 1；一个目录名永远不是导出符号。退一步只登记两个常量也不行：`MAX_EXEMPTIONS` 今天正好 34/34，其 JSDoc 写死「只能降不能升」。改走 `CONSTITUTION-EXCEPTION`（NORTH_STAR §8 第 2 步），由 T-298 的 `check-expiry.mjs` 读，**这是本仓唯一能承载「到期版本号」的机制**。按铁律 12 在此记下这次偏离 |
| **到期版本号写 `v1.0`** | `isExpired('v1.0', 'v1.0')` 为 true，而当前版本回落值就是 `v1.0`——**写 v1.0 等于当天到期转红**。写 `v1.2`，与撤销条件 #1 对齐 |
| **保留但不加任何机器** | 那就是把「被部署、被检查、没人用」原样留到下一个版本，只是多了一份写着「我们想过这件事」的 ADR |
