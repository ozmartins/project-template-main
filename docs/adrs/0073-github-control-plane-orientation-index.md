# ADR-0073: `.github/README.md` is the factory control-plane orientation index

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The repository’s factory control plane lives under `.github/` and contains active
workflows, agent instruction files, and factory configuration. Contributors
typically enter this area from the GitHub web UI, where a directory-level
`README.md` is rendered automatically.

Without a local orientation index in `.github/`, contributors must infer control-
plane ownership and navigation from raw file trees. That increases onboarding
cost and raises the risk of edits that drift from factory governance patterns.

## Decision

We treat `.github/README.md` as the canonical orientation index for the factory
control plane. It must concisely document the control-plane purpose, key
subdirectories/files, and agent roster with current pipeline context.

## Consequences

- Contributors get a single, first-open index for control-plane navigation and
  role ownership.
- Control-plane maintainers are obligated to keep `.github/README.md` aligned
  whenever control-plane paths, workflow activation state, or agent roles/
  pipeline placement change.
- Reviews for control-plane changes should verify this index remains accurate as
  part of merge readiness.

**Rollback:** If the index becomes stale or materially misleading, revert to the
last known-correct version of `.github/README.md` (or remove the file
temporarily) until a corrected index is restored in a follow-up PR.

## Alternatives considered

- Keep orientation information only in root-level docs: rejected because users
  entering `.github/` do not automatically land on root documentation context.
- Leave `.github/` unindexed: rejected because control-plane discoverability and
  ownership mapping remain inconsistent.

## Evidence

- `.github/README.md` — control-plane orientation index added for `.github/`
- `docs/architecture/software-factory.md` (linked from `.github/README.md`) —
  full factory flow reference
- Issue: `#414`
