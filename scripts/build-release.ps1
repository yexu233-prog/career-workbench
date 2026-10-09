param([string]$PackageName = "", [switch]$PublicRelease, [string]$ReleaseTag = "")

$ErrorActionPreference = "Stop"
if (-not $PackageName) {
    $releaseVersion = (Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) "package.json") -Raw | ConvertFrom-Json).version
    $PackageName = "career-workbench-" + $releaseVersion
}
if ($PackageName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$') { throw "Invalid test package name." }

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot "release"
$stagingRoot = Join-Path $releaseRoot (".staging-" + $PackageName + "-" + [guid]::NewGuid().ToString("N"))
$packageRoot = Join-Path $stagingRoot $PackageName
$zipPath = Join-Path $stagingRoot ($PackageName + ".zip")
$checksumPath = $zipPath + ".sha256"
$finalPackageRoot = Join-Path $releaseRoot $PackageName
$finalZipPath = Join-Path $releaseRoot ($PackageName + ".zip")
$finalChecksumPath = $finalZipPath + ".sha256"
$guideSourceName = "Windows" + (-join ([char[]](0x6D4B, 0x8BD5, 0x7248, 0x4F7F, 0x7528, 0x8BF4, 0x660E))) + ".md"
$guidePackageName = (-join ([char[]](0x4F7F, 0x7528, 0x8BF4, 0x660E))) + ".md"
$guideSource = Join-Path $projectRoot (Join-Path "docs" $guideSourceName)
$fontSource = Join-Path $projectRoot "assets\fonts\NotoSansCJKsc-Regular.otf"
$fontLicense = Join-Path $projectRoot "assets\fonts\OFL.txt"
$fontReadme = Join-Path $projectRoot "assets\fonts\README.md"

$bundledNode = Join-Path $projectRoot "runtime\node\node.exe"
$codexNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (Test-Path -LiteralPath $bundledNode) {
    $nodePath = $bundledNode
} else {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $nodePath = $nodeCommand.Source }
    elseif (Test-Path -LiteralPath $codexNode) { $nodePath = $codexNode }
    else { throw "Node.js 24 was not found; the test package cannot be built." }
}

if (-not (Test-Path -LiteralPath $fontSource) -or -not (Test-Path -LiteralPath $fontLicense) -or -not (Test-Path -LiteralPath $fontReadme)) {
    throw "The bundled Noto Sans SC font or its license is missing."
}
if (-not (Test-Path -LiteralPath $guideSource)) { throw "The Chinese user guide is missing." }
if (Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 41823 -State Listen -ErrorAction SilentlyContinue) {
    throw "Stop the running Career Workbench before building a release; the existing package will be retained."
}

$tsc = Join-Path $projectRoot "node_modules\typescript\bin\tsc"
$vitest = Join-Path $projectRoot "node_modules\vitest\vitest.mjs"
$vite = Join-Path $projectRoot "node_modules\vite\bin\vite.js"
$bundleScript = Join-Path $projectRoot "scripts\bundle-service.mjs"
function Assert-NodeRuntime([string]$Path) {
    $runtime = (& $Path -p "[process.versions.node, process.platform, process.arch].join('|')").Trim()
    if ($LASTEXITCODE -ne 0 -or $runtime -notmatch '^24\.[^|]+\|win32\|x64$') { throw "Node.js runtime must be Node 24 on win32 x64; got $runtime" }
}
Assert-NodeRuntime $nodePath

if ($PublicRelease) {
    & $nodePath (Join-Path $projectRoot "scripts\public-release-policy.mjs") $projectRoot $ReleaseTag
    if ($LASTEXITCODE -ne 0) { throw "Public release source validation failed; existing package remains available." }
    & (Join-Path (Split-Path -Parent $nodePath) "npm.cmd") audit --audit-level=high
    if ($LASTEXITCODE -ne 0) { throw "Dependency security audit failed; public release blocked." }
}


foreach ($config in @("packages\shared\tsconfig.json", "packages\domain\tsconfig.json", "packages\database\tsconfig.json", "apps\web\tsconfig.json", "apps\local-service\tsconfig.json")) {
    & $nodePath $tsc -p (Join-Path $projectRoot $config) --noEmit
    if ($LASTEXITCODE -ne 0) { throw "TypeScript validation failed: $config" }
}
& $nodePath $vitest run
if ($LASTEXITCODE -ne 0) { throw "Automated tests failed." }

foreach ($config in @("packages\shared\tsconfig.json", "packages\domain\tsconfig.json", "packages\database\tsconfig.json", "apps\local-service\tsconfig.json")) {
    & $nodePath $tsc -p (Join-Path $projectRoot $config)
    if ($LASTEXITCODE -ne 0) { throw "Production build failed: $config" }
}
Push-Location (Join-Path $projectRoot "apps\web")
try {
    & $nodePath $vite build
    if ($LASTEXITCODE -ne 0) { throw "Web production build failed." }
} finally { Pop-Location }

$tsx = Join-Path $projectRoot "node_modules\tsx\dist\cli.mjs"
& $nodePath $tsx --tsconfig (Join-Path $projectRoot "apps\web\tsconfig.json") (Join-Path $projectRoot "scripts\resume-template-regression.tsx")
if ($LASTEXITCODE -ne 0) { throw "Reference resume template Edge PDF regression failed." }

$normalizedReleaseRoot = [IO.Path]::GetFullPath($releaseRoot).TrimEnd('\') + '\'
foreach ($target in @($stagingRoot, $packageRoot, $zipPath, $checksumPath, $finalPackageRoot, $finalZipPath, $finalChecksumPath)) {
    $normalizedTarget = [IO.Path]::GetFullPath($target)
    if (-not $normalizedTarget.StartsWith($normalizedReleaseRoot, [StringComparison]::OrdinalIgnoreCase) -or $normalizedTarget -eq $normalizedReleaseRoot.TrimEnd('\')) {
        throw "Unsafe release output path: $target"
    }
}
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

New-Item -ItemType Directory -Path (Join-Path $packageRoot "app") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageRoot "web") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageRoot "runtime\node") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageRoot "assets\fonts") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageRoot "scripts") -Force | Out-Null

$serverBundle = Join-Path $packageRoot "app\server.mjs"
Push-Location $projectRoot
try {
    & $nodePath $bundleScript $serverBundle
    if ($LASTEXITCODE -ne 0) { throw "Local service bundling failed." }
} finally { Pop-Location }

Copy-Item -Path (Join-Path $projectRoot "apps\web\dist\*") -Destination (Join-Path $packageRoot "web") -Recurse -Force
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $packageRoot "runtime\node\node.exe") -Force
Copy-Item -LiteralPath $fontSource -Destination (Join-Path $packageRoot "assets\fonts\NotoSansCJKsc-Regular.otf") -Force
Copy-Item -LiteralPath $fontLicense -Destination (Join-Path $packageRoot "assets\fonts\OFL.txt") -Force
Copy-Item -LiteralPath $fontReadme -Destination (Join-Path $packageRoot "assets\fonts\README.md") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "scripts\start-app.ps1") -Destination (Join-Path $packageRoot "scripts\start-app.ps1") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "scripts\stop-app.ps1") -Destination (Join-Path $packageRoot "scripts\stop-app.ps1") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "startup.cmd") -Destination (Join-Path $packageRoot "startup.cmd") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "shutdown.cmd") -Destination (Join-Path $packageRoot "shutdown.cmd") -Force
$localizedStartName = (-join ([char[]](0x542F, 0x52A8, 0x6C42, 0x804C, 0x5DE5, 0x4F5C, 0x53F0))) + ".cmd"
$localizedStopName = (-join ([char[]](0x505C, 0x6B62, 0x6C42, 0x804C, 0x5DE5, 0x4F5C, 0x53F0))) + ".cmd"
Copy-Item -LiteralPath (Join-Path $projectRoot "startup.cmd") -Destination (Join-Path $packageRoot $localizedStartName) -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "shutdown.cmd") -Destination (Join-Path $packageRoot $localizedStopName) -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination (Join-Path $packageRoot "README.md") -Force
Copy-Item -LiteralPath $guideSource -Destination (Join-Path $packageRoot $guidePackageName) -Force

if ($PublicRelease) {
    & $nodePath (Join-Path $projectRoot "scripts\release-metadata.mjs") generate $packageRoot $nodePath --public $ReleaseTag
} else {
    & $nodePath (Join-Path $projectRoot "scripts\release-metadata.mjs") generate $packageRoot $nodePath
}
if ($LASTEXITCODE -ne 0) { throw "Release metadata, license catalog, or file manifest generation failed; previous package remains available." }
& $nodePath (Join-Path $projectRoot "scripts\verify-release.mjs") $packageRoot
if ($LASTEXITCODE -ne 0) { throw "Release package smoke checks failed; previous package remains available." }
& $nodePath (Join-Path $projectRoot "scripts\create-release-zip.mjs") $packageRoot $zipPath
if ($LASTEXITCODE -ne 0) { throw "ZIP creation failed; previous package remains available." }
$zipStream = [System.IO.File]::OpenRead($zipPath)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $hash = [System.BitConverter]::ToString($sha256.ComputeHash($zipStream)).Replace("-", "").ToLowerInvariant()
} finally {
    $sha256.Dispose()
    $zipStream.Dispose()
}
Set-Content -LiteralPath $checksumPath -Value "$hash  $PackageName.zip" -Encoding ASCII
& $nodePath (Join-Path $projectRoot "scripts\verify-zip-checksum.mjs") $zipPath $checksumPath
if ($LASTEXITCODE -ne 0) { throw "ZIP checksum verification failed; previous package remains available." }

$previousRoot = Join-Path $releaseRoot ("previous-" + (Get-Date -Format "yyyy-MM-dd-HHmmss") + "-before-p1-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$normalizedPreviousRoot = [IO.Path]::GetFullPath($previousRoot)
if (-not $normalizedPreviousRoot.StartsWith($normalizedReleaseRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe previous-package path." }
$existing = @($finalPackageRoot, $finalZipPath, $finalChecksumPath) | Where-Object { Test-Path -LiteralPath $_ }
if ($existing.Count) { New-Item -ItemType Directory -Path $previousRoot -Force | Out-Null }
try {
    foreach ($old in $existing) { Move-Item -LiteralPath $old -Destination (Join-Path $previousRoot (Split-Path -Leaf $old)) -ErrorAction Stop }
    Move-Item -LiteralPath $packageRoot -Destination $finalPackageRoot -ErrorAction Stop
    Move-Item -LiteralPath $zipPath -Destination $finalZipPath -ErrorAction Stop
    Move-Item -LiteralPath $checksumPath -Destination $finalChecksumPath -ErrorAction Stop
    & $nodePath (Join-Path $projectRoot "scripts\verify-zip-checksum.mjs") $finalZipPath $finalChecksumPath
    if ($LASTEXITCODE -ne 0) { throw "Promoted ZIP checksum mismatch." }
} catch {
    foreach ($new in @($finalPackageRoot, $finalZipPath, $finalChecksumPath)) {
        if (Test-Path -LiteralPath $new) { Move-Item -LiteralPath $new -Destination (Join-Path $stagingRoot ((Split-Path -Leaf $new) + ".failed")) -ErrorAction SilentlyContinue }
    }
    if (Test-Path -LiteralPath $previousRoot) {
        foreach ($old in Get-ChildItem -LiteralPath $previousRoot) { Move-Item -LiteralPath $old.FullName -Destination (Join-Path $releaseRoot $old.Name) -ErrorAction SilentlyContinue }
    }
    throw
}
Write-Host "Test package created: $finalPackageRoot"
Write-Host "Archive created: $finalZipPath"
Write-Host "SHA-256: $hash"
if ($existing.Count) { Write-Host "Previous package retained: $previousRoot" }
