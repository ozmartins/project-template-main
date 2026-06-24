# Security & Quality — Contributor Guide

This guide explains what security and quality controls are in place, which ones gate your pull requests, which ones run on a schedule, and what you are expected to do when a finding is raised.

It is written for contributors working on the application stack. Platform-operator procedures (cluster hardening, production credential rotation, incident response) are covered separately under `docs/devsecops/`.

---

## Contents

- [PR-time CI gates](#pr-time-ci-gates)
  - [Local pre-commit and pre-push hooks](#local-pre-commit-and-pre-push-hooks)
  - [Required status checks](#required-status-checks)
  - [Semgrep SAST scan](#semgrep-sast-scan)
  - [OSV dependency scan](#osv-dependency-scan)
  - [Gitleaks secret scan](#gitleaks-secret-scan)
  - [Container image scans on pull requests](#container-image-scans-on-pull-requests)
  - [Architecture audit on pull requests](#architecture-audit-on-pull-requests)
  - [E2E auth and access-control gate](#e2e-auth-and-access-control-gate)
- [Nightly and scheduled sweeps](#nightly-and-scheduled-sweeps)
  - [Code-quality workflow (daily)](#code-quality-workflow-daily)
  - [Architecture audit (daily)](#architecture-audit-daily)
  - [CIS Kubernetes benchmark (nightly)](#cis-kubernetes-benchmark-nightly)
  - [Azure security benchmark (nightly)](#azure-security-benchmark-nightly)
  - [Container image drift scan (weekly)](#container-image-drift-scan-weekly)
- [Dependabot and patching SLA](#dependabot-and-patching-sla)
- [Repository trust model](#repository-trust-model)

---

## PR-time CI gates

### Local pre-commit and pre-push hooks

The repository ships [Lefthook](https://github.com/evilmartians/lefthook) hooks that run locally before you commit or push. Install Lefthook once (`npm install -g lefthook` or your preferred method) and then run `lefthook install` in the repository root to activate the hooks.

**Pre-commit hooks** (run on every `git commit`):

| Hook | What it checks |
|---|---|
| `biome-check` | Lint and auto-format frontend TypeScript/JS/JSON with Biome |
| `biome-check-temporal` | Lint and auto-format temporal TypeScript with Biome |
| `typecheck-frontend` | TypeScript type check on `frontend/src/**` |
| `typecheck-temporal` | TypeScript type check on `temporal/src/**` |
| `secret-scan` | Gitleaks scan of staged files for secrets |

The Biome hooks rewrite files in place and re-stage them; if a type check or secret scan fails the commit is aborted.

**Commit-message hook** (run on every `git commit`):

| Hook | What it checks |
|---|---|
| `conventional-commit` | Validates commit messages against the Conventional Commits pattern |

Commit messages must follow the format `type(scope): description`, where `type` is one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, or `revert`; the optional `scope` is lowercase alphanumeric with hyphens, underscores, or slashes; and the subject is at most 120 characters. If the message does not match, the commit is aborted with an example shown.

**Pre-push hooks** (run on `git push`):

| Hook | What it checks |
|---|---|
| `gitleaks` | Full gitleaks scan of the working tree for leaked credentials |
| `licenses` | License compliance check for `frontend/` and `temporal/` packages |

If a pre-push hook fails your push is blocked. Fix the issue locally before pushing.

### Required status checks

The `Summary` check must pass before any PR can merge to `main`. `Summary` is a fan-in job in `.github/workflows/pr-validation.yml` that depends on all the following jobs:

| Job | What it validates |
|---|---|
| Shared tools regression suite | Vitest tests for `.github/tools/shared` |
| SQL migration lint | `sqlfluff lint` on all Supabase migrations |
| YAML workflow & chart lint | `yamllint` on `.github/workflows/` and `charts/` |
| Markdown docs lint | `markdownlint-cli2` on `docs/**/*.md` and `README.md` |
| Frontend lint & build | Biome lint, Vite build, Vitest unit tests, license compliance check |
| Temporal worker lint, typecheck & tests | Biome lint, TypeScript typecheck, Temporal unit tests |
| Helm chart smoke test | `helm lint` + `ci-test.sh` for the `charts/app/` chart |
| Frontend Docker entrypoint test | `test-entrypoint.sh` for the frontend container |
| Seed validation | Supabase seed smoke test |

A failing job in this list blocks the merge. Fix the root cause — do not disable or skip the failing check.

### Semgrep SAST scan

`.github/workflows/semgrep.yml` runs on every PR to `main` as a standalone required status check (separate from `Summary`). It scans `frontend/src` and `temporal/src` using the following Semgrep rulesets:

| Ruleset | What it covers |
|---|---|
| `p/typescript` | TypeScript-specific anti-patterns |
| `p/javascript` | JavaScript security and quality rules |
| `p/security-audit` | General security audit patterns |
| `p/owasp-top-ten` | OWASP Top 10 vulnerability classes |
| `p/secrets` | Hard-coded secrets and credential patterns |

Findings are uploaded as SARIF to the Security tab. The workflow gates only on **ERROR**-severity findings — `warning` and `note` findings are advisory and do not block merge.

What to do when Semgrep blocks your PR:

1. Open the job summary or the Security tab to see the annotated finding with the matched rule and a link to the rule documentation.
2. Fix the code pattern identified. Most ERROR findings are genuine security issues (injection sinks, insecure cryptography, hard-coded secrets).
3. If the finding is a false positive, add an inline `nosemgrep` suppression comment with a brief explanation. This is a narrow suppression and is visible to the security reviewer. The syntax depends on the language: use `// nosemgrep: <rule-id>` in TypeScript and JavaScript files; use `# nosemgrep: <rule-id>` in Python files.
4. Do not disable the check or set `continue-on-error: true` on the step.

### OSV dependency scan

`.github/workflows/osv-scan.yml` runs on every PR to `main` as a standalone required status check (separate from `Summary`). It scans `frontend/package-lock.json` and `temporal/package-lock.json` using the [Google OSV Scanner](https://github.com/google/osv-scanner) and reports only **HIGH or CRITICAL** severity findings that are **new in your PR** (it diffs against the base branch). If your PR introduces a new HIGH or CRITICAL vulnerability the check fails and blocks merge.

What to do when OSV blocks your PR:

1. Check the annotation on the affected lockfile line; it identifies the vulnerable package and CVE.
2. Update the dependency to a patched version, or replace it with a safe alternative.
3. If no patched version exists yet, document the finding in the PR body with a plan and ask for a security-reviewer exception. Do not disable the scan.

### Gitleaks secret scan

`.github/workflows/gitleaks.yml` runs on every PR to `main` and every push to `main` as a standalone required status check (separate from `Summary`). It scans only the **commit delta** of the PR or push for leaked credentials and secrets — not the full repository history. Findings are redacted in workflow logs to avoid re-exposing any detected secret.

The scan uses the upstream Gitleaks default rules extended by the project-level allowlist in `.gitleaks.toml`, which excludes:

- The well-known Supabase local-dev anon key (not a real credential)
- Placeholder strings such as `<YOUR_...>` and `REPLACE_ME`
- The `.env.example` file
- The `ci-history/` branch

If you commit a string that matches a Gitleaks rule but is not a real secret (for example, a test fixture containing a fake token), add an allowlist entry to `.gitleaks.toml` with a comment explaining why the pattern is safe, and include it in the same PR.

What to do when Gitleaks blocks your PR:

1. Open the job log — findings are redacted in CI but the affected file and line number are shown.
2. Inspect the file locally: `gitleaks detect --staged --source . --config .gitleaks.toml` for staged changes, or `gitleaks detect --source . --config .gitleaks.toml` for the working tree.
3. Remove the secret from the commit. If it was already pushed, rotate the credential immediately — treat it as compromised regardless of whether the repository is public or private.
4. If the finding is a false positive (not a real secret), add an allowlist entry to `.gitleaks.toml`. Do not add `continue-on-error: true` to the workflow step or disable the check.

The Lefthook `pre-push` hook runs `gitleaks protect` locally before every push so that most findings are caught before reaching CI. See [Local pre-commit and pre-push hooks](#local-pre-commit-and-pre-push-hooks) for setup instructions.

### Container image scans on pull requests

When `.github/workflows/build-images.yml` runs on a PR it builds both container images locally (not pushed) and runs two scanners. This is the PR path — no registry credentials are used and no image is pushed.

| Scanner | Tool | Behaviour on failure |
|---|---|---|
| Trivy vuln | `trivy image --scanners vuln` | Informational — SARIF uploaded to the Security tab; does not block the PR |
| Trivy misconfig + secret | `trivy image --scanners misconfig,secret` | **Gating** — exits non-zero on CRITICAL or HIGH findings; blocks merge |
| Grype | `anchore/scan-action` | **Gating** — exits non-zero on HIGH or above; blocks merge |
| Dockle | CIS Benchmark audit (`goodwithtech/dockle`) | **Gating** — exits non-zero on WARNING or above; blocks merge |

The `Enforce scan gate` step combines all gating results. If any of Trivy misconfig/secret, Grype, or Dockle fail, the build job fails and merge is blocked.

What to do when a container scan fails:

- **Misconfig finding**: review the Trivy output in the workflow logs. Misconfigurations are usually `Dockerfile` hardening issues (running as root, missing `USER`, exposed ports). Fix the `Dockerfile`.
- **Secret finding**: Trivy found a credential pattern in the image layer. Remove the secret from the `Dockerfile` and commit history. See the Lefthook `secret-scan` hook to catch these before pushing.
- **CVE finding (Grype)**: update the base image or the specific package to a version without the CVE.
- **CIS Benchmark finding (Dockle)**: review the Dockle output in the workflow logs — each finding is labelled with its CIS check ID (e.g. `CIS-DI-0005`). Fix the `Dockerfile` to satisfy the control (for example, adding a non-root `USER`, pinning the base image digest, or removing unnecessary packages). If the finding is a genuine false positive that cannot be fixed (for example, because a Kubernetes-level control supersedes the container-level check), add the check ID to `.dockleignore` at the repository root with a comment explaining the justification. Suppressions in `.dockleignore` are visible to reviewers; do not suppress without documenting why.

### Architecture audit on pull requests

`.github/workflows/architecture-audit.yml` also runs on PRs that touch `temporal/src/**`, `supabase/migrations/**`, `.github/workflows/**`, `scripts/audit/**`, or `charts/app/**`. This audit is **report-only** — it never blocks a merge. Its output appears in the job summary as a worklist for the Tech Reviewer and Security Reviewer agents.

### E2E auth and access-control gate

`.github/workflows/e2e-dev.yml` runs the full Playwright suite hourly and after every deploy to the `dev` environment. The suite includes `frontend/e2e/auth-access-control.spec.ts`, which is marked as **merge-blocking** for auth and role-based behaviors that are already proven green on the deployed dev environment.

The auth/access-control spec covers:

| Test | What it verifies |
|---|---|
| Unauthenticated access | Requesting a protected route (e.g. `/entities/portfolio`) without a session redirects to the login surface |
| Invalid credentials | Submitting wrong credentials stays on login and shows an explicit failure state |
| Write-capable user | An authenticated user with write permissions can access protected entity routes and see write controls |
| Read-only user | An authenticated user with read-only permissions can navigate protected routes but write controls are not shown |

These tests skip automatically when `E2E_AUTH_EMAIL` is not configured, so they do not block contributors working on forks without E2E credentials. On configured environments, a failure causes the E2E workflow to file a deduplicated incident issue for the factory to pick up.

**What to do if auth/access-control tests fail on your change:**

1. Check the `e2e-dev` run that failed after your deploy — the Playwright report is uploaded as a workflow artifact.
2. If your change intentionally altered auth or access-control behavior, update the spec to reflect the new expectations as part of the same PR.
3. If the failure is unexpected, verify that the deployed environment is healthy and that no migration or RLS policy introduced a regression. Do not merge a PR that causes a regression in these checks.

---

## Nightly and scheduled sweeps

These workflows run without a PR. Findings surface as GitHub issues, Security tab alerts, or job summaries. They do not block in-progress PRs but they do generate work you may be assigned.

### Code-quality workflow (daily)

**Workflow:** `.github/workflows/code-quality.yml` — runs daily at 04:00 UTC.

**What it runs:**

| Tool | What it covers |
|---|---|
| CodeQL (JS/TS + Python) | Static security analysis — results appear on the Security tab |
| tsc | TypeScript type-level errors across the whole repo |
| ruff | Python lint |
| shellcheck | Shell script lint |
| hadolint | Dockerfile lint |
| gitleaks | Secret scanning across full history |
| Semgrep | SAST pattern matching (`p/ci` ruleset) |
| Trivy | Full image vuln scan (not the PR diff-only version) |
| npm audit | Dependency vulnerability audit for `frontend/` and `temporal/` |
| pip audit | Dependency vulnerability audit for Python code |

All findings are aggregated into a `quality` metric and written to the `ci-history` branch. The `code-quality-reviewer` agent reads the findings and files deduplicated GitHub issues for anything above its configured severity threshold.

**What to do when a ticket is filed:** the ticket will be labelled `queue:development` once it is ready for implementation. Treat it like any other backlog issue: review the finding, fix the root cause, and open a PR that closes the ticket.

Do not mark a code-quality finding as "won't fix" without consulting a security or tech reviewer first.

### Architecture audit (daily)

**Workflow:** `.github/workflows/architecture-audit.yml` — runs daily at 06:00 UTC.

Covers whole-repo wiring checks that per-PR review agents cannot see: Temporal workflow/activity registration, `pull_request_target` permission risks, and Supabase views that bypass RLS. Output is always report-only and is available in the job summary.

### CIS Kubernetes benchmark (nightly)

**Workflow:** `.github/workflows/audit-cis-kubernetes.yml` — runs nightly at 03:00 UTC on the `factory-cluster-guardian` self-hosted runner.

Runs [kube-bench](https://github.com/aquasecurity/kube-bench) (Apache 2.0) against the live cluster and checks CIS Kubernetes Benchmark section 4 (worker node controls; master control plane sections 1-3 are managed by the cloud provider and are not accessible). When the cluster is not reachable the job emits a warning and skips gracefully.

Findings at the `FAIL` level are routed to the `audit-findings-triage` agent, which files or updates deduplicated GitHub issues. These issues land in the `queue:platform` lane and are handled by the platform engineer, not the general contributor queue.

### Azure security benchmark (nightly)

**Workflow:** `.github/workflows/audit-azure-security.yml` — runs nightly at 04:00 UTC on the `factory-cluster-guardian` self-hosted runner.

Runs [Prowler](https://github.com/prowler-cloud/prowler) (Apache 2.0) against the Azure subscription (~300 CIS Azure Benchmark checks covering IAM, storage, networking, monitoring) and also queries Azure Defender free-tier recommendations via `az security assessment list`. Both skip gracefully when the runner is not Azure-authenticated.

Findings at or above the configured severity threshold (default `medium`) are routed to the `audit-findings-triage` agent. Resulting issues land in `queue:security` and are handled by the security reviewer.

### Container image drift scan (weekly)

**Workflow:** `.github/workflows/container-scan-scheduled.yml` — runs every Monday at 06:00 UTC.

Scans the `frontend` and `temporal-worker` images currently in ACR using Trivy and Grype to catch CVEs introduced by base image updates between code changes. When HIGH or CRITICAL findings appear and no open issue already exists a new GitHub issue is filed. The workflow skips gracefully when ACR credentials are not configured (e.g. in a fork without ACR).

---

## Dependabot and patching SLA

Dependabot is configured (`.github/dependabot.yml`) to open weekly PRs every Monday for `frontend/` and `temporal/` npm dependencies. It also opens security-triggered PRs immediately when a new advisory affecting a pinned version is published.

**Weekly update PRs** (grouped batches): these are routine and are usually merged without review unless they contain a major version bump. If you are assigned a weekly Dependabot PR, check that CI passes and merge it.

**Security PRs** (individual): Dependabot opens a separate PR for each vulnerable package as soon as GitHub publishes an advisory. These carry the `dependencies` label and a severity label (`critical`, `high`, `medium`, or `low`).

**Contributor SLA expectations:**

| Severity | Expected response |
|---|---|
| Critical | Merge or escalate within 1 business day. If the patch breaks something, open a tracking issue and find a workaround immediately. |
| High | Merge within 3 business days. |
| Medium / Low | Merge in the next weekly batch (within 7 days). |

When a Dependabot PR cannot be merged because the patch introduces breaking changes:

1. Pin the dependency to the vulnerable version with a code comment explaining why.
2. Open a tracking issue linked to the Dependabot PR describing the blocker and your remediation plan.
3. Add the `needs-security-review` label to the tracking issue so the security reviewer is aware.

Do not close a security Dependabot PR without either merging it or opening a tracking issue.

---

## Repository trust model

Understanding what the repository enforces automatically and where human judgment is still required helps you know which shortcuts are genuinely safe and which are risky.

### What CI enforces automatically

| Control | Enforcement point |
|---|---|
| Code style and types | Lefthook pre-commit + `pr-validation` (Biome, typecheck) |
| Secret detection in staged files | Lefthook pre-commit (`gitleaks`) |
| License compliance | Lefthook pre-push + `pr-validation` |
| SAST security patterns | `semgrep.yml` (PR gate, ERROR-severity findings) |
| New HIGH/CRITICAL dependency CVEs | `osv-scan.yml` (PR gate) |
| Container image misconfigurations and secrets | `build-images.yml` (PR gate, Trivy) |
| Container image CVEs (second opinion) | `build-images.yml` (PR gate, Grype) |
| Container image CIS Benchmark checks | `build-images.yml` (PR gate, Dockle) |
| Auth and access-control behaviour | `e2e-dev.yml` (post-deploy gate, `auth-access-control.spec.ts`) |
| SQL migration syntax | `pr-validation` (sqlfluff) |
| Markdown and YAML lint | `pr-validation` |
| Branch protection | GitHub branch rules on `main` — force-push and deletion blocked, `Summary` required, stale reviews dismissed |
| Secret scanning (full history) | GitHub secret scanning push protection + `code-quality` nightly gitleaks |

### What specialist review lanes enforce

Some controls are checked by a specialist before merge rather than by an automated gate. The factory pipeline routes PRs into these lanes using labels.

| Lane | Label | What the reviewer checks |
|---|---|---|
| Security reviewer | `queue:security` | Auth and authorisation logic, RLS/RPC trust boundaries, secrets handling, workflow permission scope |
| Database reviewer | `queue:database` | Migration safety, RLS completeness, SCD2 correctness, seed data impact |
| Platform reviewer | `queue:platform` | CI workflow changes, Helm chart correctness, Kubernetes/Terraform changes |
| Tech reviewer | `queue:tech-review` | Cross-cutting engineering quality and architecture fitness |

These labels are added by agents and must not be removed by contributors. Only the named specialist reviewer removes a specialist label after they are satisfied.

### What contributors must not do

The following actions violate the repository's trust model. Do not do them locally, in PRs, or by asking another contributor to do them on your behalf.

- **Commit secrets, credentials, tokens, or real connection strings** into any file, including comments and test fixtures. Use environment variables and the patterns in `supabase/config.toml` and `.env.example` files.
- **Disable or bypass a gating check** (e.g. adding `continue-on-error: true` to a gating step, or `--no-verify` on a commit) without opening a tracking issue and obtaining security-reviewer or platform-reviewer sign-off.
- **Remove `needs-security-review`, `needs-database-review`, or `needs-platform-review` labels** from a PR. Only the relevant specialist removes their label.
- **Use `pull_request_target` with untrusted code** or elevate `GITHUB_TOKEN` permissions beyond what the job minimally requires. The architecture audit flags these patterns and the security reviewer must clear them.
- **Hard-code registry URLs, subscription IDs, cluster names, or tenant IDs** in workflow files or application code. Use repository variables (`vars.*`) and secrets (`secrets.*`).
- **Merge a PR with unresolved HIGH or CRITICAL OSV, Grype, or Trivy misconfig/secret findings.** The `Summary` gate enforces this, but if a gate is temporarily broken the obligation still applies.
- **Push directly to `main`.** All changes must go through a PR and the required checks.

### Image supply-chain controls

Images built from the `main` and `dev` branches have additional supply-chain controls applied after the push path in `build-images.yml`:

- **Cosign signature**: each pushed image digest is signed with a keyless Cosign signature attached to the ACR registry. Signature verification can be performed with `cosign verify`.
- **SPDX SBOM**: an SPDX-format software bill of materials is generated by `anchore/sbom-action` and uploaded as a workflow artifact (retention: 7 days) and attached to the image.
- **SLSA provenance attestation**: `actions/attest-build-provenance` attaches a SLSA Build Level 2 provenance attestation to each image digest and pushes the attestation to the registry.

These controls apply to the build from trusted branches only. PR-path builds are scanned but not pushed and therefore not signed or attested.
