# ADR-0104: Workflow-native engineering health dashboard on `main`

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Copilot (implementation), @ianreay (review direction)
- **Supersedes / Superseded by:** Supersedes ADR-0079

## Context

The repository had deep history feeds for CI (`ci-history`) and E2E (`e2e-history`), but most non-test workflows were not publishing structured status at all. Operational and audit outcomes only existed inside Actions logs, so there was no unified health surface.

The prior dashboard design in ADR-0079 rendered to a dedicated `status` branch and depended on branch-hosted links. The current requirement is a workflow-native feed where each workflow publishes its own normalized status record, and rendered dashboard artifacts live directly on `main` (`docs/ci-status/*`) so SVG embeds render natively in the repository UI.

## Decision

We standardize workflow-level status publishing to a new append-only `workflow-history/runs.jsonl` feed, produced by `.github/scripts/workflow-record.mjs`, and render a unified engineering dashboard to `docs/ci-status/` on `main` using `.github/scripts/health-render.mjs`.

Each significant workflow appends a normalized record and then invokes a non-blocking render/publish step (`continue-on-error: true`) through `.github/scripts/health-render-publish.mjs`, which regenerates the dashboard and commits with `[skip ci]`.

## Consequences

- New workflows can appear on the dashboard by publishing a single record (inversion of responsibility).
- Dashboard SVGs and markdown render directly from `main`, removing branch URL indirection.
- Existing deep feeds (`ci-history`, `e2e-history`) remain intact and are used as drill-down sources.
- We accept additional control-plane complexity in workflow definitions to keep status publication explicit and decentralized.

## Alternatives considered

- Keep the `status` branch model from ADR-0079 and continue externalized links.
  - Rejected because it keeps most workflows dark unless centrally hard-coded and does not satisfy native `main` embedding requirements.
- Replace `ci-history`/`e2e-history` with a single monolithic feed.
  - Rejected because those feeds already support deep suite-level drill-down and should remain stable.

## Evidence

- `.github/scripts/workflow-record.mjs`
- `.github/scripts/health-render.mjs`
- `.github/scripts/health-render-publish.mjs`
- `.github/workflows/deploy-dev.yml`
- `.github/workflows/deploy-test.yml`
- `.github/workflows/deploy-prod.yml`
- `.github/workflows/architecture-audit.yml`
- `.github/workflows/audit-azure-security.yml`
- `.github/workflows/audit-cis-kubernetes.yml`
- `.github/workflows/pipeline-daily.yml`
- `.github/workflows/validate-dsl-definitions.yml`
- `.github/workflows/validate-ontology.yml`
- `.github/workflows/monitor-actions.yml`
- `.github/workflows/code-quality.yml`
- `.github/workflows/pr-validation.yml`
- `.github/workflows/e2e-dev.yml`
- `docs/ci-status/summary.md`
- `README.md`
