# Gmail MCP / HTTP-tool server

Integration boundary for the [`email-order-import`](../../temporal/definitions/email-order-import.json)
Temporal workflow (see [ADR-0127](../../docs/adrs/0127-email-order-import-workflow-and-model-hosting.md)).
It exposes Gmail operations as HTTP tools using the repo's `POST {url}/tools/{name}` convention — the same
shape `llm_agent` MCP dispatch uses — so the workflow calls them deterministically via the `http_request`
activity.

## Tools

| Endpoint | Body | Returns |
|---|---|---|
| `POST /tools/search_pending` | `{ gmail_account, label_exclude, require_pdf, max }` | `{ messages: [{ message_id, subject, has_pdf }], count }` |
| `POST /tools/download_attachment` | `{ gmail_account, message_id }` | `{ has_pdf, filename, signed_url }` |
| `POST /tools/mark_imported` | `{ gmail_account, message_id }` | `{ success }` |
| `POST /tools/mark_ignored` | `{ gmail_account, message_id, reason }` | `{ success }` |
| `GET  /health` | — | `{ ok, stub }` |

`download_attachment` uploads the PDF to the Supabase Storage bucket `order-pdfs` and returns a short-lived
**signed URL** that `file_extract` fetches.

## Environment

| Var | Purpose |
|---|---|
| `PORT` | Listen port (default `8080`). |
| `GMAIL_MCP_STUB` | `true` → run without Gmail/Storage creds (serves fixtures + a generated sample PDF). |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | OAuth2 refresh-token auth. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a Workspace service-account key (domain-wide delegation; impersonates `gmail_account`). |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Storage upload + signing. |
| `ORDER_PDF_BUCKET` | Storage bucket (default `order-pdfs`). |
| `SIGNED_URL_TTL` | Signed-URL lifetime in seconds (default `600`). |
| `GMAIL_MCP_PUBLIC_URL` | Base URL other containers use to reach this server (stub fixture links). |

## Run

```bash
# stub mode (no credentials needed) — for wiring/manual testing
GMAIL_MCP_STUB=true node index.mjs

# real mode
GMAIL_REFRESH_TOKEN=... GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... \
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node index.mjs
```

Under Docker Compose the worker reaches it at `http://gmail-mcp:8080` (the `email-order-import`
definition's `gmail_mcp_url` variable).

## Security

Holds Gmail credentials and a Supabase service-role key. The `googleapis` dependency and the credential/auth
model require Security/Compliance and license review before production use. All secrets are read from env;
nothing is committed.
