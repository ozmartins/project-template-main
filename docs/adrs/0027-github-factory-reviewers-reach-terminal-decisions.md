# ADR-0027: Factory Reviewers Reach Terminal Decisions In-Lane

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

Early factory designs had reviewers (tech-reviewer, security-reviewer, database-steward) defer decisions: they would comment, request changes, and then wait for a human to confirm the resolution before proceeding. This created a perpetual "pending review" state — PRs queued for human confirmation that never came. The review queue grew; the factory stalled.

## Decision

Each reviewer agent **reaches a terminal decision in its own lane** and does not wait for human confirmation of that decision before clearing the lane:

- **Tech Reviewer**: approves the PR (or requests changes with specific, actionable items) in a single pass. Does not request changes and then await a human response before acting again — if the requested change is addressed in a subsequent commit, the next sweep approves.
- **Security Reviewer**: either clears `needs-security-review` (no blocking findings) or files a `priority:high` issue and holds the label. Does not ask "should I block this?" — it decides.
- **Database Steward**: clears `needs-database-review` when satisfied. Does not escalate to a human unless the migration is genuinely destructive (which requires `needs-database-review` to stay).
- **Platform Engineer**: clears `needs-platform-review` when the infra change is sound.

**Human escalation** is reserved for: findings above a severity threshold, explicitly destructive operations (production data changes, secrets rotation), and situations where the reviewer's confidence is below a defined threshold (documented per-agent in the `.agent.md` charter).

**Self-approval fallback**: when a PR's author identity matches the factory PAT, GitHub rejects `gh pr review --approve`. In this case, the tech-reviewer applies the `tech-approved` label and posts a summary comment instead of a formal approval. Downstream agents treat `tech-approved` identically to a formal PR approval.

## Consequences

**Positive:**
- The review queue drains continuously. PRs do not accumulate waiting for human confirmation.
- Agent decisions are auditable — every label change and comment is a GitHub event. Humans can review decisions asynchronously without being in the critical path.
- The factory operates at the cadence of the pipeline (*/15 min) rather than human responsiveness (hours/days).

**Negative:**
- An incorrect agent decision (false approval, false clearance) reaches main without a human check. The CI test suite (ADR-0014) and the architecture audit are the downstream quality gates.
- Agents must be calibrated to avoid both under-blocking (missing real issues) and over-blocking (flagging irrelevant findings that stall valid work). This calibration is maintained in the `.agent.md` charters.
- The `tech-approved` label fallback is a social convention, not a GitHub-enforced gate. A branch protection rule that requires at least one human review cannot be satisfied by the factory PAT alone.

## Alternatives considered

**All decisions require human confirmation:** Safe but defeats the purpose of automation. The factory degenerates to a notification system.

**Tiered confidence thresholds with escalation:** Valid model but adds complexity. The simpler rule — "decide in-lane, escalate only above threshold" — achieves the same result with less machinery.

## Evidence

- `.github/agents/tech-reviewer.agent.md` — approval criteria, self-approval fallback
- `.github/agents/security-reviewer.agent.md` — blocking thresholds
- `.github/agents/database-steward.agent.md` — migration review rules
- ADR-0011 — label-driven routing that implements the "lane" model
