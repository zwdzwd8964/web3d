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
