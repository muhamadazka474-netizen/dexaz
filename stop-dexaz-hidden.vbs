' stop-dexaz-hidden.vbs
' Menjalankan stop-dexaz.ps1 tanpa memunculkan jendela PowerShell/terminal.

Dim shell, fso, scriptDir, psFile, cmd

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psFile = scriptDir & "\stop-dexaz.ps1"

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & psFile & """"

shell.Run cmd, 0, True
