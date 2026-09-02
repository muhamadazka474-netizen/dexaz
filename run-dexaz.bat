@echo off
REM Klik dua kali file ini untuk menjalankan DEXAZ dari awal — tanpa
REM jendela PowerShell/terminal yang muncul sama sekali:
REM   - Mematikan proses yang memakai port 3000/8000 (jika ada)
REM   - Membuka halaman animasi loading sambil setup berjalan di background
REM   - Setup + menjalankan backend (uvicorn) tersembunyi
REM   - Setup + menjalankan frontend (npm run dev) tersembunyi
REM   - Halaman loading otomatis pindah ke http://127.0.0.1:3000/login
REM     begitu siap
REM
REM Log proses ada di folder logs/ jika perlu troubleshooting.
REM Untuk menghentikan DEXAZ, jalankan stop-dexaz.bat.

start "" wscript.exe "%~dp0run-dexaz-hidden.vbs"
exit
