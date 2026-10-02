$ErrorActionPreference = "Stop"
function Zh([string]$escaped) { [regex]::Unescape($escaped) }

$projectRoot = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $projectRoot "runtime\node\node.exe"
$codexRuntimeNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$bundledServerEntry = Join-Path $projectRoot "app\server.mjs"
$sourceServerEntry = Join-Path $projectRoot "apps\local-service\dist\server.js"
$bundledWebRoot = Join-Path $projectRoot "web"
$sourceWebRoot = Join-Path $projectRoot "apps\web\dist"
$fontFile = Join-Path $projectRoot "assets\fonts\NotoSansCJKsc-Regular.otf"
$appFolderName = -join ([char[]](0x6C42, 0x804C, 0x5DE5, 0x4F5C, 0x53F0))
$appDataRoot = Join-Path $env:LOCALAPPDATA $appFolderName
$runtimeDirectory = Join-Path $appDataRoot "runtime"
$profileDirectory = Join-Path $appDataRoot "browser-profile"
$tokenFile = Join-Path $runtimeDirectory "control-token.txt"
$pidFile = Join-Path $runtimeDirectory "service.pid"
$standardLog = Join-Path $runtimeDirectory "service.log"
$errorLog = Join-Path $runtimeDirectory "service-error.log"

if (Test-Path -LiteralPath $bundledNode) {
    $nodePath = $bundledNode
} else {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) {
        $nodePath = $nodeCommand.Source
    } elseif (Test-Path -LiteralPath $codexRuntimeNode) {
        # The source workspace can reuse Codex Node.js. The final package uses runtime/node.
        $nodePath = $codexRuntimeNode
    } else {
        throw (Zh '\u7f3a\u5c11\u8fd0\u884c\u73af\u5883\uff0c\u8bf7\u91cd\u65b0\u89e3\u538b\u5b8c\u6574\u6d4b\u8bd5\u5305\u540e\u91cd\u8bd5\u3002')
    }
}

if (Test-Path -LiteralPath $bundledServerEntry) {
    $serverEntry = $bundledServerEntry
    $webRoot = $bundledWebRoot
} else {
    $serverEntry = $sourceServerEntry
    $webRoot = $sourceWebRoot
}
$webEntry = Join-Path $webRoot "index.html"

if (-not (Test-Path -LiteralPath $serverEntry) -or -not (Test-Path -LiteralPath $webEntry)) {
    throw (Zh '\u7a0b\u5e8f\u6587\u4ef6\u4e0d\u5b8c\u6574\uff0c\u8bf7\u91cd\u65b0\u89e3\u538b\u5b8c\u6574\u6d4b\u8bd5\u5305\u540e\u91cd\u8bd5\u3002')
}

$edgeCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe")
)
$edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edgePath) {
    throw (Zh '\u672a\u627e\u5230\u0020\u004d\u0069\u0063\u0072\u006f\u0073\u006f\u0066\u0074\u0020\u0045\u0064\u0067\u0065\uff0c\u8bf7\u5b89\u88c5\u6216\u4fee\u590d\u0020\u0045\u0064\u0067\u0065\u0020\u540e\u91cd\u8bd5\u3002')
}

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null

try {
    $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:41823/api/health" -TimeoutSec 2
    if ($health.status -eq "ok" -and $health.appName -eq $appFolderName) {
        $listener = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 41823 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        $runningService = if ($listener) { Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue } else { $null }
        $samePackage = $runningService -and $runningService.CommandLine -and
            $runningService.CommandLine.IndexOf($serverEntry, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $runningService.CommandLine.IndexOf($webRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
        if (-not $samePackage) { throw "OTHER_PACKAGE_RUNNING" }
        Start-Process -FilePath $edgePath -ArgumentList @("--app=http://127.0.0.1:41823", "--user-data-dir=$profileDirectory", "--no-first-run")
        exit 0
    }
    throw "PORT_41823_OCCUPIED"
} catch {
    if ($_.Exception.Message -eq "OTHER_PACKAGE_RUNNING") {
        throw (Zh '\u5df2\u6709\u5176\u4ed6\u7248\u672c\u7684\u6c42\u804c\u5de5\u4f5c\u53f0\u5728\u8fd0\u884c\u3002\u8bf7\u5148\u4f7f\u7528\u8be5\u7248\u672c\u7684\u505c\u6b62\u811a\u672c\uff0c\u518d\u542f\u52a8\u5f53\u524d\u7248\u672c\u3002')
    }
    if ($_.Exception.Message -eq "PORT_41823_OCCUPIED") {
        throw (Zh '\u0034\u0031\u0038\u0032\u0033\u0020\u7aef\u53e3\u5df2\u88ab\u5360\u7528\u3002\u8bf7\u5173\u95ed\u5360\u7528\u8be5\u7aef\u53e3\u7684\u7a0b\u5e8f\u540e\u91cd\u8bd5\uff1b\u672c\u7a0b\u5e8f\u4e0d\u4f1a\u81ea\u52a8\u7ed3\u675f\u5176\u4ed6\u8fdb\u7a0b\u3002')
    }
}

$occupied = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 41823 -State Listen -ErrorAction SilentlyContinue
if ($occupied) { throw (Zh '\u0034\u0031\u0038\u0032\u0033\u0020\u7aef\u53e3\u5df2\u88ab\u5360\u7528\u3002\u8bf7\u5173\u95ed\u5360\u7528\u8be5\u7aef\u53e3\u7684\u7a0b\u5e8f\u540e\u91cd\u8bd5\uff1b\u672c\u7a0b\u5e8f\u4e0d\u4f1a\u81ea\u52a8\u7ed3\u675f\u5176\u4ed6\u8fdb\u7a0b\u3002') }

$controlToken = [guid]::NewGuid().ToString("N")
Set-Content -LiteralPath $tokenFile -Value $controlToken -Encoding ASCII

Write-Host (Zh '\u6b63\u5728\u542f\u52a8\u672c\u673a\u670d\u52a1\u2026')
$serviceArguments = @($serverEntry, "--production", "--control-token-file", $tokenFile, "--web-root", $webRoot)
if (Test-Path -LiteralPath $fontFile) {
    $serviceArguments += @("--font-file", $fontFile)
}
$serviceProcess = Start-Process -FilePath $nodePath -ArgumentList $serviceArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $standardLog -RedirectStandardError $errorLog -PassThru
Set-Content -LiteralPath $pidFile -Value $serviceProcess.Id -Encoding ASCII

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 250
    $serviceProcess.Refresh()
    if ($serviceProcess.HasExited) {
        break
    }
    try {
        $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:41823/api/health" -TimeoutSec 1
        if ($health.status -eq "ok" -and $health.appName -eq $appFolderName) {
            $ready = $true
            break
        }
    } catch {
    }
}

if (-not $ready) {
    throw (Zh '\u672c\u673a\u670d\u52a1\u542f\u52a8\u5931\u8d25\u3002\u8bf7\u67e5\u770b\u968f\u5305\u4f7f\u7528\u8bf4\u660e\u4e2d\u7684\u6545\u969c\u8bca\u65ad\u7ae0\u8282\uff0c\u7136\u540e\u91cd\u8bd5\u3002')
}

Write-Host (Zh '\u670d\u52a1\u5df2\u5c31\u7eea\uff0c\u6b63\u5728\u6253\u5f00\u0020\u004d\u0069\u0063\u0072\u006f\u0073\u006f\u0066\u0074\u0020\u0045\u0064\u0067\u0065\u2026')
Start-Process -FilePath $edgePath -ArgumentList @("--app=http://127.0.0.1:41823", "--user-data-dir=$profileDirectory", "--no-first-run")
