; Inkwell uninstaller: ask whether to delete the user's data too (default: keep it).
; Skipped during updates (the old version is uninstalled silently) and silent uninstalls.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    IfSilent inkwellKeepData
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Inkwell data?$\r$\n$\r$\nThis removes all quotes, invoices, customers, attachments and backups in$\r$\n$APPDATA\Inkwell$\r$\n$\r$\nChoose No to keep it (for example if you plan to reinstall)." IDNO inkwellKeepData
      RMDir /r "$APPDATA\Inkwell"
    inkwellKeepData:
  ${endIf}
!macroend
