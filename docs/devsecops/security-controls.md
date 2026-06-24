# Security Controls

Operational inventory of the security controls that gate pull requests and protect the `main` branch.
Use this guide to verify whether a control is active, locate the evidence it produces, and know where
to inspect or tune it during audits, blocked-PR investigations, and periodic control reviews.

> **Audience:** Security engineers auditing CI/CD posture · Platform engineers maintaining merge
> protection · Incident responders investigating why a PR was blocked or a control failed.

---

## Control summary

| Control | Type | Trigger | Blocks merge? | Evidence location |
|---|---|---|---|---|
| Semgrep SAST | Workflow | PR → `main`, push → `main` | Yes — ERROR-severity findings | Workflow summary, `semgrep-sarif` artifact, GitHub Code Scanning |
| OSV Dependency Scan | Workflow | PR → `main` | Yes — newly introduced HIGH/CRITICAL CVEs | Workflow summary, `osv-scan-sarif` artifact |
| Gitleaks secret scan | Workflow | PR → `main`, push → `main` | Yes — job fails when secrets found in commit delta | PR Checks → Security - Gitleaks secret scan |
| PR Validation jobs | Workflow | PR → `main`, push → `main` | Yes — when the failing job is configured as a required check in branch protection | Workflow summary per job |
| Branch protection on `main` | GitHub-native | All pushes / PR merges | Yes — enforced by GitHub | **Settings → Branches** |
| CODEOWNERS review | GitHub-native | PRs touching protected paths | Yes — requires approved review from `@ianreay` | PR review tab |
| Required status checks | GitHub-native | All PRs to `main` | Yes — for whichever check names are listed in branch protection | **Settings → Branches** |
| Stale review dismissal | GitHub-native | New commits after approval | Yes — re-review required | PR review tab |
| Force-push blocking | GitHub-native | All pushes to `main` | Yes | **Settings → Branches** |
| Branch deletion blocking | GitHub-native | Deletion attempt on `main` | Yes | **Settings → Branches** |
| Secret scanning | GitHub-native | Every push | No merge block; alerts raised | **Security → Code security and analysis** |
| Secret scanning push protection | GitHub-native | Every push | Yes — blocks push containing a detected secret | **Security → Code security and analysis** |
| Dependabot vulnerability alerts | GitHub-native | New CVEs in dependency graph | No merge block; alerts raised | **Security → Dependabot** |
| Dependabot automated security PRs | GitHub-native | New exploitable CVEs | No — raises a PR for review | **Security → Dependabot** |
| Container image scanning (Trivy misconfig, Grype CVE, Dockle CIS) | Workflow | PR (any branch) | Yes — blocking via `build-images-pr` job gate | Workflow summary, `build-images-pr` job logs |
| Supply chain controls (Cosign signing, SBOM, SLSA provenance) | Workflow (post-merge) | Push → `main`, push → `dev` | No — post-merge; not a PR gate | Workflow run `sign-images` / provenance jobs, uploaded SBOM artifacts |
| Architecture audit | Workflow (report-only) | PR → `main` touching `temporal/src/**`, `supabase/migrations/**`, `.github/workflows/**`, `scripts/audit/**`, `charts/app/**` | No — report-only; never blocks merge | Workflow summary, issue filed on CRITICAL kube-score findings |
| Delete-branch-on-merge | GitHub-native | PR merge | Automatic cleanup | **Settings → General** |

---

## Workflow-based gates

### Semgrep SAST — `Validate - Semgrep`

**Source:** [`.github/workflows/semgrep.yml`](../../.github/workflows/semgrep.yml)

#### Overview

| Attribute | Value |
|---|---|
| Workflow name | `Validate - Semgrep` |
| Job name | `Semgrep scan` |
| Trigger | `pull_request` → `main`; `push` → `main` |
| Concurrency | Cancels stale PR runs; push-to-main runs are not cancelled |
| Permissions | `contents: read`, `security-events: write` |

#### What it scans

| Attribute | Value |
|---|---|
| Rulesets | `p/typescript`, `p/javascript`, `p/security-audit`, `p/owasp-top-ten`, `p/secrets` |
| Path scope | `frontend/src`, `temporal/src` |
| Output format | SARIF (`semgrep.sarif`) |

#### Enforcement logic

The `semgrep-action` step runs with `continue-on-error: true` so it does not immediately fail the
job. A separate **Enforce ERROR severity gate** step parses the SARIF output and applies the
following policy:

- If `semgrep.sarif` is missing → job fails.
- If any result has `"level": "error"` → job fails with the count reported.
- If the Semgrep step itself failed for reasons other than findings → job fails.
- WARNING or NOTE findings → logged in the step summary but do **not** block merge.

This means **only ERROR-severity findings block the PR**. Lower-severity findings are visible in
the step summary and in GitHub Code Scanning but do not prevent merge.

#### Artifact and evidence locations

| Evidence | Location |
|---|---|
| Step summary table | Workflow run → **Summary** tab, section "Semgrep scan" |
| SARIF artifact | Workflow run → **Artifacts** → `semgrep-sarif` (retained 14 days) |
| GitHub Code Scanning | **Security → Code scanning** → tool filter: `Semgrep` |

SARIF is also uploaded to GitHub Code Scanning via `github/codeql-action/upload-sarif`, so findings
appear as Code Scanning alerts linked to the commit or PR.

---

### OSV Dependency Scan — `PR - OSV Dependency Scan`

**Source:** [`.github/workflows/osv-scan.yml`](../../.github/workflows/osv-scan.yml)

#### Overview

| Attribute | Value |
|---|---|
| Workflow name | `PR - OSV Dependency Scan` |
| Job name | `OSV scan (diff-only HIGH/CRITICAL)` |
| Trigger | `pull_request` → `main` only (not on push) |
| Permissions | `contents: read` |

#### What it scans

| Attribute | Value |
|---|---|
| Lockfiles | `frontend/package-lock.json`, `temporal/package-lock.json` |
| Severity filter | `HIGH`, `CRITICAL` only |
| Scanner | `google/osv-scanner-action` v2.3.8 |

#### Diff-only enforcement logic

The scan runs twice: once against the **base branch SHA** and once against the **PR head SHA**.
The `osv-reporter-action` step then compares both JSON outputs and reports only the
**vulnerabilities newly introduced by the PR**.

- A PR that adds a dependency with a known HIGH/CRITICAL CVE → job fails (`--fail-on-vuln=true`).
- A PR that inherits a pre-existing HIGH/CRITICAL CVE present in the base → **not** a PR failure
  (the vulnerability was already present and is tracked separately by Dependabot).
- Lower-severity findings (LOW, MEDIUM) → not reported at this gate.

The step summary shows three counts: base branch vulnerabilities, PR branch vulnerabilities, and
the count newly introduced by the PR.

#### Artifact and evidence locations

| Evidence | Location |
|---|---|
| Step summary table | Workflow run → **Summary** tab, section "OSV dependency scan (HIGH/CRITICAL)" |
| SARIF artifact | Workflow run → **Artifacts** → `osv-scan-sarif` (retained 7 days) |
| GitHub annotations | PR diff view — OSV annotates affected files when `--gh-annotations=true` |

---

### Gitleaks Secret Scan — `Security - Gitleaks secret scan`

**Source:** [`.github/workflows/gitleaks.yml`](../../.github/workflows/gitleaks.yml)

#### Overview

| Attribute | Value |
|---|---|
| Workflow name | `Security - Gitleaks secret scan` |
| Job name | `Gitleaks secret scan` |
| Trigger | `pull_request` → `main`; `push` → `main` |
| Concurrency | Cancels stale PR runs; push-to-main runs are not cancelled |
| Permissions | `contents: read`, `pull-requests: read` |

#### What it scans

Gitleaks scans only the **commit delta** of the PR or push — not the full repository history. This
keeps scan time short and focuses findings on newly introduced secrets.

| Attribute | Value |
|---|---|
| Rule base | Upstream Gitleaks default rules (via `[extend] useDefault = true` in `.gitleaks.toml`) |
| Custom allowlist | `.gitleaks.toml` — excludes Supabase local-dev well-known anon key, placeholder strings (`<YOUR_...>`, `REPLACE_ME`), `.env.example`, and `ci-history/` |
| Action version | `gitleaks/gitleaks-action` v3.0.0 |
| License mode | Audit mode (MIT license; no `GITLEAKS_LICENSE` required) |

#### Enforcement logic

The `gitleaks-action` step exits with a non-zero code when any secret pattern is detected in the
commit delta. This causes the job to fail and creates a failing check on the PR.

- Secrets found in commit delta → job fails; check status: **failure**
- No secrets detected → job passes; check status: **success**
- Findings are redacted in workflow logs by default to prevent accidental secret exposure in CI output.

> **Branch protection note:** Whether a Gitleaks failure hard-blocks merge depends on whether
> `Gitleaks secret scan` is configured as a required status check in **Settings → Branches → `main`**.
> The workflow is designed as a merge gate; confirm the required-check setting is active during audits.

#### Allowlist configuration

The `.gitleaks.toml` allowlist at the repository root defines project-level exceptions for known
non-secret patterns (local-dev JWTs, placeholder strings, example files). This file is at the
repository root (not under `.github/`) and is not itself a CODEOWNERS-protected path.

To tune the allowlist or add custom rules, edit `.gitleaks.toml` and open a PR.

#### Evidence locations

| Evidence | Location |
|---|---|
| Failing check | PR Checks → **Security - Gitleaks secret scan** → `Gitleaks secret scan` job |
| Finding details | Job log — redacted by default; developers must inspect locally with `gitleaks detect --source .` |

---

### PR Validation — `PR - Validation`

**Source:** [`.github/workflows/pr-validation.yml`](../../.github/workflows/pr-validation.yml)

#### Overview

| Attribute | Value |
|---|---|
| Workflow name | `PR - Validation` |
| Visible checks | `Summary` plus the upstream job names listed below |
| Trigger | `pull_request` → `main`; `push` → `main` |
| Merge-blocking | Depends on the live branch-protection required-check list; `validation-summary` itself only writes a report |

#### Jobs in this workflow

| Job name | What it checks |
|---|---|
| `Shared tools regression suite` | Vitest unit tests for `.github/tools/shared` |
| `SQL migration lint` | sqlfluff against `supabase/migrations/` |
| `YAML workflow & chart lint` | yamllint against `.github/workflows/` and `charts/` |
| `Markdown docs lint` | markdownlint against `docs/**/*.md` and `README.md` |
| `Frontend lint & build` | biome lint, Vite build, Vitest unit tests, license compliance |
| `Temporal worker lint, typecheck & tests` | biome lint, TypeScript typecheck, Jest tests, license compliance |
| `Helm chart lint & profile tests` | Helm render + `ci-test.sh`, frontend Docker entrypoint contract tests |
| `Supabase demo-baseline seed` | Runs `run_demo_baseline_seed.sh` |
| `Supabase auth & RBAC contract tests` | Runs `run_auth_rbac.sh` |
| `Supabase auth integration tests (users, roles, MFA)` | Starts Supabase, runs `run_auth_integration.sh` |
| `Supabase direct-DB write-RPC guard contracts` | Runs `run_direct_db_write_rpc_guards.sh` |
| `Supabase create_entity_with_version reset-path contracts` | Runs `run_create_entity_with_version_reset.sh` |
| `Supabase seed-demo-users integration tests` | Runs `run_seed_demo_users.sh` |
| `Supabase workflow_classifications contract tests` | Runs `run_workflow_classifications_contract.sh` |
| `Dockerfile lint (hadolint)` | hadolint on `frontend/Dockerfile` and `temporal/Dockerfile` |
| `Summary` | Aggregates the job results above; verify in branch protection whether it is the only required check |

> **Warning:** The `Summary` job lists the jobs above in its `needs:` and runs with `if: always()`,
> so it still executes after failed dependencies, and its report step only writes a markdown table
> to `$GITHUB_STEP_SUMMARY`. Because that step never exits non-zero, the job does **not** fail
> just because an upstream job in `needs:` failed. During audits, verify the actual
> required-check list under **Settings → Branches** instead of assuming `Summary` alone blocks
> every failed validation job.

Four jobs are **not** in `Summary`'s `needs:` and never block merge:

| Job name | Purpose |
|---|---|
| `Temporal DSL stub tests` | Jest tests for the DSL interpreter/expression/schema/duration/llm_agent sub-modules; run in parallel but not a required check |
| `Coverage (non-gating)` | Records unit + E2E coverage telemetry to `ci-history`; push-to-main only |
| `Append CI test results to ci-history + render dashboard` | Writes build-over-build trend data; push-to-main only |
| `Publish workflow-history + health dashboard` | Appends a workflow-run record and regenerates the CI health dashboard; skipped on PRs (`github.event_name != 'pull_request'`) |

---

### Architecture Audit — `Audit - Architecture`

**Source:** [`.github/workflows/architecture-audit.yml`](../../.github/workflows/architecture-audit.yml)

#### Overview

| Attribute | Value |
|---|---|
| Workflow name | `Audit - Architecture` |
| Job names | `Whole-repo architecture audit (report-only)`, `Helm best-practice scan (kube-score, report-only)` |
| Trigger | `pull_request` → `main` touching `temporal/src/**`, `supabase/migrations/**`, `.github/workflows/**`, `scripts/audit/**`, or `charts/app/**`; also daily schedule and `workflow_dispatch` |
| Merge-blocking | **No** — explicitly report-only; findings surface as workflow summary output and, for CRITICAL kube-score results, as filed GitHub issues |

This workflow provides a whole-repo audit lens that complements per-PR review by catching cross-file wiring issues, security posture gaps, and behaviour-vs-existence mismatches. It is intentionally non-gating to avoid blocking merges on informational findings, but practitioners should monitor its output during audits.

The Security Reviewer and Tech Reviewer factory agents consult this run's findings as part of their review workflow.

---

### Container Image Scanning — `CICD - Build Images`

**Source:** [`.github/workflows/build-images.yml`](../../.github/workflows/build-images.yml)

#### Overview

| Attribute | Value |
|---|---|
| Workflow name | `CICD - Build Images` |
| Blocking job | `build-images-pr` (PR path only) |
| Trigger | `pull_request` (any branch); `push` → `main` or `dev` |
| Merge-blocking | **Yes** — the `build-images-pr` job fails hard when any blocking scan finds HIGH/CRITICAL issues |

The workflow splits into a **PR path** (`build-images-pr`) that runs on all pull requests without registry credentials, and a **trusted push path** (`build-images`) that runs only on pushes to `main`/`dev` and holds OIDC tokens and registry credentials.

#### PR path: blocking scan gate

Three scanners run against locally-built images on every PR:

| Scanner | What it checks | Blocking condition |
|---|---|---|
| Trivy misconfig/secrets | Container misconfigurations and embedded secrets (HIGH/CRITICAL) | Yes — `trivy-ms` failure fails the job |
| Grype CVE | OS and application CVEs using NVD/GHSA severity, only-fixed (`severity-cutoff: high`) | Yes — `grype` failure fails the job |
| Dockle CIS Benchmark | CIS Docker Benchmark violations (exit-level: warn) | Yes — `dockle` failure fails the job |
| Trivy vuln (informational) | OS CVEs from Debian DSA/NVD (CRITICAL/HIGH) | No — informational SARIF only, uploaded to Code Scanning |

The **Enforce scan gate** step aggregates all three blocking outcomes. If any one fails the job fails hard. Trivy vuln findings are uploaded to **Security → Code scanning** as informational SARIF but never block the job.

#### Evidence locations (PR path)

| Evidence | Location |
|---|---|
| Blocking scan outcome | PR Checks → CICD - Build Images → `build-images-pr` job |
| Trivy vuln SARIF (informational) | **Security → Code scanning**, category filter: `container-<image>` |
| Grype table output | `build-images-pr` job log → Scan — Grype step |

#### Trusted push path: supply chain controls

After a successful push to `main` or `dev` the `sign-images`, SBOM upload, and SLSA provenance jobs run automatically. These are **not PR gates** — they execute after code has already merged.

| Control | Behaviour |
|---|---|
| Cosign image signing | Each pushed digest is signed with a keyless Cosign signature (OIDC/Sigstore) so downstream consumers can verify image provenance. |
| SBOM generation | An SPDX-JSON SBOM is generated for each image, uploaded as a workflow artifact (`sbom-<image>.spdx.json`, retained 7 days) and attached to the image digest. |
| SLSA provenance attestation | GitHub Actions build provenance is attested and pushed to the container registry using `actions/attest-build-provenance`. |

**Verify supply chain controls:** Open a recent `CICD - Build Images` run on a `main` or `dev` push. Confirm `sign-images` and provenance jobs completed successfully. Download the `sbom-frontend.spdx.json` artifact to inspect the SBOM.

---

## GitHub-native controls

These controls are enforced by GitHub's platform rather than by workflow YAML. They cannot be
disabled or bypassed by code changes alone — an authorized user must change repository settings.

### Branch protection on `main`

**Verify:** **Settings → Branches → `main` protection rule**

| Setting | Configured value |
|---|---|
| Require a pull request before merging | Yes |
| Require approvals | Yes |
| Dismiss stale pull request approvals when new commits are pushed | Yes |
| Require review from Code Owners | Yes (see [CODEOWNERS enforcement](#codeowners-enforcement)) |
| Require status checks to pass before merging | Yes |
| Required status checks | Verify the live list in **Settings → Branches** (see note below) |
| Require branches to be up to date | Configured in Settings |
| Allow force pushes | No |
| Allow deletions | No |

### Secret scanning and push protection

**Verify:** **Security → Code security and analysis**

| Control | Behaviour |
|---|---|
| Secret scanning | GitHub scans every push for known secret patterns (tokens, credentials, API keys). Findings raise alerts visible to maintainers. Does **not** block merge by itself. |
| Secret scanning push protection | Blocks the push before it reaches the repository when a high-confidence secret is detected. The developer must either remove the secret or explicitly bypass the block through the GitHub UI. |

These controls are independent of any workflow and cannot be tuned or disabled via `.github/`
files. All configuration is in **Security → Code security and analysis** in repository settings.

> **Required-check note:** The active control registry in [`.github/SECURITY.md`](../../.github/SECURITY.md)
> names `Summary`, but the workflow's `validation-summary` job is informational unless branch
> protection also lists the specific upstream jobs as required checks.

### Dependabot

**Verify:** **Security → Dependabot alerts** and **Security → Code security and analysis**

| Control | Behaviour |
|---|---|
| Dependabot vulnerability alerts | Raised when a dependency in the graph matches a known CVE. Visible to maintainers; does not block merge. |
| Dependabot automated security PRs | Opens a PR to bump the vulnerable dependency to a patched version. The PR must be reviewed and merged; it does not auto-merge. |

> **Relationship to OSV scan:** Dependabot tracks CVEs in the current dependency graph; the
> OSV scan gates on CVEs *introduced by a PR*. Both controls are required for full coverage.

### Delete-branch-on-merge

**Verify:** **Settings → General → Pull Requests → Automatically delete head branches**

When enabled, GitHub automatically deletes the PR source branch after a successful merge. This is
a housekeeping control, not a security gate.

---

## CODEOWNERS enforcement

**Source:** [`.github/CODEOWNERS`](../../.github/CODEOWNERS)

### Protected paths

| Path | Owner |
|---|---|
| `/.github/` | `@ianreay` |
| `/.github/workflows/` | `@ianreay` |
| `/.github/agents/` | `@ianreay` |
| `/deploy/k8s/` | `@ianreay` |
| `/charts/app/templates/` | `@ianreay` |
| `/docs/adrs/` | `@ianreay` |
| `/scripts/seed-demo-users.sh` | `@ianreay` |

### How enforcement works

CODEOWNERS review is **not self-enforcing**. The `.github/CODEOWNERS` file defines which owner
must approve a PR touching a given path, but the requirement only becomes a merge gate when
**"Require review from Code Owners"** is enabled in the `main` branch protection rule
(**Settings → Branches → `main`**).

When that setting is active:

1. Any PR that touches a CODEOWNERS-protected path requires an approving review from the listed
   owner (`@ianreay`) before merge is allowed.
2. If a new commit is pushed to the PR after an owner review, stale review dismissal (also
   configured in branch protection) invalidates the previous approval and requires a fresh review.
3. The factory pipeline can merge product/app PRs autonomously, but it **cannot** bypass the
   CODEOWNERS gate on control-plane paths — those always require a human review.

> **Note from CODEOWNERS:** The factory's autonomous merge gate was removed on 2026-06-07.
> Enabling "Require review from Code Owners" in branch protection is the second half of issue #277.
> Confirm the setting is active when auditing whether CODEOWNERS is truly enforced.

---

## Operator verification guide

### Verifying branch protection

1. Navigate to **Settings → Branches**.
2. Under **Branch protection rules**, confirm there is a rule for `main`.
3. Click the rule to inspect each setting in the [Branch protection on `main`](#branch-protection-on-main) table above.
4. Record the exact required-check names. Do not assume `Summary` alone covers every validation job.

### Verifying secret scanning and push protection

1. Navigate to **Security → Code security and analysis**.
2. Confirm both **Secret scanning** and **Push protection** show as **Enabled**.
3. Active findings are listed under **Security → Secret scanning alerts**.

### Verifying CODEOWNERS enforcement

1. Navigate to **Settings → Branches → `main`** branch protection rule.
2. Confirm **Require review from Code Owners** is checked.
3. Confirm `.github/CODEOWNERS` is present and defines the correct paths and owners.

### Locating Semgrep evidence for a PR

1. Open the PR and click **Checks**.
2. Find **Validate - Semgrep** → **Semgrep scan**.
3. Click the workflow run to view the **Summary** tab — the Semgrep scan section shows a table of
   finding counts by severity.
4. Open **Artifacts** and download `semgrep-sarif` for the raw SARIF file (retained 14 days).
5. For historical findings, navigate to **Security → Code scanning** and filter by tool `Semgrep`.

### Locating OSV scan evidence for a PR

1. Open the PR and click **Checks**.
2. Find **PR - OSV Dependency Scan** → **OSV scan (diff-only HIGH/CRITICAL)**.
3. The **Summary** tab shows the base/PR/new-introduction counts.
4. Open **Artifacts** and download `osv-scan-sarif` for the SARIF file (retained 7 days).
5. PR annotations in the diff view highlight the affected packages when new CVEs are introduced.

### Locating Gitleaks evidence for a PR

1. Open the PR and click **Checks**.
2. Find **Security - Gitleaks secret scan** → **Gitleaks secret scan** job.
3. Click the job to open the run log.
4. Findings are **redacted** in the log by default to avoid exposing the detected value in CI output.
5. To inspect findings locally, run `gitleaks detect --source .` in the repository root.
6. To verify the allowlist exceptions, review `.gitleaks.toml` at the repository root.

> **If findings are detected:** Remove the secret from the commit (rewrite history or use
> `git commit --amend` before the branch is merged). If the pattern is a known non-secret
> placeholder, add an allowlist entry to `.gitleaks.toml` and open a PR. See the
> [Gitleaks secret scan section](#gitleaks-secret-scan--security---gitleaks-secret-scan)
> above for allowlist guidance.

### Locating container image scan evidence for a PR

1. Open the PR and click **Checks**.
2. Find **CICD - Build Images** → **build-images-pr** job.
3. Click **Scan — Grype** step for the CVE table output.
4. Click **Scan — Trivy misconfiguration/secrets** for misconfiguration findings.
5. Click **Scan — Dockle** for CIS Benchmark violations.
6. For informational Trivy vuln findings (not merge-blocking), navigate to **Security → Code scanning** and filter by category `container-<image>`.

### Verifying PR Validation status

1. Open the PR and click **Checks**.
2. Find **PR - Validation** → expand to see all jobs.
3. The `Summary` job result is what branch protection evaluates.
4. Each upstream job (frontend, temporal, Supabase, etc.) has its own tab with logs.

---

## Troubleshooting flow

### Which controls block merge?

Controls that **block merge** (PR cannot be merged until resolved):

- Semgrep SAST: ERROR-severity finding detected
- OSV Dependency Scan: new HIGH/CRITICAL CVE introduced by the PR
- Gitleaks secret scan: secret pattern detected in commit delta (when configured as required status check)
- PR Validation check failures: only if the failing check name is listed as required in branch protection
- Container image scan (`build-images-pr`): Trivy misconfig/secrets, Grype CVE, or Dockle CIS violation (HIGH/CRITICAL)
- Branch protection: a required status check is not passing
- Branch protection: insufficient approvals / no CODEOWNERS approval
- Secret scanning push protection: push was blocked before reaching the repo
- Branch protection: branch is not up-to-date with `main` (if configured)

Controls that **report only** (do not block merge by themselves):

- Semgrep WARNING/NOTE findings (visible in Code Scanning, not a merge gate)
- OSV findings in the base branch (pre-existing CVEs tracked by Dependabot, not new introductions)
- Trivy vuln scan in `build-images-pr` (informational SARIF; Grype is the blocking CVE gate)
- Supply chain controls — Cosign signing, SBOM, SLSA provenance (run post-merge on push to `main`/`dev`)
- Secret scanning alerts (raised after the push lands; push protection is the hard gate)
- Dependabot vulnerability alerts
- Architecture audit workflow (explicitly report-only, non-gating)
- Coverage job (informational telemetry only)

### PR is blocked — how to identify the cause

| Symptom | Where to look | Likely cause |
|---|---|---|
| `Summary` check failing | PR Checks → PR - Validation → `Summary` | The summary job itself failed or did not complete |
| `Summary` check passed but another PR validation job failed | PR Checks → PR - Validation; then **Settings → Branches** | The failed job is not configured as a required check |
| Semgrep check failing | PR Checks → Validate - Semgrep → Semgrep scan | ERROR-severity SARIF finding |
| OSV check failing | PR Checks → PR - OSV Dependency Scan | New HIGH/CRITICAL CVE in PR lockfiles |
| Gitleaks check failing | PR Checks → Security - Gitleaks secret scan | Secret pattern found in commit delta |
| Container scan check failing | PR Checks → CICD - Build Images → `build-images-pr` | Trivy misconfig/secrets, Grype CVE, or Dockle CIS violation |
| "Changes requested" or "Review required" | PR Reviews tab | CODEOWNERS approval missing or dismissed |
| Merge button shows "Required status checks have not passed" | PR conversation tab | One or more required checks still pending or failed |
| Push was rejected before reaching the repo | Git client error message | Secret scanning push protection triggered |

### Distinguishing workflow failures from GitHub settings failures

- **Workflow failures** show as failed checks under the PR's **Checks** tab. Logs are available in
  the workflow run. These are fixable by changing code and pushing a new commit.
- **GitHub settings failures** (branch protection, CODEOWNERS, secret scanning push protection)
  show as blocked actions with a message from GitHub itself, not from a workflow. These require
  an authorized repository maintainer to change settings or perform an explicit bypass.

### Where a control must be changed

| Control | Where to change it |
|---|---|
| Semgrep rulesets or path scope | `.github/workflows/semgrep.yml` |
| OSV severity threshold or lockfiles | `.github/workflows/osv-scan.yml` |
| Gitleaks rules or allowlist | `.gitleaks.toml` (allowlist); `.github/workflows/gitleaks.yml` (action version) |
| Container scan scanners or severity thresholds | `.github/workflows/build-images.yml` |
| PR validation jobs | `.github/workflows/pr-validation.yml` |
| Required status checks | **Settings → Branches → `main`** |
| CODEOWNERS protected paths | `.github/CODEOWNERS` |
| CODEOWNERS enforcement (branch protection) | **Settings → Branches → `main`** |
| Secret scanning / push protection | **Security → Code security and analysis** |
| Branch deletion / force-push policies | **Settings → Branches → `main`** |

> Changes to `.github/workflows/`, `.github/agents/`, `.github/CODEOWNERS`, and `docs/adrs/` are
> themselves control-plane paths protected by CODEOWNERS and require an ADR in the same PR per
> repository policy.

---

## Related references

- [`.github/SECURITY.md`](../../.github/SECURITY.md) — Active control registry and vulnerability reporting
- [`.github/CODEOWNERS`](../../.github/CODEOWNERS) — Control-plane path ownership
- [`.github/workflows/WORKFLOWS.md`](../../.github/workflows/WORKFLOWS.md) — Full workflow catalogue
- [`docs/devsecops/README.md`](README.md) — DevSecOps guide index
