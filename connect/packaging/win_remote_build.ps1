#requires -Version 5.1
<# Build and natively assert BoxAI Connect from a clean pushed Git ref. #>
[CmdletBinding()]
param(
    [string]$Ref = 'main',
    [string]$RepoUrl = 'https://github.com/dev-fan-sophon/boxai.git'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.cargo\bin;C:\Program Files\Git\cmd;C:\Program Files\NSIS;C:\Program Files\7-Zip;" + $env:PATH

$log = Join-Path $env:USERPROFILE 'build_connect_remote.log'
$done = Join-Path $env:USERPROFILE 'build_connect_remote.done'
if (Test-Path $done) { Remove-Item $done -Force }
'' | Set-Content -Path $log -Encoding utf8

function Write-BuildLog([string]$Message) {
    Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message)
}

try {
    Write-BuildLog "ref: $Ref"
    Write-BuildLog ("rustup: " + (& rustup --version | Select-Object -First 1))
    & rustup toolchain install 1.97.0 --profile minimal
    if ($LASTEXITCODE -ne 0) { throw "rustup failed with exit code $LASTEXITCODE" }
    & rustup component add rustfmt clippy --toolchain 1.97.0
    if ($LASTEXITCODE -ne 0) { throw "rustup component install failed with exit code $LASTEXITCODE" }

    $work = Join-Path $env:USERPROFILE 'src\boxai-connect-work'
    if (Test-Path $work) { Remove-Item $work -Recurse -Force }
    Write-BuildLog "cloning $RepoUrl ($Ref)"
    & git clone --depth 1 --branch $Ref $RepoUrl $work 2>&1 | ForEach-Object { Write-BuildLog "$_" }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $work '.git'))) {
        throw "git clone failed with exit code $LASTEXITCODE"
    }

    $metadataPath = Join-Path $work 'connect\release-metadata.json'
    $metadata = Get-Content $metadataPath -Raw | ConvertFrom-Json
    $version = $metadata.version
    $root = Join-Path $env:USERPROFILE "src\boxai-connect-$version"
    if (Test-Path $root) { Remove-Item $root -Recurse -Force }
    Move-Item $work $root
    $connect = Join-Path $root 'connect'
    Write-BuildLog "version: $version"
    Write-BuildLog ("HEAD: " + (& git -C $root rev-parse HEAD))

    Push-Location $connect
    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File 'packaging\windows\stage-release.ps1' 2>&1 |
            ForEach-Object { Write-BuildLog "$_" }
        if ($LASTEXITCODE -ne 0) {
            throw "Windows stage/assert failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }

    $stage = Join-Path $connect "release\$version"
    $artifactName = $metadata.windows_artifact.Replace('{version}', $version)
    $expected = @($artifactName, "$artifactName.assertion.json") | Sort-Object
    $actual = @(Get-ChildItem $stage -File | ForEach-Object Name | Sort-Object)
    if (Compare-Object $expected $actual) {
        throw "Windows release stage differs: $($actual -join ', ')"
    }
    Get-ChildItem $stage | ForEach-Object {
        Write-BuildLog ("STAGED " + $_.Name + " (" + $_.Length + " bytes)")
    }
    Write-BuildLog "DONE root=$root"
    'exit=0' | Set-Content -Path $done -Encoding ascii
    exit 0
} catch {
    Write-BuildLog ("DRIVER EXCEPTION: " + $_.Exception.Message)
    'exit=99' | Set-Content -Path $done -Encoding ascii
    exit 99
}
