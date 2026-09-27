param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$runningOnWindows = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Windows
)
$runningOnX64 = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::X64
if (-not $runningOnWindows -or -not $runningOnX64) {
    throw 'this staging script produces only native Windows x64 artifacts'
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$metadataPath = Join-Path $root 'release-metadata.json'
$metadata = Get-Content $metadataPath -Raw | ConvertFrom-Json

Push-Location $root
try {
    if ((& go env GOOS) -ne 'windows' -or (& go env GOARCH) -ne 'amd64') {
        throw 'Go must target native windows/amd64'
    }
    if ($metadata.release_mode -ne 'unsigned-package-signed-updates' -or $metadata.signed -ne $false -or
        $metadata.notarized -ne $false -or $metadata.updater -ne $true -or
        $metadata.release_feed -ne $true) {
        throw 'release metadata must describe an unsigned package with a signed update feed'
    }
    $desktopTargets = @($metadata.desktop_release_targets)
    if ($desktopTargets.Count -ne 2 -or $desktopTargets[0] -cne 'macos' -or
        $desktopTargets[1] -cne 'windows' -or $metadata.browser_target -ne $false) {
        throw 'release metadata must describe only native macOS and Windows desktop targets'
    }
    if ($metadata.windows_target -ne 'windows-x64' -or
        $metadata.windows_go_target -ne 'windows/amd64') {
        throw 'release metadata must select the native Windows x64 Go target'
    }

    $resources = Get-Content 'build\windows\winres.json' -Raw | ConvertFrom-Json
    $info = $resources.RT_VERSION.'#1'.'0409'.info.'0409'
    $info.FileVersion = $metadata.version
    $info.ProductVersion = $metadata.version
    $resourceFile = Join-Path $root 'build\windows\winres.release.json'
    [System.IO.File]::WriteAllText($resourceFile, ($resources | ConvertTo-Json -Depth 20))
    try {
        & go run github.com/tc-hib/go-winres@v0.3.3 make --in $resourceFile --arch amd64 --out rsrc --file-version $metadata.version --product-version $metadata.version
        if ($LASTEXITCODE -ne 0) { throw 'Windows resource generation failed' }
        & go build -tags production -trimpath "-ldflags=-s -w -H windowsgui -X main.version=$($metadata.version)" -o "dist\$($metadata.binary_name).exe" .
        if ($LASTEXITCODE -ne 0) { throw 'Go/Wails release build failed' }
    } finally {
        Remove-Item $resourceFile -ErrorAction SilentlyContinue
        Remove-Item 'rsrc_windows_*.syso' -ErrorAction SilentlyContinue
    }

    $stage = Join-Path $root 'dist\windows-x64'
    if (Test-Path $stage) {
        Remove-Item $stage -Recurse -Force
    }
    New-Item $stage -ItemType Directory | Out-Null
    $exeName = "$($metadata.binary_name).exe"
    $releaseDirectory = Join-Path $root 'dist'
    Copy-Item (Join-Path $releaseDirectory $exeName) $stage
    Copy-Item (Join-Path $root 'LICENSE') $stage
    Copy-Item (Join-Path $root 'LICENSE.magpie') $stage
    Copy-Item (Join-Path $root '..\NOTICE') $stage
    Copy-Item $metadataPath $stage

    $expected = @($exeName, 'LICENSE', 'LICENSE.magpie', 'NOTICE', 'release-metadata.json')
    $staged = @(Get-ChildItem $stage -File | ForEach-Object Name | Sort-Object)
    if (Compare-Object ($expected | Sort-Object) $staged) {
        throw "staging directory has unexpected contents: $($staged -join ', ')"
    }

    $artifactName = $metadata.windows_artifact.Replace('{version}', $metadata.version)
    if (-not $artifactName.EndsWith('-setup.exe')) {
        throw 'the Windows artifact must be the setup program'
    }
    $artifact = Join-Path (Join-Path $root 'dist') $artifactName
    if (Test-Path $artifact) {
        Remove-Item $artifact -Force
    }

    # The download and explicit updater handoff open the same setup program.
    # One artifact, one install path, so an update cannot lay out an
    # install differently from the way a person installing by hand would.
    $makensis = Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe'
    if (-not (Test-Path $makensis)) {
        $makensis = (Get-Command makensis -ErrorAction SilentlyContinue).Source
    }
    if (-not $makensis) {
        throw 'NSIS (makensis.exe) is required to build the Windows setup program'
    }
    $versionParts = @($metadata.version.Split('-')[0].Split('.'))
    if ($versionParts.Count -ne 3) {
        throw "release metadata version $($metadata.version) is not major.minor.patch"
    }
    $script = Join-Path $PSScriptRoot 'installer.nsi'
    & $makensis `
        '/INPUTCHARSET' 'UTF8' `
        "/DPRODUCT_VERSION=$($versionParts -join '.')" `
        "/DSOURCE_EXE=$(Join-Path $stage $exeName)" `
        "/DOUTPUT_FILE=$artifact" `
        "/DLICENSE_FILE=$(Join-Path $stage 'LICENSE')" `
        "/DMAGPIE_LICENSE_FILE=$(Join-Path $stage 'LICENSE.magpie')" `
        "/DNOTICE_FILE=$(Join-Path $stage 'NOTICE')" `
        $script
    if ($LASTEXITCODE -ne 0) {
        throw "makensis failed with exit code $LASTEXITCODE"
    }
    if (-not (Test-Path $artifact)) {
        throw "makensis reported success but wrote no $artifactName"
    }

    $release = Join-Path $root "release\$($metadata.version)"
    if (Test-Path $release) {
        Remove-Item $release -Recurse -Force
    }
    New-Item $release -ItemType Directory | Out-Null
    $releasedArtifact = Join-Path $release $artifactName
    Copy-Item $artifact $releasedArtifact
    $reportPath = "$releasedArtifact.assertion.json"
    $report = & (Join-Path $PSScriptRoot 'assert-release.ps1') `
        -ExecutablePath (Join-Path $stage $exeName) `
        -ArchivePath $releasedArtifact `
        -MetadataPath $metadataPath `
        -LicensePath (Join-Path $root 'LICENSE')
    $assertion = $report | ConvertFrom-Json
    $releasedHash = (Get-FileHash -LiteralPath $releasedArtifact -Algorithm SHA256).Hash
    if ($assertion.platform -cne 'win32-x64' -or
        $assertion.version -cne $metadata.version -or
        $assertion.artifact_sha256 -cne $releasedHash) {
        throw 'native Windows assertion did not cover the staged release artifact'
    }
    $report | Set-Content -Path $reportPath -Encoding utf8

    Write-Output $releasedArtifact
    Write-Output $reportPath
} finally {
    Pop-Location
}
