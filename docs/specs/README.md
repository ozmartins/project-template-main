# Specs

This directory holds **detailed technical designs** for individual features, subsystems, or cross-cutting concerns. Each spec describes what to build and how — the concrete schema, contracts, algorithms, and constraints.

Specs are the implementation-level complement to ADRs:

- An **ADR** in [`docs/adrs/`](../adrs/) records *why* a decision was made and what was traded away. It is immutable once accepted.
- A **spec** here records *what exactly to build*. It is a living document — it can be updated as the design evolves, and should be superseded (not deleted) when a breaking redesign occurs.

## When to write a spec

Write a spec when a feature or subsystem is complex enough that a developer could not implement it correctly from the ADR alone. Signs you need a spec:

- The design has a non-trivial schema (JSON, SQL, API contract)
- The implementation has correctness constraints that aren't obvious from the code (determinism, ordering, idempotency)
- Multiple components must agree on a contract before any one can be built
- The feature has security, versioning, or operational implications that should be reviewed before code is written

## Index

| Spec | What it covers | Status |
|---|---|---|
| [temporal-dsl-spec.md](./temporal-dsl-spec.md) | JSON DSL for configuration-driven Temporal workflows — schema, step types, interpreter guide | Draft |
| [factory-pipeline-reliability.md](./factory-pipeline-reliability.md) | Reliability hardening plan for the GitHub factory pipeline, including guardrails, retries, and recovery flows | Draft |
| [copilot-assignment-cleanup.md](./copilot-assignment-cleanup.md) | Diagnosis and remediation plan for ghost Copilot assignments and backlog cleanup in the factory pipeline | Draft |
| [factory-pr-coordination-gate.md](./factory-pr-coordination-gate.md) | Queue-level shared-surface collision detection, stale-branch coordination, and post-conflict scope gating for Copilot PRs | Draft |
| [dependency-update-scope-contract.md](./dependency-update-scope-contract.md) | Canonical lane model and allowed diff envelope for Dependabot and Copilot dependency PRs | Draft |
| [network-exposure-spec.md](./network-exposure-spec.md) | Ingress and network-exposure security model for local Docker and Kubernetes deployments | Accepted |
| [platform-deployment-spec.md](./platform-deployment-spec.md) | Deployment contract across local Docker, Azure AKS, and AWS EKS, including platform versus app ownership boundaries | Draft |
| [workflow-json-schema-contract.md](./workflow-json-schema-contract.md) | Canonical launch-payload contract across workflow definitions, trigger UI, API validation, and DB enforcement | Draft |
| [distributed-tracing-spec.md](./distributed-tracing-spec.md) | OpenTelemetry + Tempo tracing across browser, ingress, edge, workflow API, and Temporal worker | Draft |
| [observability-stack.md](./observability-stack.md) | Opt-in Grafana OSS stack for logs, metrics, traces, dashboards, and alerting across AKS and EKS | Draft |
