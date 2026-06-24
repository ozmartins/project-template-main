# ADR-0054: Use supabase/setup-cli v2 in control-plane workflows

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The `pr-validation` control-plane workflow uses `supabase/setup-cli` to install the Supabase CLI on GitHub-hosted runners before running integration tests against the local Supabase stack. This PR moves the action from major version 1 to 2.

Because `.github/workflows/pr-validation.yml` is a control-plane boundary, this major action-version change must be explicitly captured as an ADR in the same PR, per ADR-0044.

The job that uses this action runs on `pull_request` and `push` triggers with read-only repository permissions. `GITHUB_TOKEN` is used only to satisfy the action's authentication requirements during CLI setup; no deployment credentials or write-scoped tokens are passed.

## Decision

We use `supabase/setup-cli@v2` in `.github/workflows/pr-validation.yml` for the Supabase CLI installation step.

## Consequences

- Keeps the workflow aligned with the current major release of `supabase/setup-cli`.
- The job's permission scope and token usage are unchanged — `GITHUB_TOKEN` with read-only access, on `pull_request`/`push` triggers only.
- Future major-version bumps to this action will require a new ADR following the same ADR-0044 process.

**Rollback:** If `supabase/setup-cli@v2` causes auth integration or CLI setup regressions, pin `.github/workflows/pr-validation.yml` back to `supabase/setup-cli@v1` and document the reason in a superseding ADR.

## Alternatives considered

- Keep `supabase/setup-cli@v1`: rejected because this PR is a dependency major-version update aiming to track the current supported release.
- Defer ADR creation: rejected because ADR-0044 mandates ADR coverage in the same PR for all control-plane workflow major-version upgrades.

## Evidence

- `.github/workflows/pr-validation.yml` — `supabase/setup-cli@v1` → `supabase/setup-cli@v2`
- Pull request: `chore(deps): Bump supabase/setup-cli from 1 to 2`
- ADR-0044: [Control-plane Workflow Action Major-Version Upgrades Require In-PR ADRs](./0044-github-actions-control-plane-major-upgrades.md)
