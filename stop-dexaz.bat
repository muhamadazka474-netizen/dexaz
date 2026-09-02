@echo off
REM Klik dua kali file ini untuk menghentikan DEXAZ (backend & frontend)
REM yang berjalan di background tanpa jendela terminal.

start "" wscript.exe "%~dp0stop-dexaz-hidden.vbs"
exit
