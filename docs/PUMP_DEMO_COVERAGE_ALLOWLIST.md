# 样板工程能力覆盖 · 豁免表（T-285）

`packages/editor/test/pump-demo-coverage.test.ts` 遍历动作注册表与 `EVENT_TYPES`，
断言**每一个都被泵组样板演示过**。演示不了的写进下表。

> **豁免不是「先放着」。** 每一条要写清**谁会用到它、什么时候**（少于 10 个汉字的理由
> 由 `readExemptions` 直接判失败），并带一个到期版本号——到期还在表上，守卫会红。
>
> 这张表回答的是「为什么客户在演示现场看不到这个能力」。一条没有理由的豁免，等于
> 把这个问题留给验收会上的那个人。

## 豁免表

| symbol | reason | owner | expires |
|---|---|---|---|
| action:setMaterial | 换材质要在界面上先选中一个零件再挑一件材质，规则里演示它只会得到一次看不出来的变色 | T-296 | v1.2 |
| action:setLight | 泵组样板没有灯节点，它靠内置默认灯架照明；加一盏灯只为演示这个动作会让样板多一个与工艺无关的对象 | T-296 | v1.2 |
| action:playMedia | 样板不含音视频资产，媒体线的演示归 v1.2 的多媒体样例 | T-328 | v1.2 |
| action:stopMedia | 同上，与 playMedia 成对，没有资产就没有可停的东西 | T-328 | v1.2 |
| action:seekAnimation | 拆装动画是一条两秒的短片段，跳到中间在演示里看不出与直接播的区别 | T-296 | v1.2 |
| action:resetScene | 样板的复原走的是爆炸系数归零，整场重置会把用户已经打开的剖面也一起收掉 | T-296 | v1.2 |
| action:exportImage | 出图有自己的工具栏入口与对话框，规则里再演示一次只会在演示中途弹出一次下载 | T-296 | v1.2 |
| action:openLink | 样板是内网离线演示，点开一个外部链接与断网可用这条承诺直接冲突 | T-296 | v1.5 |
| action:wait | 纯节拍动作，样板的每一步都用动画自己的时长控制节奏，插一段空等只会让演示变慢 | T-296 | v1.2 |
| event:hoverEnter | 悬停进入要配一条悬停离开才成对，两条规则只为演示悬停会与点击的三级拆开抢同一批零件 | T-296 | v1.2 |
| event:hoverLeave | 同上，与 hoverEnter 成对出现才有意义 | T-296 | v1.2 |
| event:hotspotClick | 样板的五个热点都由规则打开面板，用户点热点标记本身的路径归 v1.2 的编排样例 | T-328 | v1.2 |
| event:animationEnd | 拆装动画播完之后没有后续步骤，挂一条空规则只为演示这个事件是假的演示 | T-328 | v1.2 |
| event:variableChange | 样板的两个变量都由规则自己写，再挂一条监听会形成一个绕回自己的环 | T-328 | v1.2 |
| event:timer | 定时器在一份等着人来点的演示工程里没有位置，它属于自动巡演那类场景 | T-328 | v1.5 |
| event:pageEnter | 覆盖层与页面是 v1.2 才通电的集合，v1.0 的样板按 A1 的版本切分不含 pages | T-328 | v1.2 |
| event:flowStepEnter | 流程编排同上，v1.0 的样板不含 flows | T-328 | v1.2 |
| event:overlayClick | 覆盖层同上，v1.0 的样板不含 pages 与 overlays | T-328 | v1.2 |
