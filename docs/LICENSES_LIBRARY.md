# 内置库许可登记

**性质**：法务可查的清单。每一条内置库内容的来源与许可都必须在这里有据可查。
**强制手段**：`node scripts/check-library-manifest.mjs`（manifest 里 `license` / `author`
字段缺失即 fail），已在 T-173 纳入 `pnpm check:constitution`。

> 为什么单独立一份文件：风险登记册 V1「内置库内容版权污染」。一张来源不明的贴图混进
> 出厂内容，在验收前没人会发现，在验收后是合同问题。**字段填了不等于查过**——这份文件是
> 用来写"查过什么"的地方，manifest 里的字段只是让它不可能被忘掉。

---

## 1. 当前内容（starter，v0.5 T-145）

全部由 `scripts/gen-library-starter.mjs` **程序化生成**：没有一个字节来自网络，没有一个
文件是从别处拷来的，脚本本身就是作者。因此：

| 项 | 值 |
|---|---|
| 许可 | `CC0-1.0`（公共领域奉献） |
| 作者 | 本仓库（`scripts/gen-library-starter.mjs`） |
| 来源 | 无外部来源。运行脚本可逐字节复现 |
| 商用 | 无限制 |

清单（8 项，共约 1.1 MB）：

| id | 名称 | 类别 | 说明 |
|---|---|---|---|
| `tex-checker` | 棋盘格 | texture | 校验 UV 缩放与贴图朝向 |
| `tex-noise` | 噪声 | texture | 粗糙度 / 遮罩源 |
| `tex-brushed-metal` | 拉丝金属 | texture | 与法线贴图配套 |
| `tex-brushed-metal-normal` | 拉丝金属 法线 | texture | 由同一噪声场求中心差分得出，与 base color 同源 |
| `hdri-daylight` | 正午天光 | hdri | 程序化渐变天空 |
| `hdri-dusk` | 黄昏 | hdri | 程序化渐变天空 |
| `model-display-stand` | 展示台 | model | 底座 + 立柱 + 台面，三个可分别选中的部件 |
| `model-signpost` | 指示牌 | model | 立杆 + 牌面 |

**这些是机制的演示物，不是美术内容。** 两张 HDRI 是数学渐变而不是实拍全景，模型的预览图是
程序画的示意图而不是渲染图——manifest 的 `note` 字段里逐条写明了。真实内容包是人工供给项
（进化规划 §7.2 H2）。

### 1.1 泵组样板工程的 GLB（v1.0 · T-222）

| 项 | 内容 |
|---|---|
| 产物 | `buildPumpDemoGlb()` 在内存里生成的 GLB —— 16 个对象 / 4 条材质 / 1 条「拆装」导入动画 |
| 来源 | **本仓库自写的程序化几何**（`packages/core/src/assets/pump-demo.ts`），无外部素材、无外部来源 |
| 许可 | `CC0-1.0`，作者 = 本仓库，商用无限制。与 §1 的 starter 同一口径 |
| 是否进 git | **否。** 不提交二进制，每次由代码生成，且**逐字节可复现**（无时间戳、无随机、无 `Date`）|

**为什么它也要登记**：它是要在客户面前演示的那份内容。「演示用的那台泵是哪来的、能不能商用」
是一个签约前会被问到的问题，而「它是我们自己用几何算出来的」必须写在能被翻到的地方，
不是只写在代码注释里。它同时是 §3 尺寸预算的一项——**不进 bundle**（走资产管线，
与 HDRI / 媒体 / 库内容同一条路），实测 Player gzip 增量为 0。

---

## 1.2 三方 npm 依赖（ADR-0030 落地纪律 2）

**这一节登记的不是内置库内容，是随构建产物再分发的第三方代码。** 与上面一节同一个理由：
一个来源不明的字节在验收前没人会发现，在验收后是合同问题。

| 包 | 版本 | 许可证 | 用途 | 引入卡 | 是否随分发再分发 |
|---|---|---|---|---|---|
| `draco3dgltf` | `1.5.7`（精确锁定，不许 caret） | **Apache-2.0** | **仅**用于人工一次性生成 `e2e/fixtures/pump-draco.glb`。`packages/core` 的 **devDependency**，不在 build / CI / `pnpm verify` 的任何路径上 | T-218 | **否** |
| `@gltf-transform/core` | `4.4.2` | MIT | GLB 读写与体检测量 | T-141 / T-217 | 是（打包进 editor） |
| `@gltf-transform/extensions` | `4.4.2` | MIT | 读 `KHR_draco_mesh_compression` 等扩展块 | T-217（由传递依赖提升为直接依赖） | 是（打包进 editor） |

**`draco3dgltf` 的 Apache-2.0 NOTICE 义务**：Apache-2.0 §4(d) 要求再分发时保留 NOTICE 文件。
**本包不随任何分发产物出去**（它只在开发机上被 `scripts/gen-draco-fixture.mjs` 调用一次），
因此该义务当前不触发。**如果哪天它进了 `dependencies`，这一格必须同批改**——
把「否」改成「是」而不补 NOTICE，就是一次真实的许可证违约。

> ⚠ **ADR-0030 有一句关于 Draco 的话是错的，别照抄。** 它在「体积影响」那格写着
> 「浏览器里的 Draco 解码走的是已自托管在 `vendor/` 的 decoder（铁律 7）」。实测不是：
> ADR-0012 已撤销默认覆盖，`loader.ts` 的 `VENDOR_DRACO_PATH` / `VENDOR_KTX2_PATH`
> **零生产调用者**，浏览器实际取的是打包器同源产出的那一份
> （dev 是 `/@fs/…/three/examples/jsm/libs/draco/`，prod 是 `dist/assets/draco_decoder-*.wasm`）。
> `vendor/` 的去留由 **T-220** 裁决，本卡只负责把证据摆出来。

---

## 2. 接入真实内容时必须做的事

按这个顺序，一条都不能省：

1. **确认许可允许商用再分发。** CC0 / CC-BY 可以（CC-BY 需在下方登记署名要求）；
   CC-BY-NC、CC-BY-ND、以及任何"仅限个人使用"的一律不收。
2. **把文件放进 `packages/editor/public/library/`**，路径写进 `manifest.json`，
   `license` 填 SPDX 标识符（如 `CC0-1.0` / `CC-BY-4.0`），`author` 填原作者。
3. **在下面的表里加一行**，附上**可点开的来源链接**与下载日期。
   链接写在这份 Markdown 里，**不写进 manifest**——manifest 里出现 `https://` 会被
   `check-library-manifest.mjs` 直接判为违反 C6（它是运行时会被读的数据文件）。
4. `node scripts/check-library-manifest.mjs` 必须绿。
5. 断网跑一次 `pnpm dev`，确认库面板完整可用。

### 外部来源登记表

| id | 来源（URL） | 下载日期 | 许可 | 署名要求 | 核查人 |
|---|---|---|---|---|---|
| —— | 暂无外部来源内容 | | | | |

---

## 3. 尺寸预算（进化规划 §8 V5）

`check-library-manifest.mjs` 强制执行：

| 项 | 上限 |
|---|---|
| 单张纹理 | 2 MB |
| 单张 HDRI | 8 MB |
| 单个模型 | 8 MB |
| 单张预览图 | 256 KB |
| 库总量 | 40 MB |

超限即 fail。理由不是磁盘，是**编辑器打开速度**：库内容走静态资源，惰性加载，但总量失控时
第一次打开面板的等待是用户对整个产品的第一印象。
