# ADR-0006 · RuntimeContext 增加 currentEvent()

- 状态: Accepted
- 日期: 2026-07-30
- 相关宪法条款: C5, C8

## 背景

ECA_SPEC §4.2 规定 `setVariable` 的参数为 `{ variableId, value: ValueExpr, mode }`，而
§3.1 的 ValueExpr 包含 `{ event: 'nodeId' | 'hotspotId' | 'animationId' }`——读取当前事件的载荷。
但 §4.1 把动作处理器签名固定为 `(ctx, params, signal)`，§6 的 RuntimeContext 里没有事件。
于是"点了哪个就把它记进变量"这条 §3.1 明确支持的用法无法实现。

## 选项

1. 改动作处理器签名加一个 `event` 参数 —— 直接；违反 §4.1 的固定签名，且所有动作都要多带一个
   99% 用不到的参数。
2. 执行器预先求值 ValueExpr 类参数 —— 执行器必须知道哪些参数是 ValueExpr，即知道具体动作的形状，
   直接违反 C5 与反模式 A3。
3. 在 RuntimeContext 上加 `currentEvent()`，由引擎在每次分发前后设置。
   ECA_SPEC §10 步骤 2 明文允许："若需要新的运行时能力，在 RuntimeContext 加方法，
   并在 SceneRuntime 与 HeadlessRuntime 两侧都实现"。

## 决定

选 3。引擎用一个逐方法转发的包装对象把事件绑进 `currentEvent()`，两个 Runtime 实现都提供该方法，
并纳入 `describeRuntimeContract` 契约测试。

## 代价

- RuntimeContext 比 §6 多一个方法，规范与实现之间出现可见差异；
- 转发包装是手写的：RuntimeContext 将来加方法时，忘了在包装里加会导致该方法在规则执行期不可用。
  （契约测试会抓到，但只在有对应用例时。）

## 撤销条件

若规范作者更倾向改动作签名，则删除 `currentEvent()`，把事件作为第四个参数传给处理器，
并同步更新全部 13 个动作与契约测试。
