# Audit & Compliance

Operational guide for running, reading, and responding to the repository's nightly security-audit
workflows. Use this guide to collect compliance evidence, triage benchmark findings, and manage
follow-up work from workflow outputs alone.

> **Audience:** Compliance engineers collecting audit evidence · Security engineers triaging
> nightly benchmark findings · Platform/on-call operators triggering audits after changes or
> incidents.

## What each workflow does

| Workflow | Schedule | Runner | Gating? | Evidence artifact |
|---|---|---|---|---|
| `audit-cis-kubernetes.yml` | 03:00 UTC nightly + `workflow_dispatch` | self-hosted `factory-cluster-guardian` | No — report only | `kube-bench-results-<run_id>` |
| `audit-azure-security.yml` | 04:00 UTC nightly + `workflow_dispatch` | self-hosted `factory-cluster-guardian` | No — report only | `azure-audit-results-<run_id>` |
| `architecture-audit.yml` | 06:00 UTC daily + `workflow_dispatch` + PRs to `main` | `ubuntu-latest` | No — report only | Job step summary; optional `queue:platform` issue on CRITICAL kube-score findings |

## Manual trigger procedures

All three workflows support `workflow_dispatch`. Trigger via the GitHub UI or the CLI:

**GitHub UI:** Navigate to **Actions → \<workflow name\> → Run workflow**, select the `main` branch, fill in any optional inputs, and click **Run workflow**.

**GitHub CLI:**

```bash
# CIS Kubernetes benchmark — default threshold (FAIL)
gh workflow run audit-cis-kubernetes.yml

# CIS Kubernetes benchmark — include WARN findings
gh workflow run audit-cis-kubernetes.yml -f severity_threshold=WARN

# Azure security benchmark — medium severity and above (default)
gh workflow run audit-azure-security.yml

# Azure security benchmark — high and critical only
gh workflow run audit-azure-security.yml -f severity_threshold=high

# Architecture audit — no inputs required
gh workflow run architecture-audit.yml
```

> **Concurrency note:** `audit-cis-kubernetes.yml` and `audit-azure-security.yml` use
> `cancel-in-progress: false` — a new manual trigger will queue behind any in-progress run rather
> than cancel it. `architecture-audit.yml` uses `cancel-in-progress: true` — a new trigger on the
> same ref will cancel an in-progress run. When triggering manually after an incident, use
> `gh run watch <run_id>` to confirm the new run starts and is not waiting behind a stale run.

### Evidence collection after a run

```bash
# Watch a run complete
gh run watch <run_id>

# Download all artifacts from a run (kube-bench or Azure)
gh run download <run_id>
# Creates: kube-bench-results-<run_id>/ or azure-audit-results-<run_id>/

# List issues filed by the triage agent after the run
gh issue list --label "queue:security" --state open

# Capture architecture audit step output (no uploaded artifact — use step logs)
gh run view <run_id> --log | grep -E '(CRITICAL|WARNING|PASS|FAIL|finding)' > architecture-audit-evidence.txt
```

Record the following for every compliance evidence bundle: run ID, run URL
(`https://github.com/<org>/<repo>/actions/runs/<run_id>`), trigger type (scheduled or manual),
`severity_threshold` used, and artifact retention expiry (30 days from run date).

For the **architecture audit**, step summary content is visible in the GitHub Actions UI under the
**Summary** tab of each job (navigate to the run → select `audit` or `helm-best-practice-scan` job →
click **Summary**). There is no uploaded artifact; retain a copy of the summary text or the filtered
step log output above for your compliance bundle.

---

## Common operator flow (all audits)

1. Trigger the workflow (scheduled or `workflow_dispatch` — see [Manual trigger procedures](#manual-trigger-procedures) above).
2. Wait for the run to complete (**Actions** UI or `gh run watch <run_id>`).
3. Open the run's step summary for a posture snapshot (the format is shown in the evidence sections below for each workflow).
4. Download artifacts for the evidence bundle: `gh run download <run_id>` (kube-bench and Azure audits only — architecture audit produces no downloadable artifact).
5. Review any new or reopened `queue:security` issues created by the triage agent.
6. Track remediation in the GitHub issue. For public benchmark findings (kube-bench, Prowler, Defender, kube-score), add a comment when a fix is merged and close the issue once the next scheduled run confirms the finding is resolved. For **exploitable vulnerabilities** (auth bypass, injection, credential exposure), use the private reporting path instead — see [Remediation SLAs and private reporting](#remediation-slas-and-private-reporting).

---

## CIS Kubernetes audit (`audit-cis-kubernetes.yml`)

### What it checks

kube-bench ([Apache 2.0](https://github.com/aquasecurity/kube-bench)) runs the **AKS 1.0**
benchmark against the live cluster, targeting node-level controls (section 4). Control-plane
sections 1–3 are managed by the cloud provider and are skipped automatically by the triage agent.

### Manual trigger inputs

- `severity_threshold` (`FAIL` or `WARN`, default `FAIL`): controls which severities are eligible for issue filing by triage.

### Execution model

- The workflow first checks `kubectl cluster-info`.
- If reachable, it creates a Kubernetes Job (`kube-bench-nightly`) using `aquasec/kube-bench:latest`.
- Command used: `kube-bench --benchmark aks-1.0 --json`.
- The job output is written to `/tmp/audit/kube-bench.json`, then uploaded as `kube-bench-results-<run_id>`.

### Evidence and summary interpretation

- Artifact: `kube-bench-results-<run_id>` containing `kube-bench.json` (retained 30 days).
- JSON structure: `.Controls[].tests.results[]` — each result carries `test_number`, `test_desc`, `status` (`PASS`/`FAIL`/`WARN`/`INFO`), and `remediation`.
- Step summary shows a status-count table:

  ```
  ## kube-bench CIS Kubernetes Benchmark — YYYY-MM-DD

  | Status | Count |
  |--------|-------|
  | FAIL   | 3     |
  | PASS   | 47    |
  | WARN   | 5     |
  | INFO   | 2     |
  ```

  A non-zero FAIL count means findings were parsed and sent to the triage agent. Check the
  **Triage findings → GitHub issues** step log for the list of filed or skipped issues.

### Triage to GitHub issues

`audit-findings-triage` is invoked with `continue-on-error: true` — a triage agent failure does not
fail the overall workflow run. If new issues are not appearing after a FAIL-heavy run, check the
**Triage findings → GitHub issues** step log for agent errors.

Environment variables passed to the agent:

- `AUDIT_SOURCE=kube-bench`
- `AUDIT_JSON_PATH=/tmp/audit/kube-bench.json`
- `AUDIT_SEVERITY_THRESHOLD=<workflow input or FAIL>`
- `AUDIT_RUN_URL=<actions run URL>`
- `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `FACTORY_CONFIG_PATH`, `AGENTS_PATH`

Operational behavior from the triage contract:

- If `AUDIT_JSON_PATH` is missing or unreadable, the agent exits without filing issues.
- Section 1–3 control-plane checks are logged as `control plane managed by provider, skipped`.
- Findings are grouped by root cause (same section, same remediation verb) rather than filing one issue per check.
- Each cluster gets a fingerprint `audit-finding-kube-bench-<sanitised-id>`; open issues with that fingerprint are reused, closed matches reopened, duplicates skipped.
- Priority mapping: scored `FAIL` → `priority:high`; unscored `FAIL` → `priority:medium`; `WARN` → `priority:low`.
- At most 10 new issues are filed per run; the highest-severity clusters are filed first.
- A structured summary is written to `$GITHUB_STEP_SUMMARY` whether or not new issues were created. It includes: source and date, findings parsed, baseline suppressions (with IDs and review dates), expired baseline entries, already-tracked counts, new issues filed (with number, title, priority), reopened recurring issues, and any errors.

### “Cluster not reachable” path

If `kubectl cluster-info` fails, `CLUSTER_REACHABLE=false` is set and scan/triage steps are skipped. The summary shows:

```
⚠️ Cluster not reachable
kube-bench skipped — self-hosted runner could not connect to the Kubernetes cluster.
```

This is an **infrastructure signal**, not a security finding. Investigate:
- Is the `factory-cluster-guardian` runner online? (**Settings → Actions → Runners**)
- Has the runner's `kubeconfig` / cluster credentials expired?
- Is the cluster itself down?

A skipped run does not create issues; the outcome is recorded as `skipped` in `docs/ci-status/`.

---

## Azure security audit (`audit-azure-security.yml`)

### What it checks

Two parallel scans run in the same job:

| Scan | Tool | Scope |
|---|---|---|
| CIS Azure Benchmark 2.0 | Prowler ([Apache 2.0](https://github.com/prowler-cloud/prowler)) | ~300 checks across IAM, storage, networking, monitoring |
| Defender for Cloud assessments | `az security assessment list` (free tier) | Unhealthy recommendations available without Defender paid plans |

### Manual trigger inputs

- `severity_threshold` (`critical`, `high`, `medium`, `low`, default `medium`): passed to Prowler (`--severity`) and triage threshold.

### Accepted-findings baseline (`deploy/audit/azure-baseline.json`)

Before triage, the agent checks each finding ID against `deploy/audit/azure-baseline.json`:

- Finding ID present **and** `review_date` is today or in the future → **suppressed** (logged as `suppressed by baseline`).
- Finding ID present **but** `review_date` has passed → **not suppressed** (logged as `baseline entry expired`); the finding proceeds to normal triage.

To accept a known finding, add an entry to the `findings` array in `deploy/audit/azure-baseline.json`
with a justification and a `review_date` no more than 90 days out. Update `last_reviewed` at the top of
the file when you edit it:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "description": "Accepted or not-applicable Azure security findings.",
  "last_reviewed": "YYYY-MM-DD",
  "findings": [
    {
      "id": "<prowler-check-id-or-defender-assessment-id>",
      "source": "azure-prowler",
      "status": "accepted",
      "justification": "Explain why this is accepted or not applicable.",
      "review_date": "YYYY-MM-DD"
    }
  ]
}
```

### Scan scope and baseline handling

- Prowler runs `--compliance cis_azure_2.0` with `--status FAIL` for the authenticated subscription.
- Defender data comes from `az security assessment list` filtered to `status.code == "Unhealthy"`.
- Baseline suppressions are read from `deploy/audit/azure-baseline.json` (`AUDIT_BASELINE_PATH`) for accepted/not-applicable findings with justification and review dates.

### Artifact layout and evidence

- Workflow writes to `/tmp/audit`:
  - `prowler-azure.json` (normalized from timestamped Prowler output),
  - `defender-assessments.json`.
- Uploaded artifact: `azure-audit-results-<run_id>` containing the full `/tmp/audit/` directory (retained 30 days).
- Step summary format:

  ```
  ## Azure Security Audit — YYYY-MM-DD

  ### Prowler CIS Azure 2.0

  | Severity | Count |
  |----------|-------|
  | high     | 2     |
  | medium   | 5     |

  ### Azure Defender for Cloud (Unhealthy)
  Unhealthy assessments: 3
  ```

  Zero Prowler findings at the chosen threshold means the environment is clean at that level, or
  the threshold is set too high — lower to `low` for a more complete picture.

> **Step exit note:** Prowler exits non-zero when findings are present at the requested threshold.
> The workflow step uses `|| true` so the step is marked successful even when findings exist.
> A green **Run Prowler CIS Azure benchmark** step does not mean no findings — always check the
> step summary table and the downloaded `prowler-azure.json` artifact.

### Distinguishing auth failures from real findings

Authentication preflight:

- `az account show` success sets `AZ_AUTH=true`; failure sets `AZ_AUTH=false`.
- With `AZ_AUTH=false`, all scan and triage steps are skipped and the summary reports:

  ```
  ⚠️ Azure CLI not authenticated
  Prowler and Defender audit skipped — self-hosted runner Azure CLI credentials not available.
  Configure a Service Principal or Managed Identity on the runner to enable this workflow.
  ```

`AZ_AUTH=false` is an **infrastructure/credential failure**, not a clean security result. Real
findings are only present when `AZ_AUTH=true` and JSON artifacts were produced. Investigate
expired SP secrets, expired certificates, or Managed Identity misconfiguration on the runner.

### Triage to GitHub issues

The workflow runs triage twice, both with `continue-on-error: true` (a triage agent failure does not
fail the overall workflow run — check the step log for errors):

1. Prowler findings with `AUDIT_SOURCE=azure-prowler`, `AUDIT_JSON_PATH=/tmp/audit/prowler-azure.json`
2. Defender findings with `AUDIT_SOURCE=azure-defender`, `AUDIT_JSON_PATH=/tmp/audit/defender-assessments.json`

Both use:

- `AUDIT_SEVERITY_THRESHOLD=<workflow input or medium>`
- `AUDIT_BASELINE_PATH=<repo>/deploy/audit/azure-baseline.json`
- Fingerprint format: `audit-finding-<source>-<sanitised-id>` (for example,
  `audit-finding-azure-prowler-aks-api-server-authorized-ip-ranges` or
  `audit-finding-azure-defender-<assessment-id>`); open issues with a matching fingerprint are
  reused, closed matches are reopened, and duplicate new issues are skipped.
- Priority mapping: Prowler/Defender severity `high` or `critical` → `priority:high`;
  `medium` → `priority:medium`; `low` → `priority:low`.
- At most 10 new issues are filed per run; the highest-severity clusters are filed first.
- A structured summary is written to `$GITHUB_STEP_SUMMARY` after each triage pass, whether or not
  new issues were created (includes: source and date, findings parsed, baseline suppressions, new
  issues filed, reopened recurring issues, and any errors).

---

## Architecture audit (`architecture-audit.yml`)

### Report-only posture vs merge gating

- The main `audit` job is explicitly report-only (`npm run audit` in non-strict mode) and is designed to surface a worklist without blocking merges.
- The Helm scan job is also report-oriented but escalates when CRITICAL findings appear by opening a platform issue.
- Unlike the kube-bench and Azure audits, both jobs in this workflow run on standard GitHub-hosted `ubuntu-latest` runners — no self-hosted runner, cluster connectivity, or cloud credentials are required.
- The architecture audit is therefore never skipped due to `CLUSTER_REACHABLE=false` or `AZ_AUTH=false` conditions.
- If this workflow fails, it is a genuine audit-script or chart-render failure, not an infrastructure connectivity issue.

### PR-time triggers

Besides schedule/manual runs, pull requests to `main` trigger this workflow when touching:

- `temporal/src/**`
- `supabase/migrations/**`
- `.github/workflows/**`
- `scripts/audit/**`
- `charts/app/**`

### What `scripts/audit` checks look for

`scripts/audit/index.ts` runs these checks:

- `temporal-registration`: flags activity modules under `temporal/src/activities/` not imported in `temporal/src/worker.ts`.
- `workflow-security`: flags risky workflow patterns (for example `pull_request_target` combined with `secrets.*`, or `permissions: write-all`).
- `view-security-invoker`: flags SQL views created without `WITH (security_invoker = true)` because that can bypass base-table RLS expectations.

### Running `scripts/audit` locally or in strict mode

The architecture audit script can also be run locally or in strict (gating) mode outside CI:

```bash
# Report mode — always exits 0; prints findings to stdout
cd scripts/audit && npm run audit

# Strict mode — exits 1 if any findings; use to gate a manual release check
cd scripts/audit && npm run audit -- --strict
```

`--strict` is not used by the scheduled workflow (which always exits 0 to avoid blocking). Use it
when you need a hard gate — for example, before promoting to a higher environment after remediation.

### On-demand contract drift check

A separate check in `scripts/audit/` detects drift between Temporal activity signatures and their
DSL workflow call sites, and between Supabase RPC definitions and frontend callers. It is not
invoked by `architecture-audit.yml`; run it on demand after schema or activity changes:

```bash
# Report current drift findings
cd scripts/audit && npm run contract-drift

# Update the baseline snapshots after deliberate contract changes
cd scripts/audit && npm run contract-drift:update
```

`npm run contract-drift` runs two sub-checks in sequence:

- **Activity contracts** (`check-activity-contracts.ts`): compares the TypeScript type signatures of
  each Temporal activity implementation in `temporal/src/activities/` against the input keys used by
  DSL workflow definitions. Reports mismatches where a definition calls an activity with keys that do
  not match the declared required parameters.
- **RPC contracts** (`check-rpc-contracts.ts`): compares the Supabase RPC function signatures captured
  in the baseline snapshot against the current `supabase/migrations/` SQL definitions. Reports drift
  where a frontend caller references an RPC that has been renamed, removed, or had its argument list
  changed.

Both sub-checks are non-gating by design. If drift is found, inspect the output and open a
`queue:security` or `queue:development` issue to track the fix. Run `npm run contract-drift:update`
only after a deliberate, reviewed contract change to reset the baseline.

### kube-score Helm scan and escalation

- Renders chart manifests for base/dev/test profiles.
- Runs kube-score and appends per-profile WARNING/CRITICAL output to step summary:

  ```
  ### Profile: `dev` — ⚠️ 4 WARNING finding(s) — 0 CRITICAL
  ```

  WARNING findings in kube-score are expected for the current chart configuration and are
  tracked separately. CRITICAL findings trigger an issue.
- If total CRITICAL findings > 0, a deduplicated issue is created:
  - title: `[kube-score] CRITICAL Helm best-practice findings detected`
  - labels include `queue:platform` and `priority:high`.

---

## Remediation SLAs and private reporting

Audit benchmark findings (kube-bench FAIL, Prowler FAIL, Defender Unhealthy) become **public
GitHub issues** under `queue:security`. They are configuration or hardening gaps, not
exploitable vulnerabilities.

Refer to [`.github/SECURITY.md`](../../.github/SECURITY.md) for the full policy. Summary:

| Channel | When to use |
|---|---|
| Public `queue:security` GitHub issue (via triage agent) | CIS benchmark / Defender / Prowler findings |
| **Private** [GitHub vulnerability report](https://github.com/Volaris-AI/project-template/security/advisories/new) | Exploitable vulnerabilities — auth bypass, injection, credential exposure, broken access control |

The repository's SLAs from `.github/SECURITY.md` apply to **private vulnerability reports**:

| Milestone | SLA |
|---|---|
| Acknowledgement | 48 hours |
| Status update | 7 days |
| Patch or mitigation plan | 30 days (confirmed issues) |

For public audit findings filed via the triage agent, track remediation through the GitHub issue
itself: add a comment when a fix is merged, and close the issue once the next scheduled audit
run confirms the finding is resolved.

### In-scope vs out-of-scope for private reporting

**Use private reporting** (do not open a public issue) for:
- Authentication / authorization bypass in the Supabase RLS/RBAC layer.
- Injection vulnerabilities (SQL, command, template) in Temporal activities.
- Secrets or credentials exposed in logs, responses, or build artifacts.
- Broken access control in API routes or RPC guards.

**Use public issues** (routine audit triage) for:
- CIS Kubernetes benchmark hardening gaps.
- Prowler CIS Azure findings and misconfigurations.
- Defender for Cloud unhealthy assessments.
- kube-score Helm best-practice warnings and CRITICAL findings.
- Denial of service / resource exhaustion issues.
- CVEs in third-party dependencies (handled separately by Dependabot).

---

## Related references

| Resource | Location |
|---|---|
| CIS Kubernetes audit workflow | [`.github/workflows/audit-cis-kubernetes.yml`](../../.github/workflows/audit-cis-kubernetes.yml) |
| Azure security audit workflow | [`.github/workflows/audit-azure-security.yml`](../../.github/workflows/audit-azure-security.yml) |
| Architecture audit workflow | [`.github/workflows/architecture-audit.yml`](../../.github/workflows/architecture-audit.yml) |
| Security controls guide | [`docs/devsecops/security-controls.md`](./security-controls.md) |
| Secrets management guide | [`docs/devsecops/secrets-management.md`](./secrets-management.md) |
| Kubernetes hardening guide | [`docs/devsecops/kubernetes-hardening.md`](./kubernetes-hardening.md) |
| Network security guide | [`docs/devsecops/network-security.md`](./network-security.md) |
| Vulnerability reporting policy | [`.github/SECURITY.md`](../../.github/SECURITY.md) |
| Workflow map | [`.github/workflows/WORKFLOWS.md`](../../.github/workflows/WORKFLOWS.md) |
| Azure accepted-findings baseline | [`deploy/audit/azure-baseline.json`](../../deploy/audit/azure-baseline.json) |
| Architecture audit scripts | [`scripts/audit/`](../../scripts/audit/) |
