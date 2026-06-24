# ADR-0092: Workload ServiceAccounts with Tokenless Pod Identities by Default

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Copilot (implementation), @ianreay (review direction)
- **Supersedes / Superseded by:** Extends ADR-0033 (portability constraints now explicitly include workload identity bindings)

## Context

The app Helm chart previously allowed workloads to inherit the namespace `default` ServiceAccount when no explicit `serviceAccountName` was set. That model weakens least-privilege isolation and makes identity boundaries implicit rather than workload-scoped.

This repository targets local Docker, AKS, and EKS environments. Identity controls must remain portable across those targets. Provider-specific workload identity bindings (for example AWS IRSA or Azure Workload Identity annotations) differ by platform and cannot be hardcoded into shared chart templates without violating ADR-0033 portability constraints.

## Decision

We define dedicated ServiceAccounts for `frontend`, `temporal-worker`, and `ops-api`, require each deployment to set an explicit `serviceAccountName`, and disable ServiceAccount token automount by default at both ServiceAccount and PodSpec levels.

Provider-specific workload identity bindings remain environment-level configuration concerns: teams apply cloud-specific annotations/labels through values overrides, while the base chart enforces portable identity isolation and tokenless-by-default posture.

## Consequences

**Positive:**
- Workloads no longer inherit the namespace `default` identity implicitly.
- Pod identity posture is least-privilege by default (`automountServiceAccountToken: false`).
- The chart contract is explicit and testable in CI render checks.
- Portability is preserved because cloud-provider identity binding details are not embedded in base templates.

**Negative:**
- Teams must intentionally opt in when a workload requires Kubernetes API access via projected ServiceAccount tokens.
- Environment owners must manage provider-specific workload identity annotations in values/profile overlays rather than relying on chart defaults.

## Alternatives considered

1. **Keep namespace default ServiceAccount inheritance** — rejected because identity is implicit and least privilege is not enforced.
2. **Hardcode provider-specific workload identity bindings in templates** — rejected because AKS/EKS/self-hosted identity mechanisms differ, which would break portability and violate ADR-0033.
3. **Disable token automount only at PodSpec level** — rejected because ServiceAccount-level default should also enforce tokenless posture when Pods are created by other controllers.

## Evidence

- `charts/app/templates/serviceaccounts.yaml`
- `charts/app/templates/frontend-deployment.yaml`
- `charts/app/templates/temporal-worker-deployment.yaml`
- `charts/app/templates/ops-api-deployment.yaml`
- `charts/app/values.yaml`
- `charts/app/ci-test.sh`
- PR: "Isolate app workloads with dedicated ServiceAccounts and tokenless pod identities"
