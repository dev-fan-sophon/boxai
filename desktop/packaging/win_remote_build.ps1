#requires -Version 5.1
<#
.SYNOPSIS
  Remote Windows driver: clone BoxAI main, build Desktop NSIS+MSI with updater signatures.

.DESCRIPTION
  Run on the Studio Windows host (SSH Host win-cf / win-lan). Counterpart to
  packaging/build_windows.ps1 for a clean release tree.

  Example (from Mac):
    scp desktop/packaging/win_remote_build.ps1 win-cf:C:/Users/win/
    ssh win-cf 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\win\win_remote_build.ps1'

  Outputs land under:
    %USERPROFILE%\src\boxai-desktop-<version>\desktop\surfaces\gui\src-tauri\target\release\bundle\
  Stage dir (Git Bash path) also prepared under desktop\release\<version>\ via stage_release.sh
#>
[CmdletBinding()]
param(
    [string]$Ref = "main",
    [string]$RepoUrl = "https://github.com/dev-fan-sophon/boxai.git"
)
$ErrorActionPreference = "Continue"

$env:PATH = "$env:USERPROFILE\.cargo\bin;C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\LLVM\bin;C:\Program Files\CMake\bin;" + $env:PATH
$env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"

$log = Join-Path $env:USERPROFILE "build_desktop_remote.log"
$done = Join-Path $env:USERPROFILE "build_desktop_remote.done"
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
    Log ("ref: $Ref")

    # Probe version without full clone if we can; after clone read from tree.
    $work = Join-Path $env:USERPROFILE "src\boxai-desktop-work"
    if (Test-Path $work) {
        Log "removing previous $work"
        Remove-Item -Recurse -Force $work
    }
    Log "cloning $RepoUrl ($Ref) into $work"
    cmd /c "git clone --depth 1 --branch `"$Ref`" `"$RepoUrl`" `"$work`" 2>&1" |
        Select-Object -Last 8 | ForEach-Object { Log $_ }
    if (-not (Test-Path (Join-Path $work ".git"))) {
        Log "CLONE FAILED"
        "exit=1" | Out-File -Encoding ascii $done
        exit 1
    }

    $version = python -c "import json;print(json.load(open(r'$work\desktop\surfaces\gui\src-tauri\tauri.conf.json'))['version'])"
    Log "Desktop version: $version"
    Log ("HEAD: " + (cmd /c "git -C `"$work`" rev-parse --short HEAD 2>&1"))

    # Stable path for operators / scp
    $root = Join-Path $env:USERPROFILE "src\boxai-desktop-$version"
    if (Test-Path $root) {
        Log "removing previous $root"
        Remove-Item -Recurse -Force $root -ErrorAction Stop
    }
    # Destination must not exist: Move-Item into an existing dir nests the source.
    Move-Item -Path $work -Destination $root -ErrorAction Stop
    $desktop = Join-Path $root "desktop"
    $gui = Join-Path $desktop "surfaces\gui"
    if (-not (Test-Path (Join-Path $desktop "packaging\build_windows.ps1"))) {
        Log "MISSING packaging/build_windows.ps1 under $desktop — clone layout wrong"
        Get-ChildItem $root | ForEach-Object { Log ("  " + $_.Name) }
        "exit=5" | Out-File -Encoding ascii $done
        exit 5
    }

    Log "[1/4] python venv + build deps"
    Set-Location $desktop
    if (-not (Test-Path "$desktop\.venv\Scripts\python.exe")) {
        cmd /c "py -m venv .venv 2>&1" | Select-Object -Last 2 | ForEach-Object { Log $_ }
    }
    cmd /c ".\.venv\Scripts\python.exe -m pip install --upgrade pip 2>&1" | Select-Object -Last 1 | ForEach-Object { Log $_ }
    cmd /c ".\.venv\Scripts\pip.exe install -e . pyinstaller typer tzdata 2>&1" | Select-Object -Last 3 | ForEach-Object { Log $_ }
    if (-not (Test-Path "$desktop\.venv\Scripts\pyinstaller.exe")) {
        Log "PYINSTALLER MISSING"
        "exit=3" | Out-File -Encoding ascii $done
        exit 3
    }

    Log "[2/4] npm ci"
    Set-Location $gui
    cmd /c "npm ci 2>&1" | Select-Object -Last 5 | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) {
        Log "npm ci failed"
        "exit=4" | Out-File -Encoding ascii $done
        exit 4
    }

    Log "[3/4] packaging/build_windows.ps1"
    Set-Location $desktop
    cmd /c "powershell -NoProfile -ExecutionPolicy Bypass -File `"$desktop\packaging\build_windows.ps1`" 2>&1" |
        ForEach-Object { Log $_ }
    $code = $LASTEXITCODE
    Log ("build_windows exit: $code")
    if ($code -ne 0) {
        "exit=$code" | Out-File -Encoding ascii $done
        exit $code
    }

    Log "[4/4] stage_release.sh (Git Bash)"
    $bash = "C:\Program Files\Git\bin\bash.exe"
    $stageUnix = "/c/Users/win/src/boxai-desktop-$version/desktop"
    if (Test-Path $bash) {
        & $bash -lc "cd '$stageUnix' && bash packaging/stage_release.sh" 2>&1 | ForEach-Object { Log $_ }
    } else {
        Log "Git bash missing — stage on Mac after scp"
    }

    $stage = Join-Path $desktop "release\$version"
    if (Test-Path $stage) {
        Get-ChildItem $stage | ForEach-Object {
            Log ("STAGED " + $_.Name + " (" + [math]::Round($_.Length / 1MB, 1) + " MB)")
        }
    }

    $bundle = Join-Path $gui "src-tauri\target\release\bundle"
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
