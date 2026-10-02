param([string]$Ref = "main")
$ErrorActionPreference = "Stop"
$Log = "$env:USERPROFILE\build_desktop_remote.log"
$Done = "$env:USERPROFILE\build_desktop_remote.done"
$Root = "$env:USERPROFILE\src\origingame\boxai-desktop-release"
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$Code = 1
Start-Transcript -Path $Log -Force
try {
    if (!(Test-Path "$Root\.git")) {
        git clone https://github.com/dev-fan-sophon/boxai.git $Root
        if ($LASTEXITCODE) { throw "Clone failed" }
    }
    Set-Location $Root
    if (git status --porcelain) { throw "Release checkout has local changes" }
    git fetch origin $Ref
    if ($LASTEXITCODE) { throw "Fetch failed" }
    git switch --detach FETCH_HEAD
    if ($LASTEXITCODE) { throw "Checkout failed" }
    Set-Location desktop
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE) { throw "Dependency install failed" }
    pnpm dist
    if ($LASTEXITCODE) { throw "Native build failed" }
    Set-Location ..
    node scripts/client-release/desktop-native.mjs
    if ($LASTEXITCODE) { throw "Native installation/boot assertion failed" }
    $Code = 0
} catch {
    Write-Output $_
} finally {
    Stop-Transcript
    "exit=$Code" | Out-File -Encoding ascii $Done
}
exit $Code
