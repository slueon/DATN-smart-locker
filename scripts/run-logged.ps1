# run-logged.ps1 — bật backend + vite CÓ ghi log, cho việc chẩn đoán.
#
# Vì sao cần file này: `node scripts/devctl.mjs up` không ghi được log (đã thử 3 cách, cả 3 hỏng
# trên máy này — xem ghi chú trong devctl.mjs). Đọc WARN/MQTT/scheduler cần log thật thì chạy file này.
#
# Dùng:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-logged.ps1
#
# Log ghi vào scripts\evidence\backend-live.log và vite-live.log (ghi đè mỗi lần chạy).
# Tắt bằng: node scripts\devctl.mjs down

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $root 'backend\smart-locker-backend'
$frontendDir = Join-Path $root 'frontend'
$ev = Join-Path $root 'scripts\evidence'

New-Item -ItemType Directory -Path $ev -Force | Out-Null
$bLog = Join-Path $ev 'backend-live.log'
$vLog = Join-Path $ev 'vite-live.log'

Write-Host "backend log : $bLog"
Write-Host "vite log    : $vLog"

Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', '.\mvnw.cmd -o spring-boot:run' `
    -WorkingDirectory $backendDir `
    -RedirectStandardOutput $bLog `
    -RedirectStandardError "$bLog.err" `
    -WindowStyle Hidden

Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'npm.cmd run dev' `
    -WorkingDirectory $frontendDir `
    -RedirectStandardOutput $vLog `
    -RedirectStandardError "$vLog.err" `
    -WindowStyle Hidden

# Chờ tới khi backend trả HTTP thật (không đoán theo port — bài học IPv6).
Write-Host 'chờ backend lên...'
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -Uri 'http://localhost:8080/api/lockers' -UseBasicParsing -TimeoutSec 3
        Write-Host "backend HTTP $($r.StatusCode) sau $($i * 2)s"
        break
    } catch {
        # 401 vẫn chứng minh server sống.
        if ($_.Exception.Response) {
            Write-Host "backend HTTP $([int]$_.Exception.Response.StatusCode) sau $($i * 2)s"
            break
        }
    }
}

Write-Host ''
Write-Host 'Xong. Đọc log bằng:'
Write-Host "  Get-Content '$bLog' -Encoding UTF8 -Tail 40"
