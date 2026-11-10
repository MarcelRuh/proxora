; NSIS installer for Proxora Native (egui API client)
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef APP_VERSION
  !define APP_VERSION "0.3.1"
!endif
!ifndef SOURCE_EXE
  !define SOURCE_EXE "..\target\release\proxora-native.exe"
!endif

Name "Proxora Native"
!ifndef OUT_FILE
  !define OUT_FILE "ProxoraNative_${APP_VERSION}_x64-setup.exe"
!endif
OutFile "${OUT_FILE}"
InstallDir "$PROGRAMFILES64\Proxora Native"
InstallDirRegKey HKLM "Software\Proxora\Native" "InstallDir"
RequestExecutionLevel admin
Unicode True
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_ICON "proxora.ico"
!define MUI_UNICON "proxora.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\proxora-native.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Proxora Desktop starten"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "German"
!insertmacro MUI_LANGUAGE "English"

Section "Proxora Native" SecApp
  SetOutPath "$INSTDIR"
  File "/oname=proxora-native.exe" "${SOURCE_EXE}"

  WriteRegStr HKLM "Software\Proxora\Native" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ProxoraNative" \
    "DisplayName" "Proxora Native"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ProxoraNative" \
    "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ProxoraNative" \
    "Publisher" "Proxora"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ProxoraNative" \
    "DisplayIcon" "$INSTDIR\proxora-native.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ProxoraNative" \
    "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ProxoraNative" \
    "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ProxoraNative" \
    "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\Proxora"
  CreateShortCut "$SMPROGRAMS\Proxora\Proxora Native.lnk" "$INSTDIR\proxora-native.exe"
  CreateShortCut "$DESKTOP\Proxora Native.lnk" "$INSTDIR\proxora-native.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\proxora-native.exe"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$SMPROGRAMS\Proxora\Proxora Native.lnk"
  Delete "$DESKTOP\Proxora Native.lnk"
  RMDir "$SMPROGRAMS\Proxora"
  RMDir "$INSTDIR"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ProxoraNative"
  DeleteRegKey HKLM "Software\Proxora\Native"
SectionEnd
