# ADR-0107: OpenTelemetry and Tempo for Distributed Tracing

- **Status:** Proposed
- **Date:** 2026-06-23
- **Deciders:** Factory Architect
- **Supersedes / Superseded by:** None

## Context

The repository now has workflow history views and a growing observability direction, but it still lacks an end-to-end trace plane across the browser, ingress, workflow trigger edge function, workflow API, and Temporal worker. Metrics and logs alone do not show where latency or failures occur across service boundaries.

This template also has important constraints:

- it must stay portable across AKS and EKS
- tracing must remain opt-in and must not silently increase the default runtime footprint
- Temporal workflow code must remain replay-safe
- the current default-deny NetworkPolicy posture means new telemetry traffic must be explicitly allowed

Issue #729 requires a design that fits the existing stack rather than introducing vendor lock-in or a second tracing system.

## Decision

We use OpenTelemetry as the tracing contract and Grafana Tempo as the shared trace backend, deployed as part of the opt-in observability stack behind a nested `observability.tracing.enabled` gate.

The design uses:

- a shared collector in the monitoring stack for OTLP ingest
- Tempo as the portable trace store, with cloud-specific storage overlays only
- same-origin browser export through Traefik so the frontend does not need a separate cross-origin telemetry endpoint
- trace propagation through `supabase/functions/trigger-workflow/index.ts`, `temporal/src/server.ts`, and Temporal client/worker bootstrap
- fail-open behavior: tracing outages never block workflow launches or user requests

Temporal tracing is added at client, worker, and activity boundaries only; workflow bodies do not import OpenTelemetry directly.

## Consequences

**Positive**

- One vendor-neutral tracing contract spans browser, ingress, edge, API, and worker layers.
- Trace-log correlation can use shared `trace_id` and `span_id` fields in Grafana/Loki without replacing current workflow-history UX.
- Cloud-specific storage differences stay isolated to platform overlays, preserving portability.

**Negative**

- Platform overlays must add collector/Tempo deployment, OTLP networking, and storage configuration.
- The frontend and edge-function path must preserve trace headers explicitly or traces will fragment.
- The chart test surface must expand to cover OTLP-related network-policy allowlists.

## Alternatives considered

**Bundle tracing unconditionally into the observability baseline.** Rejected because it increases resource cost for every observability-enabled install and conflicts with opt-in complexity.

**Run a separate tracing stack per application instance.** Rejected because it is too heavy for a reusable template and duplicates platform services unnecessarily.

**Use a vendor-specific tracing backend.** Rejected because it weakens portability and conflicts with the repository's open-source and multi-cloud principles.

## Evidence

- Issue #729 — `Epic: Distributed tracing (OpenTelemetry + Tempo)`
- `supabase/functions/trigger-workflow/index.ts`
- `temporal/src/server.ts`
- `temporal/src/worker.ts`
- `charts/app/templates/networkpolicies.yaml`
- `charts/app/ci-test.sh`
- `docs/specs/distributed-tracing-spec.md`
