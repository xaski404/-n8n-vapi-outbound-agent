# Restart n8n when UI shows "Offline" / healthz hangs after a webhook request.
# Also clears stuck "running" executions that block recovery on startup.
#
#   powershell -ExecutionPolicy Bypass -File scripts\fix-n8n-stuck.ps1
#
# UI: use http://localhost:5678 (NOT the cloudflare tunnel URL).
$ErrorActionPreference = "Stop"
$vol = "projekt_z_n8n_n8n_data"

Write-Host "Stopping n8n..."
docker stop n8n | Out-Null

Write-Host "Clearing stuck executions in SQLite..."
$clearSql = Join-Path $PSScriptRoot "_clear-running.sql"
try {
  docker run --rm -v "${vol}:/data" -v "${clearSql}:/clear.sql" alpine sh -c "apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 /data/database.sqlite < /clear.sql" | Out-Null
} catch {
  Write-Host "SQLite cleanup skipped"
}

Write-Host "Starting n8n..."
docker start n8n | Out-Null

$deadline = (Get-Date).AddSeconds(90)
do {
    Start-Sleep -Seconds 3
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:5678/healthz" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) {
            Write-Host "n8n OK -> http://localhost:5678"
            exit 0
        }
    } catch { Write-Host "." -NoNewline }
} while ((Get-Date) -lt $deadline)

Write-Host ""
Write-Host "n8n still not responding. Check: docker logs n8n --tail 50"
exit 1
