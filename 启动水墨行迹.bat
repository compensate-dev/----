@echo off
rem Ink Landscape one-click launcher: starts local server if needed, then opens the page.
rem file:// double-click can NEVER load image textures into WebGL (browser security),
rem so always enter the site through this launcher.
rem 一键启动水墨行迹：先探测 8131 端口是否已有服务，没有就以隐藏窗口拉起 _server2.ps1，最后打开地图页。
rem 切到脚本所在目录，保证 _server2.ps1 等相对路径能找到。
cd /d "%~dp0"
rem 服务端口，与 _server2.ps1 保持一致；下面探测与打开页面都用这个变量。
set PORT=8131
rem 探测端口：能连上说明服务已在运行，跳过启动；连不上则另起一个隐藏的 PowerShell 进程跑服务器脚本。
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=New-Object Net.Sockets.TcpClient; $ok=$false; try{$c.Connect('127.0.0.1',%PORT%);$ok=$true}catch{}; try{$c.Close()}catch{}; if($ok){Write-Output 'ALREADY RUNNING'}else{Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0_server2.ps1'}"
rem 留两秒给服务器开始监听，再拉起浏览器；/nobreak 表示这两秒按键也不能跳过。
timeout /t 2 /nobreak >nul
rem 用默认浏览器打开水墨行迹页，必须走 http:// 才能把贴图载入 WebGL。
start "" "http://127.0.0.1:%PORT%/map.html?v=f52"
