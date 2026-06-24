# ADR-0075: Factory Process Reviewer isolates write scope to a dedicated daily job

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** Supersedes ADR-0074

## Context

ADR-0074 allowed the nightly `factory-process-reviewer` to directly maintain
`.github/copilot-instructions.md`, but its first implementation granted
`contents: write` at the `pipeline-daily.yml` workflow level.

That made the earlier `docs-improver` and `user-docs-manager` stages inherit a
repo-write `GITHUB_TOKEN` even though those stages only need read access to the
repository contents plus issue-writing capability. Security review for the
rollout required explicit least privilege: the direct-to-main instruction
maintenance remains acceptable only if the write-capable behavior is isolated to
the reviewer execution on trusted scheduled/manual triggers.

## Decision

We keep `docs-improver` and `user-docs-manager` in a read-only `pipeline` job
and run `factory-process-reviewer` in a dedicated follow-on
`factory_process_reviewer` job with its own explicit `permissions:` block.

Only the reviewer job receives `contents: write`; the earlier job uses the
scoped `github.token` for read + issue-write behavior, while the reviewer keeps
the dedicated trusted token environment needed for direct instruction
maintenance.

## Consequences

- The daily pipeline now follows least privilege: non-mutating stages no longer
  inherit a write-capable `GITHUB_TOKEN`.
- The reviewer keeps the same cadence and trusted triggers (`schedule` and
  `workflow_dispatch`) without introducing another workflow file.
- Shared-runtime setup is duplicated across two jobs, which modestly increases
  runtime in exchange for clearer security boundaries.

## Alternatives considered

- Keep workflow-level `contents: write`: rejected because it gives unnecessary
  repository write scope to non-mutating stages.
- Split the reviewer into a separate scheduled workflow: rejected because a
  dedicated follow-on job provides the same least-privilege boundary with less
  control-plane duplication.

## Evidence

- `.github/workflows/pipeline-daily.yml` — read-only pipeline job plus dedicated
  write-capable reviewer job
- `.github/tools/shared/src/__tests__/factory-process-reviewer-foundation.test.ts`
  — contract coverage for permission isolation and job wiring
- `docs/adrs/0074-factory-process-reviewer-direct-instruction-maintenance.md` —
  superseded initial design
