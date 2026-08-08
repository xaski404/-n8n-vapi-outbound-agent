# Starts a Cloudflare quick tunnel to local n8n (:5678) and updates .env PUBLIC_WEBHOOK_URL.
# Keep this terminal OPEN — closing it kills the tunnel.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-tunnel.ps1
#
# Requires: cloudflared (winget install Cloudflare.cloudflared)
$ErrorActionPreference = "Stop"
$proj = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $proj ".env"
$logFile = Join-Path $PSScriptRoot "tunnel.log"

# Refresh PATH so cloudflared is found after winget install (new terminals only otherwise).
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host "cloudflared not found. Install: winget install Cloudflare.cloudflared"
  Write-Host "Then open a NEW terminal and run this script again."
  exit 1
}

Write-Host "Starting quick tunnel -> http://localhost:5678"
Write-Host "Waiting for URL (up to 30s)..."

$job = Start-Job {
  param($log)
  cloudflared tunnel --url http://localhost:5678 --no-autoupdate 2>&1 | Tee-Object -FilePath $log
} -ArgumentList $logFile

$url = $null
for ($i = 0; $i - 30; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $logFile) {
    $match = Select-String -Path $logFile -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
    if ($match) {
      $url = ($match.Matches[0].Value).TrimEnd('/')
      break
    }
  }
}

if (-not $url) {
  Stop-Job $job -Force | Out-Null
  Remove-Job $job -Force | Out-Null
  Write-Host "Could not read tunnel URL. Check $logFile"
  exit 1
}

# Update .env PUBLIC_WEBHOOK_URL
$content = Get-Content $envFile -Raw
$content = $content -replace 'PUBLIC_WEBHOOK_URL=.*', "PUBLIC_WEBHOOK_URL=$url/"
Set-Content $envFile $content -NoNewline

Write-Host ""
Write-Host "Tunnel URL: $url"
Write-Host "Updated .env -> PUBLIC_WEBHOOK_URL=$url/"
Write-Host ""
Write-Host "Restart n8n to pick up the new URL:"
Write-Host "  docker restart n8n"
Write-Host ""
Write-Host "Tunnel is running in background job. To stop: Stop-Job $($job.Id); Remove-Job $($job.Id)"
Write-Host "For production use a named Cloudflare tunnel or VPS — quick tunnels are temporary."

Receive-Job $job -Wait
