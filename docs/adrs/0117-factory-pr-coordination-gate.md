# ADR-0117: Factory PR Coordination Gate

- **Status:** Proposed
- **Date:** 2026-06-24
- **Deciders:** Factory Architect
- **Supersedes / Superseded by:** Expands ADR-0110 and ADR-0113 if accepted

## Context

Trend issue #1049 grouped four tickets in 24 hours that all pointed at the same control-plane gap: the factory lets multiple open Copilot PRs collide on shared mutable surfaces and only discovers the problem after review churn begins. The observed failures span three related classes:

1. same-path collisions on shared files
2. constrained-namespace collisions such as duplicate ADR numbers
3. stale-branch and post-conflict contamination that return to review without an objective scope check

The repository already has partial protections. ADR-0110 covers protected-path collision checks and ADR-0113 adds a conflict-refresh detection stage, but those decisions remain narrow and separate. The trend now requires one queue-level contract that coordinates collisions, stale branches, and post-conflict scope safety together.

## Decision

We add one factory PR coordination gate ahead of normal review routing in the fast pipeline.

The gate uses open GitHub PR state plus machine-readable PR comments as the source of truth, detects collisions across an explicit shared-path registry, protected and sensitive same-path edits, and constrained namespaces such as ADR numbering, and records a changed-file baseline before refresh or conflict repair. A PR may return to review only if its post-repair changed-file set is identical to or narrower than that baseline; otherwise it is re-kicked from fresh `main`.

## Consequences

- The factory gets one deterministic coordination contract instead of separate fixes for docs collisions, ADR-number churn, and stale-branch contamination.
- Shared-surface coordination stays intentionally narrow; the registry must remain explicit so normal application development is not serialized.
- The design avoids a new persistence service by storing evidence in machine-readable PR comments, which keeps GitHub as the control-plane source of truth.
- PR-handler remains the owner of the refresh action path, while the coordination gate owns earlier detection and baseline recording.
- If accepted, future implementations that touch this contract should be reviewed against this ADR rather than ADR-0110 or ADR-0113 alone.

## Alternatives considered

- **Keep separate symptom-level fixes.** Rejected because the same collision family is already appearing across multiple tickets and shared surfaces.
- **Serialize all open Copilot PRs.** Rejected because it would protect against collisions by destroying throughput.
- **Add a separate stateful coordination service.** Rejected because GitHub PR state plus machine-readable comments are sufficient and better aligned with the factory's GitOps-style control plane.

## Evidence

- Issue #1049 - `Trend: shared-surface PR collisions are spawning mergeability/process churn`
- `docs/specs/factory-pr-coordination-gate.md`
- ADR-0110 - `Copilot checks protected paths for open PR collisions`
- ADR-0113 - `Copilot PR Conflict-Refresh Detection Stage`
