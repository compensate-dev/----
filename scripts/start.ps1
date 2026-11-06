# 一江春水 · 本地启动 / 自检
# 用法：powershell -File scripts\start.ps1          启动服务（http://localhost:53422）
#       powershell -File scripts\start.ps1 test     只跑单元测试，不起服务
#
# 本机 Node 是便携版（LOCALAPPDATA\nodejs），没进系统 PATH，这里直接取绝对路径调用。
# 下载版只需本地托管页面；没有本地密钥时由服务转发到比赛接口，不需随包提供密钥。

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# 比赛压缩包可附带 runtime\node.exe；本机开发则沿用便携安装或系统 Node。
$node = Join-Path $root "runtime\node.exe"
if (-not (Test-Path $node)) {
  $node = Join-Path $env:LOCALAPPDATA "nodejs\node-v26.13.0-win-x64\node.exe"
}
if (-not (Test-Path $node)) {
  $systemNode = Get-Command node -ErrorAction SilentlyContinue
  if ($systemNode) { $node = $systemNode.Source }
  else {
    Write-Host "未找到 Node.js。请将 Node 22.18+ 放入 runtime\node.exe，或先安装 Node.js。" -ForegroundColor Yellow
    return
  }
}

Push-Location $root
try {
  if ($args -contains "test") {
    & $node --test tests\ai-guide.test.ts
    return
  }
  if (-not $env:LIYU_REMOTE_GUIDE_URL) {
    $env:LIYU_REMOTE_GUIDE_URL = "https://dazzling-wholeness-production-72f5.up.railway.app/api/guide"
  }
  & $node server\index.mjs
}
finally {
  Pop-Location
}
