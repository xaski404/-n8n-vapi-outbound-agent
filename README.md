# AI Voice Agent — n8n × Retell AI × Google Calendar × Google Sheets

Voice AI assistant for a fitness studio. Handles inbound calls (booking, rescheduling, cancelling appointments, FAQ) and outbound calls (following up on Meta Lead Ads).

```
Meta Lead Ad
        │  POST /webhook/meta-lead-inbound
        ▼
   ┌──────────────────── n8n (Flow A) ──────────────────────┐
   │ Webhook → Parse Lead → Dispatch Retell Outbound Call    │
   └────────────────────────┬───────────────────────────────┘
                             ▼
                          Retell AI  ──places call──►  Lead
                             │
   Inbound call ──►  Retell AI (inbound agent)
                             │
                    Custom Functions (Flows C–F)
                    ┌────────────────────────────────┐
                    │ check_availability              │
                    │ book_appointment                │
                    │ list_my_appointments            │
                    │ cancel_appointment              │
                    │ reschedule_appointment           │
                    └────────┬───────────────────────┘
                             │  Google Calendar API
                             ▼
                      Google Calendar
                             │
                    call_analyzed webhook
                             ▼
   ┌──────────────────── n8n (Flow B) ──────────────────────┐
   │ Webhook → Map to Sheets → Upsert Google Sheets Row      │
   └────────────────────────┬───────────────────────────────┘
                             ▼
                      Google Sheets (Leads tab, 8 columns A–H)
```

## Repository layout

| Path | Purpose |
|------|---------|
| `code/*.ts` | Typed, testable source for n8n Code nodes |
| `scripts/build-workflow.mjs` | Generates `workflows/retell-voice-agent.json` |
| `scripts/sync-retell-urls.mjs` | Syncs webhook URLs + tools to Retell agents |
| `scripts/push-inbound-prompt.mjs` | Deploys inbound agent prompt to Retell |
| `scripts/push-outbound-prompt.mjs` | Deploys outbound agent prompt to Retell |
| `scripts/push-faq-knowledge-base.mjs` | Creates/updates Retell Knowledge Base from FAQ |
| `docs/retell-agent-prompt.md` | Inbound agent prompt (source of truth) |
| `docs/retell-outbound-agent-prompt.md` | Outbound agent prompt |
| `data/faq-pl.json` | FAQ for Retell KB |
| `deploy/hetzner/` | Production Docker Compose (n8n + Cloudflare tunnel) |
| `workflows/retell-voice-agent.json` | Importable n8n workflow (all flows) |

## 1. Google Sheet setup

1. Create a spreadsheet (e.g. **Voice Leads**).
2. Add a sheet tab named **`Leads`** (or set `GOOGLE_SHEETS_SHEET_NAME` in `.env`).
3. Paste this header row into **row 1** (8 columns, A–H):

```
phone	full_name	status	call_summary	recording_url	transcript	sessions_per_week	preferred_session_date
```

4. Copy the spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`

## 2. Configure environment

```bash
cp .env.example .env    # then edit all values
```

Required in `.env`:

| Variable | Description |
|----------|-------------|
| `RETELL_API_KEY` | Retell API key |
| `RETELL_INBOUND_AGENT_ID` | Retell inbound agent ID |
| `RETELL_OUTBOUND_AGENT_ID` | Retell outbound agent ID |
| `RETELL_FROM_NUMBER` | Studio phone number (E.164, e.g. `+48...`) |
| `PUBLIC_WEBHOOK_URL` | Public URL for n8n (tunnel or domain) |
| `GOOGLE_CALENDAR_ID` | Google Calendar ID (or `primary`) |
| `GOOGLE_SHEETS_DOCUMENT_ID` | Google Sheets spreadsheet ID |

## 3. Import workflow into n8n

n8n → **Workflows → Import from File** → `workflows/retell-voice-agent.json`.

In n8n:
1. **Credentials → Google Sheets OAuth2 API** — sign in with Google account
2. **Credentials → Google Calendar OAuth2 API** — same account
3. Assign credentials to all HTTP nodes that use `googleSheetsOAuth2Api` / `googleCalendarOAuth2Api`
4. Activate the workflow

## 4. Deploy Retell agents

```bash
node scripts/push-inbound-prompt.mjs      # push inbound prompt
node scripts/push-outbound-prompt.mjs      # push outbound prompt
node scripts/sync-retell-urls.mjs          # sync all tool URLs + end_call
node scripts/push-faq-knowledge-base.mjs   # upload FAQ to KB
```

## 5. Development

```bash
cd code && npm install && npm run typecheck && cd ..
node scripts/build-workflow.mjs            # regenerate workflow JSON
cd code && npm test                        # run unit tests
```

## 6. Production (Hetzner)

See `docs/deploy-hetzner.md` for full setup. Quick start:

```bash
cd deploy/hetzner
cp .env.example .env   # edit all values
docker compose up -d
```

n8n runs on `127.0.0.1:5678`, exposed via Cloudflare tunnel.
