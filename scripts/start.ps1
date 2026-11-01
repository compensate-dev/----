# 一江春水 · 本地启动 / 自检
# 用法：powershell -File scripts\start.ps1          启动服务（http://localhost:53422）
#       powershell -File scripts\start.ps1 test     只跑单元测试，不起服务
#
# 说明：本机 Node 是便携版（LOCALAPPDATA\nodejs），没进系统 PATH，这里直接取绝对路径调用。

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# 便携 Node 路径：装到别处的话改这一行即可；找不到就退回系统 PATH 里的 node
$node = Join-Path $env:LOCALAPPDATA "nodejs\node-v26.13.0-win-x64\node.exe"
if (-not (Test-Path $node)) { $node = "node" }

Push-Location $root
try {
  if ($args -contains "test") {
    & $node --test tests\ai-guide.test.ts
    return
  }
  if (-not (Test-Path ".env.local")) {
    Write-Host "缺少 .env.local：请先写入 ZHIPU_API_KEY=你的智谱 key" -ForegroundColor Yellow
    return
  }
  & $node server\index.mjs
}
finally {
  Pop-Location
}
