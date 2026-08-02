# Railway 试部署 · 操作手册

> 背景与取舍见 [ADR-0019](../docs/adr/0019-railway-试部署实例.md)。
> 一句话：**一个 Railway 服务，同一个域名下 `/` 是编辑器、`/player/` 是播放器。**
> 这是试部署/演示用的实例，不是交付形态（交付仍是拷 `dist/` 进内网 Web 服务器）。

## 开实例（Railway 控制台，约 3 分钟）

1. 打开 <https://railway.app> → **New Project** → **Deploy from GitHub repo** →
   选 `zwdzwd8964/web3d`（首次需要授权 Railway 访问该仓库）。
2. 进入创建出的服务 → **Settings → Source**，把分支切到你要部署的分支
   （当前配置所在分支：`claude/railway-instance-deployment-19f87r`；合并主干后用主干即可）。
3. 不需要填任何 Build/Start Command——仓库根的 `railway.json` 已钉死用 `Dockerfile`
   构建，健康检查走 `/healthz`。推分支即触发构建，首次构建约 3–5 分钟。
4. **Settings → Networking → Generate Domain**，若询问端口填 `8080`。
5. 完成。访问：
   - `https://<域名>/` —— 编辑器
   - `https://<域名>/player/` —— 播放器
   - `https://<域名>/player/bench.html` —— 基准测试页（T-110）

不需要配置任何环境变量：服务器读 Railway 注入的 `PORT`，其余全有默认值。

## 实地测试路径

1. 打开 `/`（编辑器），走黄金路径：导入/摆放 → 材质灯光 → 规则 → 预览。
2. 点「发布并下载 .w3p」，得到包文件。
3. 打开 `/player/`，把 `.w3p` 拖进页面（或用文件选择器），逐项核对行为一致。
4. 断网复测：加载完成后断开网络，编辑器与播放器应继续可用（C6）；
   刷新页面需要重新联网取静态文件，这是正常的——「断网能跑」指运行时零外部请求。

注意：场景数据存在**访问者浏览器的 IndexedDB** 里。换设备/换浏览器看不到彼此的
场景，服务器上也不落任何用户数据——试部署实例只发静态文件。

## 用 Railway CLI 代替控制台（可选）

```bash
npm i -g @railway/cli
railway login
railway init          # 新建项目（或 railway link 关联已有项目）
railway up            # 用本地工作区直接构建部署（同样走 Dockerfile）
railway domain        # 生成公网域名
```

## 本地验证（推 Railway 之前）

不装 Docker，直接跑真实产物 + 真实服务器：

```bash
pnpm install
pnpm -F @w3/editor build
pnpm -F @w3/player exec vite build --base=/player/
EDITOR_DIR=packages/editor/dist PLAYER_DIR=packages/player/dist \
  node deploy/server.mjs
# 打开 http://127.0.0.1:8080/ 与 http://127.0.0.1:8080/player/
```

装了 Docker 的话，跑与 Railway 完全相同的路径：

```bash
docker build -t web3d-test .
docker run --rm -p 8080:8080 web3d-test
```

## 已知边界

- player 的 `--base=/player/` 只存在于 Dockerfile 的构建命令里，本地
  `pnpm dev` / `pnpm build` / CI 完全不受影响。
- 自写静态服务器没有 Range/ETag/限流（见 ADR-0019「代价」）；试部署够用，
  当生产用就该换 nginx/Caddy。
- 删实例 = Railway 控制台删掉该 Service/Project 即可，仓库里不残留任何状态。
