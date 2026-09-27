Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!ifndef VERSION
!error "VERSION is required"
!endif
!ifndef PAYLOAD
!error "PAYLOAD is required"
!endif
!ifndef OUTPUT
!error "OUTPUT is required"
!endif
!ifndef LICENSE
!error "LICENSE is required"
!endif
Name "BoxAI Connect"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\BoxAI Connect"
RequestExecutionLevel user
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "BoxAI Connect"
VIAddVersionKey "FileDescription" "BoxAI Connect Installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "BoxAI; upstream Magpie contributors (MIT)"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "BoxAI Connect requires 64-bit Windows."
    Abort
  ${EndIf}
FunctionEnd
Section "BoxAI Connect"
  SetOutPath "$INSTDIR"
  File /oname=magpie.exe "${PAYLOAD}"
  File /oname=LICENSE.txt "${LICENSE}"
  CreateShortcut "$SMPROGRAMS\BoxAI Connect.lnk" "$INSTDIR\magpie.exe" "app"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BoxAIConnectMagpie" "DisplayName" "BoxAI Connect"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BoxAIConnectMagpie" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BoxAIConnectMagpie" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd
Section "Uninstall"
  Delete "$SMPROGRAMS\BoxAI Connect.lnk"
  Delete "$INSTDIR\magpie.exe"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BoxAIConnectMagpie"
  # Never delete auth, agent configuration, or other user data.
SectionEnd
