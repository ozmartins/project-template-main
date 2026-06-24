# ADR-0062: Standardise GitHub Actions Workflow Display Names

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay
- **Supersedes / Superseded by:** —

## Context

Workflow `name:` fields were inconsistent: some had no category prefix (`Architecture Audit`,
`Build Images`), some used em dashes (`Pipeline — Daily`), and some used hyphens
(`Monitor - Deploy`). This made the Actions tab hard to scan and the category each
workflow belonged to was not clear at a glance.

ADR-0003 established the category-organisation model and ADR-0005 began applying it
to pipeline file names. This ADR applies the same `Category - Descriptor` convention
to every workflow's display `name:` field.

## Decision

All workflow `name:` fields follow `Category - Descriptor` (title case, space-hyphen-space
separator). Em dashes (`—`) are replaced with hyphens (`-`). The rename map is:

| File | Old name | New name |
|---|---|---|
| `architecture-audit.yml` | `Architecture Audit` | `Audit - Architecture` |
| `audit-azure-security.yml` | `Audit — Azure Security Benchmark` | `Audit - Azure Security Benchmark` |
| `audit-cis-kubernetes.yml` | `Audit — CIS Kubernetes Benchmark` | `Audit - CIS Kubernetes Benchmark` |
| `build-images.yml` | `Build Images` | `CICD - Build Images` |
| `deploy-dev.yml` | `Deploy Dev` | `Deploy - Dev` |
| `deploy-prod.yml` | `Deploy Prod` | `Deploy - Prod` |
| `deploy-test.yml` | `Deploy Test` | `Deploy - Test` |
| `e2e-dev.yml` | `E2E (dev environment)` | `Test - E2E Dev` |
| `k8s-render-validate.yml` | `K8s Render & Validate` | `Validate - K8s Render` |
| `pipeline-daily.yml` | `Pipeline — Daily` | `Pipeline - Daily` |
| `pipeline-fast.yml` | `Pipeline — Fast` | `Pipeline - Fast` |
| `pipeline-hourly.yml` | `Pipeline — Hourly` | `Pipeline - Hourly` |
| `pr-enrichment.yml` | `PR Enrichment` | `PR - Enrichment` |
| `pr-validation.yml` | `PR Validation` | `PR - Validation` |
| `validate-dsl-definitions.yml` | `Validate DSL Definitions` | `Validate - DSL Definitions` |

`workflow_run: workflows: [...]` references in other files are updated to match the
new display names so triggers continue to fire correctly.

## Consequences

**Positive:**
- Actions tab is consistently scannable by category.
- New workflows have a clear naming pattern to follow.

**Negative:**
- GitHub Actions run history is grouped by display name; renamed workflows start a
  fresh history in the UI (old runs remain accessible under the old name until they age out).
- Any external tooling or dashboards that filter by the old display names will need updating.

## Alternatives considered

**Keep em dashes for Pipeline workflows:** The em dash was present in three files and
arguably aesthetic, but it creates a second separator convention. Normalising to hyphen
removes the inconsistency at the cost of a one-time churn.

## Evidence

- Issue #143 — rename map and rationale
- `.github/workflows/` — all `name:` fields updated
- `.github/workflows-available/agent-tech-reviewer.yml` — `workflow_run:` reference updated
- `.github/tools/shared/src/__tests__/cluster-guardian-foundation.test.ts` — test updated
