# Re-imports the generated workflow into the running n8n container, overwriting
# the existing workflow (matched by id) and re-activating it.
#
#   powershell -ExecutionPolicy Bypass -File scripts\reload.ps1
#
# Requires: n8n container named "n8n" (external stack at ..\projekt_z_n8n).
$ErrorActionPreference = "Stop"
$proj = Split-Path $PSScriptRoot -Parent
$wfId = "68osxI9fvq7pBgCA"
$src = Join-Path $proj "workflows\vapi-outbound-agent.json"
$tmp = Join-Path $proj "workflows\_reload.tmp.json"

# Inject the live workflow id + active flag and preserve Google Sheets credentials.
$liveExport = Join-Path $proj "workflows\_live-creds.json"
docker exec n8n n8n export:workflow --id=$wfId --output=/home/node/.n8n/_live-creds.json 2>&1 | Out-Null
docker cp "n8n:/home/node/.n8n/_live-creds.json" $liveExport
node -e "const fs=require('fs');const src=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const live=JSON.parse(fs.readFileSync(process.argv[2],'utf8'))[0];const liveCredNode = live.nodes.find((n) => n.credentials && n.credentials.googleSheetsOAuth2Api);
for (const node of src.nodes) {
  if (node.type === 'n8n-nodes-base.httpRequest' && liveCredNode && liveCredNode.credentials && liveCredNode.credentials.googleSheetsOAuth2Api && (node.name.includes('Google Sheets') || node.name.includes('Sheet Tab'))) {
    node.credentials = { googleSheetsOAuth2Api: liveCredNode.credentials.googleSheetsOAuth2Api };
  }
}src.id=process.argv[3];src.active=true;fs.writeFileSync(process.argv[4],JSON.stringify(src));" "$src" "$liveExport" "$wfId" "$tmp"
Remove-Item $liveExport -Force -ErrorAction SilentlyContinue

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
