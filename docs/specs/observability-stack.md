# Observability Stack

**Status:** Draft  
**Last updated:** 2026-06-24

---

## Goal

Define the repository's opt-in observability baseline for metrics, logs, traces, dashboards, and alerts without breaking the template's portability or low-complexity default path.

The design must:

- stay self-hostable and portable across AKS and EKS
- remain opt-in
- keep cluster-admin and namespace-scoped ownership boundaries clear
- support end-to-end diagnosis for application and workflow failures

This design addresses issue #34 and aligns with epic #54 and tracing epic #729.

---

## Scope

In scope:

- cluster-level observability components
- namespace-scoped chart resources for scraping and alerts
- structured application logging
- Prometheus-compatible metrics
- distributed tracing via OpenTelemetry and Tempo
- Grafana dashboards and alert rules for the first production-ready signal set

Out of scope for phase 1:

- browser log shipping and real-user monitoring
- vendor-specific managed monitoring backends
- mandatory observability components in the default local bootstrap path

---

## Approaches considered

| Approach | Trade-off |
|---|---|
| Cloud-native managed monitoring per provider | Operationally convenient, but creates vendor lock-in and diverges between AKS and EKS. |
| Minimal mixed stack (Prometheus + Jaeger + ad hoc logging) | Familiar parts, but fragmented operator UX and duplicated ingestion plumbing. |
| Grafana OSS LGTM stack (`kube-prometheus-stack` + Loki + Tempo + OpenTelemetry Collector) | **Recommended.** One open-source operator surface for logs, metrics, and traces while preserving portability. |

---

## Recommended approach

Adopt an opt-in Grafana OSS observability stack composed of:

- `kube-prometheus-stack` for Prometheus, Alertmanager, Grafana, and operator-managed CRDs
- Loki for structured log storage
- Tempo for trace storage
- OpenTelemetry Collector as the shared ingest and export plane for logs and traces

The stack is enabled only when explicitly configured. The repository default stays lean.

---

## Ownership boundary

### Platform-owned components

Cluster-admin bootstrap owns:

- Prometheus Operator CRDs
- Prometheus, Alertmanager, and Grafana
- Loki
- Tempo
- OpenTelemetry Collector
- storage overlays and ingress/auth for the observability namespace

### Application-owned components

Namespace-scoped app work owns:

- `ServiceMonitor` resources
- `PrometheusRule` resources
- workload annotations and environment wiring for exporters
- lane-local dashboard definitions packaged with the chart or app config
- network-policy allowlists needed to reach the collector or scrape endpoints

This split preserves the namespace-scoped deploy boundary established by ADR-0017.

---

## Signal contracts

### Logging

Requirements:

- application and worker logs are structured JSON
- each log line stays single-line
- fields include `service`, `environment`, `severity`, and when available `trace_id` and `span_id`
- logs must not contain bearer tokens, service-role secrets, or raw sensitive payloads

Phase 1 covers server-side and worker-side logs only.

### Metrics

Requirements:

- Prometheus scrape endpoints for the app and worker
- `ServiceMonitor` resources are value-gated because they depend on Prometheus Operator CRDs
- first alert set covers:
  - application error rate
  - workflow failure rate
  - p99 latency

### Tracing

Requirements:

- OpenTelemetry is the tracing contract
- Tempo is the trace backend
- trace propagation must cross the workflow trigger/API boundary and Temporal client/worker boundary
- workflow implementation code itself must remain replay-safe; instrumentation belongs at client, worker, and activity boundaries

This broader stack decision subsumes the narrower tracing-only proposal in ADR-0107 if accepted.

---

## Configuration model

Recommended values shape:

```yaml
observability:
  enabled: false
  metrics:
    enabled: true
    serviceMonitor:
      enabled: false
  logs:
    enabled: true
  tracing:
    enabled: true
  alerts:
    enabled: true
```

Rules:

1. `observability.enabled=false` keeps the template baseline free of cluster observability dependencies.
2. CRD-backed resources such as `ServiceMonitor` and `PrometheusRule` stay separately gated.
3. Tracing stays nested under the observability gate rather than becoming mandatory with metrics.

---

## Runtime instrumentation boundaries

### Frontend

Phase 1 covers metrics exposure and trace propagation only when tracing is enabled. Browser log shipping stays out of scope.

### Workflow/API boundary

Any server endpoint that triggers or proxies workflow execution must preserve trace context and emit request/latency metrics.

### Temporal worker

The Temporal worker is a Node.js workload in this repository. Instrumentation must use Temporal-safe OpenTelemetry boundaries:

- worker startup
- client calls
- activity execution

Do not import tracing libraries directly into workflow implementation code that must remain replay-safe.

---

## Dashboard and alert baseline

Minimum committed operator surfaces:

1. Grafana dashboard for request volume, error rate, and latency by service.
2. Grafana dashboard for workflow execution and failure signals from the worker.
3. Alerts for:
   - error rate above threshold
   - workflow failure rate above threshold
   - high latency sustained beyond threshold

Alert thresholds may start conservative in staging and tighten after baseline measurements.

---

## Bounded implementation surfaces

- platform chart or platform Terraform wiring for the shared observability namespace
- `charts/app/templates/` for `ServiceMonitor`, `PrometheusRule`, and any required network-policy changes
- frontend and worker runtime instrumentation surfaces
- dashboard JSON or chart-packaged dashboard assets

This issue remains architecture review work because the stack introduces platform-owned components and CRD prerequisites.

---

## Test strategy

Required coverage for implementation:

1. Render tests or chart assertions for observability-gated resources and disabled-by-default behavior.
2. Unit or integration tests for worker instrumentation boundaries and structured-log fields.
3. Validation that tracing failures are fail-open and do not block requests or workflow starts.
4. A staging smoke path proving at least one alert and one dashboard operate on live signals.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| The stack becomes mandatory or too heavy for fresh clones | Keep everything behind explicit values gates. |
| AKS and EKS diverge operationally | Keep only storage and ingress overlays cloud-specific; the contract stays shared. |
| Tracing instrumentation breaks Temporal replay safety | Restrict tracing to client, worker, and activity boundaries. |
| Sensitive data leaks into telemetry | Define log/span field allowlists and prohibit raw payload capture. |

---

## Acceptance criteria mapping

- An ADR defines the stack and ownership boundaries before implementation.
- `ServiceMonitor` and `PrometheusRule` resources are value-gated behind explicit observability settings.
- The design includes at least one dashboard and alert baseline.
- Temporal worker tracing is specified at replay-safe boundaries.
