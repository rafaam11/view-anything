; Tauri includes FileAssociation.nsh before installerHooks. Replace only its
; association macros: repeated /UPDATE must not overwrite the original backup.
!macroundef APP_ASSOCIATE
!macro APP_ASSOCIATE EXT FILECLASS DESCRIPTION ICON COMMANDTEXT COMMAND
  Push $R0
  Push $R1
  Push $R2
  ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${If} $R0 != "${FILECLASS}"
    ReadRegStr $R1 SHELL_CONTEXT "Software\Classes\$R0\shell\open\command" ""
    ; Migrate older, non-namespaced classes only when their command is ours.
    ${If} $R0 != ""
    ${AndIf} $R1 == `${COMMAND}`
      ReadRegStr $R2 SHELL_CONTEXT "Software\Classes\.${EXT}" "$R0_backup"
      ${If} $R2 == $R0
        StrCpy $R2 ""
      ${EndIf}
      WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "${FILECLASS}_backup" "$R2"
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" "$R0_backup"
      WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "" "${FILECLASS}"
    ${ElseIf} $UpdateMode != 1
      WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "${FILECLASS}_backup" "$R0"
      WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "" "${FILECLASS}"
    ${EndIf}
  ${EndIf}
  ; Keep Open With available even if another app became the default meanwhile.
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
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${FILECLASS}"
  Pop $R1
  Pop $R0
!macroend
