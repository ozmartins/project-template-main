# Factory Activation Guide

This document explains how to activate the autonomous GitHub factory pipeline in a new fork of this repository. The factory automates: issue triage, Copilot code assignment, tech review, and PR merge.

---

## What the factory does

1. **Product Owner** (every 15 min): triages new issues, assigns `queue:development` + `ready-for-dev` labels.
2. **Project Manager** (every 15 min): assigns `ready-for-dev` issues to the GitHub Copilot coding agent, monitors PR progress, readies drafts, nudges Copilot on failures.
3. **PR Handler** (every 15 min per open PR): reviews code, approves or requests changes, merges when CI passes and reviews are satisfied.
4. **Tech Reviewer** (optional, in `workflows-available/`): performs deep architectural review for complex PRs.

---

## Required secrets

These two secrets must be set on the repository before any factory pipeline runs will do real work.

| Secret name | What it is | Required scopes |
|---|---|---|
| `COPILOT_TOKEN` | GitHub token that authenticates the Copilot SDK agent runner | `repo`, `issues:write`, `pull-requests:write` — must belong to an account with GitHub Copilot for Business enabled |
| `PROJECT_MANAGER_PAT` | Personal Access Token for a service account (or the org bot) that acts as the factory's "manager" identity | `repo`, `issues:write`, `pull-requests:write`, `write:discussion` |

### How to set secrets

```bash
# Set via GitHub CLI (run once per fork):
gh secret set COPILOT_TOKEN --repo <org>/<repo>
gh secret set PROJECT_MANAGER_PAT --repo <org>/<repo>
```

Or via **GitHub UI**: Repository → Settings → Secrets and variables → Actions → New repository secret.

---

## How issues flow to Copilot

```
Open issue (any label state)
    ↓
Stage 1 — product-owner (pipeline-fast, every 15 min)
    - adds: queue:development, ready-for-dev, priority:*
    - repairs Initiative → Epic → Story board hierarchy
    ↓
Stage 2 — pr-handler, one fresh session per open PR oldest-first (pipeline-fast)
    - reviews code, ADRs, test coverage for each PR
    - readies settled green drafts
    - merges approved PRs or routes to specialist lane
    ↓
Stage 2 — project-manager, runs after pr-handler loop (pipeline-fast)
    - assigns copilot-swe-agent[bot] to ready-for-dev issues up to concurrency cap
    - cleans up stale assignments (Copilot assigned >4h with no PR opened)
    ↓
    Copilot opens a draft PR for each assigned issue
    ↓
    (next pipeline-fast pass — Stage 2 again)
    pr-handler detects settled green draft → gh pr ready <number>
    pr-handler reviews → approves or requests changes
    pr-handler merges, or adds queue:review for Tech Reviewer
    ↓
main branch
```

---

## Activation checklist

- [ ] 1. **Set `COPILOT_TOKEN` secret** — Copilot SDK auth. Without this, all agent stages skip silently.
- [ ] 2. **Set `PROJECT_MANAGER_PAT` secret** — gh CLI auth for the manager identity. Without this, `gh issue edit`, `gh pr merge`, and incident filing all fail.
- [ ] 3. **Enable GitHub Copilot coding agent** on the repository — GitHub UI: Settings → Copilot → Enable Copilot coding agent for this repo.
- [ ] 4. **Allow bot and Copilot PR workflows to run without approval** — GitHub UI: Settings → Actions → General → Fork pull request workflows from outside collaborators → set to **"All contributors"** (or at minimum "Known contributors"). Without this, every Copilot coding agent PR will be stuck at `action_required` and generate repeated `ci-action-required-gate` incidents. This cannot be resolved by re-running workflows from the agent; it requires a maintainer to update this setting and then manually re-run any stuck workflow runs. See the [README: Copilot and bot PR workflow approval](../README.md#copilot-and-bot-pr-workflow-approval) section for the full remediation path including API commands.
- [ ] 5. **Configure GitHub Labels** — see `.github/LABELS.md` for the full label reference. The factory uses `queue:*`, `ready-for-dev`, `needs-triage`, `priority:*`, `test-gap`, `auto:alert`, and specialist review labels. Run the label bootstrap script:
  ```bash
  bash .github/scripts/bootstrap-labels.sh
  ```
  (Create this script if it doesn't exist yet — see below.)
- [ ] 6. **Set `E2E_BASE_URL` in the `dev` environment variables** — the URL of the deployed dev frontend, e.g. `https://dev.yourapp.example.com`. Without this, E2E runs against blank and file incidents with empty URLs.
  ```bash
  gh variable set E2E_BASE_URL --repo <org>/<repo> --env dev --body "https://dev.yourapp.example.com"
  ```
- [ ] 7. **(Optional) Set E2E secrets** — only needed once a dev environment is deployed:
  ```
  E2E_AUTH_EMAIL, E2E_AUTH_PASSWORD
  E2E_READONLY_EMAIL, E2E_READONLY_PASSWORD
  E2E_MANAGER_EMAIL, E2E_MANAGER_PASSWORD
  E2E_OPERATOR_EMAIL, E2E_OPERATOR_PASSWORD
  E2E_MFA_CODE (optional, used when the E2E account receives an MFA challenge)
  ```
- [ ] 8. **(Optional) Activate additional workflows** from `workflows-available/` — copy the file into `workflows/` and include the ADR justification in the same PR. See `workflows-available/WORKFLOWS.md` for the catalog.

---

## What "succeeds but does nothing" looks like

Before secrets are configured, the pipeline workflows will all show green (success) in GitHub Actions, but the agent run log will contain:

```
{"msg":"COPILOT_GITHUB_TOKEN not set — skipping agent run"}
```

This is intentional (fail-open for new forks) but means the factory is not active. Check the job step summary for the "Agent skipped" notice.

---

## Verifying the factory is active

1. Open an issue with no labels.
2. Wait up to 15 minutes (one pipeline-fast pass).
3. Confirm: the issue has been labelled (`queue:development`, `ready-for-dev`, `priority:*`).
4. Wait another 15 minutes (second pass).
5. Confirm: `copilot-swe-agent[bot]` is assigned to the issue and a draft PR has opened.

If step 3 doesn't happen, check: Settings → Actions → General → "Allow all actions" (confirm the `COPILOT_TOKEN` and `PROJECT_MANAGER_PAT` secrets are set and have the right scopes).

---

## Clearing `action_required` on same-repo Copilot PRs

If a same-repo Copilot pull request opens but its required PR workflows stop at `action_required`, use the manual backstop workflow:

1. Open **Actions** → **PR - Trusted rerun for Copilot gate**.
2. Click **Run workflow** and provide the pull request number.
3. The workflow re-runs every `pull_request` run for that PR head SHA whose conclusion is `action_required`.
4. Record the first re-run that starts normally, then escalate the repository/org Actions approval settings if new Copilot PRs still land in `action_required`.

This workflow is a trusted maintainer-side re-trigger path for the known approval-gate regression. It does **not** replace the underlying settings fix.

---

## `COPILOT_TOKEN` requirements

The `COPILOT_TOKEN` is the credential that the Copilot SDK uses to spawn agent sessions. It must:
- Belong to a user account (or service account) with an **active GitHub Copilot for Business** seat on the organisation.
- Have `repo`, `issues:write`, and `pull-requests:write` scopes.
- Be an **OAuth user token** (`gho_` prefix) — classic PATs (`ghp_`) and fine-grained PATs are both rejected by the Copilot SDK endpoint with `400: Personal Access Tokens are not supported for this endpoint`.

The easiest way to get the right token: run `gh auth token` on a machine where you're logged in to GitHub CLI with Copilot scopes. The output is a `gho_` token you can pipe directly to `gh secret set COPILOT_TOKEN`.

```bash
gh auth token | gh secret set COPILOT_TOKEN --repo <org>/<repo>
```

The account that holds `COPILOT_TOKEN` is the identity that will appear as the author of Copilot's actions (comments, label changes) when the agent acts via the SDK. Keep it separate from `PROJECT_MANAGER_PAT` so the two identities are distinguishable in the audit log.

---

## `PROJECT_MANAGER_PAT` requirements

Used for `gh` CLI calls in the pipeline (issue edits, PR merges, label management, incident filing). It must:
- Have `repo`, `issues:write`, `pull-requests:write` scopes.
- **Not** be the same token as `COPILOT_TOKEN` — GitHub rejects self-approval on PRs authored by the same identity.
- Be a **classic PAT** or a GitHub App installation token.

The factory uses this token to approve and merge PRs authored by the Copilot coding agent. The self-approval fallback (ADR-0027) applies: when `PROJECT_MANAGER_PAT`'s identity is also the PR author, the tech-reviewer adds the `tech-approved` label instead of a formal GitHub review approval.

---

## Repeating this in a new fork

Every fork of this template starts with no secrets. The checklist above is the complete activation path. The only fork-specific configuration is:
1. `COPILOT_TOKEN` and `PROJECT_MANAGER_PAT` secrets (service accounts differ per org)
2. `E2E_BASE_URL` variable in the `dev` environment (different URL per deployment)
3. Kubernetes and cloud infra variables in `factory.yml` (replace all `<PLACEHOLDER>` values)

Everything else — the pipeline workflows, agent instructions, ADRs, test strategy — is inherited from the template unchanged.
