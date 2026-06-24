# ADR-0127: Email Order Import — Workflow Shape & Model Hosting

**Status:** Proposed  
**Date:** 2026-06-24  
**Deciders:** Oseias da Silva Martins  
**Technical Story:** SPEC.md — Gmail-to-ERP Order Import

## Context

`SPEC.md` requires importing purchase-order PDFs from a Gmail inbox into the ERP: find inbox messages
that lack an `imported` label **and** carry a PDF attachment, extract structured order data (customer +
order lines) from the PDF via an LLM "structured-outputs" call, persist the order, and label the email
`imported` (or `ignored` with a reason when the PDF is not an order).

The SPEC frames this as a standalone C# service, but this repository's runtime is the **Temporal DSL
engine**: workflows are JSON definitions stored in Supabase `workflow_definitions` and executed by
`DSLWorkflow` (`temporal/src/workflows/dsl/interpreter.ts`), composed from generic, reusable activities
(`temporal/src/activities/*`). A universal model activity, `llm_agent` (`@earendil-works/pi-ai`), is
already wired to **Azure OpenAI `gpt-5.4`** (`provider=azure-openai-responses`,
`PIAGENT_PROVIDER`/`PIAGENT_MODEL_ID`, `AZURE_OPENAI_MAX_TOKENS_FIELD=max_completion_tokens`).

We must decide: the **workflow shape**, how Gmail and the PDF are handled, **where the model call sits**,
and **which model host** to standardize on. Several of these have org security/compliance implications
(new data-egress paths, stored Gmail credentials) and so warrant a recorded decision.

## Decision

Implement the import as a DSL definition `email-order-import` with this shape:
`sequence`( search pending emails → `for_each` message wrapped in `try_catch`( download attachment →
**extract order via the model** → branch on `is_order` → validate → persist → label ) ).

- **Gmail** is integrated through an **MCP / HTTP-tool server** exposing `POST {GMAIL_MCP_URL}/tools/*`
  (`search_pending`, `download_attachment`, `mark_imported`, `mark_ignored`), invoked from the workflow
  via the existing `http_request` activity. This keeps Gmail credentials and OAuth refresh inside a
  dedicated service rather than the worker.
- **PDF handling**: `download_attachment` uploads the attachment to **Supabase Storage** and returns a
  **signed URL**, which is passed to the existing `file_extract` activity unchanged.
- **Model call**: `file_extract` runs `pdf-parse` then calls **`llm_agent`** with the Order JSON as
  `response_schema`. **The model call therefore sits inside `file_extract` → `llm_agent`**, hosted on
  **Azure OpenAI `gpt-5.4`**, with structured output enforced by the mandatory `submit_response` tool and
  re-validated by the step's `output_schema` (validation failure → Temporal retry).
- **Persistence**: the extracted order is sent to the ERP via `http_request` `POST
  ${ORDERS_API_URL}/orders/import`.
- **Tracking**: per-message outcomes (`imported` / `ignored` + reason / `error`) are recorded in a new
  additive `email_imports` table, keyed unique on `(gmail_account, message_id)` for idempotency.

The model host is **env-governed** at the worker level; the workflow does not pin a provider per step, so
all model traffic for this workflow flows through the org-approved Azure deployment.

## Consequences

What becomes easier or more difficult to do because of this change?

### Positive

- Maximum reuse: `file_extract`, `llm_agent`, `http_request`, `data_validate`, the `DSLWorkflow`
  interpreter, and the `/workflows/trigger` endpoint are used unchanged.
- Azure `gpt-5.4` is already provisioned and org-approved; no new model client or vendor egress path.
- `try_catch` per message isolates failures so one bad email never aborts the batch; `email_imports`
  provides idempotency and a status surface for the SPEC's `/imports/email-orders/{id}` view.
- Structured output is schema-enforced and automatically retried on validation failure.

### Negative

- Text-first extraction (`pdf-parse`) returns little/no text for scanned/image PDFs — no OCR/vision yet.
- Introduces two external dependencies: a hosted **Gmail MCP server** holding Gmail credentials
  (operational + security surface, needs Security/Compliance + license review), and the ERP
  `POST /orders/import` endpoint, which **does not exist in this repository**.

### Neutral

- Model host is controlled by env (`PIAGENT_PROVIDER`/`PIAGENT_MODEL_ID`); `file_extract` does not expose
  a per-step provider override today.

## Options Considered

### Option 1: Azure OpenAI gpt-5.4 via the existing pi-ai/llm_agent path (chosen)
- **Pros:** already wired and org-approved; AAD/key auth available; structured outputs via
  `submit_response`; multimodal-capable for a future scanned-PDF fallback; zero new model code.
- **Cons:** tied to the Azure deployment naming and the `/openai/v1` chat-completions compat path; PDF
  reaches the model as extracted text, not as a native document upload.

### Option 2: Direct OpenAI API (literal SPEC) and/or in-worker Gmail activity / multimodal PDF / entity-model persistence
- **Pros:** matches the SPEC wording (OpenAI + `/orders/import`); the OpenAI Files API enables true PDF
  upload; a multimodal call would handle scanned PDFs; a dedicated `googleapis` activity would avoid
  hosting a separate MCP server.
- **Cons:** direct OpenAI introduces a new, currently unapproved data-egress path requiring
  Security/Compliance sign-off; multimodal requires a real `llm_agent` change (it sends text only today);
  these were not selected for the first iteration.

## Related Decisions

- [ADR-0001: Temporal workflow DSL](0001-temporal-workflow-dsl.md)
- [ADR-0006: Temporal workflow orchestration](0006-temporal-workflow-orchestration.md)
- [ADR-0007: Temporal signal-driven human-in-the-loop](0007-temporal-signal-driven-human-in-the-loop.md)
- [ADR-0024: Additive migrations only](0024-additive-migrations-only.md)
- Prior wiring of `llm_agent` to Azure OpenAI `gpt-5.4`.

## Notes

- A per-step provider/model override is a small `file_extract` change if per-workflow model selection is
  needed later.
- Follow-ups: a multimodal fallback for scanned POs (extract-text-empty → vision call), and confirming the
  real `POST /orders/import` request/response contract with the ERP team.
- Implementation plan: see the approved plan for this work (`email-order-import` DSL definition, Gmail MCP
  server, `email_imports` migration, `order-pdfs` Storage bucket, verification steps).
