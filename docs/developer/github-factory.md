# GitHub Factory Contributor Guide

This guide is for contributors who interact with or extend the repository factory pipeline. It focuses on issue-to-PR flow, lane labels, agent/workflow boundaries, and common troubleshooting.

## Start from the source-of-truth docs

Use these as canonical references instead of this page for full inventories and exact contracts:

- Factory overview: [`README.md` (Factory pipeline)](../../README.md#the-factory-pipeline)
- Factory activation (secrets, enabling workflows): [`.github/FACTORY-ACTIVATION.md`](../../.github/FACTORY-ACTIVATION.md)
- Factory config (repo identity, concurrency, runner profiles): [`.github/factory.yml`](../../.github/factory.yml)
- Label taxonomy and ownership: [`.github/LABELS.md`](../../.github/LABELS.md)
- Active workflow catalog + schedules: [`.github/workflows/WORKFLOWS.md`](../../.github/workflows/WORKFLOWS.md)
- Copilot implementation/PR rules: [`.github/copilot-instructions.md`](../../.github/copilot-instructions.md)
- Lifecycle narrative: [`docs/architecture/software-factory.md`](../architecture/software-factory.md)
- Factory architecture ADR: [`ADR-0002`](../adrs/0002-github-factory-architecture.md)

## Contributor issue lifecycle (practical view)

1. **Issue triage**
   - New issues are usually marked `needs-triage`.
   - Product Owner triage applies one `queue:*` lane plus lifecycle labels such as `ready-for-dev`.
2. **Ready-for-dev gate**
   - Work is assignable when it has `queue:development` + `ready-for-dev` and no blocking labels (for example `needs-info`, `needs-design`, `blocked`).
3. **Copilot assignment**
   - Project Manager assigns Copilot and tracks concurrency/capacity.
   - Manual assignment is possible, but prefer the automated lane and assignment guidance in [`README.md`](../../README.md#manually-assigning-copilot-to-an-issue).
4. **Draft PR and review routing**
   - Copilot opens a draft PR.
   - PR Handler and specialists route/clear review lanes using labels like `queue:review`, `needs-security-review`, `needs-database-review`, and `needs-platform-review`.
5. **Merge and closure linkage**
   - PR body must contain `Closes #<issue-number>` so GitHub links and closes the issue correctly.
   - Missing closing keywords are a known source of ghost assignments; see [`docs/specs/copilot-assignment-cleanup.md`](../specs/copilot-assignment-cleanup.md).

## Labels that matter most when contributing

### Queue labels (who should act)

- `queue:development` — Copilot implementation lane.
- `queue:architecture` — design/spec/ADR lane before coding.
- `queue:security`, `queue:database`, `queue:platform`, `queue:docs`, `queue:ops`, `queue:product` — specialist ownership lanes.

#### What each specialist lane means

| Lane | What triggers it | Who acts |
|---|---|---|
| `queue:security` | Security findings, audit alerts, auth/secrets/RLS concerns | Security Reviewer: checks permissions, dependency vulns, data-exposure risk, workflow credentials |
| `queue:database` | Schema, migration, or data-model work | DB Steward: checks migration safety, RLS policies, tenant scoping, seed-data impact |
| `queue:platform` | CI/CD, Kubernetes, Helm, Terraform, or runner changes | Platform Engineer: checks workflow governance, build paths, runner placement, chart correctness |
| `queue:docs` | Developer documentation gap filed by `docs-improver` or `developer-docs-manager` | Docs Improver / Copilot implementation |
| `queue:ops` | Operational incident or environment health issue | Operations Manager: environment posture, cost, backup validation |
| `queue:product` | Needs product clarification before technical work can start | Human / Product Owner |

A PR carrying `needs-security-review`, `needs-database-review`, or `needs-platform-review` cannot be merged until the corresponding specialist agent clears the lane. See the [Mermaid lifecycle diagram](../architecture/software-factory.md#issue-to-merge-lifecycle) for how clearing a gate works.

### Lifecycle and gate labels (whether work can proceed)

- `ready-for-dev` — scoped and ready for coding.
- `needs-triage`, `needs-info`, `needs-design`, `design-in-progress`, `blocked` — do not start implementation until cleared.
- PR specialist gates: `needs-security-review`, `needs-database-review`, `needs-platform-review`.
- PR review lane: `queue:review`.

For full semantics (who sets/clears each label), use [`.github/LABELS.md`](../../.github/LABELS.md) and [ADR-0011](../adrs/0011-github-label-driven-work-routing.md).

## Major agents and cadences (contributor view)

You usually only need to know which stage to check, then open the linked source file for exact behavior. The table below gives a practical overview; for full trigger conditions, required secrets, and exact agent contracts, use [`.github/workflows/WORKFLOWS.md`](../../.github/workflows/WORKFLOWS.md) and the individual `.agent.md` files.

| Cadence | Workflow | Core agents | What it handles |
|---|---|---|---|
| Every 15 min | [`pipeline-fast.yml`](../../.github/workflows/pipeline-fast.yml) | [`product-owner`](../../.github/agents/product-owner.agent.md), [`project-manager`](../../.github/agents/project-manager.agent.md), [`pr-handler`](../../.github/agents/pr-handler.agent.md), [`security-reviewer`](../../.github/agents/security-reviewer.agent.md), [`database-steward`](../../.github/agents/database-steward.agent.md), [`platform-engineer`](../../.github/agents/platform-engineer.agent.md) | Issue triage, Copilot assignment, PR review/merge, specialist lane clearance |
| Every 15 min | [`monitor-actions.yml`](../../.github/workflows/monitor-actions.yml) | [`actions-monitor`](../../.github/agents/actions-monitor.agent.md) | Detects stuck or failed workflow runs and files deduplicated incident issues |
| Hourly (:30 UTC) | [`pipeline-hourly.yml`](../../.github/workflows/pipeline-hourly.yml) | [`factory-architect`](../../.github/agents/factory-architect.agent.md), [`qa-manager`](../../.github/agents/qa-manager.agent.md), [`operations-manager`](../../.github/agents/operations-manager.agent.md), [`cluster-guardian`](../../.github/agents/cluster-guardian.agent.md) | Architecture/spec work, QA coverage, ops health, cluster alerts |
| Daily (04:00 UTC) | [`code-quality.yml`](../../.github/workflows/code-quality.yml) | [`code-quality-reviewer`](../../.github/agents/code-quality-reviewer.agent.md) | Static-analysis findings (tsc, ruff, shellcheck, Semgrep, etc.) triaged into deduped quality tickets |
| Daily (06:00 UTC) | [`pipeline-daily.yml`](../../.github/workflows/pipeline-daily.yml) | [`docs-improver`](../../.github/agents/docs-improver.agent.md), [`user-docs-manager`](../../.github/agents/user-docs-manager.agent.md), [`trend-analyst`](../../.github/agents/trend-analyst.agent.md), [`factory-process-reviewer`](../../.github/agents/factory-process-reviewer.agent.md) | User-facing and general docs gap detection, cross-ticket trend roll-ups, factory process review and agent instruction improvements |
| Nightly (03:00 UTC) | [`audit-cis-kubernetes.yml`](../../.github/workflows/audit-cis-kubernetes.yml) | [`audit-findings-triage`](../../.github/agents/audit-findings-triage.agent.md) | kube-bench CIS Kubernetes Benchmark compliance scan; findings triaged into deduped issues |
| Nightly (04:00 UTC) | [`audit-azure-security.yml`](../../.github/workflows/audit-azure-security.yml) | [`audit-findings-triage`](../../.github/agents/audit-findings-triage.agent.md) | Prowler CIS Azure Benchmark scan; findings triaged into deduped issues |
| Nightly (22:00 UTC) | [`pipeline-nightly-devdocs.yml`](../../.github/workflows/pipeline-nightly-devdocs.yml) | [`developer-docs-manager`](../../.github/agents/developer-docs-manager.agent.md) | Developer guide coverage (bootstrap or watermark-based gap filing) |
| Nightly (23:00 UTC) | [`pipeline-nightly-devsecops-docs.yml`](../../.github/workflows/pipeline-nightly-devsecops-docs.yml) | [`devsecops-docs-manager`](../../.github/agents/devsecops-docs-manager.agent.md) | DevSecOps documentation coverage (security controls, audits, K8s hardening) |
| Weekly (Mon 09:00 UTC) | [`pipeline-weekly.yml`](../../.github/workflows/pipeline-weekly.yml) | [`personas-curator`](../../.github/agents/personas-curator.agent.md) | Maintains living persona documents under `docs/personas/` |
| Weekly (Fri 18:00 UTC) | [`pipeline-weekly-diary.yml`](../../.github/workflows/pipeline-weekly-diary.yml) | [`diary-agent`](../../.github/agents/diary-agent.agent.md) | Weekly factory diary entry under `docs/diary/` |
| Event-driven | [`monitor-deploy.yml`](../../.github/workflows/monitor-deploy.yml) | [`deploy-sentinel`](../../.github/agents/deploy-sentinel.agent.md) | Investigates failed deploy or E2E runs and raises precise incident issues |

All factory pipelines support `workflow_dispatch` so you can trigger them manually from **Actions → [workflow name] → Run workflow**. This is useful when debugging agent behavior without waiting for the next scheduled run.

## When you add or modify factory control-plane behavior

If your change touches control-plane contracts, treat it as governance work (not routine content edits):

- **Workflow behavior changes** in `.github/workflows/**` require an ADR in `docs/adrs/` in the same PR.
- **Agent contract/guardrail/routing changes** in `.github/agents/**` also require a same-PR ADR.
- **Operating-rule or routing changes** to `.github/copilot-instructions.md` also require a same-PR ADR.
- Keep ADR numbering/indexing consistent (see [ADR index guidance](../adrs/README.md)).
- Keep PR scope narrow and mention the required specialist review lane when relevant.

These rules are defined in [`.github/copilot-instructions.md`](../../.github/copilot-instructions.md).

## Common factory-process confusion (and where to look)

### "Issue is still open after merged PR" (ghost assignment symptoms)

Typical cause: missing `Closes #<issue-number>` in PR body. Confirm PR linkage and follow cleanup guidance in [`docs/specs/copilot-assignment-cleanup.md`](../specs/copilot-assignment-cleanup.md).

### "Copilot got assigned twice / duplicate sessions"

Check assignment history and assignees. The Project Manager contract explicitly skips issues already assigned to Copilot; see [`project-manager.agent.md`](../../.github/agents/project-manager.agent.md).

### "Two agents/workflows seem to own the same thing"

Use labels and workflow sources to identify ownership boundaries:

1. Check lane labels on the issue/PR (`queue:*`, `needs-*-review`).
2. Check [`.github/LABELS.md`](../../.github/LABELS.md) for owner/clearer rules.
3. Check [`.github/workflows/WORKFLOWS.md`](../../.github/workflows/WORKFLOWS.md) for trigger/cadence.
4. Check the relevant `.agent.md` file for exact execution contract.

If ownership still appears ambiguous, open a scoped issue in `queue:architecture` (design/routing clarification) rather than patching behavior ad hoc.

### "An agent filed a duplicate issue"

Factory agents (`trend-analyst`, `docs-improver`, `developer-docs-manager`, etc.) are designed to deduplicate before filing, but duplicates can slip through. When you spot one:

1. Label the duplicate with `duplicate` and close it, leaving a comment pointing at the canonical issue.
2. If the same agent repeatedly files duplicates, review the agent's deduplication contract in its `.agent.md` file. If the contract needs tightening, open a scoped issue in `queue:architecture` rather than editing the agent file ad hoc — agent prompt contracts are a control-plane boundary that require an ADR.

### "Copilot PR CI is stuck at `action_required`"

Same-repo Copilot PRs can get stuck waiting for a maintainer to approve running workflows. The `pr-trusted-rerun.yml` workflow provides a maintainer backstop:

1. Go to **Actions → PR Trusted Rerun → Run workflow**.
2. Enter the PR number. The workflow re-runs all `action_required` checks for the current PR head SHA using `github.token` (`actions: write`) — no PAT or speculative push required.

See [`.github/workflows/pr-trusted-rerun.yml`](../../.github/workflows/pr-trusted-rerun.yml) for the full implementation. If re-running does not clear the gate, the block is set at the repository settings level (Settings → Actions → General → "Fork pull request workflows") and requires a human maintainer to adjust.
