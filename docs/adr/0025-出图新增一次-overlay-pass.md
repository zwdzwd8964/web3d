# ADR-0025 · 出图在渲染路径上新增一次 overlay pass（真 Q4）

- 状态: Accepted
- 日期: 2026-08-03
- 相关宪法条款: **C5**（分诊 Q4：改渲染管线）· C3 · NORTH_STAR §8（例外三件套）

## 背景

R06：**HTML 热点不在 canvas 里。** 出图要产出的东西是「设备说明书插图」——一张图上标着「①阀盖 ②叶轮 ③机封」，这正是渲染出图这个功能的头号用途。而热点今天是 DOM 层（`hotspot-layer.ts`），`renderer.render(scene, camera)` 读不到它一个像素。

热点合成必须发生在 `renderer.render(scene, camera)` **之后**——这是在改渲染路径，按 `NORTH_STAR §4` 是分诊 **Q4**：「不许直接动手。写 ADR，重新评估预算与工期。」

这是一条**真 Q4**，不是可以绕开的：`hotspot-layer.ts:37-42` 的注释在 v0 就写着「v1's render to image feature has to swap in a sprite renderer」——接缝是留了，但接缝的另一头必然落在渲染路径上。

## 选项

1. **把 overlay 加进 `this.scene`，靠一次 render 画完。**
   - 收益：渲染出口仍然只有一个，不触 Q4。
   - 代价：overlay 会被 picker 射到、被 `boundsOf` 量到、被 `resetScene` 的图重建波及；出图失败时它留在场景里；且它必须永远面向相机，需要**每帧**维护——一个只在导出那 300 ms 用得上的东西，要付全时段的成本。

2. **在 `captureImage()` 内部追加一次 `renderer.render(overlayScene, orthoCamera)`（`autoClear = false`）**（本条）。
   - 收益：overlay 只在导出期间存在，场景图零污染，picker / bounds / resetScene 全都看不见它。
   - 代价：见下。

3. **不合成，出图不含热点。**
   - 收益：零代价，不触 Q4。
   - 代价：R06 未解决，出图对「设备说明书插图」这个头号用途基本无用——等于交付了一个功能的壳。

## 决定

选 2。并同时定死四件事，缺一不可：

### 1 · 例外注释（逐字）

`packages/core/src/runtime/scene-runtime.ts` 的 `captureImage()` 内、第二处 `renderer.render(...)` 上方：

```ts
// CONSTITUTION-EXCEPTION: 渲染出口 · ADR-0025 · 到期 v2
```

### 2 · 白名单项

「唯一渲染出口」检查（与出图同版本新建，断言 `renderer.render(` 只出现在 `drawScene()` 里）加一条**带过期版本号 `v2`** 的豁免，例外 id `E-3`。

### 3 · 契约 K3 写死

> **出图的 overlay pass 在 `drawScene()` 之后、以 `autoClear = false` 追加；postfx 不得假设自己是最后一个写默认帧缓冲的人。**

违反的后果有两个方向：描边把热点盖掉，或热点被 composer 的最后一次 clear 抹掉。技术前提是成立的——composer 的最后一个 pass `renderToScreen = true` 写默认帧缓冲（`design/render-out.md:427`），所以 overlay 可以 `autoClear=false` 叠在它之后。

### 4 · 补一句 composer 时间线的措辞

> **`composed` 模式下也走主画布临时改尺寸，不因为有了 composer 就分出第二条出图路径。**

这一句必须写死。原因：`render-out.md` 的另一条 ADR 把「postfx 引入 composer 之后重新评估」写进撤销条件，而 [ADR-0021](0021-撤销-D20-v1.0-引入后处理链.md) 的 composer **就落在同一个版本（v1.0）**——撤销条件在批准当天就已满足一半。不补这句，RO-* 与 PF-* 两条线会各做各的，最终得到「direct 出图」与「composed 出图」两套实现。**那是 C3 分叉的同构形状，而且它发生在同一个包内，parity 看不见。**

**变异检验**：把 overlay pass 挪到 `drawScene()` 之前 → 「热点出现在导出图上」的像素断言必须转红（同一像素两次导出一有一无）。把 `autoClear` 改回 `true` → 同一条断言必须转红（overlay 会把整幅画面清掉）。改不红的断言不算数。

### 5 · 作废一条假设，并写明它的连带后果（T-265 落地时补）

**作废**：「热点 sprite 是场景内对象、会吃雾、进 composer」。这条假设在几处早期讨论里
出现过，它与本 ADR 选的方案不相容——一个在 `drawScene()` 之后、以 `autoClear=false`
叠上去的 overlay，按定义就不在场景图里、不经过 composer 的任何一个 pass。

**连带后果，两条，都要写进面板文案**：

- **雾对热点无效。** 雾是场景着色的一部分，overlay 在它之后。一个 200 米外的热点
  不会像它标注的那台泵一样被雾化——它会清清楚楚地浮在雾里。
- **描边对热点无效。** 同理：`OutlinePass` 在 composer 链里，overlay 在链尾之后。

两条都**合理**（热点是标注，不是场景里的物体：一个被雾糊掉的编号等于没有编号），
但「合理」不等于「不用说」。用户在效果面板里开了雾、导出后发现热点没被雾化，第一反应
一定是「导出坏了」。

**同时作废的还有一条测试假设**：既然 sprite 不进 composer、也不需要 renderer，那么
栅格化就与 GPU 无关——`HotspotSpriteLayer` 因此可以在纯 Node 里被穷举（注入一个只
记录调用的假 2D context）。**这是 parity 第一次够得到渲染层**：`tick()` 先更新热点层
再 `renderer?.render(...)`，热点层的更新与 renderer 在不在无关。

## 代价

明确接受五条：

1. **`scene-runtime.ts` 里出现第二处 `renderer.render(...)`。** 「唯一渲染出口」这条纪律从建立的第一天起就带着一个有名有姓的例外。这条纪律本身是与出图同版本建立的——也就是说我们在立规矩的同一张卡上给它开了口子。接受它的理由是选项 1 与选项 3 的代价更大，但这个事实要写下来。

2. **与 postfx 的 pass 顺序耦合靠契约 K3 约束，不靠类型系统。** 契约破了只有 E2E 能发现，编译器一声不吭。这正是 v0.5 那条教训（**测试覆盖零件，而缺陷长在接缝上**）指的形状：`captureImage` 有单测、composer 有单测，两者之间的顺序没有任何单测能表达。

3. **overlay 的混合结果在透明背景下与 R07 的边缘问题叠加，观测成本翻倍。** 透明背景 + 抗锯齿的边缘实测必须**在有 overlay 的图上也采一遍样**，不能只测纯模型——两个非预乘混合叠在一起的结果，不是任何一个单独结论的推论。

4. **出图期间视口被冻结**（100–500 ms 内点不出画面变化），且 4× 出图会瞬间申请一块大帧缓冲，弱机可能丢上下文。中文兜底文案有（「显卡资源不足，导出已取消（请降低导出倍率）」），但**用户的视口确实会挂掉**，只能靠刷新恢复。

5. **到期版本号 `v2` 今天没有任何脚本在读。** `grep -rl CONSTITUTION-EXCEPTION scripts/` 无输出，而 `NORTH_STAR.md:292` 写着「到期未清理，CI 转为失败」。**本例外的到期承诺，在 T-298（`scripts/check-expiry.mjs`，v1.0 · M14 · 波次 W3）完成之前是一张空头支票。** 这一条必须写在这里，因为它是本 ADR 唯一一条不由本 ADR 自己兑现的承诺——**T-298 被砍，本条的「到期 v2」就是一句装饰**。落地时按 `NORTH_STAR §8` 第 2 步的格式就地写下 `// CONSTITUTION-EXCEPTION: 渲染出口 · ADR-0025 · 到期 v2`（本 ADR 上文已给出逐字的那一行），T-298 的解析器认的就是它。

## 撤销条件

- **postfx 落地后 composer 提供了可注册的 pass 链** → overlay 改为链上的最后一个 pass，第二处 `renderer.render(...)` 删除，本例外随之作废。**到期版本：v2。**
- **v1.0 内出现第二处需要「在 `drawScene()` 之后再画一次」的需求**（水印、比例尺、坐标轴指示器）→ 说明这不是一个例外而是**一类**，应把「渲染后置层」做成注册表（与 ref-kinds 注册表同构的一次性结构改造：改这一次，让它以后不用再改），本 ADR 重写。
- **「唯一渲染出口」检查的豁免条目 > 1** → 检查本身失去意义（一条允许两个例外的唯一性检查不是检查）。此时应改为断言 `renderer.render(` 调用点的**集合相等**（恰好等于一份明确列出的清单）而不是数量上限——同 [ADR-0026](0026-改写恒真的后端晋级门槛.md) 规则 1 的口径。
- **v2 到期时 composer 仍未提供可注册 pass 链** → 不许顺延。届时要么完成结构改造，要么写新 ADR 把到期版本号推后并重新论证——**推后必须有新的论证，不能只改一个数字**。
