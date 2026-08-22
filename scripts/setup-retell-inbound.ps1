# Retell inbound agent + webhook setup helper.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup-retell-inbound.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\setup-retell-inbound.ps1 -TestWebhooks
#
param(
  [switch]$TestWebhooks
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

$envVars = Read-DotEnv $envFile
$publicUrl = ($envVars["PUBLIC_WEBHOOK_URL"] -replace '/$', '') + '/'
$agentId = $envVars["RETELL_AGENT_ID"]
$fromNumber = $envVars["RETELL_FROM_NUMBER"]

if (-not $envVars["PUBLIC_WEBHOOK_URL"]) {
  Write-Host "Brak PUBLIC_WEBHOOK_URL w .env - uruchom tunnel (scripts\start-tunnel.ps1)" -ForegroundColor Red
  exit 1
}

Write-Host "`n=== Retell - konfiguracja inbound + kalendarz ===" -ForegroundColor Cyan
Write-Host "Public URL:  $publicUrl" -ForegroundColor Green
Write-Host "Agent ID:    $agentId" -ForegroundColor Green
Write-Host "Numer:       $fromNumber" -ForegroundColor Green

$webhooks = @{
  call_analyzed       = "${publicUrl}webhook/retell-call-analyzed"
  check_availability  = "${publicUrl}webhook/retell-check-availability"
  book_appointment    = "${publicUrl}webhook/retell-book-appointment"
}

Write-Host "`n--- Webhooki (wklej w Retell) ---" -ForegroundColor Cyan
$webhooks.GetEnumerator() | Sort-Object Name | ForEach-Object {
  Write-Host ("  {0,-20} {1}" -f $_.Key, $_.Value) -ForegroundColor Gray
}

$configPath = Join-Path $proj "docs\retell-custom-functions.json"
$config = @{
  agent_id = $agentId
  phone_number = $fromNumber
  webhooks = $webhooks
  custom_functions = @(
    @{
      name = "check_availability"
      url = $webhooks.check_availability
      method = "POST"
      description = "Sprawdza wolne terminy na trening probny w kalendarzu studia."
      parameters = @{
        type = "object"
        properties = @{
          preferred_day = @{
            type = "string"
            description = "Preferowany dzien tygodnia po polsku, np. czwartek"
          }
        }
      }
    },
    @{
      name = "book_appointment"
      url = $webhooks.book_appointment
      method = "POST"
      description = "Rezerwuje termin treningu probnego w Google Calendar."
      parameters = @{
        type = "object"
        properties = @{
          slot_start = @{ type = "string"; description = "ISO datetime z check_availability" }
          customer_name = @{ type = "string"; description = "Imie i nazwisko klienta" }
          notes = @{ type = "string"; description = "Opcjonalne notatki" }
        }
        required = @("slot_start", "customer_name")
      }
    }
  )
  post_call_analysis_fields = @(
    "outcome", "sessions_per_week", "preferred_session_date",
    "booked_slot", "goal", "experience_level"
  )
}
$config | ConvertTo-Json -Depth 6 | Set-Content -Path $configPath -Encoding utf8
Write-Host "`nZapisano konfiguracje: docs\retell-custom-functions.json" -ForegroundColor Green

Write-Host "`n--- Kroki w Retell Dashboard ---" -ForegroundColor Cyan
Write-Host "1. Agents -> otworz agenta ($agentId)" -ForegroundColor Gray
Write-Host "2. Prompt: skopiuj z docs\retell-agent-prompt.md" -ForegroundColor Gray
Write-Host "3. Tools -> Add Custom Function (x2) - parametry z docs\retell-custom-functions.json" -ForegroundColor Gray
Write-Host "4. Webhooks -> call_analyzed -> $($webhooks.call_analyzed)" -ForegroundColor Gray
Write-Host "5. Phone Numbers -> przypisz $fromNumber do agenta (inbound)" -ForegroundColor Gray
Write-Host "6. Knowledge Base (opcjonalnie): wgraj data\faq-pl.json" -ForegroundColor Gray

Write-Host "`n--- n8n: Google Calendar credential ---" -ForegroundColor Cyan
Write-Host "1. http://localhost:5678 -> Credentials -> Google Calendar OAuth2 API" -ForegroundColor Gray
Write-Host "2. Zaloguj sie tym samym kontem Google co Sheets" -ForegroundColor Gray
Write-Host "3. Uruchom: powershell -ExecutionPolicy Bypass -File scripts\reload.ps1" -ForegroundColor Gray

if ($TestWebhooks) {
  Write-Host "`n--- Test webhookow lokalnie ---" -ForegroundColor Cyan
  Push-Location (Join-Path $proj "code")
  npm run test:e2e
  Pop-Location
}

Write-Host ""
