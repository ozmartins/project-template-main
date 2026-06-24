# ADR-0109: Copilot keeps PR comments scoped around pre-existing CI failures

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Factory Process Reviewer
- **Supersedes / Superseded by:** None

## Context

The nightly process review found multiple Copilot PRs where a pre-existing `Markdown docs lint` failure on `main` was handled as a PR-local CI fix after PR comments asked Copilot to repair CI. That expanded unrelated PR diffs into `docs/devsecops/security-controls.md` even when the branch did not introduce the failing check. Existing instructions already required comparing failing checks against `main`, but did not explicitly cover the response path when a PR comment asks Copilot to fix unrelated CI anyway.

## Decision

We clarify `.github/copilot-instructions.md` so Copilot must keep the PR diff scoped to the assigned issue and respond with `main` failure evidence when the same check is already failing on `main`, even if a PR comment asks it to fix CI.

## Consequences

This reduces avoidable review round-trips and out-of-scope edits caused by baseline CI failures. Reviewers and agents must file or use a separate follow-up for the baseline breakage instead of laundering unrelated fixes through active implementation PRs.

## Alternatives considered

Leaving the existing instruction unchanged was rejected because the last-24h incidents showed the generic rule was not specific enough for PR-comment-driven CI remediation. Filing only a process roll-up was rejected because an existing roll-up already covers the pattern and the instruction can be clarified immediately.

## Evidence

- `.github/copilot-instructions.md`
- PR #1003, PR #1004, PR #1005, and PR #1008 received or answered CI-fix nudges involving a `Markdown docs lint` failure already present on `main`.
- Existing roll-up issue #995 was updated with the repeated evidence.
