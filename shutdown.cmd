@echo off
setlocal
title Career Workbench Shutdown
set "CAREER_STOP_SCRIPT=%~dp0scripts\stop-app.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { & $env:CAREER_STOP_SCRIPT } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo.
  powershell.exe -NoProfile -Command "Write-Host ([regex]::Unescape('\u672c\u673a\u670d\u52a1\u672a\u80fd\u5b89\u5168\u505c\u6b62\uff0c\u8bf7\u67e5\u770b\u4e0a\u65b9\u9519\u8bef\u548c\u968f\u5305\u4f7f\u7528\u8bf4\u660e\u3002')"
  pause
  exit /b 1
)
