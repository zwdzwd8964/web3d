# 嵌入 API · EMBED_API

把播放器放进别人的页面，并从那个页面指挥它。

> **两道锁，只配一半等于没配。** `frame-ancestors` 挡「谁能把我们放进 iframe」，
> `embed-policy.json` 挡「谁能对我们说话」。部署侧的配法见
> [DEVELOPMENT.md §10](DEVELOPMENT.md)。

---

## 1. 快速开始

<!-- doc:quickstart:start -->
```html
<div id="viewer" style="width: 960px; height: 540px"></div>
<script src="/player/embed.js"></script>
<script>
  const ready = W3Player.mount({
    src: '/player/index.html?embed=1&src=demo.w3p',
    container: document.getElementById('viewer'),
  })

  ready.then(async (player) => {
    // 播放器报上来它支持什么。**据它判断，不要硬编码一份清单。**
    console.log('可用命令：', player.commands.join(', '))

    player.on('hotspotClick', (payload) => {
      console.log('用户点了热点', payload)
    })

    await player.subscribe(['hotspotClick', 'variableChange'])
    await player.setVariable('var_step', 2)
  }).catch((error) => {
    // **别省掉这一段。** 握手失败（超时 / origin 被拒 / 协议不匹配）与命令失败都会走到
    // 这里，而没有它的话，浏览器控制台里只有一条 unhandled rejection，宿主页面自己不知情。
    console.error('嵌入失败[' + error.code + ']：' + error.message)
  })
</script>
```
<!-- doc:quickstart:end -->

`?embed=1` **不能省**：不带它，播放器不装嵌入层（那三个模块一个字节都不下载），
`mount()` 会在超时后 reject。

**一个容器只 mount 一次。** `mount()` 每次调用都新建一个 iframe，它不检查容器里是不是
已经有播放器了——调两次就是两套完整运行时（两个 WebGL 上下文、两条渲染循环、包被下载
两遍），而两个 iframe 会一上一下排开，第二个溢出到容器外面。要拿到句柄就把
`mount()` 的返回值存下来复用，不要再调一次。

---

## 2. 命令表

每条命令返回一个 Promise。失败时 reject 一个 `PlayerError`，它带 `code`——
**按码分支，不要按中文匹配**，中文措辞会变。

| 命令 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `ready` | — | `{ protocol, commands, scene }` | 握手。`mount()` 自己调，宿主一般不用 |
| `play` | — | — | 继续播放 |
| `pause` | — | — | 暂停。**不保证画面立刻停**：可见性与视口也是输入量，见 §5 |
| `getVariable` | `{ id }` | 变量当前值 | 变量不存在时 `unknown-variable`，**不是返回 0** |
| `setVariable` | `{ id, value }` | — | 写同值不产生 `variableChange` |
| `subscribe` | `{ events? }` | — | 省略 `events` = 全订 |
| `screenshot` | — | `{ dataUrl }` | **可能不存在**，先 `can('screenshot')` |
| `goToStep` | `{ step }` | — | **可能不存在** |
| `goToScene` | `{ sceneId }` | — | **v1.0 恒不存在**，见 §4 |

### 命令可能不存在，这是设计而不是缺陷

`player.commands` 是播放器**按它实际能做什么**算出来的。一条依赖注入不进来的命令
**不会出现在清单里**，而不是出现之后永远失败——后者会让 `can()` 返回 true 而调下去必错，
那是最难排查的一种。

```js
if (player.can('screenshot')) {
  const { dataUrl } = await player.screenshot()
}
```

---

## 3. 事件表

`player.on(name, handler)` 订阅，返回一个取消函数。**还要 `subscribe()` 一次**告诉播放器
你要哪些——`on` 是本地的，`subscribe` 是远端的过滤器。

| 事件 | payload | 什么时候 |
|---|---|---|
| `sceneReady` | — | 场景建好、资产加载完 |
| `click` | `{ nodeId, point?, distance? }` | 点中一个对象 |
| `hoverEnter` | `{ nodeId }` | 指针移入 |
| `hoverLeave` | `{ nodeId }` | 指针移出。**先 leave 后 enter** |
| `hotspotClick` | `{ hotspotId }` | 点中一个热点 |
| `animationEnd` | `{ animationId, completed }` | `completed: false` = 被打断的 |
| `variableChange` | `{ variableId, from, to }` | 值**真的变了**才发 |
| `timer` | `{ timerId, tick }` | 计时器 |
| `openLink` | `{ url, target }` | 场景里的规则要打开一个链接。**宿主决定要不要开** |
| `error` | `{ code, message? }` | 拒绝握手、跑不了、命令失败 |

---

## 4. 版本协商

SDK 里写着 `SUPPORTED_PROTOCOLS`，播放器在 `ready` 里报自己的 `protocol`。对不上时
`mount()` reject 一个 `protocol-mismatch`。

**SDK 不 import 播放器的协议常量**：它会被拷进你的页面、与播放器分别升级。
一致性由我们这边的测试保证（读 SDK 源码文本比对），不由「两边同时发布」保证。

**协议版本只在不兼容变更时 +1。** 新增一条命令不算不兼容——它只是出现在
`ready.commands` 里，老宿主看不见也不会调。`goToScene` 就是按这个规则先占了名字：
协议里有它，v1.0 的 `ready.commands` 里没有，v1.5 接上多场景时**协议号一个数都不用动**。

---

## 5. `pause()` 不是唯一的开关

播放器实际跑不跑，是三个输入量的**与**：

```
宿主要不要播（pause/resume） && 标签页可见 && 播放器在视口里
```

所以 `resume()` 之后画面**未必**动——标签页在后台或者播放器滚出屏幕时它仍然停着。
反过来，标签页从后台切回来**不会**覆盖你的 `pause()`。

---

## 6. origin 策略

播放器只跟白名单里的 origin 说话。白名单是部署目录里的 `embed-policy.json`，样例见
`deploy/embed-policy.example.json`。

- 精确：`https://customer.example`
- 最左单标签通配：`https://*.customer.example` —— 匹配 `a.customer.example`，
  **不匹配** `a.b.customer.example`，**也不匹配**裸域
- 显式全通：`"*"`
- scheme 必须 https（localhost / 127.0.0.1 例外）

**读不懂的配置 → 谁都不许嵌，不是全通。** 非白名单来源只会收到**一条** `denied`，
之后完全沉默（防反射放大）。

### 自己传 `sandbox` 的话，`allow-same-origin` 不能省

默认值是 `'allow-scripts allow-same-origin'`。想收紧的话请注意：**去掉
`allow-same-origin` 播放器就起不来**——iframe 会落进一个不透明源，于是它的模块脚本
对自己的服务器都算跨源而被 CORS 拦下，`?src=` 也会被播放器自己的同源检查判成跨源。
症状是你等满超时拿到 `timeout`，而播放器那边一行日志都没有。

它不会让 iframe 拿到**你的**权限：`allow-same-origin` 给的是 iframe 自己那个源的权限。

---

## 7. 样板宿主页

[`samples/host-demo/index.html`](../samples/host-demo/index.html)。它零外链、零依赖，
把它扔进任何一台静态服务器都能跑。§1 的快速开始片段与那个文件里的**逐字相同**，
由一条测试盯着。
