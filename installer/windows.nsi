Unicode true
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID lzma
Name "PixelSync"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\PixelSync"
Icon "../assets/icons/pixelsync.ico"
UninstallIcon "../assets/icons/pixelsync.ico"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "PixelSync"
VIAddVersionKey /LANG=1033 "FileDescription" "PixelSync Setup"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "PixelSync contributors"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PixelSync"
!define MUI_ABORTWARNING
!define MUI_ICON "../assets/icons/pixelsync.ico"
!define MUI_UNICON "../assets/icons/pixelsync.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\PixelSync.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

!macro RequireClosed PREFIX
Function ${PREFIX}RequireAppClosed
  retry:
  nsProcess::_FindProcess "PixelSync.exe"
  Pop $0
  ${If} $0 == 0
    IfSilent cancelled
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Close PixelSync and any PixelSync MCP bridge processes before continuing. Save your artwork first." IDRETRY retry
    Goto cancelled
  ${ElseIf} $0 != 603
    MessageBox MB_OK|MB_ICONSTOP "Unable to check whether PixelSync is running (error $0)." /SD IDOK
    Goto cancelled
  ${EndIf}
  Return
  cancelled:
  SetErrorLevel 1
  Abort
FunctionEnd
!macroend
!insertmacro RequireClosed ""
!insertmacro RequireClosed "un."

Function .onInit
  SetShellVarContext current
  SetRegView 64
  ; Keep install/uninstall confined to this app's per-user directory, even with /D.
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\PixelSync"
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "PixelSync requires 64-bit Windows." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\PixelSync.Setup") p .r0 ?e'
  Pop $1
  ${If} $1 == 183
    MessageBox MB_OK|MB_ICONSTOP "PixelSync Setup is already running." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
FunctionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\PixelSync"
FunctionEnd

Section "Install"
  Call RequireAppClosed
  ; Let the old version remove its own file list so upgrades leave no stale binaries.
  IfFileExists "$INSTDIR\Uninstall PixelSync.exe" 0 fresh
    ClearErrors
    ExecWait '"$INSTDIR\Uninstall PixelSync.exe" /S _?=$INSTDIR' $0
    ${If} ${Errors}
    ${OrIf} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "Unable to remove the previous PixelSync version. Installation stopped." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
  fresh:
  SetOverwrite on
  !include "${GENERATED_DIR}/install-files.nsh"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall PixelSync.exe"
  CreateShortcut "$SMPROGRAMS\PixelSync.lnk" "$INSTDIR\PixelSync.exe"
  CreateShortcut "$DESKTOP\PixelSync.lnk" "$INSTDIR\PixelSync.exe"
  WinShell::SetLnkAUMI "$SMPROGRAMS\PixelSync.lnk" "io.pixelsync.app"
  WinShell::SetLnkAUMI "$DESKTOP\PixelSync.lnk" "io.pixelsync.app"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "PixelSync"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "PixelSync contributors"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\PixelSync.exe,0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall PixelSync.exe$\"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall PixelSync.exe$\" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Call un.RequireAppClosed
  SetOutPath "$TEMP"
  !include "${GENERATED_DIR}/uninstall-files.nsh"
  Delete "$SMPROGRAMS\PixelSync.lnk"
  Delete "$DESKTOP\PixelSync.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  Delete "$INSTDIR\Uninstall PixelSync.exe"
  RMDir "$INSTDIR"
  ; Settings in %APPDATA%\PixelSync, external client configs and projects are retained.
SectionEnd
