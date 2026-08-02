# ADR-0019 · `playMedia` 早结束竞速：结构探测 `waitMediaEnd`，不扩宽 `RuntimeContext`

- **状态**：已采纳（2026-08-02）
- **背景卡**：T-186 ①（D19「先到者为准」实际只等 `durationS`，`waitForEnd` 零生产调用者）
- **相关**：ADR-0018、[进化规划 D19](../MVP_V0_5_进化规划.md)、ECA_SPEC §6、runtime-contract.ts 的冻结说明

## 背景

D19 的原文：「真实环境听 `ended`（以先到者为准），headless 走 `ctx.wait(durationS)`」。
T-163 实现时只落了后半句——`MediaBus.waitForEnd` 写了、测了，但**零生产调用者**；
`playMedia(await: true)` 在两个运行时里都只等 `durationS`。真实剪辑比录制时长短
（编码器差异、`durationS` 手工改过、播放中途出错）时，规则链会对着寂静空等。

接通它需要动作拿到「真实结束」这一半。而 `RuntimeContext` 是**冻结清单**
（进化规划 §4.3 只允许 `setLight` + 三个媒体方法；契约测试的注释写明了为什么：
为一个便利扩宽一次，下一个便利就有了先例）。同时 D19 明说 headless **不许**听
`ended`——这个能力天生就是单侧的，塞进两侧共有的接口本身就是错的形状。

## 决定

`SceneRuntime` 增加公开方法 `waitMediaEnd(id, signal)`（委托 `MediaBus.waitForEnd`），
**不进 `RuntimeContext`**。`playMedia` 的 handler 用 `unknown` + 类型守卫**结构探测**
ctx 上有没有这个方法：

- 有，且剪辑真的在播 → `Promise.race([ctx.wait(durationS), waitMediaEnd(id)])`，
  两半都挂在同一个内层 `AbortController` 上，外层 signal 中止两半（铁律 10）；
- 没有（headless），或剪辑没真开播（自动播放被拒 / 无元素工厂）→ 照旧
  `ctx.wait(durationS)`。`isMediaPlaying` 守卫是承重的：`waitForEnd` 对没在播的
  剪辑立即 resolve，不守卫就等于把这类剪辑的等待整个跳过——那是行为变更，不是修债。

## 代价

一个动作与一个运行时之间出现了**未在接口上声明的耦合**：`media.ts` 知道
`SceneRuntime` 有个叫 `waitMediaEnd` 的方法。改名或改签名时 tsc 不会替这条路把关
（探测走 `unknown`），只有 `scene-runtime.test.ts` 里那条集成测试会红——变异检验
（删掉 `waitMediaEnd` → 集成测试红、动作单测仍绿）证明了这条防线真的在。

## 撤销条件

第二个动作需要某个仅真实运行时才有的能力时，这个模式就到头了——届时把
`waitMediaEnd?` 作为**可选成员**声明进 `RuntimeContext` 并回写 ECA_SPEC §6
（那是字段定义变更，按 CLAUDE.md 停下来问人），删掉结构探测。
