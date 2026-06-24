# ADR-0078: Keep Terraform gha-deployer RBAC aligned with deploy runtime contract

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot (implementation), @ianreay (review)
- **Supersedes / Superseded by:** —

## Context

ADR-0017 establishes namespace-scoped deploy permissions and ADR-0072 keeps deploy failures explicit when live namespace RBAC is stale. The deploy runtime now uses chart-managed HPA/PDB resources from ADR-0065 and also relies on rollout diagnostics (`events`, `pods/log`) during Helm reconciliation and incident triage.

The Terraform-managed `kubernetes_role.gha_deployer` in `terraform/modules/app-instance/namespaces.tf` had drifted narrower than the nonprod RBAC contract used by the deployment path, which risked reprovisioned environments missing permissions required by current deploy behavior.

## Decision

We treat Terraform as the source-of-truth RBAC contract for `gha-deployer` and keep it aligned with the deploy runtime surface by granting namespace-scoped access to:

- core: `services`, `configmaps`, `pods`, `pods/log`, `events`
- `external-secrets.io`: `externalsecrets`
- `policy`: `poddisruptionbudgets`
- `autoscaling`: `horizontalpodautoscalers`

All rules keep the existing namespace-scoped verb set (`get`, `list`, `watch`, `create`, `patch`, `update`, `delete`) and do not introduce cluster-wide privileges.

## Consequences

- Terraform-provisioned namespaces now match deploy/runtime requirements and avoid RBAC drift-induced reconciliation failures.
- Deploy diagnostics continue to work without out-of-band RBAC patching when environments are recreated.
- Any future deploy-surface resource additions must update the Terraform role in the same change to preserve contract parity.

## Alternatives considered

- Keep Terraform narrower and rely on manual RBAC manifests. Rejected because it preserves drift risk and makes reprovisioning inconsistent.
- Broaden to cluster-scoped roles. Rejected because ADR-0017 requires namespace-scoped least privilege.

## Evidence

- `terraform/modules/app-instance/namespaces.tf`
- `deploy/k8s/rbac-nonprod.yaml`
- ADR-0017, ADR-0065, ADR-0072
