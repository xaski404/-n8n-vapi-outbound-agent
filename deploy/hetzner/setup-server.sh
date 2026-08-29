#!/usr/bin/env bash
# Run once on a fresh Hetzner Ubuntu VPS (as root or with sudo).
set -euo pipefail

echo "==> Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

echo "==> Installing docker compose plugin..."
apt-get update -qq
apt-get install -y -qq git curl

echo "==> Creating app directory..."
mkdir -p /opt/n8n-retell
cd /opt/n8n-retell

echo ""
echo "Done. Next steps:"
echo "  1. Copy deploy/hetzner/* and workflows/retell-voice-agent.json to /opt/n8n-retell/"
echo "  2. Copy .env (from laptop) to /opt/n8n-retell/.env"
echo "  3. cd /opt/n8n-retell && docker compose up -d"
echo "  4. Open n8n UI via SSH tunnel: ssh -L 5678:127.0.0.1:5678 root@YOUR_VPS_IP"
echo "     Then http://localhost:5678 — import workflow + connect Google OAuth"
echo ""
echo "See docs/deploy-hetzner.md for full checklist."
