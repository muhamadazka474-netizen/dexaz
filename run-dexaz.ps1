<#
  run-dexaz.ps1
  ------------------
  Menjalankan DEXAZ dari awal secara otomatis — TANPA jendela
  PowerShell/terminal yang terlihat sama sekali:
    0) Kalau Python/Node.js/PostgreSQL belum ada di PC ini, auto-install
       lewat winget dulu (setup-dexaz.ps1) — bikin PC kosong bisa langsung
       jalan. Cuma butuh SATU klik "Yes" di prompt UAC kalau ini kejadian.
    1) Matikan TOTAL semua proses DEXAZ dari run sebelumnya (lewat PID yang
       dicatat run terakhir, DITAMBAH pencarian ulang lewat port sebagai
       jaring pengaman) sebelum menyalakan apa pun yang baru — supaya
       setiap kali diklik selalu mulai dari kondisi benar-benar bersih,
       tidak pernah tabrakan dengan proses lama yang masih nyangkut.
    2) Nyalakan server loading kecil di localhost & buka halaman loading
       di browser default lewat URL http:// biasa (bukan file .html
       langsung), supaya selalu benar-benar pakai browser default.
    3) Setup + jalankan backend (venv + install requirements) lalu
       `uvicorn main:app --reload --host 127.0.0.1 --port 8000`
       sebagai proses background tersembunyi (output ditulis ke logs/).
    4) Setup + jalankan frontend (`npm install`) lalu `npm run dev`
       sebagai proses background tersembunyi (output ditulis ke logs/).
    5) Halaman loading sendiri yang menunggu frontend siap (polling via
       JavaScript) lalu pindah otomatis ke http://127.0.0.1:3000/login.
    6) Catat PID dari ketiga proses (loading/backend/frontend) yang baru
       dinyalakan ke logs/dexaz-pids.json, supaya run BERIKUTNYA tahu
       persis apa yang harus dimatikan di langkah 1.

  Kenapa perlu langkah 1 yang "total": menutup tab browser TIDAK mematikan
  backend/frontend (memang didesain begitu, supaya kalau browser tidak
  sengaja tertutup, aplikasi tetap jalan). Tapi kalau lalu run-dexaz.bat
  diklik lagi, proses lama itu wajib benar-benar mati dulu sebelum proses
  baru dinyalakan — kalau tidak, proses baru bentrok rebutan port yang
  sama dengan proses lama (uvicorn --reload & npm juga suka menyalakan
  proses anak tersembunyi yang tidak ketahuan cuma dari PID induknya),
  yang berujung ke frontend/backend gagal nyala dan halaman loading
  di port 4321 tidak pernah terhubung / muter terus tanpa akhir.

  Skrip ini dijalankan lewat run-dexaz.bat -> run-dexaz-hidden.vbs, jadi
  tidak pernah menampilkan jendela apa pun ke pengguna (kecuali prompt UAC
  di step 0 kalau memang ada prasyarat yang belum terpasang). Semua log
  proses ada di folder logs/ untuk keperluan troubleshooting.

  Untuk menghentikan DEXAZ, jalankan stop-dexaz.bat.
#>

$ErrorActionPreference = "Stop"

$root         = $PSScriptRoot
$backendDir   = Join-Path $root "backend"
$frontendDir  = Join-Path $root "frontend"
$logDir       = Join-Path $root "logs"
$loadingPage  = Join-Path $root "dexaz-loading.html"
$pidFile      = Join-Path $logDir "dexaz-pids.json"
$frontendPort = 3000
$backendPort  = 8000
$loadingPort  = 4321

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

$orchestratorLog = Join-Path $logDir "run-dexaz.log"
function Log($text) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $text
    Add-Content -LiteralPath $orchestratorLog -Value $line
}

"--- run-dexaz start $(Get-Date) ---" | Out-File -LiteralPath $orchestratorLog -Encoding UTF8

# ---------------------------------------------------------------------------
# Helper: matikan satu proses BESERTA seluruh anak/cucu-nya (uvicorn --reload
# menyalakan proses worker terpisah dari proses supervisor-nya; "npm run dev"
# menyalakan proses "next dev" sebagai anak node.exe terpisah dari npm-nya).
# Mematikan cuma proses induk (atau cuma proses yang kebetulan lagi pegang
# port) sering menyisakan salah satu dari mereka tetap hidup / auto-restart.
# ---------------------------------------------------------------------------
function Stop-ProcessTree {
    param([int]$ProcessId)

    if (-not $ProcessId) { return }

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId $child.ProcessId
    }

    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        Log "  - PID $ProcessId dimatikan."
    } catch {
        # Sudah mati duluan / tidak ditemukan - abaikan.
    }
}

# ---------------------------------------------------------------------------
# 0) Kalau prasyarat (Python, Node.js, PostgreSQL) belum lengkap di PC ini,
#    jalankan setup-dexaz.ps1 dulu (auto-install lewat winget). Ini membuat
#    PC yang benar-benar baru/kosong tetap bisa langsung jalan cukup dengan
#    klik run-dexaz.bat. Satu-satunya interaksi manual yang mungkin muncul
#    adalah SATU prompt UAC (izin Administrator untuk winget install) —
#    hanya terjadi kalau memang ada yang belum terpasang.
# ---------------------------------------------------------------------------
function Test-CommandWorks {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

$needsSetup = (-not (Test-CommandWorks "python")) -or (-not (Test-CommandWorks "node")) -or (-not (Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue))

if ($needsSetup) {
    Log "0) Prasyarat belum lengkap (Python/Node.js/PostgreSQL), menjalankan setup-dexaz.ps1..."
    $setupScript = Join-Path $root "setup-dexaz.ps1"
    if (Test-Path $setupScript) {
        try {
            & $setupScript
        } catch {
            Log "0) setup-dexaz.ps1 gagal dijalankan: $_"
        }
        # Refresh PATH di proses ini juga, siapa tahu baru saja terpasang.
        $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
        $userPath    = [Environment]::GetEnvironmentVariable("Path", "User")
        $env:Path = @($machinePath, $userPath) -join ";"
        Log "0) setup-dexaz.ps1 selesai, lanjut ke tahap berikutnya."
    } else {
        Log "0) setup-dexaz.ps1 tidak ditemukan di folder project, lewati auto-setup."
    }
} else {
    Log "0) Semua prasyarat (Python, Node.js, service PostgreSQL) sudah terdeteksi."
}

# ---------------------------------------------------------------------------
# 1) Matikan TOTAL semua sisa proses DEXAZ dari run sebelumnya, dengan DUA
#    lapis supaya tidak ada yang lolos:
#      a) Lewat PID yang dicatat run terakhir di logs/dexaz-pids.json —
#         setiap PID dimatikan BESERTA seluruh proses anak/cucu-nya.
#      b) Jaring pengaman: cari ulang siapa pun yang masih memegang port
#         3000/8000/4321 dan matikan juga (menutup celah proses lama yang
#         entah kenapa tidak tercatat di PID file, mis. run pertama kali
#         sebelum fitur ini ada, atau proses yang sempat auto-restart).
#    Baru setelah port-port ini benar-benar bebas, lanjut menyalakan yang
#    baru — supaya tidak pernah rebutan port dengan proses lama.
# ---------------------------------------------------------------------------
function Stop-ProcessOnPort {
    param(
        [int]$Port,
        # PENTING (fix): kalau diisi, HANYA proses yang command line-nya
        # mengandung teks ini (mis. path folder frontend/backend DEXAZ)
        # yang akan dimatikan - dicocokkan case-insensitive lewat -like.
        # Sebelumnya fungsi ini mematikan SIAPA PUN yang kebetulan sedang
        # memegang port 3000/8000, tanpa peduli itu proses DEXAZ atau
        # bukan. Di PC yang juga punya proyek Node.js lain (atau aplikasi
        # lain apa pun) yang kebetulan jalan di port yang sama, ini
        # berarti DEXAZ diam-diam mencoba mematikan aplikasi ORANG LAIN -
        # dan kalau itu gagal (izin akses ditolak, proses auto-restart
        # oleh tool lain, dst.), DEXAZ tetap memaksa pakai port itu juga,
        # bukannya pindah ke port lain - hasilnya gagal terus sampai
        # pengguna mematikan proses itu manual lewat Task Manager.
        #
        # Sekarang: kalau $OnlyIfCommandLineContains diisi dan proses yang
        # ditemukan TERNYATA BUKAN proses DEXAZ (command line tidak
        # cocok), proses itu DIBIARKAN SAJA - tidak disentuh sama sekali.
        # Resolve-PortOrShift (dipanggil setelah fungsi ini) akan otomatis
        # mendeteksi port itu masih terpakai dan memindahkan DEXAZ ke port
        # kosong berikutnya - jauh lebih aman dan jauh lebih andal
        # daripada terus mencoba (dan gagal) merebut port dari aplikasi
        # yang tidak terkait sama sekali.
        [string]$OnlyIfCommandLineContains = $null
    )

    $procIds = @()

    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        $procIds = $conns.OwningProcess | Sort-Object -Unique
    } catch {
        $lines = netstat -ano | Select-String ":$Port\s" | Select-String "LISTENING"
        foreach ($line in $lines) {
            $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne "" }
            if ($parts.Length -gt 0) {
                $procIds += [int]$parts[-1]
            }
        }
        $procIds = $procIds | Sort-Object -Unique
    }

    if (-not $procIds -or $procIds.Count -eq 0) {
        return
    }

    foreach ($procId in $procIds) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { "?" }

        if ($OnlyIfCommandLineContains) {
            $cmdLine = $null
            try {
                $cimProc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
                $cmdLine = $cimProc.CommandLine
            } catch { }

            if (-not $cmdLine -or ($cmdLine -notlike "*$OnlyIfCommandLineContains*")) {
                Log "  Port $Port dipakai PID $procId ($name) tapi BUKAN proses DEXAZ (command line tidak cocok) - dibiarkan, DEXAZ akan pindah port otomatis kalau perlu."
                continue
            }
        }

        Log "  Port $Port masih dipakai PID $procId ($name, proses DEXAZ) - mematikan tree-nya..."
        Stop-ProcessTree -ProcessId $procId
    }
}

# ---------------------------------------------------------------------------
# Pembersihan KHUSUS untuk proses listener halaman loading (port 4321).
#
# `Stop-ProcessOnPort` (di atas) tidak bisa diandalkan untuk port ini:
# listener-nya pakai [System.Net.HttpListener] yang jalan lewat driver
# kernel HTTP.sys - akibatnya Windows/netstat SELALU melaporkan pemilik
# socket-nya sebagai PID 4 ("System"), bukan PID powershell.exe yang
# sebenarnya menjalankannya. `Stop-ProcessTree` yang mencoba mematikan PID 4
# akan gagal (proses System dilindungi), jadi proses powershell.exe yang
# sesungguhnya bisa tetap nyangkut hidup tanpa terdeteksi oleh pengecekan
# berbasis port sama sekali.
#
# Sebagai jaring pengaman tambahan (di luar pembersihan lewat PID file di
# langkah 1a), cari lewat baris perintahnya: proses powershell.exe mana pun
# yang command line-nya mengandung penanda unik DEXAZ-LOADING-LISTENER,
# lalu matikan. Ini menutup celah kalau PID file dari run sebelumnya hilang/
# rusak/tidak sempat tertulis, sehingga listener lama bisa tetap hidup
# selamanya dan terus menyajikan versi dexaz-loading.html yang beku sejak
# proses itu pertama nyala.
# ---------------------------------------------------------------------------
function Stop-OrphanLoadingListeners {
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -like "*DEXAZ-LOADING-LISTENER*" }
        foreach ($p in $procs) {
            Log "  Ditemukan proses loading-listener nyangkut (PID $($p.ProcessId)) - mematikan..."
            Stop-ProcessTree -ProcessId $p.ProcessId
        }
    } catch {
        Log "  (info) Gagal mencari proses loading-listener nyangkut: $_"
    }
}

function Wait-PortFree {
    param([int]$Port, [int]$TimeoutSeconds = 8)

    for ($i = 0; $i -lt ($TimeoutSeconds * 2); $i++) {
        $inUse = $false
        try {
            $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
            $inUse = $conns.Count -gt 0
        } catch {
            $inUse = $false
        }
        if (-not $inUse) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

Log "1) Mematikan total sisa proses DEXAZ dari run sebelumnya"

# 1a-extra) Jaring pengaman khusus loading-listener (lihat penjelasan di
# definisi fungsinya) - dijalankan lebih dulu supaya proses lama yang
# nyangkut tidak sempat terus menyajikan halaman loading versi beku.
Stop-OrphanLoadingListeners

# 1a) Lewat PID yang tercatat run terakhir.
if (Test-Path $pidFile) {
    try {
        $prevPids = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
        foreach ($label in @("loading", "backend", "frontend")) {
            $prevPid = $prevPids.$label
            if ($prevPid) {
                Log "  Mematikan proses '$label' dari run sebelumnya (PID $prevPid)..."
                Stop-ProcessTree -ProcessId ([int]$prevPid)
            }
        }
    } catch {
        Log "  (info) Gagal membaca $pidFile , lewati - tetap lanjut ke pembersihan lewat port: $_"
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
} else {
    Log "  Tidak ada catatan PID dari run sebelumnya (mungkin run pertama kali)."
}

# 1b) Jaring pengaman: bersihkan proses DEXAZ yang KETINGGALAN dari run
#     sebelumnya kalau masih memegang port-nya (dikenali lewat command
#     line-nya - lihat parameter OnlyIfCommandLineContains di
#     Stop-ProcessOnPort). Kalau yang memegang port itu BUKAN proses
#     DEXAZ (aplikasi lain milik pengguna), dibiarkan saja tidak disentuh
#     - Resolve-PortOrShift di bawah akan otomatis memindahkan DEXAZ ke
#     port kosong berikutnya.
Stop-ProcessOnPort -Port $frontendPort -OnlyIfCommandLineContains $frontendDir
Stop-ProcessOnPort -Port $backendPort  -OnlyIfCommandLineContains $backendDir
Stop-ProcessOnPort -Port $loadingPort  -OnlyIfCommandLineContains "DEXAZ-LOADING-LISTENER"

foreach ($portCheck in @($frontendPort, $backendPort, $loadingPort)) {
    if (Wait-PortFree -Port $portCheck -TimeoutSeconds 8) {
        Log "  Port $portCheck sudah bebas."
    } else {
        Log "  Port $portCheck masih terpakai setelah 8 detik (kemungkinan aplikasi lain, bukan DEXAZ) - lanjut, port kosong berikutnya akan dipakai otomatis (lihat Resolve-PortOrShift)."
    }
}

# ---------------------------------------------------------------------------
# 1c) Kalau port default (3000/8000/4321) TETAP tidak bisa dibebaskan -
#     misalnya karena dipakai aplikasi LAIN yang tidak terkait DEXAZ sama
#     sekali (contoh nyata yang pernah kejadian: aplikasi WhatsApp-bridge
#     pihak ketiga yang auto-start dan kebetulan memakai port 3000 juga) -
#     jangan maksa bentrok. Cari port kosong berikutnya secara otomatis dan
#     pakai itu, supaya DEXAZ tetap bisa jalan tanpa pengguna harus matikan
#     aplikasi lain secara manual setiap kali.
# ---------------------------------------------------------------------------
function Test-PortFree {
    param([int]$Port)
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

function Get-NextFreePort {
    param([int]$PreferredPort, [int]$MaxTries = 25)
    for ($p = $PreferredPort; $p -lt ($PreferredPort + $MaxTries); $p++) {
        if (Test-PortFree -Port $p) { return $p }
    }
    return $null
}

function Resolve-PortOrShift {
    param([string]$Label, [int]$Port)

    if (Test-PortFree -Port $Port) {
        return $Port
    }

    Log "  Port $Port ($Label) masih dipakai proses lain yang bukan DEXAZ (atau tidak bisa dimatikan) - mencari port kosong berikutnya..."
    $altPort = Get-NextFreePort -PreferredPort ($Port + 1)
    if ($altPort) {
        Log "  -> $Label dipindah otomatis ke port $altPort."
        return $altPort
    }

    Log "  (peringatan) Tidak menemukan port kosong untuk $Label di sekitar $Port - tetap coba pakai $Port, mungkin akan gagal bind."
    return $Port
}

$frontendPort = Resolve-PortOrShift -Label "frontend" -Port $frontendPort
$backendPort  = Resolve-PortOrShift -Label "backend"  -Port $backendPort
$loadingPort  = Resolve-PortOrShift -Label "loading"   -Port $loadingPort

# ---------------------------------------------------------------------------
# Membuka halaman loading di browser DEFAULT milik pengguna.
#
# Start-Process langsung pada FILE .html mengikuti asosiasi tipe file,
# yang di Windows kadang beda dari "browser default" untuk link http/https
# (sering nyasar ke Edge). Coba baca command dari registry ternyata rapuh:
# banyak variasi ProgId/argumen antar browser & versi Windows yang gampang
# meleset dan bikin seluruh proses gagal diam-diam.
#
# Solusi yang jauh lebih tahan banting: sajikan dexaz-loading.html lewat
# server HTTP kecil di 127.0.0.1, lalu buka sebagai URL http:// biasa.
# Start-Process pada URL http/https SELALU memakai browser default yang
# sebenarnya (persis UserChoice yang sama), tanpa kita perlu tebak-tebak
# path/argumen executable-nya sama sekali.
# ---------------------------------------------------------------------------
Log "2) Menyalakan server loading page (port $loadingPort) & membuka browser default"

$loadingProcId = $null

if (Test-Path $loadingPage) {
    $loadingListenerCmd = @"
# DEXAZ-LOADING-LISTENER - penanda unik, JANGAN dihapus: dipakai
# Stop-OrphanLoadingListeners di run-dexaz.ps1 untuk menemukan & mematikan
# proses ini di run berikutnya lewat command line-nya (karena port 4321
# selalu terdeteksi milik PID System di netstat, bukan PID proses ini).
`$ErrorActionPreference = 'SilentlyContinue'
try {
    `$listener = `$null
    # Coba bind beberapa kali - kalau port baru saja dilepas proses lama,
    # Windows kadang butuh sesaat (TIME_WAIT) sebelum benar-benar bisa
    # dipakai lagi. Sebelumnya kegagalan bind di sini didiamkan begitu saja
    # (listener tidak pernah nyala, browser lalu "can't connect" ke
    # localhost:$loadingPort tanpa penjelasan) - sekarang dicoba ulang dulu.
    for (`$attempt = 0; `$attempt -lt 10; `$attempt++) {
        try {
            `$listener = New-Object System.Net.HttpListener
            `$listener.Prefixes.Add('http://localhost:$loadingPort/')
            `$listener.Start()
            break
        } catch {
            `$listener = `$null
            Start-Sleep -Milliseconds 500
        }
    }
    if (`$listener) {
        # Menyala selama sesi DEXAZ berjalan (bukan cuma 10 menit) - supaya
        # kalau browser ditutup & dibuka lagi nyasar ke URL loading ini
        # (misal lewat riwayat/autocomplete), tetap otomatis diarahkan ke
        # aplikasi, bukan "can't connect". Ikut mati saat run-dexaz.bat
        # dijalankan ulang atau stop-dexaz.bat dijalankan.
        #
        # PENTING: file dibaca ULANG dari disk di SETIAP request (bukan
        # sekali di awal lalu disimpan di memori). Sebelumnya kalau proses
        # listener ini entah kenapa tidak mati bersih di antara dua run
        # (mis. tertinggal dari run yang jauh lebih lama), dia akan terus
        # menyajikan versi dexaz-loading.html yang beku di memori sejak
        # pertama kali nyala - walau file di disk sudah diperbarui. Ini bikin
        # perubahan/perbaikan pada dexaz-loading.html seolah tidak pernah
        # kepakai, padahal sebenarnya cuma tersaji dari versi lama yang
        # nyangkut. Baca ulang per-request membuat listener SELALU
        # menyajikan isi terbaru dari disk, apa pun umur proses listener-nya.
        while (`$listener.IsListening) {
            `$async = `$listener.BeginGetContext(`$null, `$null)
            if (`$async.AsyncWaitHandle.WaitOne(1000)) {
                `$context = `$listener.EndGetContext(`$async)
                try {
                    `$html = [System.IO.File]::ReadAllText('$loadingPage')
                    # Ganti placeholder port di HTML dengan port FINAL yang
                    # sebenarnya dipakai run ini (bisa beda dari default
                    # 3000/8000 kalau Resolve-PortOrShift terpaksa
                    # menggesernya karena port default dipakai aplikasi lain).
                    `$html = `$html.Replace('__DEXAZ_FRONTEND_PORT__', '$frontendPort').Replace('__DEXAZ_BACKEND_PORT__', '$backendPort')
                    `$htmlBytes = [System.Text.Encoding]::UTF8.GetBytes(`$html)
                    `$context.Response.ContentType = 'text/html; charset=utf-8'
                    `$context.Response.ContentLength64 = `$htmlBytes.Length
                    `$context.Response.OutputStream.Write(`$htmlBytes, 0, `$htmlBytes.Length)
                } catch { } finally {
                    `$context.Response.OutputStream.Close()
                }
            }
        }
        `$listener.Stop()
        `$listener.Close()
    }
} catch { }
"@

    $loadingOut = Join-Path $logDir "loading-server.log"
    $loadingErr = Join-Path $logDir "loading-server-error.log"

    try {
        $loadingProc = Start-Process powershell `
            -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", $loadingListenerCmd `
            -WindowStyle Hidden `
            -RedirectStandardOutput $loadingOut `
            -RedirectStandardError $loadingErr `
            -PassThru -ErrorAction Stop
        $loadingProcId = $loadingProc.Id

        # Tunggu sampai server loading benar-benar siap menerima koneksi
        # (maks ~6 detik, karena sekarang listener-nya sendiri juga boleh
        # retry bind sampai ~5 detik) sebelum memerintahkan browser membuka
        # URL-nya, supaya tidak terlihat "connection refused" saat browser
        # membuka.
        $ready = $false
        for ($i = 0; $i -lt 60; $i++) {
            try {
                $client = New-Object System.Net.Sockets.TcpClient
                $client.Connect("127.0.0.1", $loadingPort)
                $client.Close()
                $ready = $true
                break
            } catch {
                Start-Sleep -Milliseconds 100
            }
        }

        if ($ready) {
            Log "2) Server loading siap, membuka http://localhost:$loadingPort/ di browser default"
        } else {
            Log "2) (peringatan) Server loading belum konfirmasi siap - tetap coba buka browser, tapi mungkin masih 'can't connect' sesaat."
        }

        Start-Process "http://localhost:$loadingPort/" -ErrorAction Stop
    } catch {
        Log "2) Gagal menyalakan/membuka halaman loading: $_"
    }
} else {
    Log "2) dexaz-loading.html tidak ditemukan, lewati animasi loading."
}

# ---------------------------------------------------------------------------
# 3) Setup + jalankan backend dari awal, sebagai proses HIDDEN (tanpa
#    jendela terminal), output dicatat ke logs/backend*.log.
# ---------------------------------------------------------------------------
Log "3) Setup & jalankan backend (port $backendPort) - hidden"

if (-not (Test-Path $backendDir)) {
    Log "Folder backend tidak ditemukan di: $backendDir"
    throw "Folder backend tidak ditemukan di: $backendDir"
}

$backendOut = Join-Path $logDir "backend.log"
$backendErr = Join-Path $logDir "backend-error.log"
$backendReqHashFile = Join-Path $logDir "backend-requirements.hash"

# ---------------------------------------------------------------------------
# Backend hanya perlu `pip install -r requirements.txt` kalau:
#   a) folder venv belum ada sama sekali (setup pertama kali), ATAU
#   b) isi requirements.txt berubah sejak install terakhir (dibandingkan
#      lewat hash SHA256 yang disimpan di logs/backend-requirements.hash).
# Kalau tidak ada dari keduanya, install di-skip total supaya start jadi
# cepat - ini juga menghindari pip yang macet/lambat gara-gara folder
# project ada di OneDrive (sync/scan real-time suka mengunci file venv
# yang sedang ditulis pip, khususnya kalau dipicu tiap kali start padahal
# tidak ada yang berubah).
# ---------------------------------------------------------------------------
$backendCmd = @"
Set-Location -LiteralPath '$backendDir'
`$venvIsNew = `$false
if (-not (Test-Path 'venv')) {
    python -m venv venv
    `$venvIsNew = `$true
}

`$reqHashFile = '$backendReqHashFile'
`$currentHash = (Get-FileHash -LiteralPath 'requirements.txt' -Algorithm SHA256).Hash
`$previousHash = `$null
if (Test-Path `$reqHashFile) {
    `$previousHash = (Get-Content -LiteralPath `$reqHashFile -Raw).Trim()
}

if (`$venvIsNew -or (`$currentHash -ne `$previousHash)) {
    & '.\venv\Scripts\python.exe' -m pip install --upgrade pip
    & '.\venv\Scripts\python.exe' -m pip install -r requirements.txt
    Set-Content -LiteralPath `$reqHashFile -Value `$currentHash -NoNewline
}

# Override origin CORS lewat env var (menang atas nilai .env) supaya kalau
# frontend kebetulan digeser ke port lain (lihat Resolve-PortOrShift di atas
# karena port default 3000 dipakai aplikasi lain), backend tetap mengizinkan
# origin frontend yang SEBENARNYA dipakai saat ini - bukan nilai statis lama
# dari .env yang mungkin sudah tidak sesuai.
`$env:DBX_FRONTEND_ORIGIN = 'http://127.0.0.1:$frontendPort'

& '.\venv\Scripts\python.exe' -m uvicorn main:app --reload --host 127.0.0.1 --port $backendPort
"@

$backendProc = Start-Process powershell `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", $backendCmd `
    -WindowStyle Hidden `
    -RedirectStandardOutput $backendOut `
    -RedirectStandardError $backendErr `
    -PassThru

# ---------------------------------------------------------------------------
# 4) Setup + jalankan frontend dari awal, sebagai proses HIDDEN (tanpa
#    jendela terminal), output dicatat ke logs/frontend*.log.
# ---------------------------------------------------------------------------
Log "4) Setup & jalankan frontend (port $frontendPort) - hidden"

if (-not (Test-Path $frontendDir)) {
    Log "Folder frontend tidak ditemukan di: $frontendDir"
    throw "Folder frontend tidak ditemukan di: $frontendDir"
}

$frontendOut = Join-Path $logDir "frontend.log"
$frontendErr = Join-Path $logDir "frontend-error.log"
$frontendLockHashFile = Join-Path $logDir "frontend-package-lock.hash"

# ---------------------------------------------------------------------------
# Sama seperti backend: `npm install` hanya perlu dijalankan kalau folder
# node_modules belum ada, ATAU package-lock.json berubah sejak install
# terakhir (dibandingkan lewat hash SHA256 tersimpan). Kalau tidak,
# langsung lanjut ke `npm run dev` - jauh lebih cepat, dan menghindari
# npm install yang macet/sangat lambat gara-gara OneDrive sync/scan
# real-time saat menulis ribuan file kecil di node_modules padahal
# sebenarnya tidak ada yang perlu diinstal ulang.
# ---------------------------------------------------------------------------
$frontendCmd = @"
Set-Location -LiteralPath '$frontendDir'
`$nodeModulesMissing = -not (Test-Path 'node_modules')

`$lockHashFile = '$frontendLockHashFile'
`$currentHash = if (Test-Path 'package-lock.json') { (Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash } else { `$null }
`$previousHash = `$null
if (Test-Path `$lockHashFile) {
    `$previousHash = (Get-Content -LiteralPath `$lockHashFile -Raw).Trim()
}

if (`$nodeModulesMissing -or (`$currentHash -ne `$previousHash)) {
    npm install
    if (`$currentHash) {
        Set-Content -LiteralPath `$lockHashFile -Value `$currentHash -NoNewline
    }
}

# `-p $frontendPort` eksplisit: kalau port default (3000) dipakai aplikasi
# lain dan sudah digeser lewat Resolve-PortOrShift di atas, "next dev" HARUS
# diberi tahu port barunya secara eksplisit - dibiarkan default begitu saja
# akan tetap mencoba bind ke 3000 dan gagal.
# `NEXT_PUBLIC_API_URL` eksplisit: kalau port BACKEND kebetulan juga digeser
# (lihat Resolve-PortOrShift), frontend perlu tahu alamat backend yang
# sebenarnya - bukan asumsi default :8000 yang ada di kode (src/lib/api.ts).
`$env:NEXT_PUBLIC_API_URL = 'http://127.0.0.1:$backendPort'

npm run dev -- -p $frontendPort
"@

$frontendProc = Start-Process powershell `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", $frontendCmd `
    -WindowStyle Hidden `
    -RedirectStandardOutput $frontendOut `
    -RedirectStandardError $frontendErr `
    -PassThru

# ---------------------------------------------------------------------------
# 5) Catat PID loading/backend/frontend supaya run BERIKUTNYA (baik lewat
#    run-dexaz.bat lagi maupun stop-dexaz.bat) tahu persis proses mana yang
#    harus dimatikan duluan, tanpa perlu tebak-tebak lewat port saja.
# ---------------------------------------------------------------------------
$pidRecord = @{
    loading  = $loadingProcId
    backend  = $backendProc.Id
    frontend = $frontendProc.Id
    loading_port  = $loadingPort
    backend_port  = $backendPort
    frontend_port = $frontendPort
    started_at = (Get-Date).ToString("s")
}
$pidRecord | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8

Log "Selesai memicu backend & frontend (berjalan hidden di background)."
Log "Backend : http://127.0.0.1:$backendPort  (log: logs/backend.log, PID $($backendProc.Id))"
Log "Frontend: http://127.0.0.1:$frontendPort/login  (log: logs/frontend.log, PID $($frontendProc.Id))"
Log "PID dicatat ke logs/dexaz-pids.json untuk pembersihan run berikutnya."
Log "Halaman loading akan otomatis pindah ke DEXAZ begitu frontend siap."
