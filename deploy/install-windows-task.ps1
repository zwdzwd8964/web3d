# T-293 · Windows 计划任务安装脚本 · Web3D 纯进程部署
#
# 给「Windows 机器上只有 Node」的那一档用。**用计划任务而不是 Windows 服务**：
# 把一个 Node 进程做成真正的服务需要 nssm / winsw 之类的第三方封装器，而这份部署的
# 前提就是断网机器上装不了额外东西。计划任务是系统自带的、开机自启的、能重启的。
#
# 用法（管理员 PowerShell）：
#   .\deploy\install-windows-task.ps1 -SiteRoot 'C:\w3\site'
#   .\deploy\install-windows-task.ps1 -SiteRoot 'C:\w3\site' -Port 80
#   .\deploy\install-windows-task.ps1 -Uninstall
#
# 装完之后验证：
#   Invoke-WebRequest http://127.0.0.1:8080/healthz -UseBasicParsing | Select-Object -Expand Content

[CmdletBinding()]
param(
  # 站点根目录，里面要有 index.html 与 player\index.html。
  [string]$SiteRoot,
  [int]$Port = 8080,
  [string]$TaskName = 'Web3D 静态站点',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "已卸载计划任务「$TaskName」。"
  } else {
    Write-Host "计划任务「$TaskName」本来就不存在，什么都没做。"
  }
  return
}

# ── 前置检查。**每一条都直接退出，不给警告。** ────────────────────────────────
# 一个「警告之后继续」的安装脚本，会在半年后变成一台「装过了但没在跑」的机器。

if (-not $SiteRoot) {
  throw "必须给 -SiteRoot。例：.\deploy\install-windows-task.ps1 -SiteRoot 'C:\w3\site'"
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  throw "找不到 node。请先装 Node（本项目在 24 上开发），或者把它加进 PATH。"
}

$SiteRoot = (Resolve-Path $SiteRoot).Path
if (-not (Test-Path (Join-Path $SiteRoot 'index.html'))) {
  throw "站点根目录 $SiteRoot 里没有 index.html。这多半不是构建产物目录。"
}
if (-not (Test-Path (Join-Path $SiteRoot 'player\index.html'))) {
  # 播放器缺了的话，发布出来的 .w3p 打不开——而编辑器本身看起来完全正常。
  throw "站点根目录 $SiteRoot 里没有 player\index.html。播放器没被一起部署，发布出来的东西打不开。"
}

$serve = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy\serve.mjs'
if (-not (Test-Path $serve)) {
  throw "找不到 $serve。请在仓库根目录（或产物目录）下运行本脚本。"
}

# ── 装 ────────────────────────────────────────────────────────────────────────

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$serve`" --root=`"$SiteRoot`" --port=$Port"

# 开机就起，且不依赖有人登录。
$trigger = New-ScheduledTaskTrigger -AtStartup

# SYSTEM 账号。与 systemd 那份不同——Windows 上给静态服务器建一个专用低权限账号
# 需要额外的账号管理流程，而这一档部署的前提是「现场只有一个人、一台机器、半小时」。
# 代价写在这里：**这个进程的权限比它需要的大**。它只读 $SiteRoot，但它能读的更多。
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)   # 0 = 不限时。它是常驻进程，不是批处理。

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "计划任务「$TaskName」已存在，先卸载再装。"
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "装好了。站点根目录：$SiteRoot"
Write-Host "验证（等一两秒再跑）："
Write-Host "  Invoke-WebRequest http://127.0.0.1:$Port/healthz -UseBasicParsing | Select-Object -Expand Content"
Write-Host ""
Write-Host "卸载：.\deploy\install-windows-task.ps1 -Uninstall"
