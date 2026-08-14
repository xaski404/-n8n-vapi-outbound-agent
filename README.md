# Outbound AI Voice Agent — n8n × Vapi.ai × Google Sheets

Outbound voice agent with post-call data landing in a Google Sheet:

```
Meta Lead Ad (simulated)
        │  POST /webhook/meta-lead-inbound
        ▼
   ┌──────────────────────── n8n (Flow A) ────────────────────────┐
   │ Webhook → Parse Meta Lead (Code) → Dispatch Vapi Call (HTTP)  │
   └───────────────────────────────┬──────────────────────────────┘
                                    │  POST https://api.vapi.ai/call
                                    ▼
                                 Vapi.ai  ──places outbound call──►  Lead
                                    │
                                    │  end-of-call-report (transcript, summary, structuredData)
                                    ▼  POST /webhook/vapi-end-of-call
   ┌──────────────────────── n8n (Flow B) ────────────────────────┐
   │ Webhook → Map Vapi→Sheets (Code) → Upsert Google Sheets Row   │
   └───────────────────────────────┬──────────────────────────────┘
                                    ▼
                            Google Sheets  (Leads tab)
```

## Repository layout

| Path | Purpose |
|------|---------|
| `docker-compose.yml` | Optional legacy Frappe/ERPNext stack (not required for Sheets) |
| `.env.example` | All secrets/config — copy to `.env` |
| `workflows/vapi-outbound-agent.json` | **Importable** n8n workflow (both flows) |
| `scripts/build-workflow.mjs` | Regenerates the workflow JSON (source of truth for the Code nodes' escaping) |
| `code/*.ts` | Typed, testable source for the Code nodes |
| `vapi/outbound-call-payload.json` | Reference Vapi request body with n8n expressions |

## 1. Google Sheet setup

1. Create a spreadsheet (e.g. **Voice Leads**).
2. Add a sheet tab named **`Leads`** (or set `GOOGLE_SHEETS_SHEET_NAME` in `.env`).
3. Paste this header row into **row 1** (one column per cell):

```
phone	full_name	first_name	last_name	campaign	status	call_outcome	call_summary	recording_url	vapi_call_id	transcript	budget	sessions_per_week	preferred_session_date	ended_reason	duration_seconds	updated_at
```

4. Copy the spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`

## 2. Configure n8n

```bash
cp .env.example .env          # then edit secrets (Vapi keys, spreadsheet ID)
```

Set in `.env`:

- `GOOGLE_SHEETS_DOCUMENT_ID` — spreadsheet ID from step 1
- `GOOGLE_SHEETS_SHEET_NAME` — tab name (default `Leads`)

In n8n UI:

1. **Credentials → Add credential → Google Sheets OAuth2 API** — sign in with the Google account that owns the spreadsheet.
2. Ensure n8n can read env vars (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` and allow-list includes `GOOGLE_SHEETS_*`).

n8n UI: http://localhost:5678

## 3. Import the workflow

n8n → **Workflows → Import from File** → `workflows/vapi-outbound-agent.json`.

On the **Upsert Google Sheets Row** node, assign your Google Sheets credential, then activate the workflow.

Webhooks:

- `POST http://localhost:5678/webhook/meta-lead-inbound`
- `POST http://localhost:5678/webhook/vapi-end-of-call`

## 4. Configure Vapi

Set `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID` in `.env`.
The `Dispatch Vapi Call` node injects `server.url` so Vapi posts the
end-of-call-report back to n8n. For Vapi (a cloud service) to reach your local
n8n, expose it with a tunnel and set `WEBHOOK_URL` accordingly:

```bash
cloudflared tunnel --url http://localhost:5678
# or: ngrok http 5678
# then set WEBHOOK_URL=https://<tunnel-host>/  in .env and recreate n8n
```

## 5. End-to-end test

**Trigger Flow A** (simulated Meta Lead Ad):

```bash
curl -X POST http://localhost:5678/webhook/meta-lead-inbound \
  -H 'Content-Type: application/json' \
  -d '{
        "full_name": "Jane Q Doe",
        "phone_number": "(415) 555-2671",
        "campaign_name": "Summer Promo",
        "leadgen_id": "lg_9"
      }'
```

**Simulate Flow B** without spending Vapi minutes (mimics the end-of-call-report):

```bash
curl -X POST http://localhost:5678/webhook/vapi-end-of-call \
  -H 'Content-Type: application/json' \
  -d '{
    "message": {
      "type": "end-of-call-report",
      "endedReason": "customer-ended-call",
      "durationSeconds": 73,
      "call": {
        "id": "call_test_1",
        "customer": { "number": "+14155552671" },
        "assistantOverrides": { "variableValues": {
          "full_name": "Jane Q Doe", "campaign_name": "Summer Promo"
        }}
      },
      "analysis": {
        "summary": "Lead is interested, requested a follow-up email.",
        "structuredData": { "outcome": "interested", "budget": "400 zł" }
      },
      "artifact": {
        "transcript": "Assistant: Hi Jane...\nUser: Yes, sounds good.",
        "recordingUrl": "https://example.com/rec/1.mp3"
      }
    }
  }'
```

Then confirm a new row in your Google Sheet (matched/updated by `phone`).

> **Recording URLs:** Vapi presigned links in `recording_url` expire after ~30 minutes.
> For permanent storage, add a Google Drive upload step later.

## 6. Working on the Code nodes

The `code/*.ts` files are the typed source of truth. After editing them, re-port
into the workflow and regenerate:

```bash
cd code && npm install && npm run typecheck && cd ..
node scripts/build-workflow.mjs      # rewrites workflows/vapi-outbound-agent.json
```

## Error-handling design (baked in)

- **HTTP nodes** (`Dispatch Vapi Call`): `retryOnFail` with `maxTries: 3` and a
  back-off, plus `onError: continueRegularOutput` so a downstream/API failure still
  lets the webhook ACK instead of returning 500.
- **Google Sheets node** (`Upsert Google Sheets Row`): same retry/continue pattern.
- **Code nodes** throw explicit, descriptive errors on missing required fields
  and invalid phone numbers — these surface in the n8n execution log.
- **`Map Vapi→Sheets`** ignores non-`end-of-call-report` events (Vapi sends
  several server messages) so only terminal reports hit the spreadsheet.
- **Upsert key:** rows are matched on `phone` (E.164) — repeat calls update the same row.

## Optional: legacy Frappe stack

`docker-compose.yml` still ships the old ERPNext stack if you need it for other
experiments. It is **not** used by the current workflow.

```bash
docker compose --env-file .env up -d
```
