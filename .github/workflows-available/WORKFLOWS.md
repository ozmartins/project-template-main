# Available Workflows

Workflows in this directory are **dormant** — GitHub does not run them. To activate one,
copy it to `.github/workflows/` and commit the change (which requires an ADR per
`copilot-instructions.md`).

---

## `agent-tech-reviewer.yml`

**What it does:** Runs the Tech Reviewer agent on an event-driven trigger (fires immediately
when "CICD - Build Images" CI completes) plus a 15-minute cron backstop. Serialises sweeps so a
CI wave doesn't fan out to 40+ parallel runs and trip SDK rate limits.

**Prerequisites:**
- `COPILOT_TOKEN` secret (GitHub Copilot API token)
- `PROJECT_MANAGER_PAT` secret (PAT with `pull-requests: write`, `issues: write`)

**Enable:**
```bash
cp .github/workflows-available/agent-tech-reviewer.yml .github/workflows/agent-tech-reviewer.yml
```

---

## `code-quality.yml`

**What it does:** Nightly (04:00 UTC) static-analysis battery — CodeQL, tsc, eslint,
ruff, shellcheck, hadolint, gitleaks, semgrep, Trivy, npm-audit, pip-audit. Results are
aggregated by `quality-compute.mjs`, recorded to the `ci-history` branch as a `quality`
record, and then the `code-quality-reviewer` agent files deduped tickets for the
highest-leverage findings. **Nothing here gates a merge.**

**Prerequisites:**
- `COPILOT_TOKEN` secret
- `PROJECT_MANAGER_PAT` secret
- `qa-targets.json` present (already in this repo at `.github/qa-targets.json`)

**Enable:**
```bash
cp .github/workflows-available/code-quality.yml .github/workflows/code-quality.yml
```

---

## `visual-ux.yml`

**What it does:** Daily Playwright screenshot capture at two breakpoints (mobile + desktop),
then the `ux-vision-reviewer` agent reviews the screenshots and files deduped UX tickets.
Non-gating.

**Prerequisites:**
- `COPILOT_TOKEN` secret
- `PROJECT_MANAGER_PAT` secret
- `playwright.visual.config.ts` in the `frontend/` directory (a Playwright config that
  navigates to each screen and captures a screenshot — this must be written for your app)
- A deployed dev environment accessible from GitHub-hosted runners

**Enable:**
```bash
cp .github/workflows-available/visual-ux.yml .github/workflows/visual-ux.yml
```
Then create `frontend/playwright.visual.config.ts` pointing at your dev URL.
