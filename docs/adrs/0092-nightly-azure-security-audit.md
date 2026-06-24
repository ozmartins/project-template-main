# ADR-0092: Nightly Azure Security Audit via Prowler and Microsoft Defender for Cloud

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** security-reviewer agent, factory-architect
- **Supersedes / Superseded by:** —

## Context

An AKS cluster with well-hardened pod security can still be fully compromised by
misconfigurations in the surrounding Azure environment: over-privileged identities,
public storage or registry exposure, missing diagnostic settings, permissive NSG rules,
or AKS API server accessible from the public internet. These control-plane risks are
invisible to Kubernetes-level audits such as kube-bench.

The factory already runs a nightly CIS Kubernetes Benchmark (`.github/workflows/audit-cis-kubernetes.yml`). A
parallel outer-ring audit covering Azure identity, networking, storage, monitoring,
and AKS-specific Azure controls is required to achieve full posture visibility.

Two complementary sources are available without additional Azure spend:
- **Prowler** (Apache 2.0): 300+ Azure checks mapped to CIS Azure 2.0, NIST, PCI-DSS.
  Runs as a Python CLI using the runner's existing Azure CLI authentication.
- **Microsoft Defender for Cloud** (free tier): `az security assessment list` returns
  Secure Score recommendations directly from the Azure Portal's Defender dashboard,
  making it the most authoritative source for subscription-level misconfigurations.

## Decision

We add `.github/workflows/audit-azure-security.yml`, a nightly workflow at 04:00 UTC
that:

1. Checks for Azure CLI authentication on the self-hosted `factory-cluster-guardian` runner.
2. Runs `prowler azure --compliance cis_azure_2.0 --output-formats json` scoped to the
   subscription detected from `az account show`.
3. Fetches Unhealthy Defender assessments via `az security assessment list`.
4. Uploads raw results as a workflow artifact (30-day retention).
5. Invokes the `audit-findings-triage` Copilot agent twice (once for Prowler findings,
   once for Defender findings) to deduplicate against existing `queue:security` issues
   and file new ones for findings above the severity threshold.

Authentication uses the runner's ambient Managed Identity / Azure CLI session — no
long-lived service principal credential is stored as a GitHub secret for this workflow.
If the runner is not authenticated, the workflow skips gracefully and writes a warning
to the step summary.

Accepted and not-applicable findings are documented in `deploy/audit/azure-baseline.json`
with mandatory justification and review date (max 90 days). The triage agent suppresses
baseline-listed finding IDs from generating new issues.

The `security-reviewer` agent's standing posture sweep is updated to consult both the
nightly Azure audit and the nightly Kubernetes audit when reviewing open `queue:security`
items.

## Consequences

**Easier:**
- Azure control-plane misconfigurations are surfaced within 24 hours of introduction.
- Prowler + Defender findings flow into the same `queue:security` label and project board
  as all other security work, keeping the queue unified.
- Accepted-risk suppressions are versioned in Git with explicit justification and review dates.

**Harder / constrained:**
- The workflow requires a self-hosted runner with `az` CLI and an authenticated Azure session.
  It degrades gracefully (skips, logs warning) when the runner is unavailable.
- Prowler can take 20–40 minutes depending on subscription resource count; the job timeout
  is set to 60 minutes.
- The 10-issue-per-run cap in `audit-findings-triage` means a first-run with many findings
  will require multiple nightly runs to file all issues; the cap prevents spam.

**New obligations:**
- Baseline entries must be reviewed before their `review_date`; expired entries should be
  re-evaluated and either re-accepted with a new date or removed.
- Runner authentication must be maintained for the nightly schedule to produce real results.

## Alternatives considered

- **`azure/login@v2` with `AZURE_CREDENTIALS` secret:** rejected in favour of Managed
  Identity to avoid storing a long-lived credential in GitHub secrets. The runner already
  has an authenticated Azure session.
- **SARIF upload to GitHub Security tab:** Prowler can emit SARIF; this is deferred because
  the triage-agent approach produces richer, deduplicated GitHub issues, and SARIF upload
  requires `security-events: write` which widens the workflow's permission surface. SARIF
  upload can be added in a follow-up when the security tab experience is preferred.
- **Checkov for IaC:** appropriate once Terraform/Bicep is part of this template; deferred.
- **Standalone `.mjs` parser scripts:** replaced by the shared `audit-findings-triage` agent
  which already handles kube-bench, Prowler, and Defender JSON formats and has been tested.

## Evidence

- Workflow: `.github/workflows/audit-azure-security.yml`
- Accepted-findings baseline: `deploy/audit/azure-baseline.json`
- Triage agent: `.github/agents/audit-findings-triage.agent.md`
- Security posture sweep update: `.github/agents/security-reviewer.agent.md` (§ Standing posture sweep)
- Related audit: `.github/workflows/audit-cis-kubernetes.yml`
- Prowler repository: https://github.com/prowler-cloud/prowler (Apache 2.0)
- Microsoft Defender for Cloud REST API: https://learn.microsoft.com/en-us/rest/api/defenderforcloud/
