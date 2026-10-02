$ErrorActionPreference = "Stop"
function Zh([string]$escaped) { [regex]::Unescape($escaped) }

$appFolderName = -join ([char[]](0x6C42, 0x804C, 0x5DE5, 0x4F5C, 0x53F0))
$appDataRoot = Join-Path $env:LOCALAPPDATA $appFolderName
$runtimeDirectory = Join-Path $appDataRoot "runtime"
$tokenFile = Join-Path $runtimeDirectory "control-token.txt"
$pidFile = Join-Path $runtimeDirectory "service.pid"

if (-not (Test-Path -LiteralPath $tokenFile)) {
    Write-Host (Zh '\u672c\u673a\u670d\u52a1\u5f53\u524d\u672a\u8fd0\u884c\u3002')
    exit 0
}

$controlToken = (Get-Content -Raw -LiteralPath $tokenFile).Trim()

try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:41823/api/system/stop" -Headers @{ "x-control-token" = $controlToken } -ContentType "application/json" -Body "{}" -TimeoutSec 3 | Out-Null
} catch {
    throw (Zh '\u672c\u673a\u670d\u52a1\u672a\u80fd\u5b89\u5168\u505c\u6b62\u3002\u8bf7\u4fdd\u7559\u6b64\u7a97\u53e3\uff0c\u67e5\u770b\u968f\u5305\u4f7f\u8bf4\u660e\uff0c\u5fc5\u8981\u65f6\u91cd\u542f\u0020\u0057\u0069\u006e\u0064\u006f\u0077\u0073\u0020\u540e\u518d\u8bd5\u3002')
}

Start-Sleep -Milliseconds 500
Remove-Item -LiteralPath $tokenFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Write-Host (Zh '\u672c\u673a\u670d\u52a1\u5df2\u505c\u6b62\u3002')
