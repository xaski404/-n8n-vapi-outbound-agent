# Stable Cloudflare Named Tunnel - URL never changes (production).
#
# WYMAGANIE: domena w Cloudflare (darmowe konto + dowolna domena, np. strona studia).
# Bez domeny quick-tunnel (trycloudflare.com) jest jedyna opcja — uruchom tunnel-watchdog.ps1.
#
# --- Sposob A: masz Tunnel Token z dashboardu (najprostszy) ---
#   1. https://one.dash.cloudflare.com -> Networks -> Tunnels -> Create tunnel
#   2. Public Hostname: webhook.TWOJA-DOMENA.pl -> http://n8n:5678
#   3. Skopiuj token i uruchom:
#        powershell -File scripts\setup-named-tunnel.ps1 `
#          -Hostname webhook.twojadomena.pl `
#          -Token "eyJ..."
#
# --- Sposob B: caly setup przez CLI ---
#   1. cloudflared tunnel login   (otworzy przegladarke)
#   2. powershell -File scripts\setup-named-tunnel.ps1 -Hostname webhook.twojadomena.pl
#
param(
  [Parameter(Mandatory = $true)]
  [string]$Hostname,
  [string]$TunnelName = "n8n-retell",
  [string]$Token = ""
)

$ErrorActionPreference = "Stop"
$proj = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $proj ".env"
$composeDir = Join-Path (Split-Path $proj -Parent) "projekt_z_n8n"
$cfDir = Join-Path $composeDir "cloudflared"
$syncRetell = Join-Path $PSScriptRoot "sync-retell-urls.mjs"

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

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

function Set-EnvValue([string]$Path, [string]$Key, [string]$Value) {
  $content = Get-Content $Path -Raw
  $line = "$Key=$Value"
  if ($content -match "(?m)^$Key=.*") {
    $content = $content -replace "(?m)^$Key=.*", $line
  } else {
    $content += "`n$line`n"
  }
  Set-Content $Path $content -NoNewline
}

function Wait-Health([string]$BaseUrl, [int]$Seconds = 60) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    try {
      $r = Invoke-WebRequest -Uri "$BaseUrl/healthz" -UseBasicParsing -TimeoutSec 10
      if ($r.StatusCode -eq 200) { return $true }
    } catch {}
    Start-Sleep 3
  } while ((Get-Date) -lt $deadline)
  return $false
}

$publicUrl = "https://$Hostname/".Replace("///", "//").Replace("https:///", "https://")
Write-Host ""
Write-Host "=== Named tunnel -> $publicUrl ===" -ForegroundColor Cyan

function Write-NamedOverride([string]$ComposeDir, [string]$Mode, [string]$Token = "") {
  $override = Join-Path $ComposeDir "docker-compose.override.yml"
  if ($Mode -eq "token") {
    @"
# Auto-generated - stable Cloudflare Named Tunnel (token)
services:
  cloudflared:
    env_file:
      - ../n8n_AI_assistant/.env
    command: tunnel --no-autoupdate run
"@ | Set-Content $override -Encoding utf8
  } else {
    @"
# Auto-generated - stable Cloudflare Named Tunnel (config.yml)
services:
  cloudflared:
    command: tunnel --no-autoupdate --config /etc/cloudflared/config.yml run
    volumes:
      - ./cloudflared:/etc/cloudflared:ro
"@ | Set-Content $override -Encoding utf8
  }
}

New-Item -ItemType Directory -Force -Path $cfDir | Out-Null

if ($Token) {
  Write-Host "Token mode (dashboard)" -ForegroundColor Green
  Set-EnvValue $envFile "CLOUDFLARE_TUNNEL_TOKEN" $Token
  Set-EnvValue $envFile "TUNNEL_TOKEN" $Token
  Set-EnvValue $envFile "PUBLIC_WEBHOOK_URL" $publicUrl
  Get-ChildItem $cfDir -Filter "*.json" -ErrorAction SilentlyContinue | Remove-Item -Force
  Remove-Item (Join-Path $cfDir "config.yml") -ErrorAction SilentlyContinue
  Write-NamedOverride $composeDir "token"
} else {
  if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "Brak cloudflared. Zainstaluj: winget install Cloudflare.cloudflared" -ForegroundColor Red
    exit 1
  }

  $cert = Join-Path $env:USERPROFILE ".cloudflared\cert.pem"
  if (-not (Test-Path $cert)) {
    Write-Host "Logowanie do Cloudflare (otworzy sie przegladarka)..." -ForegroundColor Yellow
    cloudflared tunnel login
    if (-not (Test-Path $cert)) {
      Write-Host "Brak cert.pem - dokoncz logowanie w przegladarce i uruchom skrypt ponownie." -ForegroundColor Red
      exit 1
    }
  }

  $listJson = cloudflared tunnel list -o json 2>$null
  $tunnels = @()
  if ($listJson) { $tunnels = $listJson | ConvertFrom-Json }

  $existing = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
  if (-not $existing) {
    Write-Host "Tworze tunnel: $TunnelName"
    cloudflared tunnel create $TunnelName | Out-Null
    $listJson = cloudflared tunnel list -o json
    $tunnels = $listJson | ConvertFrom-Json
    $existing = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
  }

  $tunnelId = $existing.id
  Write-Host "Tunnel ID: $tunnelId" -ForegroundColor Gray

  Write-Host "DNS: $Hostname -> tunnel"
  cloudflared tunnel route dns $TunnelName $Hostname 2>&1 | Out-Null

  $credSrc = Join-Path $env:USERPROFILE ".cloudflared\$tunnelId.json"
  if (-not (Test-Path $credSrc)) {
    throw "Brak pliku credentials: $credSrc"
  }
  Copy-Item $credSrc (Join-Path $cfDir "$tunnelId.json") -Force

  $configPath = Join-Path $cfDir "config.yml"
  @"
tunnel: $tunnelId
credentials-file: /etc/cloudflared/${tunnelId}.json
ingress:
  - hostname: $Hostname
    service: http://n8n:5678
  - service: http_status:404
"@ | Set-Content $configPath -Encoding utf8

  Set-EnvValue $envFile "PUBLIC_WEBHOOK_URL" $publicUrl
  # config.yml mode - token not needed
  $content = Get-Content $envFile -Raw
  $content = $content -replace "(?m)^CLOUDFLARE_TUNNEL_TOKEN=.*\r?\n?", ""
  Set-Content $envFile $content -NoNewline
  Write-NamedOverride $composeDir "config"
}

Push-Location $composeDir
docker compose up -d --force-recreate cloudflared n8n | Out-Null
Pop-Location

Write-Host "Czekam na tunnel..."
Start-Sleep 12
if (Wait-Health $publicUrl.TrimEnd('/')) {
  Write-Host "OK: $publicUrl" -ForegroundColor Green
} else {
  Write-Host "Tunnel jeszcze nie odpowiada - sprawdz docker logs cloudflared" -ForegroundColor Yellow
}

Push-Location $proj
node $syncRetell
Pop-Location

Write-Host ""
Write-Host "Gotowe. URL na stale: $publicUrl" -ForegroundColor Green
Write-Host "Watchdog (quick-tunnel) nie jest juz potrzebny." -ForegroundColor Gray
Write-Host ""
