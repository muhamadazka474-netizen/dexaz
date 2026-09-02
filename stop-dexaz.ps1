<#
  stop-dexaz.ps1
  ------------------
  Menghentikan DEXAZ: mematikan proses loading/backend/frontend (lewat PID
  yang dicatat run-dexaz.ps1 di logs/dexaz-pids.json, tree-kill supaya
  proses anak seperti worker uvicorn --reload atau "next dev" milik npm
  ikut mati juga), DITAMBAH jaring pengaman lewat port 3000/8000/4321
  seperti sebelumnya. Diperlukan karena run-dexaz.bat menjalankan backend &
  frontend sebagai proses tersembunyi (tanpa jendela terminal yang bisa
  ditutup manual).
#>

$ErrorActionPreference = "Stop"

$root         = $PSScriptRoot
$logDir       = Join-Path $root "logs"
$pidFile      = Join-Path $logDir "dexaz-pids.json"
$frontendPort = 3000
$backendPort  = 8000
$loadingPort  = 4321

function Stop-ProcessTree {
    param([int]$ProcessId)

    if (-not $ProcessId) { return }

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId $child.ProcessId
    }

    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    } catch {
        # Sudah mati duluan / tidak ditemukan - abaikan.
    }
}

function Stop-ProcessOnPort {
    param([int]$Port)

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
        Stop-ProcessTree -ProcessId $procId
    }
}

# 1) Lewat PID yang tercatat run terakhir (tree-kill). Sekalian baca port
#    FINAL yang tercatat run terakhir - bisa beda dari default 3000/8000/4321
#    kalau run-dexaz.ps1 sempat menggesernya otomatis (lihat Resolve-PortOrShift)
#    karena port default dipakai aplikasi lain.
$recordedPorts = @()
if (Test-Path $pidFile) {
    try {
        $prevPids = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
        foreach ($label in @("loading", "backend", "frontend")) {
            $prevPid = $prevPids.$label
            if ($prevPid) {
                Stop-ProcessTree -ProcessId ([int]$prevPid)
            }
        }
        foreach ($portField in @("loading_port", "backend_port", "frontend_port")) {
            if ($prevPids.$portField) { $recordedPorts += [int]$prevPids.$portField }
        }
    } catch {
        # File PID rusak/tidak terbaca - tetap lanjut ke pembersihan lewat port.
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

# 2) Jaring pengaman lewat port: port default DITAMBAH port final yang
#    tercatat run terakhir (kalau beda dari default), untuk apa pun yang
#    tidak tercatat di PID file.
$portsToClean = @($frontendPort, $backendPort, $loadingPort) + $recordedPorts | Sort-Object -Unique
foreach ($p in $portsToClean) {
    Stop-ProcessOnPort -Port $p
}

try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("DEXAZ sudah dihentikan.", "DEXAZ", "OK", "Information") | Out-Null
} catch {
    # jika MessageBox gagal (mis. server headless), tidak apa-apa - proses tetap dihentikan.
}
