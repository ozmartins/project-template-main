# ADR-0119: Grafana LGTM Observability Stack

- **Status:** Proposed
- **Date:** 2026-06-24
- **Deciders:** Factory Architect
- **Supersedes / Superseded by:** Supersedes ADR-0107 if accepted

## Context

Issue #34 requests one approved observability direction before implementation work begins. The repository currently lacks a unified operational stack for logs, metrics, traces, dashboards, and alerts. That leaves operators without a portable way to diagnose request failures, Temporal workflow errors, or latency regressions across environments.

The decision has important constraints:

- the template must remain self-hostable and portable across AKS and EKS
- advanced observability must be opt-in rather than a default requirement for a fresh clone
- the deploy boundary between platform-owned cluster services and namespace-scoped app resources must stay explicit
- tracing must remain replay-safe for Temporal workflow execution

The narrower tracing-only proposal in ADR-0107 is not sufficient by itself because issue #34 requires the full signal stack and ownership boundaries.

## Decision

We adopt an opt-in Grafana OSS LGTM observability stack built from `kube-prometheus-stack`, Loki, Tempo, and OpenTelemetry Collector.

Platform-owned cluster bootstrap provides the shared observability namespace, CRDs, storage, and ingress/auth surfaces. Application-owned work adds value-gated `ServiceMonitor` and `PrometheusRule` resources, structured logging, metrics endpoints, and replay-safe tracing instrumentation. Phase 1 covers server-side and worker-side telemetry first; browser log shipping and RUM stay out of scope.

## Consequences

- The template gets one open-source operator surface for metrics, logs, and traces rather than separate tooling per signal.
- AKS and EKS stay aligned because only storage and ingress overlays are cloud-specific; the signal contract stays shared.
- Observability remains optional for baseline installs because CRD-backed resources and tracing are gated behind explicit values.
- Platform review remains mandatory because the decision introduces cluster-owned components and operator prerequisites.
- If accepted, the tracing-only proposal in ADR-0107 should no longer be treated as the primary observability decision.

## Alternatives considered

- **Use cloud-native managed monitoring services.** Rejected because it conflicts with the repository's portability and open-source constraints.
- **Assemble a mixed stack with separate tools per signal.** Rejected because it fragments operator workflows and duplicates ingest plumbing.
- **Make observability mandatory in the default install.** Rejected because it violates the repository's opt-in complexity principle.

## Evidence

- Issue #34 - `ops: define observability stack - structured logging, metrics, tracing`
- `docs/specs/observability-stack.md`
- ADR-0017 - `Namespace-Scoped RBAC for Deploy Runners`
- ADR-0107 - `OpenTelemetry and Tempo for Distributed Tracing`
