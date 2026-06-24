# ADR-0063: Weekly Azure Front Door CIDR Refresh Workflow

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The ingress hardening model depends on keeping `deploy/azure/afd-backend-cidrs.txt` aligned with the Azure `AzureFrontDoor.Backend` service tag. The repository previously documented this as a weekly CI task but did not implement the control-plane workflow or artifact path.

Because this introduces a new workflow under `.github/workflows/**`, the change must include an in-PR ADR describing credentials, failure behavior, and rollback expectations.

## Decision

We add a weekly/manual GitHub Actions workflow that logs into Azure, regenerates `deploy/azure/afd-backend-cidrs.txt` from the `AzureFrontDoor.Backend` service tag, and opens a PR automatically when the file changes.

## Consequences

- Drift in the Azure ingress CIDR artifact is checked weekly with a repeatable workflow.
- Missing Azure credentials fail the run explicitly via an error step instead of silently skipping.
- The repository now depends on configured Azure OIDC/app-registration credentials for this automation to run successfully.

**Rollback:** Disable `.github/workflows/refresh-azure-frontdoor-cidrs.yml` or revert the workflow/script files if the automation causes noisy PR churn or credential management regressions.

## Alternatives considered

- Manual operator refreshes only: rejected because it allows silent drift and inconsistent cadence.
- Downloading public service-tag JSON directly: rejected because this implementation requirement expects explicit Azure credentials/failure signaling in workflow logs.
- Updating ingress values directly in CI: rejected to keep scope limited to the single generated Azure CIDR artifact.

## Evidence

- `.github/workflows/refresh-azure-frontdoor-cidrs.yml`
- `.github/scripts/refresh-afd-backend-cidrs.sh`
- `deploy/azure/afd-backend-cidrs.txt`
- Issue: `#177`
