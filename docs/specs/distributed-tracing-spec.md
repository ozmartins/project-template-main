# Distributed Tracing Spec

**Status:** Draft  
**Last updated:** 2026-06-23

---

## Goal

Add end-to-end distributed tracing across the workflow launch path and execution stack so operators can follow a request from the browser through ingress, trigger forwarding, workflow start, and Temporal execution.

The design must:

- stay portable across AKS and EKS
- remain opt-in
- preserve replay safety for Temporal workflows
- keep tracing failures non-blocking

---

## Scope

In scope:

- OpenTelemetry instrumentation and propagation
- shared OTLP collector and Tempo backend
- trace-log correlation with Grafana/Loki
- OTLP-related chart and network-policy updates
- runtime surfaces in browser, edge function, workflow API, and Temporal worker

Out of scope:

- browser log shipping
- Supabase internal container instrumentation
- making tracing mandatory in local development

---

## Recommended approach

Extend the observability stack with a nested gate:

```yaml
observability:
  enabled: true
  tracing:
    enabled: true
```

This is the recommended approach over always-on tracing because it preserves the baseline footprint while still keeping the stack self-hostable and portable.

### Trade-offs considered

| Approach | Trade-off |
|---|---|
| Bundle tracing directly into the existing observability baseline | Simplest operator surface, but it silently increases resource cost and rollout scope. |
| Per-application collector and Tempo instances | Stronger isolation, but too expensive and operationally heavy for a reusable template. |
| Shared collector + Tempo with nested tracing gate | **Recommended.** Preserves opt-in complexity and keeps platform ownership centralized. |

---

## End-to-end path

```text
Browser
  -> Traefik ingress
  -> Supabase edge function `trigger-workflow`
  -> workflow API `temporal/src/server.ts`
  -> Temporal client
  -> Temporal worker / activities
```

Every hop must either create a root span or continue the current trace context.

---

## Instrumentation plan

### 1. Browser

Use OpenTelemetry web instrumentation for:

- document load
- fetch/XHR calls to the trigger and workflow-status endpoints

Requirements:

- export OTLP over HTTP through a same-origin path routed by Traefik
- propagate `traceparent` and `tracestate`
- treat exporter failures as no-op from the user's perspective

### 2. Traefik

Configure Traefik to emit ingress spans to the collector.

This provides:

- request timing at the ingress boundary
- correlation between browser spans and backend spans
- a trace root for requests that enter the cluster without browser instrumentation

### 3. Supabase edge function

`supabase/functions/trigger-workflow/index.ts` must preserve inbound trace headers when forwarding to `TEMPORAL_TRIGGER_URL`.

This is mandatory. Without it, the trace breaks at the edge-function boundary even if browser and backend instrumentation both exist.

### 4. Workflow API

Instrument `temporal/src/server.ts` as the workflow API boundary.

Required spans:

- inbound HTTP request span
- definition lookup span
- persistence/write-boundary span
- Temporal client start span

The workflow API must also propagate trace context when it starts the Temporal workflow.

### 5. Temporal worker

Instrument `temporal/src/worker.ts` through Temporal-supported client/worker interceptors and activity boundaries.

Required attributes include:

- workflow type
- task queue
- workflow ID
- run ID
- activity name

Do **not** import OpenTelemetry directly inside workflow implementation code under `temporal/src/workflows/**`. That code must remain replay-safe.

---

## Collector and Tempo topology

Use one shared collector and one shared Tempo backend in the monitoring namespace.

### Collector responsibilities

- receive OTLP HTTP/gRPC traffic
- batch and forward traces
- expose health/metrics for observability of the observability plane

### Tempo responsibilities

- store trace data
- serve Grafana trace queries
- remain platform-configurable for storage backend differences

Storage portability rule:

- AKS uses Azure Blob via platform overlays
- EKS uses S3 via platform overlays
- repo-owned application code must not branch on cloud provider

---

## Network and chart implications

Tracing is blocked by the current default-deny posture unless the chart is updated.

Required updates:

1. allow OTLP egress from frontend, workflow API, and worker workloads to the collector
2. allow collector ingress from those namespaces/workloads
3. extend `charts/app/ci-test.sh` assertions to verify the rendered allowlist

Bounded implementation surfaces:

- `charts/app/templates/networkpolicies.yaml`
- `charts/app/ci-test.sh`
- observability values overlays and platform chart wiring

---

## Trace-log correlation

Structured logs from instrumented services must include:

- `trace_id`
- `span_id`
- service/workload name

Grafana derived fields should link log lines to Tempo traces directly.

This complements existing workflow-history views; it does not replace them.

---

## Failure behavior

Tracing must be fail-open:

- collector unavailability must not block workflow starts
- Tempo unavailability must not block requests or worker execution
- exporter failures degrade observability only

This is required because tracing is an operational aid, not a correctness dependency.

---

## Security and data-handling constraints

Span attributes and logs must not include:

- bearer tokens
- Supabase service keys
- raw request bodies that may contain secrets or PII

Safe examples:

- workflow name
- workflow ID
- response status code
- task queue name
- elapsed duration

---

## Story split

1. **Platform slice:** collector, Tempo, storage overlays, Traefik tracing, Grafana datasource wiring
2. **Chart slice:** OTLP network-policy and values/test updates
3. **Backend slice:** edge-function header propagation, workflow API instrumentation, Temporal client/worker instrumentation
4. **Frontend slice:** browser tracing and same-origin OTLP export
5. **Correlation slice:** structured log enrichment and Grafana derived-field configuration

---

## Test strategy

Minimum acceptance coverage:

1. automated checks confirm tracing-enabled chart renders OTLP network-policy allowances
2. unit/integration tests confirm the edge function forwards `traceparent` and `tracestate`
3. backend tests confirm trace context survives workflow start boundaries
4. manual or automated verification shows one end-to-end trace from browser to Temporal activity in Grafana
5. failure-path tests confirm requests still succeed when the exporter or collector is unavailable

---

## Current repo-specific constraints

- `supabase/functions/trigger-workflow/index.ts` currently forwards only JSON content type and drops trace headers
- `temporal/src/worker.ts` starts the worker and API server but has no tracing bootstrap today
- `charts/app/templates/networkpolicies.yaml` currently allows only the existing service ports, not OTLP collector traffic
- `charts/app/ci-test.sh` has no assertions for tracing-related network policy yet

---

## Risks

- Trace continuity will silently fail if any boundary drops propagation headers.
- Browser export can create cross-origin or CSP issues if the OTLP endpoint is not routed through the existing ingress path.
- Adding collector traffic without matching policy tests can create environment-specific drift.
