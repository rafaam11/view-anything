; Tauri includes FileAssociation.nsh before installerHooks. This file replaces its association
; macros and adds install/uninstall hooks. Policy: the installer never takes a default app.
;  - Every format is offered under Open With only (OpenWithProgids). Windows asks the user, who opts in.
;  - Text the shell runs (bat, cmd, ps1, js, py, sh, bash) is not associated at all: an Open With
;    entry alone makes Windows 11 show its app picker instead of running the script. A right-click
;    verb under SystemFileAssociations offers the viewer instead.
;  - Install, update and uninstall repair what versions up to 0.16 did to executable types: a default
;    taken from them (restored from its backup, or removed when there was none) and our Open With
;    entries, in Classes and in Explorer's FileExts.
; Saved as UTF-8 with a BOM so NSIS reads the Korean verb name.

!define VA_PREFIX "com.rafaam11.viewanything."
!define VA_VERB "com.rafaam11.viewanything.view"
!define VA_FILEEXTS "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts"

; Scripts get the right-click verb (keep in step with SCRIPT_EXTENSIONS in src/text/formats.ts).
!macro VA_EACH_SCRIPT MACRO
  !insertmacro ${MACRO} "bat"
  !insertmacro ${MACRO} "cmd"
  !insertmacro ${MACRO} "ps1"
  !insertmacro ${MACRO} "js"
  !insertmacro ${MACRO} "py"
  !insertmacro ${MACRO} "sh"
  !insertmacro ${MACRO} "bash"
!macroend
; Everything Windows runs or installs on a double-click: repaired, never associated.
!macro VA_EACH_EXECUTABLE MACRO
  !insertmacro VA_EACH_SCRIPT ${MACRO}
  !insertmacro ${MACRO} "vbs"
  !insertmacro ${MACRO} "vbe"
  !insertmacro ${MACRO} "jse"
  !insertmacro ${MACRO} "wsf"
  !insertmacro ${MACRO} "wsh"
  !insertmacro ${MACRO} "hta"
  !insertmacro ${MACRO} "reg"
  !insertmacro ${MACRO} "exe"
  !insertmacro ${MACRO} "com"
  !insertmacro ${MACRO} "msi"
  !insertmacro ${MACRO} "lnk"
  !insertmacro ${MACRO} "scr"
  !insertmacro ${MACRO} "pif"
  !insertmacro ${MACRO} "cpl"
!macroend

; Removes our values (any class with our prefix) from an OpenWithProgids key, then the key if empty.
!macro VA_DROP_OPEN_WITH KEY
  Push $R0
  Push $R1
  Push $R2
  StrCpy $R0 0
  ${Do}
    ClearErrors
    EnumRegValue $R1 HKCU "${KEY}" $R0
    ${If} ${Errors}
    ${OrIf} $R1 == ""
      ${ExitDo}
    ${EndIf}
    StrCpy $R2 $R1 26
    ${If} $R2 == "${VA_PREFIX}"
      DeleteRegValue HKCU "${KEY}" $R1
    ${Else}
      IntOp $R0 $R0 + 1
    ${EndIf}
  ${Loop}
  DeleteRegKey /ifempty HKCU "${KEY}"
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

; Gives an executable type back to Windows: our default goes (restored from its backup when one was
; saved; an empty backup means there was no per-user value, so the value is removed and the machine
; association applies again), and so do our backups and Open With entries.
!macro VA_REPAIR_EXT EXT
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  ReadRegStr $R0 HKCU "Software\Classes\.${EXT}" ""
  StrCpy $R1 $R0 26
  ${If} $R1 == "${VA_PREFIX}"
    ReadRegStr $R2 HKCU "Software\Classes\.${EXT}" "$R0_backup"
    StrCpy $R3 $R2 26
    ${If} $R2 != ""
    ${AndIf} $R3 != "${VA_PREFIX}"
      WriteRegStr HKCU "Software\Classes\.${EXT}" "" "$R2"
    ${Else}
      DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
    ${EndIf}
    DeleteRegValue HKCU "Software\Classes\.${EXT}" "$R0_backup"
  ${EndIf}
  DeleteRegValue HKCU "Software\Classes\.${EXT}" "com.rafaam11.viewanything.text_backup"
  !insertmacro VA_DROP_OPEN_WITH "Software\Classes\.${EXT}\OpenWithProgids"
  !insertmacro VA_DROP_OPEN_WITH "${VA_FILEEXTS}\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty HKCU "${VA_FILEEXTS}\.${EXT}"
  DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}"
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro VA_ADD_VERB EXT
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\${VA_VERB}" "MUIVerb" "View Anything으로 보기"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\${VA_VERB}" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\${VA_VERB}\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!macroend

!macro VA_REMOVE_VERB EXT
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\${VA_VERB}"
  DeleteRegKey /ifempty HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell"
  DeleteRegKey /ifempty HKCU "Software\Classes\SystemFileAssociations\.${EXT}"
!macroend

; Nothing of ours belongs on "*" (all files); clear it only if a value of ours is there.
!macro VA_CLEAR_ALL_FILES
  Push $R0
  Push $R1
  ReadRegStr $R0 HKCU "Software\Classes\*" ""
  StrCpy $R1 $R0 26
  ${If} $R1 == "${VA_PREFIX}"
    DeleteRegValue HKCU "Software\Classes\*" ""
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend

!macro VA_NOTIFY_SHELL
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro VA_EACH_EXECUTABLE VA_REPAIR_EXT
  !insertmacro VA_CLEAR_ALL_FILES
  !insertmacro VA_EACH_SCRIPT VA_ADD_VERB
  !insertmacro VA_NOTIFY_SHELL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro VA_EACH_SCRIPT VA_REMOVE_VERB
  ; Windows may register the executable itself once it was picked under Open With.
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  !insertmacro VA_EACH_EXECUTABLE VA_REPAIR_EXT
  !insertmacro VA_CLEAR_ALL_FILES
  !insertmacro VA_NOTIFY_SHELL
!macroend

; Open With only. The one default this changes is a default the user already gave this app under an
; older, non-namespaced class with the same command: it moves to the new class with its backup.
!macroundef APP_ASSOCIATE
!macro APP_ASSOCIATE EXT FILECLASS DESCRIPTION ICON COMMANDTEXT COMMAND
  Push $R0
  Push $R1
  Push $R2
  ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${If} $R0 != "${FILECLASS}"
  ${AndIf} $R0 != ""
    ReadRegStr $R1 SHELL_CONTEXT "Software\Classes\$R0\shell\open\command" ""
    ${If} $R1 == `${COMMAND}`
      ReadRegStr $R2 SHELL_CONTEXT "Software\Classes\.${EXT}" "$R0_backup"
      ${If} $R2 == $R0
        StrCpy $R2 ""
      ${EndIf}
      WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "${FILECLASS}_backup" "$R2"
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" "$R0_backup"
      WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "" "${FILECLASS}"
    ${EndIf}
  ${EndIf}
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${FILECLASS}" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}" "" `${DESCRIPTION}`
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\DefaultIcon" "" `${ICON}`
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\shell\open" "" `${COMMANDTEXT}`
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\shell\open\command" "" `${COMMAND}`
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

; Restores the default only where it is still ours: from the backup taken when an older version set
; it, or, when that backup is empty (there was no per-user value), by removing the value so the
; machine association applies again. A default the user moved to another app stays.
!macroundef APP_UNASSOCIATE
!macro APP_UNASSOCIATE EXT FILECLASS
  Push $R0
  Push $R1
  ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${If} $R0 == "${FILECLASS}"
    ReadRegStr $R1 SHELL_CONTEXT "Software\Classes\.${EXT}" "${FILECLASS}_backup"
    ${If} $R1 == "${FILECLASS}"
      StrCpy $R1 ""
    ${EndIf}
    ${If} $R1 == ""
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
    ${Else}
      WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "" "$R1"
    ${EndIf}
  ${EndIf}
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" "${FILECLASS}_backup"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${FILECLASS}"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}"
  ; Explorer records apps used through Open With here; ours go with the app.
  DeleteRegValue HKCU "${VA_FILEEXTS}\.${EXT}\OpenWithProgids" "${FILECLASS}"
  DeleteRegKey /ifempty HKCU "${VA_FILEEXTS}\.${EXT}\OpenWithProgids"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${FILECLASS}"
  Pop $R1
  Pop $R0
!macroend
