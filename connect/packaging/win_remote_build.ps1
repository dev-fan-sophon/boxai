#requires -Version 5.1
<#
.SYNOPSIS
  Remote Windows driver: clone BoxAI main, build Connect NSIS+MSI with updater signatures.

.DESCRIPTION
  Run on the Studio Windows host (SSH Host win-cf / win-lan).

  Example (from Mac):
    scp connect/packaging/win_remote_build.ps1 win-cf:C:/Users/win/
    ssh win-cf 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\win\win_remote_build.ps1'
#>
[CmdletBinding()]
param(
    [string]$Ref = "main",
    [string]$RepoUrl = "https://github.com/dev-fan-sophon/boxai.git"
)
$ErrorActionPreference = "Continue"

$env:PATH = "$env:USERPROFILE\.cargo\bin;C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\LLVM\bin;C:\Program Files\CMake\bin;" + $env:PATH
$env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"

$log = Join-Path $env:USERPROFILE "build_connect_remote.log"
$done = Join-Path $env:USERPROFILE "build_connect_remote.done"
if (Test-Path $done) { Remove-Item -Force $done }
"" | Out-File -Encoding utf8 $log

function Log($msg) {
    Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg)
}

$key = Join-Path $env:USERPROFILE ".config\boxai\desktop-updater.key"
if (-not (Test-Path $key)) {
    Log "MISSING updater key at $key"
    "exit=2" | Out-File -Encoding ascii $done
    exit 2
}
$env:TAURI_SIGNING_PRIVATE_KEY = $key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""

try {
    Log ("rustc: " + (cmd /c "rustc --version 2>&1"))
    Log ("node: " + (cmd /c "node -v 2>&1"))
    Log ("pnpm: " + (cmd /c "pnpm -v 2>&1"))
    Log ("ref: $Ref")

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $work = Join-Path $env:USERPROFILE "src\boxai-connect-work-$stamp"
    Log "cloning $RepoUrl ($Ref) into $work"
    cmd /c "git clone --depth 1 --branch `"$Ref`" `"$RepoUrl`" `"$work`" 2>&1" |
        Select-Object -Last 8 | ForEach-Object { Log $_ }
    if (-not (Test-Path (Join-Path $work ".git"))) {
        Log "CLONE FAILED"
        "exit=1" | Out-File -Encoding ascii $done
        exit 1
    }

    $version = python -c "import json;print(json.load(open(r'$work\connect\src-tauri\tauri.conf.json'))['version'])"
    Log "Connect version: $version"
    Log ("HEAD: " + (cmd /c "git -C `"$work`" rev-parse --short HEAD 2>&1"))

    # Stable path used by pull-windows-artifacts.sh (must be boxai-connect-<ver>)
    $root = Join-Path $env:USERPROFILE "src\boxai-connect-$version"
    if (Test-Path $root) {
        Log "previous $root exists — try remove, else rename aside"
        try {
            Remove-Item -Recurse -Force $root -ErrorAction Stop
        } catch {
            $bak = "$root.bak-$stamp"
            Log "remove failed ($($_.Exception.Message)); renaming to $bak"
            Rename-Item -Path $root -NewName (Split-Path $bak -Leaf) -ErrorAction Stop
        }
    }
    # Destination must not exist: Move-Item into an existing dir nests the source.
    Move-Item -Path $work -Destination $root -ErrorAction Stop
    $connect = Join-Path $root "connect"
    if (-not (Test-Path (Join-Path $connect "package.json"))) {
        Log "MISSING package.json under $connect — clone layout wrong"
        Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object { Log ("  " + $_.Name) }
        "exit=5" | Out-File -Encoding ascii $done
        exit 5
    }

    Set-Location $connect
    Log "[1/3] pnpm install --frozen-lockfile"
    cmd /c "pnpm install --frozen-lockfile 2>&1" | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) {
        Log "pnpm install failed"
        "exit=3" | Out-File -Encoding ascii $done
        exit 3
    }

    # Empty-password minisign key: spawn through node like Desktop's win_tauri_build.mjs
    Log "[2/3] pnpm tauri build (via node env wrapper)"
    $nodeScript = @"
const { spawnSync } = require('child_process');
const path = require('path');
process.env.TAURI_SIGNING_PRIVATE_KEY = process.env.TAURI_SIGNING_PRIVATE_KEY || '';
process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '';
const r = spawnSync('pnpm', ['tauri', 'build'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
  shell: true,
});
process.exit(r.status === null ? 1 : r.status);
"@
    $wrap = Join-Path $env:TEMP "boxai_connect_tauri_build.js"
    Set-Content -Path $wrap -Value $nodeScript -Encoding utf8
    cmd /c "node `"$wrap`" 2>&1" | ForEach-Object { Log $_ }
    $code = $LASTEXITCODE
    Log ("tauri build exit: $code")
    if ($code -ne 0) {
        "exit=$code" | Out-File -Encoding ascii $done
        exit $code
    }

    Log "[3/3] stage_release.sh"
    $bash = "C:\Program Files\Git\bin\bash.exe"
    $stageUnix = "/c/Users/win/src/boxai-connect-$version/connect"
    if (Test-Path $bash) {
        & $bash -lc "cd '$stageUnix' && bash packaging/stage_release.sh" 2>&1 | ForEach-Object { Log $_ }
    }

    $stage = Join-Path $connect "release\$version"
    if (Test-Path $stage) {
        Get-ChildItem $stage | ForEach-Object {
            Log ("STAGED " + $_.Name + " (" + [math]::Round($_.Length / 1MB, 1) + " MB)")
        }
    }

    $bundle = Join-Path $connect "src-tauri\target\release\bundle"
    if (Test-Path $bundle) {
        Get-ChildItem -Recurse -Path $bundle -Include *.exe, *.msi, *.sig -ErrorAction SilentlyContinue |
            ForEach-Object {
                Log ("ARTIFACT " + $_.FullName + " (" + [math]::Round($_.Length / 1MB, 1) + " MB)")
            }
    }

    Log "DONE root=$root"
    "exit=0" | Out-File -Encoding ascii $done
    exit 0
} catch {
    Log ("DRIVER EXCEPTION: " + $_.Exception.Message)
    "exit=99" | Out-File -Encoding ascii $done
    exit 99
}
