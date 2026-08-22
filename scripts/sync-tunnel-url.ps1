# Reads the active quick-tunnel URL from the Docker cloudflared container,
# writes it to n8n_AI_assistant/.env (PUBLIC_WEBHOOK_URL), and recreates n8n.
#
# Run after: docker restart cloudflared   (URL changes on every restart!)
#
#   powershell -ExecutionPolicy Bypass -File scripts\sync-tunnel-url.ps1
$ErrorActionPreference = "Stop"
$proj = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $proj ".env"
$n8nCompose = Join-Path (Split-Path $proj -Parent) "projekt_z_n8n"

$logs = cmd /c "docker logs cloudflared 2>&1"
$line = [regex]::Matches($logs, 'https://[a-z0-9-]+\.trycloudflare\.com') | Select-Object -Last 1
if (-not $line) {
  Write-Host "No tunnel URL in cloudflared logs. Start it:"
  Write-Host "  cd $n8nCompose"
  Write-Host "  docker compose up -d cloudflared"
  exit 1
}

$url = $line.Value.TrimEnd('/')
Write-Host "Tunnel URL: $url"

$content = Get-Content $envFile -Raw
$content = $content -replace 'PUBLIC_WEBHOOK_URL=.*', "PUBLIC_WEBHOOK_URL=$url/"
Set-Content $envFile $content -NoNewline

Push-Location $n8nCompose
docker compose up -d --force-recreate n8n | Out-Null
Pop-Location

Start-Sleep 8
docker exec n8n n8n publish:workflow --id=68osxI9fvq7pBgCA 2>&1 | Out-Null

Push-Location $proj
node scripts/sync-retell-urls.mjs
Pop-Location

Write-Host "Updated .env + recreated n8n + synced Retell URLs. Test:"
Write-Host "  curl -X POST $url/webhook/retell-call-analyzed -H 'Content-Type: application/json' -d '@scripts/test-retell-webhook.json'"
Write-Host ""
Write-Host "Retell webhooks + calendar tools updated automatically."
