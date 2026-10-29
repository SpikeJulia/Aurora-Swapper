; Aurora records and file snapshots live in Electron's userData directory.
; Keep them after uninstall so a user can reinstall and recover if needed.
; Ask before a user-initiated uninstall, but remain silent during updates.
!macro customUnInit
  ${ifNot} ${isUpdated}
    IfSilent +3
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "卸载 Aurora Swapper 不会还原游戏文件。请先在应用内对游戏执行“还原原始文件”。安装记录和备份保存在本机应用数据目录，卸载时将保留；请勿手动删除。$\r$\n$\r$\n继续卸载？" IDOK +2
    Quit
  ${endIf}
!macroend
