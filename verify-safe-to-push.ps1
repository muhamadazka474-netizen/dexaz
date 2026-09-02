# verify-safe-to-push.ps1
#
# Jalankan ini SEBELUM setiap `git push`, sebagai pengecekan terakhir.
# Tidak mengubah apa pun — cuma memeriksa dan melaporkan.
#
# Cara pakai: klik kanan -> "Run with PowerShell", atau dari terminal:
#   powershell -ExecutionPolicy Bypass -File .\verify-safe-to-push.ps1

$ErrorActionPreference = "Stop"
$problems = @()

Write-Host "== Mengecek apakah aman untuk push ke GitHub ==" -ForegroundColor Cyan

# 1. .env tidak boleh ter-track oleh git sama sekali
$tracked = git ls-files | Select-String -Pattern '(^|/)\.env$|(^|/)\.env\.[^.]*$' | Where-Object { $_ -notmatch '\.env\.example$' }
if ($tracked) {
    $problems += "File .env asli SEDANG DI-TRACK git: $tracked"
} else {
    Write-Host "[OK] .env tidak ter-track oleh git" -ForegroundColor Green
}

# 2. .env tidak boleh pernah ada di history commit
$inHistory = git log --all --full-history --name-only --pretty=format: -- .env 2>$null | Where-Object { $_ -ne "" }
if ($inHistory) {
    $problems += ".env pernah muncul di git history (lihat: git log --all --full-history -- .env)"
} else {
    Write-Host "[OK] .env tidak pernah ada di git history" -ForegroundColor Green
}

# 3. .gitignore harus punya baris .env
$gitignore = Get-Content .gitignore -Raw -ErrorAction SilentlyContinue
if ($gitignore -notmatch '(?m)^\.env$') {
    $problems += ".gitignore tidak (lagi) berisi baris '.env' — cek apakah ada yang mengedit .gitignore"
} else {
    Write-Host "[OK] .gitignore berisi '.env'" -ForegroundColor Green
}

# 4. Peringatan kalau nilai .env masih placeholder / default
if (Test-Path .env) {
    $envContent = Get-Content .env -Raw
    if ($envContent -match 'DBX_ADMIN_PASSWORD=(admin|admin123|change-me-on-first-login)\b') {
        $problems += "DBX_ADMIN_PASSWORD masih nilai default/lemah — ganti sebelum online."
    }
    if ($envContent -match 'SECRET_KEY=change-me' -or $envContent -match 'JWT_SECRET=change-me' -or $envContent -match 'ENCRYPTION_KEY=change-me') {
        $problems += "SECRET_KEY/JWT_SECRET/ENCRYPTION_KEY masih nilai contoh dari .env.example — generate nilai acak baru."
    }
}

# 5. git status ringkas, biar kelihatan apa yang mau ke-commit
Write-Host "`n== git status ==" -ForegroundColor Cyan
git status --short

Write-Host ""
if ($problems.Count -eq 0) {
    Write-Host "AMAN: tidak ada masalah yang terdeteksi. Silakan lanjut push." -ForegroundColor Green
} else {
    Write-Host "DITEMUKAN MASALAH — JANGAN PUSH DULU:" -ForegroundColor Red
    foreach ($p in $problems) { Write-Host " - $p" -ForegroundColor Red }
    exit 1
}
