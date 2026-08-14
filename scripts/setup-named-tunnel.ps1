# Stable Cloudflare Named Tunnel (URL never changes — recommended for production).
#
# One-time setup on your PC (needs free Cloudflare account):
#   1. Install cloudflared: winget install Cloudflare.cloudflared
#   2. cloudflared tunnel login
#   3. cloudflared tunnel create n8n-retell
#   4. cloudflared tunnel route dns n8n-retell webhook.TWOJA-DOMENA.pl
#      (or skip DNS and use the tunnel UUID hostname from Cloudflare dashboard)
#   5. Create config.yml (example below) and run: cloudflared tunnel run n8n-retell
#
# OR get a tunnel token from Cloudflare Zero Trust → Networks → Tunnels → n8n-retell → Configure
# and paste into .env:
#   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
#   PUBLIC_WEBHOOK_URL=https://webhook.TWOJA-DOMENA.pl/
#
# Then: cd projekt_z_n8n && docker compose up -d --force-recreate cloudflared
#
# Example config.yml (if running tunnel outside Docker):
# ---
# tunnel: <TUNNEL-UUID>
# credentials-file: C:\Users\YOU\.cloudflared\<TUNNEL-UUID>.json
# ingress:
#   - hostname: webhook.TWOJA-DOMENA.pl
#     service: http://localhost:5678
#   - service: http_status:404
# ---

Write-Host @"

=== Named Cloudflare Tunnel (stable URL) ===

Quick-tunnel (trycloudflare.com) ZAWSZE pada po kilku godzinach/dniach.
Named tunnel = ten sam URL na stałe.

Kroki:
  1. Konto Cloudflare (darmowe) + domena (może być ta sama co strona)
  2. Zero Trust -> Networks -> Tunnels -> Create tunnel
  3. Public hostname -> http://n8n:5678 (w Dockerze) lub localhost:5678
  4. Skopiuj Tunnel Token do .env jako CLOUDFLARE_TUNNEL_TOKEN=...
  5. Ustaw PUBLIC_WEBHOOK_URL=https://twoj-hostname/
  6. docker compose up -d --force-recreate cloudflared  (w projekt_z_n8n)
  7. Retell webhook: PUBLIC_WEBHOOK_URL/webhook/retell-call-analyzed

Bez named tunnel uruchom w tle:
  powershell -File scripts\tunnel-watchdog.ps1

"@
