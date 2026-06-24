# ADR-0055: Dev Environment Uses Shared Temporal Server in `dev` Namespace

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot
- **Supersedes / Superseded by:** —

## Context

The `10x-stack-dev` application namespace (`<DEV_NAMESPACE>`) requires a Temporal server for its worker and ops-api components. Two options were available:

1. **Shared server** — point the worker and ops-api at the existing Temporal cluster already running in the cluster's `dev` namespace (`temporal-frontend.dev.svc.cluster.local:7233`).
2. **Dedicated server** — deploy a separate Temporal release into `<DEV_NAMESPACE>`.

The cluster has no NetworkPolicy between `<DEV_NAMESPACE>` and `dev`, so cross-namespace DNS resolution works without additional configuration.

Temporal's built-in **namespace** isolation ensures that workflows, task queues, and histories for this application are logically separated from any other tenants that share the same Temporal server, provided each tenant uses a distinct Temporal namespace and task queue.

## Decision

We use the existing shared Temporal server at `temporal-frontend.dev.svc.cluster.local:7233` for both `temporalWorker` and `opsApi` in the dev environment. Both components are configured with:

- **Temporal namespace:** `<DEV_NAMESPACE>` — provides logical isolation from other tenants on the same server.
- **Task queue:** `<DEV_NAMESPACE>-main` — unique per deployment, preventing cross-app task routing.

This aligns the dev environment with the test and prod environments, where both `temporalWorker` and `opsApi` use the same Temporal address and namespace.

## Consequences

**Positive:**
- No additional Temporal infrastructure to operate or pay for in dev.
- Temporal namespace and task-queue naming prevents workflow/task cross-contamination between tenant applications.
- Consistent pattern with test and prod profiles (same address structure, same scoped-namespace approach).

**Negative:**
- The dev application depends on the availability of the shared Temporal server. If that server is unhealthy, both the worker and ops-api lose Temporal connectivity.
- Noisy-neighbour risk at the server level (CPU, memory, storage) if other tenants generate high workflow volume. Accepted for dev; dedicated infrastructure is appropriate for prod.
- If the shared server is ever decommissioned or migrated, `values-dev.yaml` must be updated to reflect the new address.

## Alternatives considered

**Dedicated Temporal in `<DEV_NAMESPACE>`:** Provides full isolation but adds operational overhead (additional Helm release, persistence layer, monitoring). Not justified for a nonprod dev environment.

**Temporal Cloud:** Would eliminate self-hosted ops entirely but introduces cost and an external dependency. Reserved for a future decision when prod requirements mature.

## Evidence

- `charts/app/values-dev.yaml` — `temporalWorker.temporal` and `opsApi.temporal` both set to `temporal-frontend.dev.svc.cluster.local:7233` and namespace `<DEV_NAMESPACE>`
- `charts/app/ci-test.sh` — assertions at `dev: temporal-worker temporal address=in-cluster svc`, `dev: ops-api temporal address=in-cluster svc`, and `dev: ops-api temporal namespace=<DEV_NAMESPACE>` guard this configuration in CI
- `deploy/k8s/namespaces.yaml` — confirms `<DEV_NAMESPACE>` is a dedicated namespace separate from the cluster's `dev` namespace
- Closes issue #127
