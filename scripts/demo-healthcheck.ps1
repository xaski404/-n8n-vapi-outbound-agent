# Quick health check before demo or after deploy.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\demo-healthcheck.ps1

$ErrorActionPreference = "Stop"
$url = "https://webhook.trening-kuba.pl/webhook/retell-check-availability"
$body = '{"name":"check_availability","args":{"preferred_day":"czwartek"},"call":{"call_id":"healthcheck"}}'

Write-Host "Checking calendar webhook..."
try {
  $r = Invoke-WebRequest -Uri $url -Method POST -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 15
  if ($r.Content -match '"available"\s*:\s*true') {
    Write-Host "OK - webhook responds, calendar reachable" -ForegroundColor Green
    exit 0
  }
  Write-Host "WARN - webhook responded but unexpected body:" -ForegroundColor Yellow
  Write-Host $r.Content
  exit 1
} catch {
  Write-Host "FAIL - webhook unreachable: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Check: docker compose ps (n8n + cloudflared must be Up)" -ForegroundColor Yellow
  exit 1
}
