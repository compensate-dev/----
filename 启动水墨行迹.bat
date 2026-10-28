@echo off
rem Ink Landscape one-click launcher: starts local server if needed, then opens the page.
rem file:// double-click can NEVER load image textures into WebGL (browser security),
rem so always enter the site through this launcher.
cd /d "%~dp0"
set PORT=8131
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=New-Object Net.Sockets.TcpClient; $ok=$false; try{$c.Connect('127.0.0.1',%PORT%);$ok=$true}catch{}; try{$c.Close()}catch{}; if($ok){Write-Output 'ALREADY RUNNING'}else{Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0_server2.ps1'}"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/map.html?v=f12"
