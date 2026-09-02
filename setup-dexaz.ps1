<#
  setup-dexaz.ps1
  ------------------
  Dipanggil otomatis oleh run-dexaz.ps1 kalau salah satu prasyarat
  (Python, Node.js, PostgreSQL) belum terpasang di PC ini — jadi PC yang
  benar-benar baru/kosong tetap bisa langsung jalan cukup dengan klik
  run-dexaz.bat.

  Yang dilakukan:
    1) Install Python 3.12, Node.js LTS, PostgreSQL 16 lewat winget
       (kalau belum ada) — SEMUA silent, tanpa dialog installer.
    2) Pastikan service PostgreSQL menyala.
    3) Kalau .env belum ada, buat baru dari .env.example dengan:
       - SECRET_KEY / JWT_SECRET / ENCRYPTION_KEY yang di-generate baru
       - Password admin DEXAZ yang di-generate baru
       - Koneksi bootstrap otomatis ke PostgreSQL lokal yang baru
         terpasang (host 127.0.0.1:5432, user postgres)
       Semua kredensial hasil generate dicatat di logs\credentials.txt.

  winget install butuh hak Administrator, jadi script ini akan
  self-elevate lewat prompt UAC (satu kali, di PC baru saja) kalau
  belum dijalankan sebagai admin.
#>

$ErrorActionPreference = "Stop"

$root   = $PSScriptRoot
$logDir = Join-Path $root "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$setupLog = Join-Path $logDir "setup-dexaz.log"

function Log($text) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $text
    Add-Content -LiteralPath $setupLog -Value $line
}

# ---------------------------------------------------------------------------
# Self-elevate. winget install butuh Administrator untuk memasang software
# level-mesin (Node.js, PostgreSQL sebagai service, dst). Ini SATU-SATUNYA
# interaksi manual yang dibutuhkan di seluruh proses (klik "Yes" di UAC) —
# hanya muncul kalau memang ada prasyarat yang belum terpasang.
# ---------------------------------------------------------------------------
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    "--- setup-dexaz: minta elevasi UAC $(Get-Date) ---" | Out-File -LiteralPath $setupLog -Encoding UTF8 -Append
    Start-Process powershell -Verb RunAs -Wait -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`""
    )
    # PENTING: pakai 'return', bukan 'exit' — supaya kalau script ini
    # dipanggil lewat "& setup-dexaz.ps1" dari run-dexaz.ps1, proses
    # PowerShell pemanggilnya tidak ikut mati.
    return
}

"--- setup-dexaz start (elevated) $(Get-Date) ---" | Out-File -LiteralPath $setupLog -Encoding UTF8 -Append

function Update-SessionPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath    = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = @($machinePath, $userPath) -join ";"
}

function Test-CommandWorks {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WithWinget {
    param([string]$Id, [string]$Override = "")

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Log "winget tidak ditemukan di PC ini - tidak bisa auto-install $Id. Perlu install manual, atau update Windows (winget bawaan Windows 10 1809+ / Windows 11)."
        return $false
    }

    Log "Menginstall $Id lewat winget..."
    $wingetArgs = @("install", "--id", $Id, "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements")
    if ($Override) {
        $wingetArgs += @("--override", $Override)
    }

    $safeName = ($Id -replace '[^a-zA-Z0-9]', '_')
    try {
        $proc = Start-Process winget -ArgumentList $wingetArgs -Wait -PassThru -NoNewWindow `
            -RedirectStandardOutput (Join-Path $logDir "winget-$safeName.log") `
            -RedirectStandardError (Join-Path $logDir "winget-$safeName-error.log") `
            -ErrorAction Stop
        Update-SessionPath
        if ($proc.ExitCode -ne 0) {
            Log "winget install $Id selesai dengan exit code $($proc.ExitCode) (cek logs\winget-$safeName-error.log kalau perlu)."
        } else {
            Log "$Id berhasil diinstall."
        }
        return $true
    } catch {
        Log "Gagal menjalankan winget untuk $Id : $_"
        return $false
    }
}

function New-RandomToken {
    param([int]$Length = 32)
    return -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $Length | ForEach-Object { [char]$_ })
}

# ---------------------------------------------------------------------------
# 1) Python
# ---------------------------------------------------------------------------
Update-SessionPath
if (Test-CommandWorks "python") {
    Log "1) Python sudah ada: $(python --version 2>&1)"
} else {
    Log "1) Python tidak ditemukan, install lewat winget..."
    Install-WithWinget -Id "Python.Python.3.12" | Out-Null
    Update-SessionPath
    if (Test-CommandWorks "python") {
        Log "1) Python berhasil terpasang: $(python --version 2>&1)"
    } else {
        Log "1) PERINGATAN: Python masih tidak terdeteksi setelah install. Mungkin perlu buka PowerShell baru."
    }
}

# ---------------------------------------------------------------------------
# 2) Node.js
# ---------------------------------------------------------------------------
if (Test-CommandWorks "node") {
    Log "2) Node.js sudah ada: $(node --version 2>&1)"
} else {
    Log "2) Node.js tidak ditemukan, install lewat winget..."
    Install-WithWinget -Id "OpenJS.NodeJS.LTS" | Out-Null
    Update-SessionPath
    if (Test-CommandWorks "node") {
        Log "2) Node.js berhasil terpasang: $(node --version 2>&1)"
    } else {
        Log "2) PERINGATAN: Node.js masih tidak terdeteksi setelah install."
    }
}

# ---------------------------------------------------------------------------
# 3) PostgreSQL
# ---------------------------------------------------------------------------
# Password superuser dipakai SAAT instalasi PostgreSQL dan ditulis ke .env
# supaya DEXAZ bisa langsung connect otomatis tanpa isi manual. Disimpan
# di file lokal supaya konsisten kalau setup ini terpanggil ulang.
$pgPasswordFile = Join-Path $root ".pg-setup-password"
if (Test-Path $pgPasswordFile) {
    $pgPassword = (Get-Content -LiteralPath $pgPasswordFile -Raw).Trim()
} else {
    $pgPassword = New-RandomToken -Length 20
    Set-Content -LiteralPath $pgPasswordFile -Value $pgPassword -NoNewline
}

$existingPgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1

if ($existingPgService) {
    Log "3) PostgreSQL sudah terpasang sebagai service: $($existingPgService.Name) (status: $($existingPgService.Status))"
    if ($existingPgService.Status -ne "Running") {
        try {
            Start-Service -Name $existingPgService.Name -ErrorAction Stop
            Log "3) Service PostgreSQL berhasil dinyalakan."
        } catch {
            Log "3) Gagal menyalakan service PostgreSQL: $_"
        }
    }
    Log "3) PostgreSQL sudah ada sebelumnya - password superuser TIDAK diubah otomatis. Kalau .env belum ada, DBX_BOOTSTRAP_PASSWORD perlu diisi manual sesuai password PostgreSQL yang sudah ada."
} else {
    # Installer PostgreSQL versi baru butuh komponen VBScript Windows.
    # Di beberapa instalasi Windows terbaru komponen ini opsional/nonaktif.
    try {
        $vbscript = Get-WindowsCapability -Online -Name "VBSCRIPT~~~~*" -ErrorAction Stop
        if ($vbscript -and $vbscript.State -ne "Installed") {
            Log "3) Mengaktifkan komponen Windows VBScript (dibutuhkan installer PostgreSQL)..."
            Add-WindowsCapability -Name $vbscript.Name -Online -ErrorAction Stop | Out-Null
        }
    } catch {
        Log "3) (info) Tidak bisa cek/aktifkan komponen VBScript otomatis: $_ - lanjut coba install PostgreSQL."
    }

    Log "3) PostgreSQL tidak ditemukan, install lewat winget (superuser password digenerate otomatis)..."
    $overrideArgs = "--mode unattended --unattendedmodeui none --superpassword $pgPassword --serverport 5432"
    Install-WithWinget -Id "PostgreSQL.PostgreSQL.16" -Override $overrideArgs | Out-Null

    Start-Sleep -Seconds 5
    $newPgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($newPgService) {
        Log "3) PostgreSQL berhasil terpasang sebagai service: $($newPgService.Name) (status: $($newPgService.Status))"
        if ($newPgService.Status -ne "Running") {
            try { Start-Service -Name $newPgService.Name -ErrorAction Stop } catch { Log "3) Gagal start service: $_" }
        }
    } else {
        Log "3) PERINGATAN: PostgreSQL tidak terdeteksi sebagai service setelah install. Cek logs\winget-PostgreSQL_PostgreSQL_16-error.log."
    }
}

# ---------------------------------------------------------------------------
# 4) Siapkan .env kalau belum ada
# ---------------------------------------------------------------------------
$envPath        = Join-Path $root ".env"
$envExamplePath = Join-Path $root ".env.example"

if (-not (Test-Path $envPath)) {
    Log "4) .env belum ada, membuat baru dari .env.example..."

    if (-not (Test-Path $envExamplePath)) {
        Log "4) GAGAL: .env.example tidak ditemukan, tidak bisa membuat .env otomatis. Buat manual."
    } else {
        $secretKey = New-RandomToken -Length 48
        $jwtSecret = New-RandomToken -Length 48

        $encryptionKey = ""
        try {
            $encryptionKey = (& python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>$null | Select-Object -Last 1)
            if ($encryptionKey) { $encryptionKey = $encryptionKey.Trim() }
        } catch { }

        $adminPassword = New-RandomToken -Length 12

        $content = Get-Content -LiteralPath $envExamplePath -Raw
        $content = $content -replace 'SECRET_KEY=.*', "SECRET_KEY=$secretKey"
        $content = $content -replace 'JWT_SECRET=.*', "JWT_SECRET=$jwtSecret"
        if ($encryptionKey) {
            $content = $content -replace 'ENCRYPTION_KEY=.*', "ENCRYPTION_KEY=$encryptionKey"
        } else {
            Log "4) (info) Belum bisa generate ENCRYPTION_KEY lewat python di tahap ini (venv backend belum ada) - baris ENCRYPTION_KEY di .env dibiarkan placeholder, isi manual sebelum pakai untuk data sungguhan: python -c `"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())`""
        }
        $content = $content -replace 'DBX_ADMIN_PASSWORD=.*', "DBX_ADMIN_PASSWORD=$adminPassword"
        $content = $content -replace 'DBX_BOOTSTRAP_NAME=.*', "DBX_BOOTSTRAP_NAME=Local PostgreSQL"
        $content = $content -replace 'DBX_BOOTSTRAP_HOST=.*', "DBX_BOOTSTRAP_HOST=127.0.0.1"
        $content = $content -replace 'DBX_BOOTSTRAP_PORT=.*', "DBX_BOOTSTRAP_PORT=5432"
        $content = $content -replace 'DBX_BOOTSTRAP_DATABASE=.*', "DBX_BOOTSTRAP_DATABASE=postgres"
        $content = $content -replace 'DBX_BOOTSTRAP_USERNAME=.*', "DBX_BOOTSTRAP_USERNAME=postgres"
        $content = $content -replace 'DBX_BOOTSTRAP_PASSWORD=.*', "DBX_BOOTSTRAP_PASSWORD=$pgPassword"

        Set-Content -LiteralPath $envPath -Value $content -Encoding UTF8
        Log "4) .env berhasil dibuat."

        $credText = @"
DEXAZ - kredensial hasil setup otomatis ($(Get-Date))
======================================================
Login DEXAZ (setelah app terbuka) : admin / $adminPassword
PostgreSQL superuser               : postgres / $pgPassword  (host 127.0.0.1:5432)

Simpan info ini di tempat aman. Disarankan ganti password admin DEXAZ
lewat halaman profil setelah login pertama kali.
"@
        Set-Content -LiteralPath (Join-Path $logDir "credentials.txt") -Value $credText -Encoding UTF8
        Log "4) Kredensial dicatat di logs\credentials.txt"
    }
} else {
    Log "4) .env sudah ada, tidak diubah."
}

Log "Setup prasyarat selesai."
