# Deploy na Hetzner VPS (produkcja 24/7)

Przenosisz **n8n + Cloudflare tunnel** z laptopa na serwer w chmurze.  
Domena `webhook.trening-kuba.pl` i Retell **zostają bez zmian**.

---

## Koszt

| Plan | RAM | Cena | Wystarczy? |
|------|-----|------|------------|
| **CX22** (rekomendowany) | 4 GB | ~5 €/mies. (~22 zł) | tak, z zapasem |
| CX11 | 2 GB | ~4 €/mies. | minimum |

Nowe konta Hetzner często dostają **20–50 € kredytu** — pierwsze miesiące praktycznie za darmo.

---

## Krok 1 — Załóż VPS

1. Wejdź na [hetzner.com/cloud](https://www.hetzner.com/cloud)
2. Utwórz projekt → **Add Server**
3. Wybierz:
   - **Location:** Falkenstein lub Nuremberg (EU, blisko Polski)
   - **Image:** Ubuntu 24.04
   - **Type:** CX22 (Shared vCPU)
4. Dodaj swój klucz SSH albo hasło root
5. Zapisz **adres IP** serwera

---

## Krok 2 — Zaloguj się na serwer

Z PowerShell na laptopie:

```powershell
ssh root@TWOJ_ADRES_IP
```

(przy pierwszym logowaniu potwierdź fingerprint — `yes`)

---

## Krok 3 — Zainstaluj Docker

Na serwerze:

```bash
curl -fsSL https://get.docker.com | sh
mkdir -p /opt/n8n-retell
cd /opt/n8n-retell
```

Albo skopiuj i uruchom `deploy/hetzner/setup-server.sh`.

---

## Krok 4 — Skopiuj pliki z laptopa

**Z laptopa** (nowe okno PowerShell, nie na serwerze):

```powershell
cd C:\Users\askik\Desktop\n8n_AI_assistant

scp deploy/hetzner/docker-compose.yml root@TWOJ_IP:/opt/n8n-retell/
scp workflows/vapi-outbound-agent.json root@TWOJ_IP:/opt/n8n-retell/
scp .env root@TWOJ_IP:/opt/n8n-retell/.env
```

Upewnij się, że w `.env` na serwerze są:
- `TUNNEL_TOKEN` (ten sam co na laptopie)
- `PUBLIC_WEBHOOK_URL=https://webhook.trening-kuba.pl/`
- wszystkie klucze Retell i Google Sheets

---

## Krok 5 — Wyłącz tunel na laptopie

**Ważne:** ten sam token Cloudflare może działać tylko w **jednym miejscu**.

Na laptopie:

```powershell
cd C:\Users\askik\Desktop\projekt_z_n8n
docker compose stop cloudflared
```

(lub zatrzymaj cały stack — na produkcji i tak używasz VPS)

---

## Krok 6 — Uruchom na Hetznerze

Na serwerze:

```bash
cd /opt/n8n-retell
docker compose up -d
docker compose ps
```

Powinno być `n8n` i `cloudflared` w statusie **Up**.

Test webhooka (na serwerze lub laptopie):

```bash
curl -s -X POST https://webhook.trening-kuba.pl/webhook/retell-check-availability \
  -H "Content-Type: application/json" \
  -d '{"name":"check_availability","args":{"preferred_day":"czwartek"},"call":{"call_id":"test"}}'
```

Oczekiwany wynik: JSON z `"available": true`.

---

## Krok 7 — Skonfiguruj n8n (workflow + Google OAuth)

n8n na VPS **nie wystawia portu na świat** — UI otwierasz przez tunel SSH.

Na laptopie:

```powershell
ssh -L 5678:127.0.0.1:5678 root@TWOJ_IP
```

Potem w przeglądarce: **http://localhost:5678**

1. Załóż konto admina (pierwsze logowanie)
2. **Workflows → Import** → `vapi-outbound-agent.json`
3. **Credentials → Google Sheets OAuth2** — zaloguj się kontem Google studia
4. **Credentials → Google Calendar OAuth2** — to samo konto
5. Przypisz credentials do node'ów HTTP (Sheets, Calendar)
6. **Activate** workflow

Opcjonalnie — zsynchronizuj Retell (z laptopa, z działającym `.env`):

```powershell
node scripts/sync-retell-urls.mjs
```

---

## Krok 8 — Test na żywo

Zadzwoń na numer studia i sprawdź:
- umówienie treningu
- przełożenie wizyty
- odwołanie

---

## Po deployu

| Co | Gdzie działa |
|----|--------------|
| Retell (głos, agenci) | chmura Retell — bez zmian |
| Domena webhook | Cloudflare — bez zmian |
| n8n + kalendarz + Sheets | **Hetzner VPS 24/7** |
| Laptop | możesz zamykać |

---

## Aktualizacja workflow (po zmianach w kodzie)

Na laptopie (dev):

```powershell
node scripts/build-workflow.mjs
scp workflows/vapi-outbound-agent.json root@TWOJ_IP:/opt/n8n-retell/
```

W n8n UI (przez SSH tunnel): re-import workflow albo edytuj ręcznie.

---

## Rozwiązywanie problemów

| Problem | Rozwiązanie |
|---------|-------------|
| Bot mówi „brak kalendarza” | `docker compose ps` — czy oba kontenery Up? Test curl webhooka |
| 502 / 530 na webhooku | Tunel nie działa — `docker compose logs cloudflared` |
| Google OAuth nie działa | Ponownie połącz credentials w n8n UI na VPS |
| Dwa tunele naraz | Zatrzymaj `cloudflared` na laptopie |

---

## Backup (raz w tygodniu)

Na serwerze:

```bash
docker run --rm -v n8n-retell_n8n_data:/data -v /root:/backup alpine \
  tar czf /backup/n8n-backup-$(date +%F).tar.gz -C /data .
```

Pobierz backup na laptop: `scp root@TWOJ_IP:/root/n8n-backup-*.tar.gz .`
