# ADR-0072: Activate nightly code-quality workflow

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

`.github/workflows-available/code-quality.yml` is a fully-written, self-contained
nightly static-analysis workflow that was sitting dormant in the
`workflows-available/` staging directory. The following scanners were producing
zero signal because the workflow had never run:

- **CodeQL** (SAST — JS/TS + Python)
- **Semgrep** (SAST rule-set)
- **Trivy** (CVE scanning — fs + npm + pip)
- **gitleaks** (secret scanning)
- **tsc** (TypeScript type errors, whole-project)
- **eslint / ruff / shellcheck / hadolint** (lint — JS, Python, shell, Dockerfile)
- **npm audit / pip-audit** (dependency vulnerability audit)

The `code-quality-reviewer` agent (`.github/agents/code-quality-reviewer.agent.md`)
and aggregation script (`scripts/audit/quality-compute.mjs`) were both in place and
ready to consume results — but had no input to act on.

Activating a workflow under `.github/workflows/` is a control-plane boundary and
requires an ADR in the same PR (per ADR-0044 and the copilot-instructions.md policy).

## Decision

We copy `code-quality.yml` from the staging directory into
`.github/workflows/code-quality.yml`, activating it immediately. The workflow is
complete and production-ready with no modifications required.

## Consequences

- The workflow runs nightly at 04:00 UTC (ahead of `pipeline-daily` at 06:00) and
  is also triggerable via `workflow_dispatch`.
- All seven scanner categories begin producing findings on the next scheduled run.
- The `code-quality-reviewer` agent will file deduplicated tickets from the results.
- A `quality` metric record will be pushed to the `ci-history` branch after each run,
  feeding the factory's quality trend tracking.
- The workflow is **non-gating** — `continue-on-error: true` is used throughout so
  scanner failures do not block deploys or merges.
- Requires `COPILOT_TOKEN` and `PROJECT_MANAGER_PAT` secrets to be set on the
  repository for the reviewer agent stage to function.

## Alternatives considered

- **Leave workflow in `workflows-available/`**: rejected — the scanners produce no
  signal while dormant, and both the aggregation script and reviewer agent are
  idle.
- **Rewrite or slim down the workflow**: rejected — the workflow is complete and
  production-ready; rewriting risks introducing regressions into a fully tested
  artifact.

## Evidence

- `.github/workflows/code-quality.yml` — activated workflow (copied from
  `.github/workflows-available/code-quality.yml`).
- `.github/agents/code-quality-reviewer.agent.md` — agent that consumes findings.
- `.github/scripts/quality-compute.mjs` — aggregation script called by the workflow.
- `.github/scripts/test-history-record.mjs` — records quality metric to ci-history branch.
- `.github/scripts/test-history-render.mjs` — renders the ci-history summary.
- `.github/qa-targets.json` — targets file referenced by the quality metric.
- Issue: `#397`
