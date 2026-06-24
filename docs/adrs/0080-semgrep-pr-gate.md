# ADR-0080: Semgrep SAST PR gate

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

Issue #21 replaces GitHub Advanced Security's CodeQL PR gate with an OSS SAST
alternative that works without the Enterprise plan. The repository already runs a
nightly `code-quality.yml` workflow with Semgrep as a non-gating scanner, but
that does not block regressions from merging on pull requests.

Adding a workflow under `.github/workflows/` changes the repository control plane,
so the change requires an ADR in the same PR per ADR-0044 and the repository
Copilot instructions.

## Decision

We add a dedicated `semgrep.yml` PR/push workflow that scans only application
source under `frontend/src/` and `temporal/src/` with the requested Semgrep OSS
rule packs (`p/typescript`, `p/javascript`, `p/security-audit`,
`p/owasp-top-ten`, and `p/secrets`).

The workflow uploads SARIF both as a GitHub code-scanning upload and as a build
artifact, and it fails closed only when Semgrep reports `ERROR` severity findings
or the scan itself does not complete successfully.

## Consequences

- Pull requests and pushes to `main` get a dedicated Semgrep SAST check without
  widening workflow permissions beyond `contents: read` and `security-events: write`.
- Findings remain scoped to application code instead of scanning generated files or
  repository control-plane content.
- Reviewers can inspect `semgrep.sarif` directly from workflow artifacts and, when
  available, GitHub code scanning ingestion.
- The repository now depends on the pinned `semgrep/semgrep-action` wrapper even
  though upstream has deprecated that wrapper; a future migration can swap to the
  native Semgrep invocation path without changing the gate policy.

## Alternatives considered

- **Keep Semgrep nightly-only in `code-quality.yml`**: rejected — a non-gating
  nightly scan does not satisfy the issue requirement to fail pull requests on
  severe findings.
- **Fold Semgrep into `pr-validation.yml`**: rejected — the issue explicitly asks
  for a dedicated `.github/workflows/semgrep.yml` workflow, and a separate gate
  keeps the control isolated.
- **Scan the whole repository**: rejected — the issue and security triage call for
  application-source scoping to reduce noise and avoid generated or irrelevant files.

## Evidence

- `.github/workflows/semgrep.yml` — dedicated Semgrep validation workflow
- `.github/workflows/code-quality.yml` — existing nightly non-gating scanner
- `docs/adrs/0044-github-actions-control-plane-major-upgrades.md` — control-plane ADR requirement
- Issue: `Volaris-AI/project-template#21`
