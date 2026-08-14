# Keeps the cloudflared quick-tunnel alive. Restarts + syncs URL when the public webhook dies.
#
# Run in background (leave terminal open):
#   powershell -ExecutionPolicy Bypass -File scripts\tunnel-watchdog.ps1
#
# Or once:
#   powershell -ExecutionPolicy Bypass -File scripts\tunnel-watchdog.ps1 -Once
param(
  [int]$IntervalSec = 120,
  [switch]$Once
)

$ErrorActionPreference = "Continue"
$proj = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $proj ".env"
$syncScript = Join-Path $PSScriptRoot "sync-tunnel-url.ps1"

function Get-PublicWebhookUrl {
  if (-not (Test-Path $envFile)) { return $null }
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^PUBLIC_WEBHOOK_URL=(.+)$') {
      return $Matches[1].Trim().TrimEnd('/')
    }
  }
  return $null
}

function Test-Tunnel([string]$BaseUrl) {
  if (-not $BaseUrl) { return $false }
  try {
    $r = Invoke-WebRequest -Uri "$BaseUrl/healthz" -UseBasicParsing -TimeoutSec 15
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Repair-Tunnel {
  $ts = Get-Date -Format "HH:mm:ss"
  Write-Host "[$ts] Tunnel down - restarting cloudflared..."
  docker restart cloudflared | Out-Null
  Start-Sleep 18
  & powershell -ExecutionPolicy Bypass -File $syncScript
}

do {
  $url = Get-PublicWebhookUrl
  $ts = Get-Date -Format "HH:mm:ss"
  if (Test-Tunnel $url) {
    Write-Host "[$ts] OK $url"
  } else {
    Write-Host "[$ts] FAIL $url"
    Repair-Tunnel
  }
  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSec
} while ($true)
