# ADR-0118: Dependency Update Scope Contract

- **Status:** Proposed
- **Date:** 2026-06-24
- **Deciders:** Factory Architect
- **Supersedes / Superseded by:** None

## Context

Trend issue #1080 grouped three dependency-update tickets in 24 hours that all stem from one missing contract: the repository does not enforce a single package-scoped diff envelope for dependency work. As a result:

- Dependabot can fail before PR creation because the repository layout or diff scope is invalid for the intended update lane.
- Copilot and dependency PR reviewers can see unrelated lockfile drift or protected-path edits mixed into narrow dependency changes.
- the same scope-drift family is rediscovered as separate update failures, noisy PRs, and protected-path collisions

Existing controls are adjacent but incomplete. ADR-0080 governs OSV vulnerability scanning for PR lockfile changes, and repository instructions say lockfiles are in scope only when justified by dependency intent, but there is no one authoritative lane model or diff classifier shared across Dependabot and Copilot dependency work.

## Decision

We make `.github/dependabot.yml` the canonical dependency lane model and enforce one lane-local dependency diff contract with two repository-owned enforcement points: a lane-integrity preflight before scheduled Dependabot runs and a shared PR diff classifier in the fast pipeline.

Each dependency PR must map to exactly one lane identity (`ecosystem + directory + optional group`). Allowed changes are limited to the lane root: manifest updates, corresponding lockfiles, and package-local compatibility fixes required to keep that lane green. Copilot-created dependency PRs may carry lockfile-only diffs only when the PR body includes an explicit `Dependency-Scope-Justification:` trailer; unrelated cross-root or protected-path drift remains out of contract.

## Consequences

- Dependency work is classified once against a canonical lane model instead of being judged differently by Dependabot, PR-handler, and Copilot prompts.
- Protected-path package lanes remain possible when they are intentionally rooted there, but unrelated control-plane drift is blocked.
- Dependabot failures can be surfaced as actionable lane-integrity findings before PR creation attempts, reducing vague `create_pull_request` failures.
- The repository takes on a new obligation to keep `.github/dependabot.yml` structurally valid as a lane source of truth.

## Alternatives considered

- **Prompt-only or reviewer-only guidance.** Rejected because it leaves the rule non-deterministic and repeats the same review churn.
- **Independent rules per producer.** Rejected because Dependabot and Copilot would drift into different scope policies.
- **Repository-wide dependency serialization.** Rejected because the problem is scope drift, not parallelism itself.

## Evidence

- Issue #1080 - `Trend: dependency-update scope drift is spawning invalid and noisy PR work`
- `docs/specs/dependency-update-scope-contract.md`
- ADR-0080 - `OSV dependency review gate for PR lockfile changes`
- `.github/dependabot.yml`
