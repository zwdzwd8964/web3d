# ADR-0020 · B9 对 media 的守卫补在 executor 的通用 `refExists` 里

- **状态**：已采纳（2026-08-02，**委托授权下的裁决，见下**）
- **背景卡**：T-186 ④（executor 的 B9 对 media 直接放行）
- **相关**：铁律 5、CLAUDE.md「停下来问人」第 2 条、ECA_SPEC B9（§8 兜底表）、T-122（`mediaById`）

## 背景

ECA_SPEC B9：「规则引用了已删除的对象 → 不崩溃，记 error 日志，该动作 `skipped`」。
executor 的 `refExists` 是实现它的**通用引用守卫**——按 `RefKind` 数据分发，七种引用
类型里六种查索引，唯独 media 走 default 直接放行，旁边的注释还停在 v0：
「media 没有运行时，没什么可验证的」。v0.5 给了 media 运行时，也给了索引 `mediaById`
（T-122），这条 default 从那时起就是漏洞：指向已删除媒体的规则不会 skip，`playMedia`
会对着不存在的记录跑完流程（await 时空等一段不存在的时长）。

## 争议点

铁律 5 与「停下来问人」第 2 条把 `executor.ts` 列为禁改文件。备选方案是把存在性检查
写进两个媒体动作的 handler——但那样 `ExecStep.status` 是 `'ok'`（带 error 日志）而不是
B9 字面要求的 `'skipped'`，调试面板与验收用例执行记录里 media 与其他六种引用**表现
不一致**，还要再写一条 ADR 记录这个偏离。两个方案各违一条纪律，必须选边。

## 决定

补全 `refExists`：`case 'media': return index.mediaById.has(id)`，一行。理由：

1. **这不是铁律 5 防的那种改动。** 铁律 5 与停工条款第 2 条的原文都限定在
   「实现某个**动作**需要改 executor」——防的是动作知识（`if (action.type === ...)`）
   渗进引擎。`refExists` 是按 `RefKind` **数据**分发的通用机制，补一个 case 不引入
   任何动作知识，反模式表里那条红线碰都没碰到。
2. **缺陷本身登记在 executor。** T-176 的登记原文就是「executor 的 B9 对 media
   直接放行」——修在别处等于绕着病灶包扎。
3. **SPEC 是逐字实现的规范。** B9 说 `skipped` 就必须是 `skipped`；handler 方案
   永久性地造出一个「按卡面修完、与规范不符」的状态。

## 代价与上报

尽管理由如上，`executor.ts` 的 diff 非空**在字面上仍触发停工条款**。本次在用户明确
授权「清完全部剩余任务，只有重大风险/决策再来找」的会话内裁决执行，并在会话汇报中
**单独标出**供否决。若人工复核不同意：revert 本 ADR 与那一行，改走 handler 方案
（T-186 ④ 研究记录里有完整设计），接受 status 不一致并另写 ADR 记录之。

## 撤销条件

见上——人工否决即撤销；或未来 `RefKind` 增员时发现 `refExists` 的 switch 不再可穷尽
（TS 会在编译期报 non-exhaustive，这正是删掉 default 换来的保险）。
