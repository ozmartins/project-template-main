# Copilot Instructions

These instructions are for Copilot coding agent work in `<ORG>/<REPO_NAME>`.

## Vision
Read [`docs/vision.md`](../docs/vision.md). Consult this document before beginning any implementation task. Decisions that conflict with these principles require an ADR.

## Start Here
Read these before changing code:

1. `README.md`
2. The assigned issue, all comments, linked PRs, linked epics, and acceptance criteria
3. `docs/specs/software-creation-factory.md` when the issue touches agents, workflows, GitHub Projects, deployment, or factory behavior
4. `DATABASE.md` and `Guide_for_agents_using_supabase_template.md` when the issue touches Supabase schema, migrations, facts, entities, relationships, or seed data

## Role
You are an implementation worker. Product direction, architecture, review routing, release promotion, and environment operations are handled by the factory agents.

Do not invent product scope. Implement the assigned issue as narrowly as possible.

## Ticket Readiness Gate
Before making changes, inspect labels and issue content.

Stop and comment instead of opening a PR if any of these are true:

- The issue has `needs-triage`, `needs-info`, `needs-design`, `design-in-progress`, `blocked`, `needs-security-review`, `needs-database-review`, or `needs-platform-review`.
- The issue lacks clear acceptance criteria.
- The issue is an epic without concrete child-story scope.
- The issue asks for architecture, roadmap, release coordination, or investigation only.
- Another open PR already targets the issue.
- You already have 3 or more open Copilot PRs.

If the issue has `queue:architecture` or asks for design/spec/ADR work, produce only the requested design artifact or issue comment. Do not implement application code unless the issue explicitly says the design is approved and implementation is in scope.

## Required Preflight
Run these checks before editing:

```bash
gh pr list --search "#<issue-number>" --state open
gh pr list --author "@me" --state open --json number --jq length
git status --short
```

If `git status --short` shows unrelated changes, do not overwrite or revert them. Work around them or stop and explain.

Verify whether the issue is already fixed on `main`. If no code change is needed, comment with evidence and close only if the issue clearly allows it.

> **Factory guardrail:** The pipeline enforces this check at the factory layer (ADR-0115). A Copilot PR with `changedFiles === 0` is detected by `evaluatePrPreflight` and automatically closed with a `[factory-reconciliation-guard]` evidence comment before any LLM session is launched. `assign_to_copilot` also checks recently-merged PRs (7-day window) and blocks re-assignment when the issue is already covered. Do not rely on the factory to catch what you can confirm before opening the PR.

## Clean Session Bootstrap And Contamination Recovery
- Every new Copilot assignment must begin from a fresh checkout of the current base branch.
- Do not rely on reused local state, old branches, or leftover uncommitted workspace changes from prior attempts.
- If contamination/conflict evidence appears (for example a contaminated branch state or merge conflicts against base), do **not** recover by rebasing the existing branch. Close the PR and request a clean re-kick from base.
- When a re-kick happens, include explicit evidence and the clean re-kick action in PR/issue comments so the recovery is auditable.

## Resolving Merge Conflicts
When resolving a merge conflict during `git merge origin/main` or `git rebase`:
- **Do not remove or alter jobs, steps, or files that exist on main and are not in scope for this PR.** Conflicts in unrelated sections must be resolved by keeping both sides (or taking main's version for files this PR does not touch).
- After resolving, run `git diff origin/main -- <file>` on every conflicted file and confirm the only changes are the ones this PR intended.
- If a file was accidentally modified beyond the PR's scope during conflict resolution, revert the extra changes before pushing: `git checkout origin/main -- <file>` then re-apply only the intended change.
- For auto-generated files (e.g. `routeTree.gen.ts`), always take `origin/main`'s version: `git checkout origin/main -- <path>`.

## Scope Rules
- Change only files needed for the assigned issue.
- If the issue says to update one file, update only that file.
- Do not perform broad refactors, dependency upgrades, styling rewrites, or workflow rewrites unless explicitly requested.
- Do not commit generated outputs such as coverage reports, build artifacts, screenshots, or test result bundles unless the issue explicitly asks for them; remove accidental generated files from the index and add or update ignore rules when appropriate.
- Treat lockfiles as in scope only when a package manifest or dependency change is required by the issue. If a lockfile changes without a corresponding manifest change, restore it to `origin/main` before opening or updating the PR and mention the restoration in the PR/comment if a reviewer flagged it.
- Do not create or modify Kubernetes deployment, Azure, runner, or production files unless the issue explicitly asks for that work.
- Do not write secrets, tokens, connection strings, private keys, or real credentials into the repository.
- If your approved implementation introduces or changes an architectural decision (infra, library/service choice, deploy/security/data boundary), include or update ADRs in `docs/adrs/` using `docs/adrs/TEMPLATE.md` and reference the ADR path in your PR.
- ADRs are immutable once Accepted. To change an Accepted decision, add a superseding ADR and update the old ADR status/history metadata; do not rewrite the accepted ADR body.
- **Any change under `.github/workflows/**` (CI gates, validation jobs, pipeline behavior) is a control-plane boundary: include the ADR in the SAME PR, up front.** Reviewers block control-plane PRs that lack one, and each blocked round-trip costs the queue hours — write it with the change, not after the review asks.
- **Any change under `.github/agents/**` that changes a factory agent contract, routing decision, prompt guardrail, or review/filing behavior is also a control-plane boundary: include the ADR in the SAME PR, up front.** Keep the ADR focused on the contract delta and update `docs/adrs/README.md` with the new entry.
- **Any change to `.github/copilot-instructions.md` that changes agent operating rules, repository policy, or review routing is also a control-plane boundary: include the ADR in the SAME PR, up front.** Keep the ADR focused on the policy delta and update `docs/adrs/README.md` with the new entry.
- Before adding or modifying a protected or sensitive path, check whether any open PR already changes the same path: `gh pr list --state open --json number,files --jq '.[] | {number, files: [.files[].path]}'`. If another PR owns that path, stop and comment with the collision instead of creating a competing change; this includes `.github/workflows/**`, `.github/agents/**`, `charts/**`, `terraform/**`, deployment files, and other paths listed in Protected And Sensitive Paths.
- For factory agent workflow stages, prefer the job-scoped `GITHUB_TOKEN` with explicit minimal `permissions:`. Do not set `GH_TOKEN` to broad PAT secrets such as `PROJECT_MANAGER_PAT` unless the issue explicitly requires capabilities unavailable to `GITHUB_TOKEN` and the same PR's ADR documents the elevated runtime identity.
- When numbering a new ADR, run both of these checks and take the next number above the highest result from either:
  ```bash
  # Highest number currently on main
  git ls-remote origin main | xargs -I{} git ls-tree -r --name-only {} -- docs/adrs/ 2>/dev/null | grep -Eo '^docs/adrs/[0-9]+' | grep -Eo '[0-9]+' | sort -n | tail -1
  # Highest number claimed by any open PR
  gh pr list --state open --json files --jq '.[].files[].path' | grep 'docs/adrs/' | grep -Eo '/[0-9]+' | grep -Eo '[0-9]+' | sort -n | tail -1
  ```
  Concurrent PRs picking the same next number is a recurring merge-conflict source. Do not rely on local file listing — it reflects your branch state, not main or other PRs. Repeat the open-PR ADR-number check immediately before pushing or requesting review on any branch that adds or renames an ADR; if another open PR now claims the same number, rename your ADR and update `docs/adrs/README.md` before review.

## Repository Stack
This repository is a template with:

- Frontend: Vite, React, TanStack Router/Query, JSON-driven UI engine under `frontend/src/engine/`
- Worker: Python Temporal worker under `temporal/src/`
- Database: Supabase/Postgres migrations under `supabase/migrations/`
- Local runtime: Docker Compose and Makefile wrappers
- Deployment: Kubernetes profile is future work unless the issue explicitly enables it

## Test And Validation Rules
Every behavior change must include tests. If the required test framework is missing, add the smallest practical test setup or explain in the PR why test coverage could not be added.

Use the most relevant available checks:

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
python -m pytest temporal/tests
make up
make down
```

Run only checks that are relevant and available. If a command is missing or dependencies are not installed, either add the minimal required setup as part of the PR or state the limitation clearly in the PR body.

### Frontend
- Add or update tests for user-visible behavior, data rendering, route behavior, or engine behavior.
- Prefer focused component/unit tests over broad snapshots.
- Preserve existing TanStack Router and JSON-driven UI engine patterns.
- Use accessible semantic HTML and keyboard-friendly controls.
- Use existing styling conventions and shared utilities before adding new styling systems.

### Temporal Worker
- Add tests under `temporal/tests` for workflow/activity behavior.
- Keep logs single-line and structured enough for grep.
- Do not make network calls in tests unless the issue explicitly requires integration behavior.
- Keep Temporal task queue, namespace, and environment variable names configurable.

### Supabase And Database
- Add new migrations; do not edit shipped migrations unless the issue explicitly asks for a correction before release.
- Keep SQL snake_case.
- UUID primary keys should use `gen_random_uuid()`.
- Use `created_at` and `updated_at` timestamps where appropriate.
- Prefer additive, reversible schema changes.
- Avoid data loss. If destructive changes are unavoidable, require explicit issue approval and document rollback.
- Explain seed data impact in the PR.
- For flexible payloads, prefer `jsonb`; for numeric facts, use clear fact type references.
- Respect the entity/SCD2 model described in `DATABASE.md` and `Guide_for_agents_using_supabase_template.md`.

## Factory Workflow Rules
The factory uses queues and review labels. Respect them.

- `queue:development` + `ready-for-dev` means implementation can proceed.
- `queue:architecture` means design/spec/ADR work, not implementation.
- `queue:security`, `queue:database`, `queue:platform`, `queue:qa`, or `queue:release` means specialist work is expected; do not bypass those lanes.
- If your change touches a specialist area, mention it in the PR and leave the appropriate review label in place.
- Do not remove `needs-security-review`, `needs-database-review`, or `needs-platform-review`; the corresponding reviewer removes those labels.

## Protected And Sensitive Paths
Changes to these paths require careful scope and human/specialist review:

- `.github/workflows/`
- `.github/agents/`
- `.github/tools/`
- `.github/copilot-instructions.md`
- `supabase/migrations/`
- `supabase/seed.sql`
- `temporal/`
- `docker-compose.yml`
- `docker-compose.dev.yml`
- `Makefile`
- future deployment paths such as `charts/`, `deploy/`, `ops/`, `platform/`
- security documentation or policy files

If the issue does not explicitly require touching these paths, avoid them.

## Runner And Deployment Policy
For the MVP factory, assume GitHub-hosted workflows by default.

Do not add self-hosted runners, Azure login steps, Kubernetes deploys, `kubectl`, Helm upgrades, production promotion, or runner remediation unless the issue explicitly asks for deployment/environment work.

Self-hosted runners are only for live environment access, private cluster access, deployment/rollback, private-network smoke tests, or host-level runner maintenance.

## Pull Request Requirements
Create a PR only after the implementation is coherent and relevant checks have been run or clearly documented.
Before opening or updating a PR, compare against the base branch with `git diff --name-only origin/main...HEAD` and confirm the diff is non-empty, matches the PR title/body, and includes the files required by the issue. If the diff is empty or shows unrelated files, do not ask for review; close/comment as already fixed or contamination instead. **The factory pipeline will also detect and close no-diff Copilot PRs automatically (ADR-0115), but you should verify this yourself first so you never open an empty PR in the first place.**

PR title:
- Use a short imperative title.
- Use `[WIP]` only if the issue explicitly asks for a partial PR.

PR body must include:

- **`Closes #<issue-number>`** — this is mandatory. It must appear in the PR body (not just a comment) so GitHub links the PR to the issue and the factory pipeline can track coverage. A PR that does not include this will be detected as a ghost assignment and re-kicked, wasting a session.
- What changed
- Why it changed
- Tests/checks run
- Any checks not run and why
- Risk and rollback notes
- Docs updated, or why no docs were needed
- Specialist review needed, if applicable

## Quality Bar
- Validate inputs.
- Parameterize database queries.
- Avoid XSS and unsafe HTML injection.
- Keep API and data contracts backwards compatible unless the issue explicitly asks for a breaking change.
- Keep logs single-line unless `docs/Logging.md` exists and says otherwise.
- Do not add noisy comments, duplicate issues, or duplicate PR feedback.
- Prefer small, reviewable PRs over large multi-feature changes.

## Assigning Copilot SWE to an issue

`gh issue edit --add-assignee Copilot` **does not work** — the CLI validates against the collaborators list and the bot is not listed there.

**Quick REST assignment** (sufficient for manual ad-hoc use — does not auto-start a session):
```bash
gh api repos/OWNER/REPO/issues/NUMBER/assignees -X POST --field 'assignees[]=Copilot'
```

**Full GraphQL assignment with session start** (use this for proper Copilot session with clean base checkout — used by the Project Manager agent):
```bash
ISSUE_ID=$(gh api repos/OWNER/REPO/issues/NUMBER --jq '.node_id')
COPILOT_NODE="BOT_kgDOC9w8XQ"   # Copilot bot node ID — stable across repos
REPO_ID=$(gh api repos/OWNER/REPO --jq '.node_id')
gh api graphql \
  -H 'GraphQL-Features: issues_copilot_assignment_api_support,coding_agent_model_selection' \
  -f query='mutation($issueId:ID!,$botId:ID!,$repoId:ID!,$base:String!) {
    addAssigneesToAssignable(input:{
      assignableId:$issueId, assigneeIds:[$botId],
      agentAssignment:{targetRepositoryId:$repoId, baseRef:$base}
    }) { assignable { ... on Issue { number } } }
  }' \
  -f issueId="$ISSUE_ID" -f botId="$COPILOT_NODE" -f repoId="$REPO_ID" -f base="main"
```

The canonical full mutation is in `.github/agents/project-manager.agent.md` (assignment step).

## Diagnosing CI Failures

Before treating a failing check as a blocker introduced by this PR, verify whether it also fails on `main`:

```bash
# Get the HEAD SHA on main and check its check-run conclusions
MAIN_SHA=$(git ls-remote origin main | cut -f1)
gh api repos/{owner}/{repo}/commits/$MAIN_SHA/check-runs --paginate \
  --jq '.check_runs[] | select(.name == "<failing check name>") | {name, conclusion}'
```

If the same check fails on `main`, it is **pre-existing** and not caused by this PR. Note this explicitly in the PR body or a comment — do not attempt to fix pre-existing failures that are outside the scope of the assigned issue, even if a PR comment asks you to fix CI. In that case, respond with the `main` failure evidence and keep the PR diff scoped to the assigned issue.

If required checks are `cancelled`, first determine whether the latest head run was externally or concurrency-cancelled before changing code. When logs show cancellation without a code/test failure, comment with the cancellation evidence and rerun requirement; do not push scope-expanding or unrelated commits just to retrigger CI.

When changing factory CI-baseline attribution code, preserve the existing triage contract: baseline-fetch failures must surface explicit warnings, job-level checks must still match parent workflow failures on `main` (`exact match` or `checkName.startsWith(mainName + " / ")`), and tests must cover each conclusion variant the change handles (including `failure`, `timed_out`, and `startup_failure`) on both the shared helper and tool-output path.

## Investigating action_required CI runs

When a Copilot PR has CI stuck at `action_required`:

1. **First try `gh run rerun` as the trusted actor** — this clears the gate when run by a repo member (not the Copilot bot):
   ```bash
   gh run rerun <run-id> --repo <owner>/<repo>
   ```
   If this moves the run from `action_required` to `in_progress`, the gate is cleared. Repeat for each `action_required` run.

2. **If `gh run rerun` does not help** (run stays `action_required` after rerun), the gate is set at the org/repo Settings level and requires a human to change **Settings → Actions → General → "Fork pull request workflows"** to not require approval for bot/Copilot PRs. Escalate with a comment on the PR.

`POST /repos/.../actions/runs/{id}/approve` only works for fork PRs (returns 403 for same-repo). Do not attempt it for same-repo PRs.
