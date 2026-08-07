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

# Inject the live workflow id + active flag so import overwrites in place.
node -e "const fs=require('fs');const w=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));w.id=process.argv[2];w.active=true;fs.writeFileSync(process.argv[3],JSON.stringify(w));" "$src" "$wfId" "$tmp"

docker cp "$tmp" n8n:/tmp/wf.json
docker exec n8n n8n import:workflow --input=/tmp/wf.json 2>&1 | Select-String -Pattern "imported"
docker exec n8n n8n update:workflow --id=$wfId --active=true 2>&1 | Select-String -Pattern "Publishing"
Remove-Item $tmp -Force

Set-Location (Join-Path (Split-Path $proj -Parent) "projekt_z_n8n")
docker compose restart n8n | Out-Null
Start-Sleep -Seconds 12
Write-Output "n8n reloaded - workflow $wfId active"
