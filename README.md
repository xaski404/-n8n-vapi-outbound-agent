# Outbound AI Voice Agent — n8n × Vapi.ai × Frappe CRM

Fully local, Docker-based test harness for an outbound voice agent:

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
   │ Webhook → Map Vapi→Frappe (Code) → Upsert Frappe Lead (HTTP)  │
   └───────────────────────────────┬──────────────────────────────┘
                                    ▼
                            Frappe / ERPNext  (Lead doctype)
```

## Repository layout

| Path | Purpose |
|------|---------|
| `docker-compose.yml` | n8n (+Postgres) and full Frappe/ERPNext stack |
| `.env.example` | All secrets/config — copy to `.env` |
| `workflows/vapi-outbound-agent.json` | **Importable** n8n workflow (both flows) |
| `scripts/build-workflow.mjs` | Regenerates the workflow JSON (source of truth for the Code nodes' escaping) |
| `code/*.ts` | Typed, testable source for the two Code nodes |
| `vapi/outbound-call-payload.json` | Reference Vapi request body with n8n expressions |

## 1. Bring up the stack

```bash
cp .env.example .env          # then edit secrets (Vapi keys etc.)
docker compose --env-file .env up -d
```

First boot provisions the Frappe site (`create-site` job) and can take several
minutes while ERPNext installs. Watch it:

```bash
docker compose logs -f create-site backend
```

- n8n UI:    http://localhost:5678
- Frappe UI: http://localhost:8080  → login `Administrator` / `${ADMIN_PASSWORD}`

## 2. Generate Frappe API keys

In Frappe: top-right avatar → **My Settings** → **API Access** → **Generate Keys**.
Put the key/secret into `.env` (`FRAPPE_API_KEY`, `FRAPPE_API_SECRET`) and
restart n8n so it picks up the env vars:

```bash
docker compose up -d --force-recreate n8n
```

> The `Lead` doctype references `custom_*` fields (`custom_call_summary`,
> `custom_call_outcome`, `custom_call_recording_url`, `custom_vapi_call_id`).
> Create them once via **Customize Form → Lead**, or delete those keys from the
> `Map Vapi to Frappe` Code node if you don't need them.

## 3. Import the workflow

n8n → **Workflows → Import from File** → `workflows/vapi-outbound-agent.json`.
Activate it. The two webhooks are now live at:

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
        "structuredData": { "outcome": "interested", "budget": "5k" }
      },
      "artifact": {
        "transcript": "Assistant: Hi Jane...\nUser: Yes, sounds good.",
        "recordingUrl": "https://example.com/rec/1.mp3"
      }
    }
  }'
```

Then confirm the record in Frappe: **CRM → Lead**, or via API:

```bash
curl "http://localhost:8080/api/resource/Lead?filters=[[\"mobile_no\",\"=\",\"+14155552671\"]]" \
  -H "Authorization: token $FRAPPE_API_KEY:$FRAPPE_API_SECRET"
```

## 6. Working on the Code nodes

The `code/*.ts` files are the typed source of truth. After editing them, re-port
into the workflow and regenerate:

```bash
cd code && npm install && npm run typecheck && cd ..
node scripts/build-workflow.mjs      # rewrites workflows/vapi-outbound-agent.json
```

## Error-handling design (baked in)

- **HTTP nodes** (`Dispatch Vapi Call`, `Upsert Frappe Lead`): `retryOnFail`
  with `maxTries: 3` and a back-off, plus `onError: continueRegularOutput` so a
  downstream/API failure still lets the webhook ACK instead of returning 500.
- **Code nodes** throw explicit, descriptive errors on missing required fields
  and invalid phone numbers — these surface in the n8n execution log.
- **`Map Vapi→Frappe`** ignores non-`end-of-call-report` events (Vapi sends
  several server messages) so only terminal reports hit the CRM.
- Idempotency hint: `upsertKey` (the E.164 phone) is emitted so you can add a
  Frappe *GET-by-filter → branch* if you want true upsert instead of create.
