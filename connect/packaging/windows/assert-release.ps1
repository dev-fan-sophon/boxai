param(
    [string]$ExecutablePath,
    [string]$ArchivePath,
    [string]$MetadataPath,
    [string]$LicensePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $MetadataPath) {
    $MetadataPath = Join-Path $root 'release-metadata.json'
}
if (-not $LicensePath) {
    $LicensePath = Join-Path $root 'LICENSE'
}
$MetadataPath = (Resolve-Path $MetadataPath).Path
$LicensePath = (Resolve-Path $LicensePath).Path
$metadata = Get-Content $MetadataPath -Raw | ConvertFrom-Json
$hostArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
$processArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
if ($hostArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64 -or
    $processArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
    throw "Windows release assertions require a native x64 host and process, got host=$hostArchitecture process=$processArchitecture"
}
$exeName = "$($metadata.binary_name).exe"
if (-not $ExecutablePath) {
    $ExecutablePath = Join-Path $root "dist\windows-x64\$exeName"
}
if (-not $ArchivePath) {
    $ArchivePath = Join-Path $root "dist\$($metadata.windows_artifact.Replace('{version}', $metadata.version))"
}
$ExecutablePath = (Resolve-Path $ExecutablePath).Path
$ArchivePath = (Resolve-Path $ArchivePath).Path

function Assert-Equal($Actual, $Expected, [string]$Name) {
    if ($Actual -cne $Expected) {
        throw "$Name expected '$Expected', got '$Actual'"
    }
}

$bytes = [System.IO.File]::ReadAllBytes($ExecutablePath)
if ($bytes.Length -lt 512 -or [System.Text.Encoding]::ASCII.GetString($bytes, 0, 2) -ne 'MZ') {
    throw 'release executable is not a valid DOS/PE image'
}
$peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
if ($peOffset -lt 0 -or $peOffset + 96 -gt $bytes.Length -or
    [System.Text.Encoding]::ASCII.GetString($bytes, $peOffset, 4) -ne "PE`0`0") {
    throw 'release executable has an invalid PE header offset or signature'
}
$machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
Assert-Equal $machine ([uint16]0x8664) 'PE machine'
$optionalHeader = $peOffset + 24
if ($optionalHeader + 152 -gt $bytes.Length) {
    throw 'release executable has a truncated PE32+ optional header'
}
$magic = [BitConverter]::ToUInt16($bytes, $optionalHeader)
Assert-Equal $magic ([uint16]0x20b) 'PE optional-header magic'
$subsystem = [BitConverter]::ToUInt16($bytes, $optionalHeader + 68)
Assert-Equal $subsystem ([uint16]2) 'PE subsystem'
$certificateDirectory = $optionalHeader + 112 + (4 * 8)
$certificateOffset = [BitConverter]::ToUInt32($bytes, $certificateDirectory)
$certificateSize = [BitConverter]::ToUInt32($bytes, $certificateDirectory + 4)
if ($certificateOffset -ne 0 -or $certificateSize -ne 0) {
    throw "release executable unexpectedly contains an Authenticode certificate table at $certificateOffset with size $certificateSize"
}

if (-not ('BoxAI.ReleaseResourceInspector' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace BoxAI {
    public static class ReleaseResourceInspector {
        private delegate bool EnumResNameProc(IntPtr module, IntPtr type, IntPtr name, IntPtr parameter);
        private delegate bool EnumResLangProc(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr parameter);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibraryExW(string path, IntPtr file, uint flags);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr FindResourceW(IntPtr module, IntPtr name, IntPtr type);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr LoadResource(IntPtr module, IntPtr resource);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint SizeofResource(IntPtr module, IntPtr resource);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr LockResource(IntPtr resourceData);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EnumResourceNamesW(IntPtr module, IntPtr type, EnumResNameProc callback, IntPtr parameter);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EnumResourceLanguagesW(IntPtr module, IntPtr type, IntPtr name, EnumResLangProc callback, IntPtr parameter);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FreeLibrary(IntPtr module);

        public static int[] Inspect(string path, int type, ushort expectedLanguage) {
            const uint LOAD_LIBRARY_AS_DATAFILE = 0x00000002;
            const uint LOAD_LIBRARY_AS_IMAGE_RESOURCE = 0x00000020;
            IntPtr module = LoadLibraryExW(path, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE);
            if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try {
                int count = 0;
                int unexpectedLanguages = 0;
                int callbackError = 0;
                EnumResNameProc callback = (currentModule, currentType, currentName, ignoredParameter) => {
                    count++;
                    bool sawLanguage = false;
                    EnumResLangProc languageCallback = (ignoredModule, ignoredType, ignoredName, language, ignoredLanguageParameter) => {
                        sawLanguage = true;
                        if (language != expectedLanguage) unexpectedLanguages++;
                        return true;
                    };
                    bool languageOk = EnumResourceLanguagesW(currentModule, currentType, currentName, languageCallback, IntPtr.Zero);
                    int languageError = Marshal.GetLastWin32Error();
                    GC.KeepAlive(languageCallback);
                    if (!languageOk) {
                        callbackError = languageError;
                        return false;
                    }
                    if (!sawLanguage) {
                        callbackError = 1815;
                        return false;
                    }
                    return true;
                };
                bool ok = EnumResourceNamesW(module, new IntPtr(type), callback, IntPtr.Zero);
                int error = Marshal.GetLastWin32Error();
                GC.KeepAlive(callback);
                if (callbackError != 0) throw new Win32Exception(callbackError);
                if (!ok && error != 1813) throw new Win32Exception(error);
                return new int[] { count, unexpectedLanguages };
            } finally {
                FreeLibrary(module);
            }
        }

        public static string ReadIntResource(string path, int type, int name) {
            const uint LOAD_LIBRARY_AS_DATAFILE = 0x00000002;
            const uint LOAD_LIBRARY_AS_IMAGE_RESOURCE = 0x00000020;
            IntPtr module = LoadLibraryExW(path, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE);
            if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try {
                IntPtr resource = FindResourceW(module, new IntPtr(name), new IntPtr(type));
                if (resource == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                uint size = SizeofResource(module, resource);
                if (size == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
                IntPtr loaded = LoadResource(module, resource);
                if (loaded == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                IntPtr pointer = LockResource(loaded);
                if (pointer == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                byte[] bytes = new byte[size];
                Marshal.Copy(pointer, bytes, 0, checked((int)size));
                return System.Text.Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF');
            } finally {
                FreeLibrary(module);
            }
        }
    }
}
'@
}

$resourceLanguage = [uint16]0x0409
$iconResources = [BoxAI.ReleaseResourceInspector]::Inspect($ExecutablePath, 3, $resourceLanguage)
$groupIconResources = [BoxAI.ReleaseResourceInspector]::Inspect($ExecutablePath, 14, $resourceLanguage)
$versionResources = [BoxAI.ReleaseResourceInspector]::Inspect($ExecutablePath, 16, $resourceLanguage)
$iconCount = $iconResources[0]
$groupIconCount = $groupIconResources[0]
$versionCount = $versionResources[0]
if ($iconCount -ne $metadata.windows_icon_images -or $groupIconCount -ne 1 -or $versionCount -ne 1) {
    throw "required PE resource counts differ: RT_ICON=$iconCount RT_GROUP_ICON=$groupIconCount RT_VERSION=$versionCount"
}
if ($iconResources[1] -ne 0 -or $groupIconResources[1] -ne 0 -or $versionResources[1] -ne 0) {
    throw 'icon and version resources must use the expected Windows language identifier 0x0409'
}
$manifest = [BoxAI.ReleaseResourceInspector]::ReadIntResource($ExecutablePath, 24, 1)
if ($manifest -notmatch '<dpiAwareness[^>]*>PerMonitorV2</dpiAwareness>') {
    throw 'release executable manifest must declare PerMonitorV2 DPI awareness'
}
if ($manifest -notmatch '<requestedExecutionLevel\s+level="asInvoker"\s+uiAccess="false"\s*/>') {
    throw 'release executable manifest must run asInvoker without UIAccess'
}

$version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($ExecutablePath)
Assert-Equal $version.ProductName $metadata.product_name 'ProductName'
Assert-Equal $version.FileDescription $metadata.file_description 'FileDescription'
Assert-Equal $version.FileVersion $metadata.version 'FileVersion'
Assert-Equal $version.ProductVersion $metadata.version 'ProductVersion'
Assert-Equal $version.OriginalFilename $metadata.original_filename 'OriginalFilename'
Assert-Equal $version.CompanyName $metadata.company_name 'CompanyName'
Assert-Equal $version.LegalCopyright $metadata.legal_copyright 'LegalCopyright'
Assert-Equal $version.InternalName $metadata.binary_name 'InternalName'
$versionParts = @($metadata.version.Split('-')[0].Split('.') | ForEach-Object { [uint16]$_ })
if ($versionParts.Count -gt 4) {
    throw 'release metadata version has more than four numeric components'
}
while ($versionParts.Count -lt 4) {
    $versionParts += [uint16]0
}
Assert-Equal $version.FileMajorPart $versionParts[0] 'FileMajorPart'
Assert-Equal $version.FileMinorPart $versionParts[1] 'FileMinorPart'
Assert-Equal $version.FileBuildPart $versionParts[2] 'FileBuildPart'
Assert-Equal $version.FilePrivatePart $versionParts[3] 'FilePrivatePart'
Assert-Equal $version.ProductMajorPart $versionParts[0] 'ProductMajorPart'
Assert-Equal $version.ProductMinorPart $versionParts[1] 'ProductMinorPart'
Assert-Equal $version.ProductBuildPart $versionParts[2] 'ProductBuildPart'
Assert-Equal $version.ProductPrivatePart $versionParts[3] 'ProductPrivatePart'

$signature = Get-AuthenticodeSignature -LiteralPath $ExecutablePath
Assert-Equal $signature.Status ([System.Management.Automation.SignatureStatus]::NotSigned) 'Authenticode status'

$expectedArtifact = $metadata.windows_artifact.Replace('{version}', $metadata.version)
Assert-Equal ([System.IO.Path]::GetFileName($ArchivePath)) $expectedArtifact 'artifact filename'
# The published artifact is the setup program, and it is the only thing anyone
# receives — by download or by update. So the assertion is not that some file
# sits next to it, but that the bytes it will install are exactly the executable
# asserted above, read back out of the installer rather than trusted from the
# build step that put them there.
$artifactBytes = [System.IO.File]::ReadAllBytes($ArchivePath)
if ($artifactBytes.Length -lt 512 -or [System.Text.Encoding]::ASCII.GetString($artifactBytes, 0, 2) -ne 'MZ') {
    throw 'the setup program is not a valid DOS/PE image'
}
$setupSignature = Get-AuthenticodeSignature -LiteralPath $ArchivePath
Assert-Equal $setupSignature.Status ([System.Management.Automation.SignatureStatus]::NotSigned) 'setup Authenticode status'

$sevenZip = Join-Path $env:ProgramFiles '7-Zip\7z.exe'
if (-not (Test-Path $sevenZip)) {
    $sevenZip = (Get-Command 7z -ErrorAction SilentlyContinue).Source
}
if (-not $sevenZip) {
    throw '7-Zip is required to read the setup payload back out of the installer'
}
$unpacked = Join-Path ([System.IO.Path]::GetTempPath()) ("boxai-connect-setup-" + [guid]::NewGuid())
$executableHash = (Get-FileHash -LiteralPath $ExecutablePath -Algorithm SHA256).Hash
try {
    & $sevenZip x "-o$unpacked" -y $ArchivePath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "7z could not read the setup program (exit code $LASTEXITCODE)"
    }
    $payload = @(Get-ChildItem $unpacked -Recurse -File -Filter $exeName)
    if ($payload.Count -ne 1) {
        throw "the setup program carries $($payload.Count) copies of $exeName"
    }
    $payloadHash = (Get-FileHash -LiteralPath $payload[0].FullName -Algorithm SHA256).Hash
    if ($payloadHash -cne $executableHash) {
        throw 'the setup program does not carry the asserted executable'
    }
} finally {
    if (Test-Path $unpacked) {
        Remove-Item $unpacked -Recurse -Force
    }
}
$artifactHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash

[pscustomobject]@{
    platform = 'win32-x64'
    version = $metadata.version
    executable = $ExecutablePath
    host_architecture = $hostArchitecture.ToString()
    machine = ('0x{0:X4}' -f $machine)
    optional_header = ('0x{0:X3}' -f $magic)
    subsystem = $subsystem
    authenticode = $signature.Status.ToString()
    certificate_table_size = $certificateSize
    dpi_awareness = 'PerMonitorV2'
    resources = [pscustomobject]@{
        icon = $iconCount
        group_icon = $groupIconCount
        version = $versionCount
        language = ('0x{0:X4}' -f $resourceLanguage)
    }
    product_name = $version.ProductName
    file_description = $version.FileDescription
    file_version = $version.FileVersion
    product_version = $version.ProductVersion
    original_filename = $version.OriginalFilename
    internal_name = $version.InternalName
    artifact = $ArchivePath
    artifact_sha256 = $artifactHash
} | ConvertTo-Json -Depth 4 -Compress
