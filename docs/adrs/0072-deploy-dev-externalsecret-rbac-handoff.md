# ADR-0072: Deploy Dev Fails Fast on Missing ExternalSecret RBAC

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot (implementation), @ianreay (platform review)
- **Supersedes / Superseded by:** —

## Context

The `deploy-dev.yml` workflow now deploys chart-managed `ExternalSecret` resources in `10x-stack-dev`. The deploy identity remains the namespace-scoped `gha-deployer` service account from ADR-0017, so it cannot self-apply new `Role` or `RoleBinding` permissions when the RBAC contract expands.

Run `27911453042` proved that updating `deploy/k8s/rbac-nonprod.yaml` in git alone is insufficient: Helm failed during `helm upgrade --install` because the live `gha-deployer` credential still lacked `get` access to `externalsecrets.external-secrets.io`.

This decision builds on ADR-0017 (namespace-scoped deploy RBAC) and ADR-0068 (deploy workflow preflight for namespace prerequisites).

## Decision

`deploy-dev.yml` adds a pre-Helm RBAC preflight that checks the full `ExternalSecret` verb set (`get`, `list`, `watch`, `create`, `patch`, `update`, `delete`) with `kubectl auth can-i`.

If any verb is missing, the workflow stops immediately and emits an explicit operator handoff:

- apply `deploy/k8s/rbac-nonprod.yaml`
- use a cluster-admin or platform-operator credential
- rerun `Deploy - Dev` only after the live Role/RoleBinding has been updated

## Consequences

**Better:**
- The deploy no longer reaches Helm before discovering that the live namespace RBAC is stale.
- Maintainers get an actionable remediation path instead of a late Helm failure on `ExternalSecret` reads.
- The namespace-scoped deploy credential remains least-privilege and does not self-escalate.

**Trade-offs:**
- A platform operator must still perform the one-time live RBAC apply when the contract changes.
- Deploy runs fail earlier until that operator handoff is completed.

## Evidence

- `.github/workflows/deploy-dev.yml`
- `deploy/k8s/rbac-nonprod.yaml`
- `.github/tools/shared/src/__tests__/phase2-k8s-deploy-foundation.test.ts`
- GitHub Actions run `27911453042`
