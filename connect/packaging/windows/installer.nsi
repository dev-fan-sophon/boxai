; BoxAI Connect setup program.
;
; One published Windows file, used two ways: a person downloads and runs it,
; and the updater runs the same file with /S over an existing install. Both
; paths therefore lay out the install identically (same directory, same Start
; menu entry, same uninstall record) because they are the same code.
;
; Everything is per-user. There is no elevation prompt and no shared state:
; an unsigned program asking for administrator is a prompt nobody should be
; trained to accept, and a self-update cannot write into a directory it does
; not own.

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef PRODUCT_VERSION
  !error "PRODUCT_VERSION must be defined by the staging script"
!endif
!ifndef SOURCE_EXE
  !error "SOURCE_EXE must be defined by the staging script"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE must be defined by the staging script"
!endif
!ifndef LICENSE_FILE
  !error "LICENSE_FILE must be defined by the staging script"
!endif

!define PRODUCT_NAME "BoxAI Connect"
!define PRODUCT_PUBLISHER "BoxAI"
!define EXE_NAME "boxai-connect.exe"
!define UNINSTALL_KEY "com.you-box.connect"
!define UNINSTALL_ROOT "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_KEY}"

Name "${PRODUCT_NAME}"
OutFile "${OUTPUT_FILE}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT_NAME}"
; An existing install decides where this one goes, so upgrading never leaves
; two copies in two directories.
InstallDirRegKey HKCU "${UNINSTALL_ROOT}" "InstallLocation"
ShowInstDetails hide
ShowUnInstDetails hide

VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "FileDescription" "BoxAI Connect Setup"
VIAddVersionKey "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey "LegalCopyright" "Copyright 2026 ${PRODUCT_PUBLISHER}"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE_NAME}"
!define MUI_LANGDLL_ALLLANGUAGES

; A desktop shortcut is offered, never assumed. A silent install never shows
; this page and so never adds or removes one: the update is not the moment to
; overrule a choice somebody already made.
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!define MUI_FINISHPAGE_SHOWREADME_TEXT $(DESKTOP_SHORTCUT_TEXT)
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut

!insertmacro MUI_PAGE_LICENSE "${LICENSE_FILE}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Vietnamese"
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

LangString DESKTOP_SHORTCUT_TEXT ${LANG_VIETNAMESE} "Tạo lối tắt trên màn hình"
LangString DESKTOP_SHORTCUT_TEXT ${LANG_SIMPCHINESE} "创建桌面快捷方式"
LangString DESKTOP_SHORTCUT_TEXT ${LANG_ENGLISH} "Create a desktop shortcut"

Function .onInit
  !insertmacro MUI_LANGDLL_DISPLAY
FunctionEnd

Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${EXE_NAME}"
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"

  ; Windows refuses to overwrite a running image but allows renaming it. The
  ; updater runs this while the program it is replacing is still running, so
  ; the old file is moved aside first and deleted afterwards if it has since
  ; exited. A leftover .previous is not a failed install.
  IfFileExists "$INSTDIR\${EXE_NAME}" 0 +3
    Delete "$INSTDIR\${EXE_NAME}.previous"
    Rename "$INSTDIR\${EXE_NAME}" "$INSTDIR\${EXE_NAME}.previous"

  ClearErrors
  File "/oname=${EXE_NAME}" "${SOURCE_EXE}"
  IfErrors 0 +4
    ; Put the previous version back rather than leaving no program at all.
    Rename "$INSTDIR\${EXE_NAME}.previous" "$INSTDIR\${EXE_NAME}"
    SetErrorLevel 2
    Abort "could not write $INSTDIR\${EXE_NAME}"

  Delete "$INSTDIR\${EXE_NAME}.previous"
  ; Installs made before there was a setup program kept the downloaded file's
  ; name, so the directory can still hold a second, older program. Everything
  ; below points at the name above, so the leftover is only wasted space; while
  ; it is the running image this delete fails, and the next update, which no
  ; longer has it running, clears it.
  Delete "$INSTDIR\BoxAI-Connect-*.exe"
  File "/oname=LICENSE" "${LICENSE_FILE}"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}.lnk" "$INSTDIR\${EXE_NAME}"
  ; An existing desktop shortcut is repointed rather than left aimed at a file
  ; the upgrade may have just removed. A missing one stays missing.
  IfFileExists "$DESKTOP\${PRODUCT_NAME}.lnk" 0 +2
    CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${EXE_NAME}"

  ; The same record the program writes when it installs itself, so Programs and
  ; Features shows one entry however the Kit arrived, and so the running
  ; program can read back the directory this install chose.
  WriteRegStr HKCU "${UNINSTALL_ROOT}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINSTALL_ROOT}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_ROOT}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_ROOT}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_ROOT}" "DisplayIcon" "$INSTDIR\${EXE_NAME}"
  WriteRegStr HKCU "${UNINSTALL_ROOT}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_ROOT}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_ROOT}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_ROOT}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTALL_ROOT}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  DeleteRegKey HKCU "${UNINSTALL_ROOT}"
  Delete "$INSTDIR\${EXE_NAME}"
  Delete "$INSTDIR\${EXE_NAME}.previous"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\uninstall.exe"
  ; Only if it is now empty. Someone may have put files here, and uninstalling
  ; is not a licence to clear a path.
  RMDir "$INSTDIR"
SectionEnd
