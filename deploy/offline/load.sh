#!/usr/bin/env sh
# T-293 · 离线包的载入脚本（Linux / macOS）。载入与启动.md 的可执行版本。
#
#   sh load.sh            # 校验 → 载入镜像 → 起容器 → 验证
#   sh load.sh --verify   # 只校验，不动机器
#   sh load.sh --node     # 不用 Docker，直接起 serve.mjs
set -eu

PORT="${PORT:-8080}"
TAG="web3d-deploy:offline"

say() { printf '%s\n' "$*"; }

# ── 1 · 校验。拷贝断一次、U 盘掉一位，后面的现象就没法解释了 ──────────────
say '1 · 校验 SHA256SUMS …'
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c SHA256SUMS
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c SHA256SUMS
else
  say '找不到 sha256sum / shasum，跳过校验。**这不是通过，是没查**。'
fi

case "${1:-}" in
  --verify) say '只校验，到此为止。'; exit 0 ;;
esac

# ── 2 · 只有 Node 的那条路 ──────────────────────────────────────────────
case "${1:-}" in
  --node)
    command -v node >/dev/null 2>&1 || { say '找不到 node。'; exit 1; }
    say "2 · 起 serve.mjs（端口 $PORT，Ctrl+C 停）…"
    exec node serve.mjs --root=./site --port="$PORT"
    ;;
esac

# ── 3 · 有容器运行时的那条路。podman 与 docker 命令逐字相同 ─────────────
if command -v docker >/dev/null 2>&1; then RT=docker
elif command -v podman >/dev/null 2>&1; then RT=podman
else
  say '既没有 docker 也没有 podman。用 `sh load.sh --node` 走纯 Node 那条路。'
  exit 1
fi

say "2 · $RT load -i image.tar …"
"$RT" load -i image.tar

say "3 · 起容器（端口 $PORT）…"
"$RT" rm -f web3d >/dev/null 2>&1 || true
"$RT" run -d --name web3d -p "$PORT:8080" --restart=unless-stopped "$TAG"

say '4 · 验证 /healthz …'
i=0
while [ "$i" -lt 30 ]; do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    say "装好了。浏览器打开 http://<这台机器的地址>:$PORT/"
    say "**别忘了再开一次 /player/** —— 两个都能开才算好。"
    exit 0
  fi
  i=$((i + 1)); sleep 1
done

say "起来了但 /healthz 30 秒没通。看日志：$RT logs web3d"
exit 1
