# ADR-0013: Helm Chart with Per-Environment Value Profiles

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The application deploys across three environments (dev, test, prod) with different resource allocations, replica counts, image pull policies, and secret references. Environment differences need to be expressed somewhere — inline conditionals in a single values file, separate Helm charts, Kustomize overlays, or per-environment values files.

## Decision

A **single Helm chart** (`charts/app/`) with **per-environment values override files**:

```
charts/app/
  values.yaml          ← defaults (reasonable dev-like values)
  values-dev.yaml      ← dev overrides
  values-test.yaml     ← test overrides (digest-pinned image, tighter resources)
  values-prod.yaml     ← prod overrides (digest-pinned, HPA enabled, prod secrets)
```

Deploy commands layer overrides: `helm upgrade --install -f values.yaml -f values-<env>.yaml`.

Secrets are **not** stored in values files. They are pre-created Kubernetes Secrets referenced via `secretKeyRef`. The chart declares which secret names it expects; the operator provisions them before the first deploy.

The Temporal server is **not** managed by this chart. It is assumed to be available (local via Docker Compose, or a managed/separate Helm release in production). The chart deploys: frontend (nginx), Temporal worker, ops API.

## Consequences

**Positive:**
- Single chart means a fix applied to the chart template reaches all environments simultaneously on the next deploy cycle.
- Per-environment files are small, reviewable diffs — easy to see what differs between dev and prod.
- The override layering pattern is idiomatic Helm; any Helm-literate operator understands it.
- No chart dependencies or subcharts; the template stays auditable and self-contained.

**Negative:**
- Manual secret provisioning before first deploy. There is no built-in secret rotation or creation automation; that belongs to the infra/devops layer (e.g., External Secrets Operator — see future ADR).
- All three environment files must be kept in sync as new configurable knobs are added. An inconsistency (feature enabled in dev but not defined in prod) is caught at deploy time, not at review time.
- The Temporal server dependency is external to this chart — its availability is a hard prerequisite that the chart cannot verify.

## Alternatives considered

**Kustomize:** Base + overlays pattern is similar but uses a different tool chain. Helm is preferred because the chart ecosystem (azure/setup-helm in CI, Artifact Hub) is more mature for this stack.

**Three separate charts:** Complete isolation between environments but high maintenance burden. A change to a deployment template must be applied to three charts in sync.

**Single values file with `if eq .Values.env "prod"` conditionals:** Works for simple cases; becomes unreadable with many conditionals and hides what differs between environments.

## Evidence

- `charts/app/values.yaml` — default values
- `charts/app/values-dev.yaml`, `values-test.yaml`, `values-prod.yaml` — environment overrides
- `charts/app/ci-test.sh` — CI lint + render validation across all profiles
- ADR-0012 — digest promotion, which consumes chart values
