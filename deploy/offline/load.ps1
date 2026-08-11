# T-293 · 离线包的载入脚本（Windows）。载入与启动.md 的可执行版本。
#
#   .\load.ps1                # 校验 → 载入镜像 → 起容器 → 验证
#   .\load.ps1 -VerifyOnly    # 只校验，不动机器
#   .\load.ps1 -NodeOnly      # 不用 Docker，直接起 serve.mjs

[CmdletBinding()]
param(
  [int]$Port = 8080,
  [switch]$VerifyOnly,
  [switch]$NodeOnly
)

$ErrorActionPreference = 'Stop'
$tag = 'web3d-deploy:offline'

# ── 1 · 校验。拷贝断一次、U 盘掉一位，后面的现象就没法解释了 ────────────────
Write-Host '1 · 校验 SHA256SUMS …'
$bad = 0
$checked = 0
foreach ($line in Get-Content .\SHA256SUMS) {
  if (-not $line.Trim()) { continue }
  $parts = $line -split '\s{2,}', 2
  $want = $parts[0]
  $path = $parts[1]
  if (-not (Test-Path $path)) { Write-Host "  缺文件 $path"; $bad++; continue }
  $got = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
  $checked++
  if ($got -ne $want.ToLower()) { Write-Host "  校验失败 $path"; $bad++ }
}
if ($checked -lt 5) { throw "只校验了 $checked 个文件，SHA256SUMS 多半是空的" }
if ($bad -gt 0) { throw "$bad 个文件校验失败。别往下走——重新拷一遍。" }
Write-Host "  $checked 个文件全部 OK"

if ($VerifyOnly) { Write-Host '只校验，到此为止。'; return }

# ── 2 · 只有 Node 的那条路 ────────────────────────────────────────────────
if ($NodeOnly) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '找不到 node。' }
  Write-Host "2 · 起 serve.mjs（端口 $Port，Ctrl+C 停）…"
  & node .\serve.mjs --root=.\site --port=$Port
  return
}

# ── 3 · 有容器运行时的那条路 ──────────────────────────────────────────────
$rt = $null
if (Get-Command docker -ErrorAction SilentlyContinue) { $rt = 'docker' }
elseif (Get-Command podman -ErrorAction SilentlyContinue) { $rt = 'podman' }
if (-not $rt) { throw '既没有 docker 也没有 podman。用 .\load.ps1 -NodeOnly 走纯 Node 那条路。' }

Write-Host "2 · $rt load -i image.tar …"
& $rt load -i image.tar

Write-Host "3 · 起容器（端口 $Port）…"
& $rt rm -f web3d 2>$null | Out-Null
& $rt run -d --name web3d -p "$($Port):8080" --restart=unless-stopped $tag | Out-Null

Write-Host '4 · 验证 /healthz …'
for ($i = 0; $i -lt 30; $i++) {
  try {
    $body = (Invoke-WebRequest "http://127.0.0.1:$Port/healthz" -UseBasicParsing -TimeoutSec 2).Content
    if ($body.Trim() -eq 'ok') {
      Write-Host "装好了。浏览器打开 http://<这台机器的地址>:$Port/"
      Write-Host '**别忘了再开一次 /player/** —— 两个都能开才算好。'
      return
    }
  } catch { Start-Sleep -Seconds 1 }
}
throw "起来了但 /healthz 30 秒没通。看日志：$rt logs web3d"
