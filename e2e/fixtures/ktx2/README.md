# `checker-etc1s.ktx2` · 来源与生成方式

**这份文件是一张真的 ETC1S 压缩纹理**，不是占位、不是未压缩 KTX2。它存在的唯一理由是：
`KTX2Loader` 从 v0.5 就接在代码里，**transcoder 那条路一次都没被真的跑过**
（`IMPL_NOTES` U-16），而《附件A 数字资产规范》已经把「允许 KTX2 贴图」写给了客户。
一份未压缩的 KTX2 能证明容器解析，**证明不了 transcoder**——而 transcoder 正是那句承诺
唯一依赖的东西。

---

## 头部字段（`packages/core/test/runtime/ktx2-wiring.test.ts` 逐项断言这些）

| 字段 | 偏移 | 值 | 含义 |
|---|---|---|---|
| identifier | 0 | `AB 4B 54 58 20 32 30 BB 0D 0A 1A 0A` | KTX 2.0 魔数 |
| `vkFormat` | 12 | **0** | 0 = 由 supercompression 决定格式，即 Basis |
| `pixelWidth` / `pixelHeight` | 20 / 24 | 128 / 128 | |
| `faceCount` | 36 | 1 | 2D 贴图，不是 cubemap |
| `levelCount` | 40 | **8** | 带完整 mip 链 |
| `supercompressionScheme` | 44 | **1** | **1 = BasisLZ（ETC1S）**，2 才是 Zstd/UASTC |
| 体积 | — | 1,147 字节 | |
| SHA-256 | — | `c9c1120e5819d1daf2f8337643c602fa42676a577e59590d3fe00471ae898cc0` | |

**`supercompressionScheme === 1` 是这份 fixture 全部价值所在。** 换成 0（未压缩）或 2
（UASTC/Zstd）都能被 `KTX2Loader` 打开，但走的是别的分支，`basis_transcoder.wasm` 一次都不会被调用。

## 图案

128×128 棋盘，格子 16px，两色 `#E84028` / `#1F8CC7`。

**故意不用黑白。** ETC1S 是有损的色度压缩，一对灰度色在压完之后仍然是灰度，而 E2E 要断言的
恰恰是「这个 mesh 不是默认灰」。带色度的一对色让「解码失败」与「解码成功」在像素上可分。

## 生成命令（**仓外一次性人工执行**）

```bash
# 在仓库之外的临时目录里
npm install ktx2-encoder@0.6.0     # MIT · 纯 JS + WASM · 仅依赖 ktx-parse
node make.mjs                       # 见下方脚本要点
```

- **工具不进仓、不进 CI、不进 `pnpm verify`**，`package.json` 里没有它。
- `ktx2-encoder@0.6.0`：**MIT**，底层是 [BinomialLLC/basis_universal](https://github.com/BinomialLLC/basis_universal)
  的 WASM 编码器，**无 node-gyp / prebuild / 系统库**——符合 ADR-0030 的准入线
  「纯 WASM / 纯 JS 的进，需要编译的不进」。
- 编码参数：`{ isUASTC: false, generateMipmap: true }`，Node 侧另需一个 `imageDecoder`
  （我们自己生成的像素，直接交回，不为一份自己画的图再引一个图像解码库）。
- 棋盘 PNG 由脚本内联的 PNG 编码器写出（与 `scripts/gen-library-starter.mjs` 同一套
  zlib + CRC 手写实现），所以整条链路零外部素材、零网络素材，**版权来源是我们自己**（CC0-1.0）。

## 为什么用它，而不是 Khronos 的 `ktx` 原生二进制

拍板项 **P-14** 砍掉 v1.5 的服务端 KTX2 编码，理由是那条路只能走 Khronos 的 `ktx`
**原生二进制**（amd64 单架构），与 `pnpm-workspace.yaml` 里 `sharp:false` 那条既有决定
（不在浏览器外跑原生步骤）以及 v3 的 ARM / 信创目标冲突。

**T-219 的 ⚠ 栏已经预先裁过这次混淆**：P-14 砍的是**产品每次上传都要跑的服务端步骤**，
不是一个人手工生成一次的测试夹具；ADR-0031 §3 末段逐字写着「不要把 P-14 读成 KTX2 全线不做」。
即便如此，能用纯 WASM 就不用原生二进制——这条准入线本身没有例外的必要。

## 更新它的时候

改了图案或编码参数 → 重跑生成脚本 → **同批更新上表的 SHA-256 与体积**，
`ktx2-wiring.test.ts` 会因为头部字段对不上而转红。那不是测试坏了，是这份说明过期了。
