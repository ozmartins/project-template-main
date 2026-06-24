# Temporal Workflow DSL — Specification

**Version:** 0.1.0-draft  
**Status:** Draft  
**ADR:** [ADR-0001](../adrs/0001-temporal-workflow-dsl.md)

---

## 0. Tech Stack

The DSL worker is implemented in **TypeScript/Node.js**, not Python. The rationale is in ADR-0001, but the key implications for implementation are:

| Concern | Package | Notes |
|---|---|---|
| Workflow runtime | `@temporalio/workflow@^1.18` | V8 isolate; webpack bundles all imports |
| Worker process | `@temporalio/worker@^1.18` | Node.js process, not CPython |
| Client | `@temporalio/client@^1.18` | Used by Edge Functions and admin scripts |
| Activity context | `@temporalio/activity@^1.18` | Heartbeat, cancellation tokens |
| Schema validation | Hand-rolled (V8-safe) | `temporal/src/workflows/dsl/validation.ts`; no external deps; runs inside V8 isolate |
| Expression evaluator | Hand-rolled (V8-safe) | `temporal/src/workflows/dsl/expression.ts`; sigil-prefix resolution; no `eval()` |
| Duration parsing | Hand-rolled | `temporal/src/workflows/dsl/duration.ts`; `"30s"`, `"5m"`, `"24h"`, `"2d"` |
| TypeScript | `typescript@^5` | Strict mode; single-object activity convention |
| **LLM activity** | `@earendil-works/pi-ai@^0.74` | Unified multi-provider LLM SDK; see §4.8 |

**Note on ajv and expr-eval:** The spec originally called for these; the implementation uses hand-rolled equivalents that are smaller, have no external deps, and are verified V8-isolate-safe. The capability is equivalent.

**Why TypeScript over Python:** JSON is a native TypeScript type — no deserialisation overhead, no dataclasses, no Pydantic. TypeScript types + `ajv` enforce the DSL schema at compile time and at runtime from the same source. The Node.js Docker image is ~50 MB vs ~200 MB for Python slim. Worker startup is faster. `proxyActivities` is the more natural dynamic dispatch pattern. The frontend is also TypeScript — DSL schema types can be a shared package between the worker and the workflow designer UI without a language boundary.

---

## 1. Purpose

**The DSL does not replace TypeScript code. It is the configuration layer that sits on top of it.**

The TypeScript/Node.js Temporal worker — activities, the interpreter, the generic building blocks — is the engine. The JSON definitions are the instructions. This is exactly the relationship between Flowable's Java execution engine and its BPMN/DMN configuration files. Nobody says Flowable replaces Java; they say it gives you Flowable-style configuration files that define workflows without writing new Java per process.

That is the intent here: JSON definition files that describe workflow structure, the blocks within workflows, and the decision logic between them — version-controlled in git, deployable independently of the worker, readable and modifiable without TypeScript knowledge.

**What the definitions control:**
- Which activity blocks to call, in what order, with what inputs
- Parallel and sequential composition of those blocks
- Decision logic — if/else branches, for-each loops, conditional routing
- Human interaction gates — wait for a signal, handle a timeout
- Error handling — catch specific failures, execute fallback steps
- Timers — sleep for a duration, wait until a timestamp
- Child workflow invocation — compose smaller defined processes into larger ones

**What the definitions do not control:**
- What an activity does internally — that is TypeScript code
- How Temporal manages durability, retries, and replay — that is Temporal
- The generic activity library contract — that is a stable TypeScript interface

**The invariant:** the Node.js worker is the stable platform. Definitions are the variable configuration. A new business process is a new JSON file. Reconfiguring an existing process is a JSON edit and a git commit. No TypeScript changes, no worker rebuild, no redeploy — for everything the existing activity library covers.

### Reference model: Flowable/Activiti/Camunda

Flowable has proven at enterprise scale for twenty years that this model works for genuinely complex business processes. Thousands of companies run approval workflows, order lifecycles, onboarding pipelines, and integration sequences as BPMN+DMN configuration. The service task library handles integration work; DMN tables handle decision logic; process definitions handle control flow. Engineers maintain the execution engine; business analysts maintain the process definitions.

What Flowable lacks that Temporal provides: event-sourced execution history, durable timers with crash recovery, language-native worker implementations, and horizontal scalability under high concurrency. This spec combines Flowable's configuration model with Temporal's execution model.

### Design goals, in order

1. **Configuration-first process definition** — workflow structure, decision logic, and composition are JSON. Version-controlled in git. Deployable without rebuilding the worker.
2. **Reusable building blocks** — a generic activity library (`http_request`, `supabase_query`, `evaluate_decision`, `send_notification`, `email_send`, `slack_message`, `transform_data`, `data_validate`) covers the vast majority of real steps. New REST API targets require new definitions, not new activity code.
3. **Full Temporal surface** — signals, queries, timers, child workflows, retry policies, parallel execution, error handling — all expressible in the definition format.
4. **Process versioning (Flowable model)** — running executions are pinned to their definition for their full lifetime. New executions pick up the current definition. Explicit operator-driven restart migrates a running execution to a new version. No `workflow.GetVersion` needed.
5. **Determinism-safe** — the interpreter satisfies Temporal's replay requirements. All non-determinism is in activities.
6. **Debuggable and auditable** — definition + Temporal event history is sufficient to diagnose any failure. Definitions in git have full diff/blame history.
7. **Schema-validated** — definitions are validated at load time before execution begins.
8. **Extensible** — for steps the library cannot cover, a code-generation agent (§4.7) produces a new `@Activity.defn` function without manual authorship.

---

## 2. Prior Art and the Gap

### 2.1 The reference model: Flowable/Activiti/Camunda (BPMN engines)

The strongest existence proof for configuration-driven workflows is not in the Temporal ecosystem — it is in the BPMN engine lineage: Flowable, Activiti, Camunda. These systems have run mission-critical enterprise processes in production for twenty years. Their model is instructive:

- **Process definitions are XML/JSON files**, version-controlled and deployed independently of application code. Running instances are pinned to the definition they started on; migration between versions is explicit and operator-driven.
- **Service tasks are reusable building blocks** configured with a type, endpoint, and input/output mapping. The service task library covers the vast majority of integration work — HTTP calls, database queries, message queue publishes — without custom Java per integration target.
- **Decision logic is separated** into Decision Model and Notation (DMN) tables: if/then/else rules authored as configuration, evaluated at runtime. Business analysts write decision logic directly, without engineering involvement.
- **Visual designer** generates the same JSON/XML that the engine executes. The designer is not a simplified view — it is the authoring tool for production processes.

**What Flowable gets right that this spec must also get right:**
1. Process versioning — running instances survive definition updates by staying pinned to their version
2. Generic service task library — REST calls, DB calls, messaging are configuration, not code
3. Separation of decision logic — conditions are tables/expressions, not code branches
4. Visual authorship — non-engineers can read, understand, and modify process definitions

**What Flowable gets wrong that Temporal fixes:**
1. State stored in a relational database — no event-sourced history, no replay guarantee, no durable timers with crash recovery
2. Thread-pool concurrency model — not designed for hundreds of thousands of concurrent long-running workflows
3. No language-native worker model — service task implementations are Java or HTTP delegates, not Python functions with the full Python ecosystem available
4. Local transaction semantics — activity failures don't automatically retry with exponential backoff across distributed workers

**The synthesis:** Temporal's execution model + Flowable's process definition model. This is the design intent of this spec.

### 2.2 Temporal's official DSL samples

Temporal ships DSL interpreter examples in Python, TypeScript, and Go. Each uses a single generic workflow class or function that interprets a YAML/JSON definition at runtime. The named-variable binding model — activities write results into named slots; subsequent steps reference those names — is the same across all three.

These samples prove: the interpreter pattern is sound, officially endorsed, and determinism-safe in both the Python and TypeScript SDKs. In the TypeScript sample, `proxyActivities` is cast to `Record<string, Function>` for string-name dispatch — no import of the activity function is required inside the workflow.

**The gap:** the samples cover exactly three primitives — `activity | sequence | parallel`. No signals, no queries, no timers, no retry policies, no child workflows, no error handling. They are deliberately minimal starting points, not production engines. This spec extends the vocabulary to the full Temporal and Flowable surface.

### 2.3 Zigflow (Go, CNCF Serverless Workflow)

Zigflow (https://github.com/zigflow/zigflow, Apache 2.0, v0.13.0 June 2026) compiles YAML against the CNCF Serverless Workflow specification into Temporal workflows with signals, queries, timers, child workflows, for-loops, and try-catch. Its capability matrix almost exactly matches §14 of this spec.

**The gaps:** (1) Go runtime with its own worker — Python activities cannot register with it without a cross-language boundary. (2) External dependency, 10 months old, no production deployments, no LTS. (3) CNCF spec adds multi-engine portability abstractions this project does not need. (4) No generic HTTP activity — each integration target requires a registered activity function.

**What this spec takes from Zigflow:** confirmation that the full Temporal surface is expressible declaratively; several step type names and field names are directly informed by its vocabulary.

### 2.4 Orchestra (Python, YAML DSL)

Orchestra (https://github.com/StewartXiang/orchestra, Python, May 2026) is Python-native with a Pydantic parser and a `PipelineWorkflow` interpreter. Phase P4 (verified complete) covers signal, query, update, condition, parallel, dynamic, and loop.

**The gaps:** six weeks old, Chinese-language documentation, unclear governance. The architecture is sound.

**What this spec takes from Orchestra:** its `PipelineWorkflow` architecture directly informs `DSLWorkflow` in §11; confirmation that the full signal/query/update/loop surface is achievable in a single-function DSL interpreter.

### 2.5 The gap this spec fills

No existing solution combines all five properties:

| Property | Flowable | Temporal samples | Zigflow | Orchestra | **This spec** |
|---|---|---|---|---|---|
| Flowable-style process versioning | **yes** | no | partial | no | **yes** |
| Generic HTTP/REST activity (no code per target) | **yes** | no | no | no | **yes** |
| Full Temporal surface (signals, timers, child WF) | no | no — 3 primitives | yes | yes | **yes** |
| TypeScript-native (no language boundary) | no | yes | no | no | **yes** |
| Temporal's durability (event-sourced, replay) | no | yes | yes | yes | **yes** |

The design is a deliberate synthesis: Flowable's versioning model and service task library concept + Temporal's official interpreter pattern + the full Temporal surface that Zigflow and Orchestra have proven is achievable.

---

## 3. Definition Structure



A workflow definition is a single JSON object.

```json
{
  "name": "onboard-customer",
  "version": "1.0.0",
  "description": "End-to-end customer onboarding pipeline",
  "input_schema": { "$ref": "#/definitions/OnboardInput" },
  "variables": {
    "welcome_subject": "Welcome to the platform"
  },
  "steps": { ... },
  "definitions": { ... }
}
```

### Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Stable identifier. Used as the Temporal workflow type name when submitted via DSL runner. |
| `version` | string | yes | SemVer. Stored on the workflow execution; used for replay safety checks. |
| `description` | string | no | Human-readable summary shown in the workflow designer UI. |
| `input_schema` | JSON Schema object | no | Validates the `input` provided at execution start. |
| `variables` | object | no | Initial variable bindings available to all steps. Values can be scalars or `$input.<field>` references. |
| `steps` | Step (see §5) | yes | The root step. Typically a `sequence` or `parallel`. |
| `definitions` | object | no | Reusable sub-definitions (JSON Schema `$defs` pattern). |

---

## 4. Generic Activity Library

The activity library is the key insight that makes the DSL viable for real workflows without custom code per integration target. The pattern mirrors Flowable's service task library: a small set of well-designed generic activities cover the vast majority of work. Workflow definitions configure them; they are not extended per use case.

### 4.1 `http_request` — configurable REST/HTTP call

The single most important activity in the library. Covers every REST API call — internal microservices, Stripe, Salesforce, Slack, any webhook — without custom TypeScript per target.

```json
{
  "activity": {
    "name": "http_request",
    "args": {
      "method": "POST",
      "url": "https://api.stripe.com/v1/customers",
      "headers": {
        "Authorization": "Bearer $env.stripe_api_key",
        "Content-Type": "application/json"
      },
      "body": {
        "email": "$input.customer_email",
        "name": "$input.customer_name"
      },
      "auth": { "type": "bearer", "token": "$env.stripe_api_key" },
      "timeout": "30s",
      "expected_status": [200, 201],
      "result_path": "id"
    },
    "result": "stripe_customer_id",
    "retry": { "max_attempts": 3, "initial_interval": "2s", "backoff_coefficient": 2.0 }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `method` | string | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `url` | expression | Full URL. Supports `$env.*`, `$input.*`, `$var.*` references. |
| `headers` | object | Key-value headers. Values support expression references. |
| `body` | object \| string | Request body. Object is JSON-serialised; string is sent as-is. Values support expressions. |
| `auth` | object | Auth config: `{"type": "bearer", "token": "..."}`, `{"type": "basic", "username": "...", "password": "..."}`, `{"type": "api_key", "header": "X-API-Key", "key": "..."}` |
| `timeout` | duration string | Per-attempt timeout. Default: `"30s"`. |
| `expected_status` | int[] | HTTP status codes considered success. Default: `[200, 201, 204]`. Others raise a retryable error. |
| `result_path` | string | Dot-path into the response JSON to extract as the result. Omit to return the full response body. |
| `non_retryable_status` | int[] | Status codes that should not be retried (e.g. `[400, 401, 403, 404, 422]`). Default: `[400, 401, 403, 404]`. |

### 4.2 `supabase_query` — parameterised SQL or RPC call

```json
{
  "activity": {
    "name": "supabase_query",
    "args": {
      "query": "select * from entities where entity_type = $1 and is_current = true",
      "params": ["$input.entity_type"],
      "result_shape": "list"
    },
    "result": "entities"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `query` | string | SQL query with `$1`, `$2`... positional parameters, OR an RPC function name when `mode: "rpc"` |
| `params` | expression[] | Values for positional parameters. Each supports expression references. |
| `mode` | `"sql"` \| `"rpc"` | Default: `"sql"`. `"rpc"` calls a Supabase edge function or database RPC. |
| `result_shape` | `"list"` \| `"one"` \| `"count"` | `"one"` returns the first row or null. `"count"` returns the row count. |

### 4.3 `supabase_mutate` — insert / update / upsert via entity model

```json
{
  "activity": {
    "name": "supabase_mutate",
    "args": {
      "operation": "upsert",
      "entity_type": "$input.entity_type",
      "data": "$input.attributes",
      "created_by": "$input.actor_id"
    },
    "result": "entity"
  }
}
```

Wraps the existing `create_entity` / `update_entity_scd2` / `get_entity` activities behind a single configurable interface. The `operation` field selects the underlying activity.

### 4.4 `send_notification` — configurable notification dispatch

```json
{
  "activity": {
    "name": "send_notification",
    "args": {
      "channel": "email",
      "to": "$input.user_email",
      "template": "approval_requested",
      "data": {
        "entity_id": "$input.entity_id",
        "requested_by": "$input.actor_id"
      }
    }
  }
}
```

Dispatches via email, Slack, push, or in-app notification. `channel` selects the transport; `template` selects a pre-registered message template; `data` provides template variables.

### 4.4.1 `email_send` — transactional email delivery

```json
{
  "activity": {
    "name": "email_send",
    "args": {
      "to": "$input.user_email",
      "subject": "Welcome to Volaris",
      "body_html": "<p>Your account is ready.</p>",
      "body_text": "Your account is ready.",
      "from": "noreply@example.com",
      "reply_to": "support@example.com",
      "_idempotency_key": "$workflow.run_id"
    }
  }
}
```

Provider is selected by environment variables in the worker:

- `RESEND_API_KEY` → Resend API
- `SENDGRID_API_KEY` → SendGrid API
- Neither set → log warning and return stub response (`{ "message_id": "stub", "provider": "stub", "delivered": false }`)

### 4.4.2 `slack_message` — channel and thread notifications

```json
{
  "activity": {
    "name": "slack_message",
    "args": {
      "channel": "C0123456789",
      "text": "Lead assigned to ops queue",
      "blocks": [{ "type": "section", "text": { "type": "mrkdwn", "text": "*Lead assigned*" } }],
      "thread_ts": "1741210000.000001",
      "_idempotency_key": "$workflow.run_id"
    },
    "result": "slack_delivery"
  }
}
```

Input contract:

- `channel` (string, required)
- `text` (string, required)
- `blocks` (object[], optional)
- `thread_ts` (string, optional)
- `_idempotency_key` (string, required)

Output contract:

```json
{ "ts": "string", "channel": "string" }
```

Delivery modes:

- `SLACK_BOT_TOKEN` set → uses Slack `chat.postMessage` API (supports direct channel posts and thread replies via `thread_ts`)
- `SLACK_BOT_TOKEN` missing, `SLACK_WEBHOOK_URL` set → uses incoming webhook delivery for simple posting
- Neither credential set → explicit warning and deterministic stub response (`{ "ts": "stub", "channel": "<input channel>" }`) for predictable local/dev behavior

### 4.5 `evaluate_decision` — DMN-style decision table lookup

The Flowable DMN equivalent. Decision tables live in Supabase (`decision_tables` entity type). The activity evaluates the matching rule and returns the result.

```json
{
  "activity": {
    "name": "evaluate_decision",
    "args": {
      "table": "credit_approval_policy",
      "version": "current",
      "input": {
        "credit_score": "$result.credit_check.score",
        "requested_amount": "$input.loan_amount",
        "customer_tier": "$result.customer.tier"
      }
    },
    "result": "credit_decision"
  }
}
```

Returns a dict with the matching rule's output columns (e.g. `{"approved": true, "max_amount": 50000, "rate_band": "A"}`). This separates decision logic from process logic entirely — business analysts change the decision table, not the workflow definition.

### 4.6 `transform_data` — reshape a data structure

```json
{
  "activity": {
    "name": "transform_data",
    "args": {
      "input": "$result.api_response",
      "mapping": {
        "customer_id": "$.data.id",
        "email": "$.data.attributes.email",
        "created_at": "$.data.attributes.created_at"
      }
    },
    "result": "customer"
  }
}
```

Applies a JSONPath mapping to reshape the input. Useful for normalising API responses before binding them into workflow variables.

### 4.7 `schedule_trigger` — delayed workflow start

Schedules a future `DSLWorkflow` run from inside an existing workflow step. `run_at` accepts either an absolute ISO-8601 timestamp (for example `"2026-06-21T15:30:00Z"`) or a relative duration string (for example `"30s"`, `"5m"`, `"2h"`).

```json
{
  "activity": {
    "name": "schedule_trigger",
    "args": {
      "workflow_id": "send-reminder",
      "workflow_input": {
        "definition": {
          "name": "reminder-dsl",
          "version": "1.0.0",
          "steps": {
            "set_variable": { "name": "status", "value": "queued" }
          }
        },
        "input": { "order_id": "$input.order_id" }
      },
      "run_at": "15m",
      "_idempotency_key": "$workflow.run_id"
    },
    "result": "scheduled"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `workflow_id` | string | Logical identifier for the delayed start. Combined with `_idempotency_key` to produce a deterministic scheduled workflow ID. |
| `workflow_input` | object | Input payload passed to `DSLWorkflow` as its single argument (normally `{ definition, input }`). |
| `run_at` | ISO-8601 timestamp \| duration string | When to start the delayed workflow (`"2026-06-21T15:30:00Z"` or `"30s"`). |
| `_idempotency_key` | string (required, non-blank) | Deduplication key. Repeated submissions with the same key return the same `scheduled_workflow_id`. Missing or blank values are rejected. |

Returns:

```json
{
  "scheduled_workflow_id": "send-reminder:schedule_trigger:<idempotency-key>",
  "run_at": "2026-06-21T15:45:00.000Z"
}
```

### 4.8 `data_validate` — JSON Schema validation with optional coercion and transform

Validates workflow data against a JSON Schema and optionally returns a reshaped output for downstream steps. Returns explicit errors — never silently passes invalid data.

```json
{
  "activity": {
    "name": "data_validate",
    "args": {
      "data": "$var.api_response",
      "schema": {
        "type": "object",
        "required": ["id", "email"],
        "properties": {
          "id":    { "type": "string" },
          "email": { "type": "string" }
        }
      },
      "coerce": true,
      "transform": {
        "user_id":    "$.id",
        "user_email": "$.email"
      },
      "_idempotency_key": "$var.run_id"
    },
    "result": "validation"
  }
}
```

**Input fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `data` | any | Yes | The value to validate — object, array, or scalar. |
| `schema` | JSON Schema object | Yes | The JSON Schema to validate `data` against. Uses the same schema conventions as the interpreter's `input_schema`/`output_schema` fields. |
| `coerce` | boolean | No (default `false`) | When `true`, attempts to coerce scalar values to the type declared in the schema before validation (e.g. `"42"` → `42` for `type: number`, `"true"` → `true` for `type: boolean`). |
| `transform` | `Record<string, string>` | No | JSONPath-style field mapping applied to the (possibly coerced) data. Same dot-path syntax as `transform_data`. Produces `transformed_data` in the result. |
| `_idempotency_key` | string | Yes | Idempotency key for Temporal activity deduplication. |

**Output fields:**

| Field | Type | Description |
|---|---|---|
| `valid` | boolean | `true` when the data satisfies the schema; `false` otherwise. |
| `errors` | string[] | One error message per schema violation. Empty array when `valid` is `true`. |
| `transformed_data` | any \| undefined | Present only when `transform` was supplied. Contains the reshaped output. Populated even when `valid` is `false`, so downstream steps can inspect partial data. |

**Behaviour notes:**

- Validation uses the same `validateSchema` function as the DSL interpreter's built-in `input_schema`/`output_schema` checks, so schema semantics are identical throughout the system.
- The activity never throws on validation failure — it returns `valid: false` with a populated `errors` array. The caller is responsible for branching on the result (typically with a `condition` step).
- When `coerce: true`, only scalar fields whose schema declares a `type` are coerced. Object and array structures are traversed recursively but no fields are dropped or created.
- If `transform` is omitted, `transformed_data` is absent from the output object entirely (not set to `null`).

**Typical usage — guard a step on valid input:**

```json
{
  "sequence": {
    "steps": [
      {
        "activity": {
          "name": "data_validate",
          "args": { "data": "$var.payload", "schema": { "type": "object", "required": ["id"] }, "_idempotency_key": "$var.run_id" },
          "result": "validation"
        }
      },
      {
        "condition": {
          "if": "$var.validation.valid",
          "then": { "activity": { "name": "supabase_query", "args": { ... } } },
          "else": { "activity": { "name": "send_notification", "args": { "message": "$var.validation.errors" } } }
        }
      }
    ]
  }
}
```

### 4.9 `llm_agent` — universal LLM activity

The `llm_agent` activity is the generic LLM building block. It is powered by `@earendil-works/pi-ai`, a unified TypeScript SDK that supports 15+ providers behind a single API: Anthropic, OpenAI, Azure OpenAI, AWS Bedrock, Google Gemini, Mistral, Groq, Cerebras, DeepSeek, OpenRouter, and any OpenAI-compatible endpoint.

**Design principle:** No LLM logic lives in the activity — prompts, tools, provider selection, MCP servers, and response schemas are all inputs. The activity is a pure executor of whatever configuration the DSL definition provides.

```json
{
  "activity": {
    "name": "llm_agent",
    "args": {
      "provider": "anthropic",
      "model_id": "claude-sonnet-4-6",
      "system_prompt": "You are an expert $input.domain analyst.",
      "user_prompt": "Classify $input.company_name based on:\n$var.search_results",
      "tools": [
        {
          "name": "search_web",
          "description": "Search the web for more information.",
          "parameters": {
            "type": "object",
            "required": ["query"],
            "properties": {
              "query": { "type": "string" },
              "count": { "type": "number" }
            }
          }
        }
      ],
      "mcp_servers": [
        { "name": "company_db", "url": "http://mcp-company:3000", "auth_token": "$env.mcp_token" }
      ],
      "response_schema": {
        "type": "object",
        "required": ["vertical", "confidence"],
        "properties": {
          "vertical":   { "type": "string" },
          "confidence": { "type": "number" }
        }
      },
      "schema_name": "classification_result",
      "temperature": 0,
      "max_tokens": 1000,
      "max_tool_rounds": 5
    },
    "result": "classification",
    "start_to_close_timeout": "120s",
    "retry": { "max_attempts": 3 },
    "output_schema": {
      "type": "object",
      "required": ["parsed"],
      "properties": {
        "parsed": {
          "type": "object",
          "required": ["vertical"],
          "properties": {
            "vertical":   { "type": "string" },
            "confidence": { "type": "number" }
          }
        }
      }
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `provider` | string | pi-ai provider ID. Default: `PIAGENT_PROVIDER` env var → `"anthropic"`. |
| `model_id` | string | Provider-specific model ID. Default: `PIAGENT_MODEL_ID` env var → provider default. |
| `system_prompt` | string | System prompt. Template-interpolated by the DSL layer before the activity is called. |
| `user_prompt` | string | User prompt. Same DSL interpolation applies. |
| `tools` | ToolDefinition[] | Tool declarations (JSON Schema `parameters`). The model may call these. |
| `mcp_servers` | McpServerConfig[] | MCP HTTP servers. Tool calls matching `name` prefix are dispatched via HTTP POST. |
| `response_schema` | JSON Schema | Enforced via a `submit_response` tool the model must call. `result.parsed` carries the payload. |
| `schema_name` | string | Name for the submit_response tool (displayed to model). Default: `"response"`. |
| `temperature` | number | Default 0. |
| `max_tokens` | number | Default 2000. |
| `max_tool_rounds` | number | Max rounds before forcing final answer. Default 5 when tools present. |

**Built-in tools** available without declaration: `search_web` (Exa Search) and `crawl_site` (Exa Contents). Both degrade gracefully when `EXA_API_KEY` is absent.

**Response schema enforcement:** pi-ai has no native JSON mode. Instead, the activity appends a `submit_response` tool with the `response_schema` as its parameters schema. The model must call it to complete. On the final forced round, all other tools are stripped so the model has no choice but to call `submit_response`. The DSL's `output_schema` on the activity step provides a second validation layer.

**Provider API keys:** each provider reads from standard env vars — pi-ai resolves them automatically. Providers using ambient credentials (AWS Bedrock, Google Vertex) need no explicit API key env var.

**Switching providers** requires only changing `provider` and `model_id` in the definition JSON — no activity code changes.

### 4.10 Extending the library with generated activities

For steps the generic library cannot cover — bespoke computation, file processing, ML inference — a new activity is generated rather than hand-written:

1. Author describes the activity in a specification comment in the definition: `// needs: compute_depreciation(entity_id, method) -> {amount, schedule}`
2. The Software Factory's coding agent generates an `@activity.defn`-equivalent TypeScript function with single-object input, tests it, and opens a PR to `temporal/src/activities/`.
3. After worker deploy, the activity is available to any DSL definition by name — no further code changes required for new workflows that use it.

This is the extension path. The primary path is always the generic library.

---

## 5. Step Types

Every step is a JSON object with exactly one discriminator key indicating its type. Steps are composable — any step field that accepts a `Step` can contain any step type.

### 3.1 `activity` — Call a registered Temporal activity

```json
{
  "activity": {
    "name": "create_entity",
    "args": {
      "entity_type": "customer",
      "attributes": "$input.customer_data",
      "created_by": "$input.requested_by"
    },
    "result": "created_entity",
    "task_queue": "main",
    "retry": {
      "max_attempts": 3,
      "initial_interval": "1s",
      "backoff_coefficient": 2.0,
      "max_interval": "30s",
      "non_retryable_errors": ["ValidationError"]
    },
    "start_to_close_timeout": "60s",
    "schedule_to_close_timeout": "5m"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | TypeScript function name registered as a Temporal activity. |
| `args` | object | no | Key-value map of arguments. Values are scalars or `$var.<name>` / `$input.<path>` / `$result.<step>` references. |
| `result` | string | no | Variable name to bind the activity's return value. Subsequent steps can reference `$result.<name>`. |
| `task_queue` | string | no | Defaults to the worker's configured task queue. |
| `retry` | RetryPolicy | no | Temporal retry policy. Omit to use the activity's default policy. |
| `start_to_close_timeout` | duration string | no | Max time for a single attempt. Default: `"30s"`. |
| `schedule_to_close_timeout` | duration string | no | Max total time across all attempts. |

**Duration strings:** `"<number><unit>"` where unit is `s` (seconds), `m` (minutes), `h` (hours), `d` (days). Examples: `"30s"`, `"5m"`, `"2h"`.

### 3.2 `sequence` — Execute steps serially

```json
{
  "sequence": {
    "steps": [
      { "activity": { "name": "step_a", "result": "result_a" } },
      { "activity": { "name": "step_b", "args": { "x": "$result.result_a" } } }
    ]
  }
}
```

Steps execute in order. A failure in any step halts the sequence and propagates the exception.

### 3.3 `parallel` — Execute steps concurrently

```json
{
  "parallel": {
    "branches": [
      { "activity": { "name": "email_send", "args": { "to": "$input.email", "subject": "Hello", "body_html": "<p>Hello</p>", "_idempotency_key": "$workflow.run_id" } } },
      { "activity": { "name": "send_notification", "args": { "user_id": "$input.user_id" } } }
    ],
    "wait_all": true
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `branches` | Step[] | — | Steps to run concurrently. |
| `wait_all` | boolean | `true` | If true, wait for all branches. If false, continue after the first branch completes (race pattern). |

All branches share the variable namespace. Branch results stored via `result` fields are merged back; conflicts (two branches writing the same variable name) are a validation error.

### 3.4 `wait_signal` — Block until a Temporal signal arrives

```json
{
  "wait_signal": {
    "signal": "submit_decision",
    "result": "decision",
    "timeout": "24h",
    "on_timeout": {
      "activity": {
        "name": "auto_reject",
        "args": { "entity_id": "$input.entity_id" }
      }
    }
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `signal` | string | yes | Signal name. Routed to a queue by the `setDefaultSignalHandler` registered at workflow start. |
| `result` | string | no | Bind the signal payload to this variable name. |
| `timeout` | duration string | no | If set, the step proceeds after this duration even without a signal. |
| `on_timeout` | Step | no | Step to execute if timeout fires before signal arrives. |

The interpreter registers a dynamic signal handler at step entry time. Signal handlers accumulate into a queue; if the signal arrives before `wait_signal` executes, the payload is not lost.

### 3.5 `condition` — Branch on a boolean expression

```json
{
  "condition": {
    "if": "$result.decision.approved == true",
    "then": {
      "activity": { "name": "provision_account", "args": { "entity_id": "$input.entity_id" } }
    },
    "else": {
      "activity": { "name": "send_rejection_email", "args": { "to": "$input.email" } }
    }
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `if` | expression string | yes | Boolean expression referencing bound variables. See §6 for expression syntax. |
| `then` | Step | yes | Step to execute when expression is truthy. |
| `else` | Step | no | Step to execute when expression is falsy. |

### 3.6 `sleep` — Wait for a fixed duration (Temporal timer)

```json
{
  "sleep": {
    "duration": "48h",
    "label": "cooling-off period"
  }
}
```

Maps to `workflow.sleep()`. Survives worker restarts. `label` is stored in the event history for debugging.

### 3.7 `wait_until` — Sleep until an absolute time

```json
{
  "wait_until": {
    "timestamp": "$input.scheduled_at",
    "label": "scheduled execution window"
  }
}
```

`timestamp` must be an ISO-8601 datetime string or a variable reference that resolves to one. Maps to `workflow.sleep()` computed as `target - workflow.now()`.

### 3.8 `child_workflow` — Invoke another DSL workflow as a child

```json
{
  "child_workflow": {
    "workflow": "approval-workflow",
    "args": {
      "entity_id": "$input.entity_id",
      "requested_by": "$input.initiated_by",
      "approvers": "$input.approvers",
      "timeout_hours": 24
    },
    "result": "approval_result",
    "task_queue": "main",
    "parent_close_policy": "terminate",
    "retry": {
      "max_attempts": 1
    }
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `workflow` | string | yes | `name` of a DSL workflow definition, or a registered Temporal workflow function name for coded workflows. |
| `args` | object | no | Input passed as the child workflow's `input`. |
| `result` | string | no | Bind child workflow return value. |
| `task_queue` | string | no | Defaults to parent's task queue. |
| `parent_close_policy` | `"terminate"` \| `"abandon"` \| `"request_cancel"` | no | Default: `"terminate"`. |

### 3.9 `for_each` — Dynamic fan-out over a list

```json
{
  "for_each": {
    "items": "$result.approver_list",
    "item_var": "approver",
    "index_var": "i",
    "body": {
      "activity": {
        "name": "send_notification",
        "args": { "user_id": "$var.approver.user_id", "message": "Your approval is required" }
      }
    },
    "mode": "parallel"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | expression | yes | Expression resolving to a list. |
| `item_var` | string | yes | Variable name for the current item within `body`. |
| `index_var` | string | no | Variable name for the current index (0-based). |
| `body` | Step | yes | Step executed per item. |
| `mode` | `"sequential"` \| `"parallel"` | no | Default: `"sequential"`. Parallel executes all iterations concurrently. |

### 3.10 `query_handler` — Register a query handler

```json
{
  "query_handler": {
    "query": "get_status",
    "returns": "$var.current_status"
  }
}
```

Registers a dynamic query handler on `DSLWorkflow` (via `setDefaultQueryHandler`) that returns the value of the given expression at query time. This step completes immediately; the handler remains active for the lifetime of the execution.

### 3.11 `set_variable` — Assign a computed value

```json
{
  "set_variable": {
    "name": "current_status",
    "value": "pending_approval"
  }
}
```

Updates the variable binding at runtime. Useful for tracking workflow state for query handlers.

### 3.12 `try_catch` — Handle activity or step failures

```json
{
  "try_catch": {
    "try": {
      "activity": { "name": "call_external_api", "args": { "url": "$input.endpoint" } }
    },
    "catch": {
      "error_var": "err",
      "body": {
        "activity": { "name": "log_failure", "args": { "error": "$var.err" } }
      }
    },
    "finally": {
      "activity": { "name": "cleanup", "args": { "entity_id": "$input.entity_id" } }
    }
  }
}
```

`finally` executes regardless of success or failure. `catch.error_var` binds the exception message string.

---

## 6. Expression Syntax

Expressions are strings prefixed with a sigil. The interpreter resolves them against the current variable context at step execution time. Expressions are evaluated in deterministic, pure TypeScript — no I/O, no dynamic evaluation.

| Prefix | Resolves to | Example |
|---|---|---|
| `$input.<path>` | Field from the workflow input object. Dot-separated for nested. | `$input.customer.email` |
| `$result.<name>` | Activity or child workflow result bound with the given `result:` name | `$result.created_entity` |
| `$var.<name>` | Any variable in the current binding context (input + results + set_variable) | `$var.current_status` |
| `$env.<key>` | Value from the workflow definition's top-level `variables` map | `$env.welcome_subject` |

**Condition expressions** (`condition.if`) support:
- Equality: `$var.x == "value"`, `$var.x != 0`
- Comparison: `$var.count > 5`, `$var.score <= 0.9`
- Boolean: `$var.approved == true`, `$var.error == null`
- Membership: `$var.status in ["approved", "escalated"]`
- Logical: `$var.x == 1 and $var.y == 2`, `$var.x == 1 or $var.y == 2`

Expressions are parsed by a restricted AST-walking evaluator (no `eval()`, no `new Function()`). The `expr-eval` library (webpack-compatible, V8-isolate-safe) is the recommended implementation. The allowed grammar is intentionally narrow to prevent logic from escaping into the definition layer — complex logic belongs in activities.

---

## 7. Variable Binding Model

The interpreter maintains a single flat `variables` object throughout execution. This is identical to the pattern in Temporal's official TypeScript and Go DSL samples.

Scoping rules:

1. At execution start, `variables` is initialised from the definition's top-level `variables` map.
2. All `$input.*` references resolve against the workflow's input payload — the input is never mutated.
3. `activity.result`, `child_workflow.result`, and `wait_signal.result` write into `variables` when their step completes.
4. `set_variable` writes into `variables` immediately.
5. `for_each` creates a scoped overlay per iteration: `item_var` and `index_var` are visible inside `body` but do not leak out.
6. `parallel.branches` and `for_each mode=parallel` execute with a copy of the current variables; writes are merged back after all branches complete. Conflicts (two branches writing the same key) raise a `DSLConflictError` — caught by the try-catch step or propagated as workflow failure.

The `variables` dict is **not** stored in the Temporal memo. The full definition is passed as workflow input and is part of the event history — that is what guarantees replay safety. The memo carries only lightweight searchable metadata (`definition_name`, `definition_version`) for visibility queries.

---

## 8. Retry Policy Schema

```json
{
  "max_attempts": 3,
  "initial_interval": "1s",
  "backoff_coefficient": 2.0,
  "max_interval": "30s",
  "non_retryable_errors": ["ValidationError", "PermissionDenied"]
}
```

Maps directly onto `@temporalio/client`'s `RetryPolicy` interface. All fields are optional; omitted fields use Temporal's defaults.

---

## 9. Full Example: Customer Onboarding

```json
{
  "name": "onboard-customer",
  "version": "1.0.0",
  "description": "Create entity, request approval, provision account, notify.",
  "variables": {
    "welcome_subject": "Welcome aboard"
  },
  "steps": {
    "sequence": {
      "steps": [
        {
          "activity": {
            "name": "create_entity",
            "args": {
              "entity_type": "customer",
              "attributes": "$input.customer_data",
              "created_by": "$input.initiated_by"
            },
            "result": "created_entity",
            "retry": { "max_attempts": 3, "initial_interval": "2s" }
          }
        },
        {
          "set_variable": { "name": "current_status", "value": "pending_approval" }
        },
        {
          "query_handler": { "query": "get_status", "returns": "$var.current_status" }
        },
        {
          "parallel": {
            "branches": [
              {
                "for_each": {
                  "items": "$input.approvers",
                  "item_var": "approver",
                  "body": {
                    "activity": {
                      "name": "send_notification",
                      "args": {
                        "user_id": "$var.approver",
                        "message": "Approval required for new customer"
                      }
                    }
                  },
                  "mode": "parallel"
                }
              }
            ]
          }
        },
        {
          "wait_signal": {
            "signal": "submit_decision",
            "result": "decision",
            "timeout": "24h",
            "on_timeout": {
              "sequence": {
                "steps": [
                  { "set_variable": { "name": "current_status", "value": "timed_out" } },
                  {
                    "activity": {
                      "name": "append_event",
                      "args": {
                        "entity_id": "$result.created_entity.entity_id",
                        "entity_type": "customer",
                        "event_type": "approval_timed_out",
                        "event_data": {}
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        {
          "condition": {
            "if": "$result.decision.approved == true",
            "then": {
              "sequence": {
                "steps": [
                  { "set_variable": { "name": "current_status", "value": "approved" } },
                  {
                    "activity": {
                      "name": "update_entity_scd2",
                      "args": {
                        "entity_id": "$result.created_entity.entity_id",
                        "attributes": { "status": "active" }
                      }
                    }
                  },
                  {
                    "activity": {
                      "name": "email_send",
                      "args": {
                        "to": "$input.customer_data.email",
                        "subject": "$env.welcome_subject",
                        "body_html": "<p>Your account is ready.</p>",
                        "body_text": "Your account is ready.",
                        "_idempotency_key": "$workflow.run_id"
                      }
                    }
                  }
                ]
              }
            },
            "else": {
              "sequence": {
                "steps": [
                  { "set_variable": { "name": "current_status", "value": "rejected" } },
                  {
                    "activity": {
                      "name": "email_send",
                      "args": {
                        "to": "$input.customer_data.email",
                        "subject": "Application update",
                        "body_html": "<p>We were unable to approve your application.</p>",
                        "body_text": "We were unable to approve your application.",
                        "_idempotency_key": "$workflow.run_id"
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  }
}
```

---

## 10. Versioning and Replay Safety

This is the most important design decision in the spec. It is the place where Temporal's execution model and Flowable's process versioning model must be reconciled — and they reconcile cleanly.

### The Flowable versioning model (and why it's correct here)

In Flowable, every running process instance is permanently associated with the process definition that was active when it started. Deploying a new version of a process definition does not affect any running instance. New instances start on the new version. Running instances continue on their version until they complete, are explicitly migrated by an operator, or are cancelled. This model is simple, predictable, and operationally sound.

This is precisely what Temporal's event history makes possible — and actually makes *easier* than Flowable. In Flowable, pinning requires explicit bookkeeping in the database. In this system, pinning is a structural consequence of how the interpreter works: the full definition JSON is passed as workflow input at execution start and becomes part of the Temporal event history. The definition is never fetched again. The interpreter has no way to use a different definition during replay even if it wanted to.

### The rules

1. **Definitions are pinned at start time.** The full definition JSON is passed as `DSLInput.definition` when starting a workflow execution. Temporal records it in the event history as part of the workflow input payload. All replays use that exact definition — the Supabase registry is never consulted during a running execution. This is the pin; it costs nothing extra.

2. **Version field is a visibility tag, not a replay guard.** Every definition carries a `version` field. The interpreter writes it to the Temporal memo (`definition_version`) at start for visibility queries ("how many executions are running on v1.2.0?"). It does not need to check for mismatches during replay because replay always uses the pinned input.

3. **Multiple versions coexist in production simultaneously.** Version 1.0.0, 1.1.0, and 2.0.0 of the same named definition can all have running executions concurrently. The interpreter is version-agnostic — it executes whatever definition it receives. The worker code does not need to change when a new definition version is deployed.

4. **New executions always use the current definition.** The client reads the latest active definition from Supabase and passes it as input. The definition registry controls which version is "current" via the `is_active` flag and `version` column.

5. **Explicit operator-driven migration.** When a running execution must be moved to a new definition version (e.g. to pick up a bug fix in a 30-day workflow), an operator action cancels the current execution and restarts it on the new version. This is intentional and auditable, not automatic. The restart receives the current state from the last execution's final variables (stored in Supabase by the workflow's `append_event` activity calls) as its input.

6. **`workflow.GetVersion` is not needed and not exposed.** `GetVersion` is the Temporal mechanism for safely changing coded workflow logic mid-execution — it is required precisely because the workflow code itself changes. In the DSL model, the interpreter never changes; only definitions do. Because the definition is pinned to the execution, there is no "coded workflow migration" problem to solve. This is strictly simpler than coded Temporal workflow versioning.

7. **Definition hot-fixes.** If a definition has a bug affecting running executions (e.g. wrong variable reference that will cause a failure at step 15), the correct response is:
   - Deploy a patched definition version (e.g. `1.0.1`)
   - For executions not yet past the broken step: cancel and restart on `1.0.1`
   - For executions already past the broken step: they will succeed; no action needed
   - A `workflow_executions` Supabase view (joining Temporal's visibility API) shows which executions are on which version and what step they are at

### Why `workflow.GetVersion` would be wrong here

`GetVersion` patches the event history to allow the interpreter to take different branches on replay vs. live execution. It's needed when coded workflow logic changes. In the DSL model, the interpreter code is fixed and never changes — step dispatch, variable resolution, signal handling are always the same TypeScript. The definition itself is the "workflow code", and it is frozen at start. There is no scenario in the DSL model where `GetVersion` adds value. Using it would be both unnecessary and misleading.

---

## 11. Interpreter Implementation Guide

The interpreter is implemented in `temporal/src/workflows/dsl/interpreter.ts` and registered in `temporal/src/worker.ts`.

### Correctness constraints

Three constraints shape the module structure:

1. **Signal buffering at init.** `setDefaultSignalHandler` is called before any `await`, so signals arriving before a `wait_signal` step are buffered in named queues and never dropped. Named signals are routed into per-name queues; `wait_signal` drains from the queue for its named signal.
2. **Dynamic activity dispatch.** `proxyActivities` is cast to `Record<string, Function>` so any registered activity can be called by string name. A new proxy is created per activity call to carry the DSL-specified timeout and retry policy.
3. **Timeout returns boolean, not throws.** `condition()` returns `false` on timeout — it does **not** throw. The `wait_signal` implementation must check the return value. This is the opposite of Python's `asyncio.TimeoutError` and is the most common porting mistake.

### V8 isolate and webpack bundling

Temporal's TypeScript SDK executes workflow code inside a V8 isolate via webpack. This replaces Python's `workflow.unsafe.imports_passed_through()` mechanism entirely:

- All imports used in workflow files are statically bundled at build time by webpack — no runtime `require()` is possible
- `eval()` and `new Function()` are banned inside workflow code — the V8 isolate blocks them
- The expression evaluator must be a pure AST-walking library (e.g. [`expr-eval`](https://github.com/silentmatt/expr-eval)) that does not call `eval()` internally; it will be bundled by webpack
- Only `assert`, `url`, and `util` are available as built-in Node.js modules inside the workflow isolate

There is no Temporal-specific allowlist. Webpack's static analysis at build time is the boundary: if a module is importable and does not call `eval()` or `new Function()`, it can be used inside a workflow.

### Core workflow function

```typescript
// temporal/src/workflows/dsl/interpreter.ts

import {
  proxyActivities,
  setDefaultSignalHandler,
  setDefaultQueryHandler,
  executeChildWorkflow,
  sleep,
  condition,
  workflowInfo,
} from '@temporalio/workflow';
import { resolveExpression, resolveArgs, evaluateCondition } from './expression';
import { validateDefinition } from './schema';
import { parseDuration } from './duration';

type Variables = Record<string, unknown>;
type Step = Record<string, unknown>;

export interface DSLInput {
  definition: Record<string, unknown>;
  input: Record<string, unknown>;
}

export async function DSLWorkflow(dslInput: DSLInput): Promise<Variables> {
  validateDefinition(dslInput.definition);

  const vars: Variables = { ...(dslInput.definition.variables as Variables ?? {}) };
  const inputData: Variables = dslInput.input ?? {};

  // Buffer signals arriving before any wait_signal step.
  // Per-name queues allow multiple distinct signals to coexist.
  const signalQueues = new Map<string, unknown[]>();
  setDefaultSignalHandler((signalName: string, ...args: unknown[]) => {
    const payload = args[0] ?? null;
    if (!signalQueues.has(signalName)) signalQueues.set(signalName, []);
    signalQueues.get(signalName)!.push(payload);
  });

  // Register dynamic query handler once; per-query returns are updated by query_handler steps.
  const queryHandlers = new Map<string, () => unknown>();
  setDefaultQueryHandler((queryName: string) => {
    const handler = queryHandlers.get(queryName);
    if (handler) return handler();
    throw new Error(`No query handler registered for: ${queryName}`);
  });

  let stepCounter = 0;
  await execute(
    dslInput.definition.steps as Step,
    vars, inputData, signalQueues, queryHandlers,
    () => stepCounter++,
  );
  return vars;
}
```

### Step dispatch

```typescript
async function execute(
  step: Step,
  vars: Variables,
  input: Variables,
  signals: Map<string, unknown[]>,
  queries: Map<string, () => unknown>,
  nextId: () => number,
): Promise<void> {
  if ('activity' in step)
    return executeActivity(step.activity as Step, vars, input, signals, queries, nextId);
  if ('sequence' in step) {
    for (const s of (step.sequence as Step).steps as Step[])
      await execute(s, vars, input, signals, queries, nextId);
    return;
  }
  if ('parallel' in step)
    return executeParallel(step.parallel as Step, vars, input, signals, queries, nextId);
  if ('condition' in step)
    return executeCondition(step.condition as Step, vars, input, signals, queries, nextId);
  if ('wait_signal' in step)
    return executeWaitSignal(step.wait_signal as Step, vars, input, signals, queries, nextId);
  if ('sleep' in step) {
    await sleep(parseDuration((step.sleep as Step).duration as string));
    return;
  }
  if ('wait_until' in step)
    return executeWaitUntil(step.wait_until as Step, vars, input);
  if ('child_workflow' in step)
    return executeChildWF(step.child_workflow as Step, vars, input, signals, queries, nextId);
  if ('for_each' in step)
    return executeForEach(step.for_each as Step, vars, input, signals, queries, nextId);
  if ('try_catch' in step)
    return executeTryCatch(step.try_catch as Step, vars, input, signals, queries, nextId);
  if ('set_variable' in step) {
    const s = step.set_variable as Step;
    vars[s.name as string] = resolveExpression(s.value, vars, input);
    return;
  }
  if ('query_handler' in step) {
    const s = step.query_handler as Step;
    queries.set(s.query as string, () => resolveExpression(s.returns, vars, input));
    return;
  }
  throw new Error(`Unknown step type: ${JSON.stringify(Object.keys(step))}`);
}
```

### Activity calling convention — single-object input

All DSL-callable activities must accept a single object argument. The interpreter passes the fully-resolved args object as that single argument. The interpreter also auto-injects `_idempotency_key` so every activity receives a stable, workflow-scoped deduplication key without the definition author having to specify it.

```typescript
// Correct: single object input
export async function createEntity(args: {
  entity_type: string;
  attributes: object;
  _idempotency_key: string;   // injected automatically by the interpreter
}): Promise<EntityResult> {
  // use args._idempotency_key in Supabase ON CONFLICT DO NOTHING
}

// Wrong for DSL use: positional parameters
export async function createEntity(entityType: string, attributes: object): Promise<EntityResult> { ... }
```

This matches the pattern used by Temporal's official TypeScript DSL sample and removes all positional ordering risk.

### Activity execution

```typescript
async function executeActivity(
  spec: Step,
  vars: Variables,
  input: Variables,
  _signals: Map<string, unknown[]>,
  _queries: Map<string, () => unknown>,
  nextId: () => number,
): Promise<void> {
  const stepId = nextId();
  const resolvedArgs = {
    ...resolveArgs(spec.args as Record<string, unknown> ?? {}, vars, input),
    // Always inject a stable idempotency key. Activities use it for Supabase upserts,
    // Stripe idempotency headers, or any other deduplication concern.
    _idempotency_key: spec.idempotency_key
      ? String(resolveExpression(spec.idempotency_key, vars, input))
      : `${workflowInfo().workflowId}:${spec.name as string}:${stepId}`,
  };

  // Create a per-call proxy to carry this activity's timeout and retry settings.
  // Casting to Record<string, Function> enables string-name dispatch.
  const acts = proxyActivities<Record<string, (args: Record<string, unknown>) => Promise<unknown>>>({
    startToCloseTimeout: spec.start_to_close_timeout
      ? parseDuration(spec.start_to_close_timeout as string)
      : '30 seconds',
    scheduleToCloseTimeout: spec.schedule_to_close_timeout
      ? parseDuration(spec.schedule_to_close_timeout as string)
      : undefined,
    retry: buildRetryPolicy(spec.retry as Step | undefined),
    taskQueue: spec.task_queue as string | undefined,
  });

  const result = await acts[spec.name as string](resolvedArgs);

  if (spec.result) vars[spec.result as string] = result;
}
```

### Hard constraint: activities must be pre-registered

`DSLWorkflow` can only call activities registered with the worker at startup. The DSL controls *workflow structure* — which activities to call and in what order — but not the *activity vocabulary*. Adding a new activity type requires a TypeScript code change and worker redeploy.

This is a Temporal architectural property, not a design limitation. The DSL boundary is: **workflow structure is configuration; activity implementations are code.**

### Signal waiting

Because `setDefaultSignalHandler` is registered before any `await`, signals arriving before `executeWaitSignal` runs are already buffered. The `condition` check below finds them immediately.

**Critical:** `condition()` returns `false` on timeout — it does **not** throw. Always check the boolean return value.

```typescript
async function executeWaitSignal(
  spec: Step,
  vars: Variables,
  input: Variables,
  signals: Map<string, unknown[]>,
  queries: Map<string, () => unknown>,
  nextId: () => number,
): Promise<void> {
  const signalName = spec.signal as string;
  const timeoutStr = spec.timeout as string | undefined;

  // condition() returns false on timeout — does NOT throw (unlike Python asyncio.TimeoutError)
  const received: boolean = await condition(
    () => (signals.get(signalName)?.length ?? 0) > 0,
    timeoutStr,
  );

  if (received) {
    const payload = signals.get(signalName)!.shift();
    if (spec.result) vars[spec.result as string] = payload;
  } else if (spec.on_timeout) {
    await execute(spec.on_timeout as Step, vars, input, signals, queries, nextId);
  }
}
```

### Parallel branches and exception semantics

`Promise.all` fails fast when any promise rejects — the first rejection propagates, but other promises continue running (not cancelled). For `wait_all: false` (race pattern), `Promise.race` continues after the first branch resolves successfully.

```typescript
async function executeParallel(
  spec: Step,
  vars: Variables,
  input: Variables,
  signals: Map<string, unknown[]>,
  queries: Map<string, () => unknown>,
  nextId: () => number,
): Promise<void> {
  const branches = spec.branches as Step[];
  // Each branch starts with a shallow copy of vars at branch-start time.
  const branchVars = branches.map(() => ({ ...vars }));
  const snapshot = { ...vars };

  if (spec.wait_all !== false) {
    // wait_all: true (default) — fail fast on first rejection
    await Promise.all(
      branches.map((branch, i) => execute(branch, branchVars[i], input, signals, queries, nextId))
    );
  } else {
    // wait_all: false — race: continue after first branch completes
    await Promise.race(
      branches.map((branch, i) => execute(branch, branchVars[i], input, signals, queries, nextId))
    );
  }

  // Merge branch results back. Conflicts (two branches writing the same key
  // with different values) are a DSLConflictError.
  for (const bv of branchVars) {
    for (const [k, v] of Object.entries(bv)) {
      if (k in snapshot && snapshot[k] === v) continue; // branch didn't change this key
      if (k in vars && vars[k] !== v && vars[k] !== snapshot[k]) {
        throw new Error(`DSLConflictError: parallel branches both wrote variable '${k}'`);
      }
      vars[k] = v;
    }
  }
}

---

## 12. Definition Storage Schema

All DSL artefacts live in Supabase. They use the project's established patterns: dedicated tables for structured data, JSONB for flexible payloads, `authenticated` role access, and the same `update_updated_at()` trigger used by all other tables. The existing entity/SCD2 model is **not** used for definitions — these are configuration artefacts, not domain entities, and they need stronger schema constraints than JSONB-in-entity-versions can provide.

### 12.1 `workflow_definitions` — versioned workflow definition registry

```sql
create table workflow_definitions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  version      text not null,                  -- semver: "1.0.0"
  definition   jsonb not null,                 -- full validated DSL JSON
  description  text,
  is_active    boolean not null default true,  -- current version flag
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   text,                           -- user_id of author
  deployed_at  timestamptz,                    -- set on deploy; null = draft

  constraint uq_workflow_definitions_name_version unique (name, version),
  constraint chk_version_semver check (version ~ '^\d+\.\d+\.\d+')
);

create trigger trg_workflow_definitions_updated_at
  before update on workflow_definitions
  for each row execute function update_updated_at();

-- Only one active version per name at a time.
-- Enforced by partial unique index so drafts (is_active=false) can stack up.
create unique index uq_workflow_definitions_active
  on workflow_definitions (name) where is_active = true;

-- Fast lookup for the interpreter client at execution start.
create index idx_workflow_definitions_name_active
  on workflow_definitions (name, is_active, deployed_at desc);

-- Full-text search on definition name and description for the designer UI.
create index idx_workflow_definitions_fts
  on workflow_definitions using gin (to_tsvector('english', name || ' ' || coalesce(description, '')));
```

**Key design decisions:**
- `(name, version)` is unique — you can never overwrite a deployed definition. Corrections require a new version.
- `is_active = true` has a partial unique index — only one version per name can be active. Activating a new version requires deactivating the old one (handled by the `activate_workflow_definition` function below).
- `deployed_at` is null until the definition is explicitly deployed. This allows draft definitions to live in the table without being picked up by new executions.
- `definition` stores the full validated JSON. The worker reads it directly; no reconstruction from normalised tables.

### 12.2 `decision_tables` — DMN-style decision logic (separate from workflow structure)

Decision logic (the `evaluate_decision` activity) is stored separately from workflow definitions. A decision table can be shared by multiple workflow definitions and versioned independently.

```sql
create table decision_tables (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  version      text not null,
  description  text,
  -- Input columns: [{name, type, label}]
  inputs       jsonb not null default '[]',
  -- Output columns: [{name, type, label}]
  outputs      jsonb not null default '[]',
  -- Hit policy: "first" (first matching rule), "all" (all matching rules)
  hit_policy   text not null default 'first' check (hit_policy in ('first', 'all', 'unique')),
  -- Rules: [{conditions: {col: expr}, outputs: {col: value}, annotation: ""}]
  rules        jsonb not null default '[]',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   text,
  deployed_at  timestamptz,

  constraint uq_decision_tables_name_version unique (name, version),
  constraint chk_dt_version_semver check (version ~ '^\d+\.\d+\.\d+')
);

create trigger trg_decision_tables_updated_at
  before update on decision_tables
  for each row execute function update_updated_at();

create unique index uq_decision_tables_active
  on decision_tables (name) where is_active = true;
```

A decision table for credit approval might look like:

```json
{
  "name": "credit_approval_policy",
  "version": "1.0.0",
  "inputs": [
    {"name": "credit_score", "type": "number"},
    {"name": "requested_amount", "type": "number"},
    {"name": "customer_tier", "type": "string"}
  ],
  "outputs": [
    {"name": "approved", "type": "boolean"},
    {"name": "max_amount", "type": "number"},
    {"name": "rate_band", "type": "string"}
  ],
  "hit_policy": "first",
  "rules": [
    {
      "conditions": {"credit_score": ">= 750", "customer_tier": "premium"},
      "outputs": {"approved": true, "max_amount": 100000, "rate_band": "A"}
    },
    {
      "conditions": {"credit_score": ">= 650"},
      "outputs": {"approved": true, "max_amount": 50000, "rate_band": "B"}
    },
    {
      "conditions": {},
      "outputs": {"approved": false, "max_amount": 0, "rate_band": "none"}
    }
  ]
}
```

### 12.3 `workflow_executions` — execution audit log and version tracking

Temporal is the authoritative source for execution state. This table is an audit mirror that enables Supabase-side queries — "which executions are running on v1.2.0?", "how long has this execution been waiting for a signal?", "which executions completed today?".

```sql
create table workflow_executions (
  id                  uuid primary key default gen_random_uuid(),
  -- Temporal identifiers
  workflow_id         text not null unique,   -- Temporal workflow ID
  run_id              text not null,          -- Temporal run ID (changes on restart)
  -- Definition linkage
  definition_name     text not null,
  definition_version  text not null,
  -- Execution state (mirrored from Temporal events via activities)
  status              text not null default 'running'
                        check (status in ('running','completed','failed','cancelled','timed_out')),
  current_step        text,                   -- label of the currently-executing step
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  -- Input and final output (stored for restart/migration support)
  input_payload       jsonb not null default '{}',
  output_payload      jsonb,
  error_message       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint fk_wf_exec_definition
    foreign key (definition_name, definition_version)
    references workflow_definitions (name, version)
);

create trigger trg_workflow_executions_updated_at
  before update on workflow_executions
  for each row execute function update_updated_at();

create index idx_wf_exec_definition on workflow_executions (definition_name, definition_version);
create index idx_wf_exec_status on workflow_executions (status, started_at desc);
create index idx_wf_exec_workflow_id on workflow_executions (workflow_id);
```

This table is written by the `DSLWorkflow` interpreter via activities at key lifecycle points (start, step transitions, completion/failure). It is the data source for the operator visibility dashboard (§16 open question 2).

### 12.4 `workflow_signals` — signal audit log

Every signal dispatched to a running workflow is recorded here for auditability.

```sql
create table workflow_signals (
  id              uuid primary key default gen_random_uuid(),
  workflow_id     text not null,
  signal_name     text not null,
  payload         jsonb not null default '{}',
  sent_by         text,           -- user_id or system identifier
  sent_at         timestamptz not null default now(),

  constraint fk_wf_signal_execution
    foreign key (workflow_id) references workflow_executions (workflow_id)
);

create index idx_wf_signals_workflow_id on workflow_signals (workflow_id, sent_at desc);
```

### 12.5 Access control

All four tables follow the project's established auth pattern from `20251202090000_core_entity_model.sql`:

- `anon` role: no access (revoked by the auth lockdown migration)
- `authenticated` role: `SELECT` on all four tables; `INSERT/UPDATE` only via `SECURITY DEFINER` functions (not direct table writes from the frontend)
- Temporal worker: Node.js process connects directly to Postgres via `pg` driver as a superuser, bypassing PostgREST entirely — can read and write all tables

Definitions are never written directly from the frontend to `workflow_definitions`. The write path is: git PR → deploy job → `SECURITY DEFINER` function `deploy_workflow_definition(name, version)` that validates the JSON schema and activates the new version atomically. This enforces schema correctness at the database boundary.

```sql
create or replace function deploy_workflow_definition(
  p_name    text,
  p_version text
)
returns workflow_definitions
security definer
language plpgsql
as $$
declare
  v_row workflow_definitions;
begin
  -- Deactivate the current active version for this name
  update workflow_definitions
     set is_active = false, updated_at = now()
   where name = p_name and is_active = true;

  -- Activate the new version
  update workflow_definitions
     set is_active = true, deployed_at = now(), updated_at = now()
   where name = p_name and version = p_version
  returning * into v_row;

  if not found then
    raise exception 'workflow definition % version % not found', p_name, p_version;
  end if;

  -- Validate the definition JSON against required fields
  if v_row.definition ->> 'name' is null
  or v_row.definition ->> 'version' is null
  or v_row.definition -> 'steps' is null then
    raise exception 'definition JSON missing required fields: name, version, steps';
  end if;

  return v_row;
end;
$$;
```

### 12.6 Schema correctness enforcement

The `definition` column in `workflow_definitions` is JSONB with a database-level structural check, plus application-level JSON Schema validation in the interpreter before any execution begins.

```sql
-- Minimal structural constraint at the DB level: name, version, steps must be present.
alter table workflow_definitions
  add constraint chk_definition_structure check (
    definition ? 'name'
    and definition ? 'version'
    and definition ? 'steps'
  );
```

Full JSON Schema validation (step type correctness, expression syntax, retry policy field types) runs in the TypeScript interpreter via `validateDefinition()` before the first step executes. A definition that passes the DB constraint but fails the interpreter's schema validation will fail at execution start — not silently at an arbitrary step. This two-layer approach catches malformed definitions as early as possible without pushing the full JSON Schema grammar into SQL.

Schema validation uses the [`ajv`](https://ajv.js.org) library (`ajv@^8`), which is webpack-compatible and runs cleanly inside Temporal's V8 isolate. The JSON Schema definition document lives at `temporal/src/workflows/dsl/schema.json` and is bundled statically — there is no runtime filesystem read.

---

## 13. Starting a DSL Workflow

From the Temporal TypeScript client (or from a Supabase Edge Function via HTTP):

```typescript
import { Client, Connection } from '@temporalio/client';
import type { DSLInput } from './workflows/dsl/interpreter';

const connection = await Connection.connect({ address: 'temporal:7233' });
const client = new Client({ connection });

const handle = await client.workflow.start('DSLWorkflow', {
  args: [{
    definition: definitionJson,         // full definition — stored in event history
    input: {                             // runtime values accessible as $input.*
      customer_data: { ... },
      initiated_by: 'user-123',
      approvers: ['user-456', 'user-789'],
    },
  } satisfies DSLInput],
  workflowId: `onboard-customer-${customerId}`,
  taskQueue: 'main',
  // Memo carries only lightweight metadata for visibility queries.
  // Do NOT put the full definition in the memo — memo has size limits
  // and is not replayed; replay safety comes from the workflow input above.
  memo: {
    definition_name: definitionJson.name,
    definition_version: definitionJson.version,
  },
});
```

---

## 14. Capability Coverage Matrix

| Temporal Capability | DSL Step | Notes |
|---|---|---|
| Activity invocation | `activity` | Full retry policy and timeout control |
| Sequential execution | `sequence` | |
| Parallel execution | `parallel` | Includes race (wait_all: false) pattern |
| Signal waiting | `wait_signal` | With timeout and on_timeout handler |
| Signal sending | — | Handled externally by callers; not a workflow-side step |
| Query handlers | `query_handler` | Dynamic registration at runtime |
| Workflow updates | — | Not in v0.1; planned for v0.2 |
| Timers / sleep | `sleep`, `wait_until` | Maps to `workflow.sleep()` |
| Child workflows | `child_workflow` | Supports both DSL and coded workflows |
| Dynamic fan-out | `for_each` | Sequential or parallel mode |
| Conditional branching | `condition` | If/then/else |
| Error handling | `try_catch` | With optional `finally` |
| Variable state | `set_variable` | |
| Cancellation | — | Temporal SDK handles at the client level; no DSL step needed |
| Continue-as-new | — | Not in v0.1; planned for v0.2 for long-running loops |
| Schedules | — | Temporal Schedules operate at the client level; DSL workflows can be registered as schedule targets |
| Memos / search attrs | — | Set by the DSL runner at start time from definition metadata |

---

## 15. What the DSL Does Not Cover

### Hard exclusions — by design

- **Arbitrary in-process computation.** The expression evaluator handles comparisons and variable references, not general computation. Anything requiring loops, string manipulation, maths, or stateful logic belongs in an activity. This is not a limitation — it is the correct separation. Computation that belongs in an activity is testable, retryable, observable, and callable by multiple workflow definitions. Embedding it in the expression evaluator would make it untestable and unobservable.

- **Dynamically-generated workflow graph topology.** `for_each` iterates over a runtime list, but the *structure* of each iteration's body is static. A workflow whose entire DAG topology is built at runtime from a database query (e.g., "build a fan-out of N arbitrary parallel steps where N and the step types are determined at runtime") is better served by a coded workflow. The DSL covers dynamic *data* (variable lists) over static *structure* (fixed step graph).

- **SDK interceptors and middleware.** Interceptors operate at the worker level — they apply to all workflows including DSL ones. The definition layer has no hook into them, nor should it. A definition author who needs custom serialisation or tracing is working at the wrong layer.

### Planned for v0.2

- **`workflow.update`** — signals that return a synchronous result to the caller. Useful for approval gates where the caller wants an immediate acknowledgement, not just a fire-and-forget.
- **`continue_as_new`** — for workflows that must run indefinitely (polling loops, perpetual monitoring). The DSL would expose a `max_history_events` threshold that triggers continue-as-new automatically, carrying forward the current variable state.

### What is NOT an exclusion (correcting earlier analysis)

Earlier analysis of this design claimed three hard limitations that are worth explicitly retracting:

1. ~~"New activity types always need TypeScript code."~~ The generic activity library (`http_request`, `supabase_query`, `evaluate_decision`, etc.) covers the vast majority of real workflow steps without custom code. The long tail is handled by the code-generation agent path (§4.7). The vocabulary constraint is real but its blast radius is small and shrinking.

2. ~~"Mid-execution versioning is unsolvable."~~ Flowable solved this decades ago. The Flowable model (pin execution to its start-time definition; migrate explicitly; new executions use new versions) is the model this spec implements, and Temporal's event history makes it *more* reliable than Flowable's database-pinning approach, not less.

3. ~~"Any real DSL becomes a programming language."~~ Flowable's BPMN+DMN model has been in production for twenty years at enterprises running genuinely complex processes. Decision tables (DMN) separate decision logic from process logic cleanly — `evaluate_decision` is the equivalent here. The expression evaluator handles the narrow set of branching conditions that belong in the workflow definition; the rest belongs in activities or decision tables.

---

## 16. Open Questions

These must be answered before v1.0.0:

1. **Definition storage: git files vs. live database rows.** The spec recommends git-controlled JSON files at `temporal/definitions/` as the source of truth, synced to Supabase on deploy. The open question is the sync mechanism — does a deploy-time migration job write to `workflow_definitions`, or does the worker load from the filesystem directly? Git-controlled files have better diff/review tooling; Supabase rows enable live editing from a designer UI. A hybrid is likely correct: git is canonical, Supabase is the runtime cache, the designer writes back to git via PR.

2. **Execution visibility dashboard.** Operators need to see: which executions are running on which definition version, what step they are currently at, and how long they have been there. This requires a `workflow_executions` Supabase view that joins Temporal's visibility API (searchable workflow metadata). The `definition_name` and `definition_version` memo fields exist precisely to enable this query.

3. **Explicit migration tooling.** The spec defines the migration model (cancel + restart on new version) but not the tooling. A `migrate_execution` Temporal workflow that cancels a running execution, extracts its last known variable state, and starts a new execution on a target version would make this operator action safe and auditable. Design needed.

4. **Expression evaluator security boundary.** The restricted expression grammar is described but not implemented. Before definitions are writable from the frontend by non-engineers, the evaluator needs a formal security review — specifically, what is the blast radius if a malformed expression is executed inside a Temporal workflow? The `expr-eval` library is the recommended implementation (pure AST-walking, no `eval()`, webpack-compatible) but needs a security audit before production use. The grammar should be implemented as a whitelist parser (explicit allowed tokens), not as a blacklist filter.

5. **Decision table schema.** The `evaluate_decision` activity references `decision_tables` as a Supabase entity type. The schema for decision table rows (input columns, output columns, rule rows, hit policy — first match, all matches, etc.) needs a spec. This is the DMN layer; it is the mechanism that keeps business logic out of workflow definitions.

6. **Workflow designer UI.** The definition format is designed for both machine and human authorship. A visual designer in the frontend's `UIEngine` is the natural extension — it would generate and consume the same JSON. The `UIEngine` already renders arbitrary component trees from JSON definitions; a workflow canvas is the same pattern applied to step graphs. Spec needed separately.
