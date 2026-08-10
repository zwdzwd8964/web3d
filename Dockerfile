# Web3D 工具引擎 —— 单镜像静态部署。
#
# 这个仓库没有后端：编辑器和播放器都是纯静态 SPA（宪法 C6 —— 运行时不发任何
# 外部请求）。所以镜像只做两件事：把 pnpm workspace 构建成两份 bundle，然后用
# nginx 从同一个 origin 把它们发出去。
#
#   /          编辑器（@w3/editor）
#   /player/   播放器（@w3/player，?src= 只接受同源相对路径）
#   /vendor/   Draco / KTX2 解码器，自托管（ADR-0012 的可选显式路径）

# ---- 构建阶段 -------------------------------------------------------------
# Debian 而不是 alpine：esbuild / rollup 的原生二进制走 glibc 变体，跟本地
# （Windows + Node 24）的 lockfile 解析结果一致，少一层 musl 的意外。
FROM node:24-slim AS build

# CI=1 让 corepack 不弹交互确认，同时 pnpm 默认 frozen-lockfile。
#
# verify_deps_before_run=false 是 T-210 的断网 job 查出来的：**pnpm 11 在执行任何脚本
# 之前会核对 node_modules 与 lockfile，那次核对会发起一次带 supply-chain 校验的
# `pnpm install`，两者都要联网。** 联网构建时它只是慢；**在客户的内网机器上，
# `pnpm build` 这一行会挂在 registry 重试上**，而那台机器永远等不到网。
# 这一行让这份交付物本身能在断网环境里构建。
ENV CI=1 \
    pnpm_config_verify_deps_before_run=false
RUN corepack enable

WORKDIR /src
COPY . .

RUN pnpm install --frozen-lockfile

# 播放器挂在 /player/ 下，用 CLI 的 --base 覆盖，不动 vite.config.ts ——
# 那份配置是 dev server 的唯一事实来源，部署路径不该渗进去。
RUN pnpm -r --filter "./packages/**" build \
 && pnpm -F @w3/player build:app --base=/player/ \
 && pnpm -F @w3/player build:embed

# ---- 运行时 ---------------------------------------------------------------
FROM nginx:alpine AS runtime

# Railway 注入 $PORT；nginx 官方 entrypoint 用 envsubst 填进模板。
# NGINX_ENVSUBST_FILTER 限定只替换 PORT，否则 $uri 之类的 nginx 变量会被抹掉。
ENV PORT=8080 \
    NGINX_ENVSUBST_FILTER=PORT

COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template

COPY --from=build /src/packages/editor/dist/ /usr/share/nginx/html/
COPY --from=build /src/packages/player/dist/ /usr/share/nginx/html/player/
COPY --from=build /src/vendor/               /usr/share/nginx/html/vendor/

EXPOSE 8080
