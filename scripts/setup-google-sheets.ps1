# Google Sheets setup helper for the Vapi end-of-call workflow.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup-google-sheets.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\setup-google-sheets.ps1 -SpreadsheetId "abc123..."
#   powershell -ExecutionPolicy Bypass -File scripts\setup-google-sheets.ps1 -TestWebhook
#
param(
  [string]$SpreadsheetId = "",
  [switch]$TestWebhook
)

$ErrorActionPreference = "Stop"
$proj = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $proj ".env"

function Read-DotEnv([string]$Path) {
  $vars = @{}
  if (-not (Test-Path $Path)) { return $vars }
  Get-Content $Path | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $k, $v = $_ -split '=', 2
    $vars[$k.Trim()] = $v.Trim()
  }
  return $vars
}

function Set-DotEnvValue([string]$Path, [string]$Key, [string]$Value) {
  $lines = Get-Content $Path
  $found = $false
  $out = foreach ($line in $lines) {
    if ($line -match "^$([regex]::Escape($Key))=") {
      $found = $true
      "$Key=$Value"
    } else { $line }
  }
  if (-not $found) { $out += "$Key=$Value" }
  Set-Content -Path $Path -Value $out -Encoding utf8
}

Write-Host "`n=== Google Sheets setup ===" -ForegroundColor Cyan

if ($SpreadsheetId) {
  Set-DotEnvValue $envFile "GOOGLE_SHEETS_DOCUMENT_ID" $SpreadsheetId
  Write-Host "Saved GOOGLE_SHEETS_DOCUMENT_ID to .env" -ForegroundColor Green
}

$envVars = Read-DotEnv $envFile
$docId = $envVars["GOOGLE_SHEETS_DOCUMENT_ID"]
$sheetName = if ($envVars["GOOGLE_SHEETS_SHEET_NAME"]) { $envVars["GOOGLE_SHEETS_SHEET_NAME"] } else { "Leads" }

if (-not $docId) {
  Write-Host "`nBrak GOOGLE_SHEETS_DOCUMENT_ID w .env" -ForegroundColor Yellow
  Write-Host @"

1. Utwórz arkusz: https://sheets.new
2. Nazwij zakładkę: $sheetName
3. W wierszu 1 wklej nagłówki (jedna kolumna = jedna komórka):

phone	full_name	first_name	last_name	campaign	status	call_outcome	call_summary	recording_url	vapi_call_id	transcript	budget	sessions_per_week	preferred_session_date	ended_reason	duration_seconds	updated_at

4. Skopiuj ID z URL (fragment między /d/ a /edit) i uruchom:

   powershell -ExecutionPolicy Bypass -File scripts\setup-google-sheets.ps1 -SpreadsheetId "TWOJE_ID"

"@ -ForegroundColor Gray
} else {
  Write-Host "Spreadsheet ID: $docId" -ForegroundColor Green
  Write-Host "Sheet tab:      $sheetName" -ForegroundColor Green
}

Write-Host "`n--- n8n: credential OAuth (jednorazowo) ---" -ForegroundColor Cyan
Write-Host @"
1. Otwórz http://localhost:5678
2. Credentials -> Add credential -> Google Sheets OAuth2 API
3. Zaloguj się kontem Google, które ma dostęp do arkusza
4. Otwórz workflow -> węzeł "Upsert Google Sheets Row" -> wybierz credential
"@ -ForegroundColor Gray

Write-Host "`n--- Przeładuj workflow + env ---" -ForegroundColor Cyan
Push-Location (Split-Path $proj -Parent | Join-Path -ChildPath "projekt_z_n8n")
docker compose up -d n8n 2>&1 | Out-Null
Pop-Location
Push-Location $proj
node scripts/build-workflow.mjs | Out-Null
powershell -ExecutionPolicy Bypass -File scripts\reload.ps1
Pop-Location
Write-Host "Workflow wdrożony." -ForegroundColor Green

if ($TestWebhook -or $docId) {
  Write-Host "`n--- Test webhook (Flow B) ---" -ForegroundColor Cyan
  $payload = Join-Path $proj "scripts\test-vapi-webhook.json"
  try {
    $resp = Invoke-RestMethod -Method Post `
      -Uri "http://localhost:5678/webhook/vapi-end-of-call" `
      -ContentType "application/json" `
      -InFile $payload
    Write-Host "Odpowiedź n8n: $($resp | ConvertTo-Json -Compress)" -ForegroundColor Green
    if ($resp.status -eq "processed") {
      Write-Host "Sprawdź arkusz — powinien być wiersz +48111222333" -ForegroundColor Green
    }
  } catch {
    Write-Host "Webhook error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Jeśli 404: docker restart n8n" -ForegroundColor Yellow
  }
}

Write-Host ""
