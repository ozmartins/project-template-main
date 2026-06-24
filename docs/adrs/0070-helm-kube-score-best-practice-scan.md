# ADR-0070: Helm best-practice scan with kube-score in the architecture-audit workflow

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot / platform-engineer agent
- **Supersedes / Superseded by:** none

## Context

The Helm CI (`k8s-render-validate.yml`) runs `helm lint`, template rendering, and `charts/app/ci-test.sh` security-context assertions. These checks verify that the chart renders without errors and that known security-context values are present, but they do not scan the rendered manifests holistically against Kubernetes best practices.

Without a policy scanner there is no regression guard: a future PR could silently remove resource limits, liveness/readiness probes, or security-context settings on a new component without any CI signal. The risk classes that would go undetected include:

- Missing resource requests/limits
- Containers running as root
- Deprecated API versions
- Missing liveness/readiness probes
- `hostNetwork: true` / `hostPID: true` without justification
- Privileged containers or dangerous capabilities

## Decision

We add a `helm-best-practice-scan` job to `.github/workflows/architecture-audit.yml` that:

1. Installs **kube-score** (single static binary, no config file needed).
2. Renders `charts/app` for the `base`, `dev`, and `test` value profiles using `helm template`.
3. Pipes each manifest set through `kube-score score` and writes the findings to `$GITHUB_STEP_SUMMARY`.
4. On any `CRITICAL` finding, files a deduplicated `queue:platform` / `priority:high` GitHub issue.

The scan is **report-only** (non-gating) — it surfaces a worklist without blocking merges, consistent with the existing architecture-audit philosophy (ADR-0028). It can be promoted to a gate once the baseline is clean.

## Consequences

**Positive:**
- Any regression that introduces a CRITICAL best-practice violation (e.g. removing security contexts, adding a privileged container) is surfaced immediately in CI.
- kube-score runs as a pure render check — no cluster contact, no credentials needed.
- The step summary gives reviewers a full findings report without needing to dig into raw logs.
- Non-gating design means the audit never blocks a hotfix while still maintaining visibility.

**Negative:**
- kube-score is pinned to a specific version (`v1.20.0`); upgrades require a manual bump.
- The scan may produce WARNING-level findings (e.g. missing NetworkPolicy) that are expected and create noise until resolved or suppressed.
- If the `queue:platform` / `priority:high` labels do not exist in the repository, the automatic issue creation falls back gracefully (warning logged, no workflow failure).

## Alternatives considered

- **polaris** — richer policy config (`polaris.yml`), HTML/JSON report, better for tracking trends over time. Rejected for now because it requires a config file and is heavier to set up. Can be adopted later if customisable rules become a requirement.
- **Adding to `k8s-render-validate.yml` instead** — that workflow is a PR gate; adding a potentially-noisy scan there would block merges before the baseline is clean. `architecture-audit.yml` is report-only and the correct home.
- **OPA/Conftest** — powerful but requires policy authoring in Rego; overkill for the standard best-practice checks kube-score covers out of the box.

## Evidence

- Workflow change: `.github/workflows/architecture-audit.yml` — `helm-best-practice-scan` job
- Existing chart security assertions: `charts/app/ci-test.sh`
- Existing render validation: `.github/workflows/k8s-render-validate.yml`
- kube-score project: https://github.com/zegl/kube-score
- Non-gating audit policy: ADR-0028 (`docs/adrs/0028-github-standing-architecture-audits.md`)
- Issue: Volaris-AI/project-template#403
