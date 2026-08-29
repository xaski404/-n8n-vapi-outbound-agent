# Re-imports the generated workflow into the running n8n container, overwriting
# the existing workflow (matched by id) and re-activating it.
#
#   powershell -ExecutionPolicy Bypass -File scripts\reload.ps1
#
# Requires: n8n container named "n8n" (external stack at ..\projekt_z_n8n).
$ErrorActionPreference = "Stop"
$proj = Split-Path $PSScriptRoot -Parent
$wfId = "68osxI9fvq7pBgCA"
$src = Join-Path $proj "workflows\retell-voice-agent.json"
$tmp = Join-Path $proj "workflows\_reload.tmp.json"

# Inject the live workflow id + active flag and preserve Google OAuth credentials.
$liveExport = Join-Path $proj "workflows\_live-creds.json"
$credExport = Join-Path $proj "workflows\_live-creds-export.json"
docker exec n8n n8n export:workflow --id=$wfId --output=/home/node/.n8n/_live-creds.json 2>&1 | Out-Null
docker cp "n8n:/home/node/.n8n/_live-creds.json" $liveExport
docker exec n8n n8n export:credentials --all --output=/home/node/.n8n/_live-creds-export.json 2>&1 | Out-Null
docker cp "n8n:/home/node/.n8n/_live-creds-export.json" $credExport
node (Join-Path $PSScriptRoot "inject-workflow-creds.mjs") "$src" "$liveExport" "$wfId" "$tmp" "$credExport"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Remove-Item $liveExport -Force -ErrorAction SilentlyContinue
Remove-Item $credExport -Force -ErrorAction SilentlyContinue

docker cp "$tmp" n8n:/tmp/wf.json
docker exec n8n n8n import:workflow --input=/tmp/wf.json 2>&1 | Select-String -Pattern "imported"
docker exec n8n n8n publish:workflow --id=$wfId 2>&1 | Select-String -Pattern "Publishing"
Remove-Item $tmp -Force

# n8n 2.x registers production webhooks only after restart following publish.
docker restart n8n | Out-Null
$deadline = (Get-Date).AddSeconds(90)
do {
  Start-Sleep -Seconds 3
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:5678/healthz" -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -eq 200) { break }
  } catch {}
} while ((Get-Date) -lt $deadline)

Write-Output "n8n reloaded - workflow $wfId published (webhooks active after restart)"
