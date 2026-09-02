' run-dexaz-hidden.vbs
' ---------------------
' Menjalankan run-dexaz.ps1 tanpa memunculkan jendela PowerShell/terminal
' sama sekali. Dipanggil oleh run-dexaz.bat — jangan dijalankan manual
' kecuali Anda memang ingin skip file .bat-nya.

Dim shell, fso, scriptDir, psFile, cmd

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psFile = scriptDir & "\run-dexaz.ps1"

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & psFile & """"

' Argumen ke-2 (0) = jendela disembunyikan sepenuhnya.
' Argumen ke-3 (False) = tidak menunggu proses selesai, langsung lanjut
' (backend & frontend memang didesain untuk terus berjalan di background).
shell.Run cmd, 0, False
