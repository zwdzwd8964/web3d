# 部署

> **这份文档管的是「怎么把它发出去」，不管「它对不对」。**
> 两句话必须先读，它们是本文件里最容易被误解的两处：
>
> 1. **镜像构建不跑任何检查。** `Dockerfile` 全文只有 `pnpm install` 与 `pnpm build`，
>    没有 `check:constitution`、没有 `test`、没有 `verify`。**镜像构建成功 ≠ 通过验收。**
>    质量由 CI（`.github/workflows/ci.yml`）保证，两者是两回事，不许互相顶替。
> 2. **`docker build` 需要联网，因此它不能充当断网构建的证据。** 它会拉基础镜像、拉整个
>    npm 依赖树。C6 的「断网能跑」由 CI 的 `offline` job 覆盖（**由 T-210 交付；本文写作时
>    该 job 尚未存在**——这一句到 T-210 落地那天要改成引用具体的 job 名）。

---

## 1 · 选哪种形态

```
                      ┌─ 客户能连公网、你要一个能点开的链接
                      │      → 「云托管」（§3）
                      │
 要部署给谁？ ────────┼─ 客户在内网 / 有自己的 K8s / 要自己扛运维
                      │      → 「自建容器」（§4）
                      │
                      └─ 只是给人看一眼，或者随构件一起交付
                             → 「纯静态托管」（§5）
```

三种形态**共用同一份构建产物**，区别只在谁来发这些字节。没有任何一种需要数据库、
需要密钥、或需要运行时的出网权限——本仓库没有后端，两个包都是纯静态 SPA（宪法 C6）。

## 2 · 产物长什么样

| 路径 | 内容 | 来源 |
|---|---|---|
| `/` | 编辑器 | `packages/editor/dist/` |
| `/player/` | 播放器 | `packages/player/dist/`，**构建时必须带 `--base=/player/`** |
| `/vendor/` | Draco / KTX2 解码器 | 仓库里的 `vendor/`（ADR-0012 的可选显式路径） |
| `/healthz` | 健康检查，返回 `ok` | `deploy/nginx.conf.template` |

`--base=/player/` 用 CLI 参数而不是写进 `packages/player/vite.config.ts`：那份配置是
dev server 的唯一事实来源，部署路径不该渗进去。

⚠ **`Dockerfile` 会把播放器构建两遍**（`pnpm -r --filter "./packages/**" build` 已经覆盖
`@w3/player`，随后 `-F @w3/player build --base=/player/` 再来一次）。第二遍覆盖第一遍，
结果是对的，代价是一次多余的构建。§6 的验证命令里有一条专门证伪「第一遍的产物漏了出去」。

## 3 · 云托管（Railway）

配置即代码，全部在 `railway.toml`：Dockerfile 构建、`/healthz` 健康检查、失败重启三次。
**没有环境变量要配**——`$PORT` 由平台注入，`deploy/nginx.conf.template` 在容器启动时由
nginx 官方 entrypoint 的 `envsubst` 填进去（`NGINX_ENVSUBST_FILTER=PORT` 限定只替换它，
否则 `$uri` 这类 nginx 自己的变量会被一起抹掉）。

```bash
railway login                 # 浏览器授权，一次即可
railway init                  # 或 railway link，绑到已有项目
railway up                    # 上传上下文 → 远端按 Dockerfile 构建 → 部署
railway domain                # 分配一个 *.up.railway.app 域名
```

验证见 §6。

> **已实跑一次（2026-08-04 · T-221）。** 项目 `0729 3d engine`，域名
> `0729-3d-engine-production.up.railway.app`，§6 的五条命令全部通过——包括最后那条
> 「唯一能证伪的」：播放器的 HTML 引用的是 `/player/assets/…`，`--base` 没有漏。
> `/vendor/draco/gltf/draco_decoder.wasm` 的 `Content-Type` 实测是 `application/wasm`。

### 3.1 ⚠ 内网 / 断网机器上构建，必须多设一个环境变量

```bash
export pnpm_config_verify_deps_before_run=false
```

**`Dockerfile` 里已经设了这一行**，所以走容器路径的人不用管。手动在一台内网机器上跑
`pnpm build` 的人必须自己设，否则**会挂住**，且现象具有误导性。

原因（T-210 的断网 job 第一次跑就撞上了）：**pnpm 11 在执行任何脚本之前，会先核对
`node_modules` 与 lockfile 是否一致。那次核对会发起一次 `pnpm install`，install 里又带一次
supply-chain policy 校验——两者都要联网。** 也就是说 `pnpm build` 这条命令自己会去问
registry，跟你的代码一个字节都没关系。

**它在联网机器上完全看不出来**：本机 `~/.cache` 里有「N 小时前验过」的记录，直接走缓存。
一台全新的内网机器没有那条记录。实测现象是 431 个包轮流重试 registry，**卡 24 分 30 秒**
之后才报错。

顺手建议一起设 `pnpm_config_fetch_retries=0`：真的出网时**立刻**失败并点名是哪个包，
而不是重试半小时之后给你一个超时。

## 4 · 自建容器

```bash
docker build -t web3d:local .
docker run --rm -p 8080:8080 web3d:local
```

`PORT` 默认 8080；换端口用 `-e PORT=3000 -p 3000:3000`。
镜像里没有任何可写状态，可以随便横向扩，也可以只读挂载。

## 5 · 纯静态托管

不想要容器时，把两份 `dist/` 与 `vendor/` 按 §2 的路径摆好即可，任何静态服务器都行。
**三条必须自己接上**（`deploy/nginx.conf.template` 里已经写好，换服务器时照抄）：

- **SPA 回退**：`/` 与 `/player/` 各自回退到对应的 `index.html`，否则刷新即 404；
- **`.wasm` 的 MIME**：必须是 `application/wasm`，否则 Draco / KTX2 解码器加载失败；
- **`assets/` 长缓存**：Vite 产物带内容哈希，`immutable` 是安全的；`index.html` **不许**长缓存。

## 6 · 验证

部署完之后逐条跑，`<host>` 换成实际地址：

```bash
curl -fsS  <host>/healthz                       # 期望 ok
curl -fsSI <host>/                | head -1     # 期望 200
curl -fsSI <host>/player/         | head -1     # 期望 200
curl -fsSI <host>/vendor/draco/gltf/draco_decoder.wasm | grep -i content-type
                                                # 期望 application/wasm，不是 text/html
curl -fsS  <host>/player/         | grep -o '/player/assets/[^"]*' | head -3
                                                # 期望非空 —— 见下
```

**最后一条是唯一能证伪的那条。** 若 `--base=/player/` 漏了（或 §2 的那次重复构建把第一遍
的产物漏了出去），播放器的 HTML 会引用 `/assets/…` 而不是 `/player/assets/…`；页面照样返回
200，只是一片空白。**前四条命令在那种情况下全部通过**——这正是本仓库反复在杀的形状。

`.wasm` 那条同理：dev server 与很多静态托管的 SPA 兜底会对任何未命中路径回 `200` +
`index.html`，所以断言状态码毫无意义，要断言 `content-type`（实测证据见
`e2e/fixtures/requests.ts` 的注释与 T-218 的变异 ①′）。

## 7 · 升级与回滚

镜像无状态，升级就是重新构建再替换：

```bash
railway up                                # 云托管
docker build -t web3d:local . && docker run --rm -p 8080:8080 web3d:local   # 自建
```

回滚同理——Railway 的 Deployments 面板可以直接 redeploy 上一次；自建则用上一个镜像 tag。
**没有数据迁移要考虑**：用户的文档在浏览器的 IndexedDB 里（宪法 C7 的 `StorageProvider`），
不在服务器上。这也意味着**换域名 = 换 origin = 用户看不到自己的旧文档**，这一条要写进
交付说明，不是部署问题但会在部署当天被问到。
