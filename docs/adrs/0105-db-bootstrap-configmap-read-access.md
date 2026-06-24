# ADR-0105: db-bootstrap gets read-only ConfigMap access for in-cluster bootstrap

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Copilot (implementation), @ianreay (review)
- **Supersedes / Superseded by:** —

## Context

The dev DB bootstrap path creates migration and seed ConfigMaps, then runs an in-cluster bootstrap job under the `db-bootstrap` service account to apply SQL and run assertions. During reconciliation, the in-cluster job must read those ConfigMaps from the `10x-stack-supabase` namespace.

The existing `db-bootstrap` RBAC contract allowed pod lookup and `pods/exec` but did not consistently include the ConfigMap read surface the runtime flow relies on, which caused intermittent `Forbidden` failures in the bootstrap phase.

## Decision

We grant `db-bootstrap` read-only namespace-scoped ConfigMap permissions (`get`, `list`, `watch`) and keep all write/delete operations on ConfigMaps restricted to the GitHub bootstrap identity (`gha-db-bootstrap`).

This permission is defined in both the runtime manifest and Terraform module so the contract remains aligned across hand-applied and provisioned environments.

## Consequences

- Bootstrap jobs can reliably read migration/seed ConfigMaps without widening write privileges.
- Least-privilege boundaries remain intact: `db-bootstrap` still cannot create, patch, update, or delete ConfigMaps.
- Any future RBAC contract changes for bootstrap identities must update both manifest and Terraform sources in the same PR to prevent drift.

## Alternatives considered

- Keep `db-bootstrap` without ConfigMap access and rely on external pre-processing. Rejected because the in-cluster bootstrap runtime still needs to resolve ConfigMap content.
- Grant broader ConfigMap permissions (create/update/delete) to `db-bootstrap`. Rejected because the runtime only needs read access and broader verbs violate least privilege.

## Evidence

- `deploy/k8s/rbac-dev-db-bootstrap.yaml`
- `terraform/modules/app-instance/namespaces.tf`
- `.github/tools/shared/src/__tests__/phase2-k8s-deploy-foundation.test.ts`
