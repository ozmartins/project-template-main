# ADR-0114: Copilot cancelled CI guidance

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Factory Process Reviewer
- **Supersedes / Superseded by:** None

## Context

Nightly process review found repeated Copilot PR round-trips where required checks were externally or concurrency-cancelled and then treated as PR-fix work. PRs #1056, #1059, #1070, #1071, and #1072 all received fix-CI nudges for cancelled latest-head runs. The existing Copilot instructions covered failures that also occur on `main` and `action_required` gates, but not cancelled runs with no code/test failure.

## Decision

We add a narrow Copilot instruction requiring cancelled required checks to be classified as cancellation evidence before code changes, and requiring agents to comment with rerun evidence instead of pushing unrelated commits just to retrigger CI.

## Consequences

Copilot responses to cancelled latest-head runs should stay evidence-based and scoped. Reviewers still need to rerun or approve workflows when GitHub cancellation or concurrency behavior prevents green checks, but Copilot should no longer convert those events into unnecessary implementation churn.

## Alternatives considered

Relying only on shared CI attribution tooling was rejected because direct PR comments can still ask Copilot to fix cancelled checks. Adding broader CI troubleshooting guidance was rejected because the observed gap is specific to cancelled runs, and speculative process rules are intentionally avoided.

## Evidence

- `.github/copilot-instructions.md`
- PRs #1056, #1059, #1070, #1071, and #1072 showed cancelled-check fix-CI nudges during the 2026-06-23 nightly process review window.
