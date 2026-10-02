@echo off
setlocal
title Career Workbench Launcher
set "CAREER_START_SCRIPT=%~dp0scripts\start-app.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { & $env:CAREER_START_SCRIPT } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo.
  powershell.exe -NoProfile -Command "Write-Host ([regex]::Unescape('\u8bf7\u6839\u636e\u4e0a\u65b9\u9519\u8bef\u63d0\u793a\u5904\u7406\uff1b\u6545\u969c\u8bf4\u660e\u8bf7\u89c1\u968f\u5305\u4f7f\u7528\u8bf4\u660e\u3002')"
  pause
  exit /b 1
)
