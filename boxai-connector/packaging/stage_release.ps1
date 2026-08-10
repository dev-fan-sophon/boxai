$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Release = Get-Content (Join-Path $Root "connector-release.json") | ConvertFrom-Json
$Stage = if ($env:BOXAI_RELEASE_STAGE) { $env:BOXAI_RELEASE_STAGE } else { Join-Path $Root "release\$($Release.version)" }
$Binary = Join-Path $Root "target\release\boxai-connector.exe"

if (-not (Test-Path $Binary)) {
    throw "Missing $Binary; run cargo build --locked --release --features connector-app/gpui-app --bin boxai-connector"
}

$Package = Join-Path $Stage "BoxAI Connector"
$Archive = Join-Path $Stage "BoxAI-Connector-windows-x64.zip"
New-Item -ItemType Directory -Force -Path $Package | Out-Null
Copy-Item $Binary (Join-Path $Package "BoxAI Connector.exe") -Force
Copy-Item (Join-Path $Root "packaging\icons\boxai-connector.png") (Join-Path $Package "boxai-connector.png") -Force
@"
BoxAI Connector $($Release.version)

This is the separately branded BoxAI Gateway Connector.
Default manifest: https://you-box.com/api/v1/connector/manifest
Credentials are stored in Windows Credential Manager.
"@ | Set-Content -Encoding UTF8 (Join-Path $Package "README.txt")

if (Test-Path $Archive) { Remove-Item $Archive -Force }
Compress-Archive -Path $Package -DestinationPath $Archive
Remove-Item $Package -Recurse -Force
Write-Host "Staged $Archive"
