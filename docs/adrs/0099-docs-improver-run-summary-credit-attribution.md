# ADR-0099: docs-improver run summary must record credit-attribution observations, not issue comments

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** docs-improver agent, factory maintainers
- **Supersedes / Superseded by:** Extends ADR-0095

## Context

ADR-0095 added a pre-comment state guard to `docs-improver`: the agent checks `gh issue view <n> --json state` and skips commenting when the issue is already `CLOSED`. That guard prevents the action but does not tell the agent where to record the observation instead.

A separate class of case also exists: the issue may still be `OPEN` at comment time, but the work was actually delivered by a PR the agent did not author. In that scenario the guard does not fire, yet posting a "Closed — work delivered" comment would still be incorrect attribution.

The `## Run summary (always)` section in the agent prompt previously listed what to include in the summary but did not explicitly state that credit-attribution and closed-issue observations belong there instead of as issue comments.

## Decision

We add a mandatory run-summary bullet to `.github/agents/docs-improver.agent.md`: if an issue's work was delivered by another PR or agent (not this agent), the agent logs the observation in the run summary only and never posts an issue comment claiming credit for that work.

This makes the "where does the observation go instead?" answer explicit, completing the contract started by ADR-0095.

## Consequences

- **Easier:** the agent has an unambiguous instruction for the "work done by other PR" case; audit trail remains clean in both the closed-issue path (ADR-0095 guard) and the open-issue/other-PR path (this rule).
- **Harder:** nothing — this is a prompt-only change; no tool calls or new logic are required.
- **New obligations:** the agent must not silently drop credit-attribution observations; they must appear in the run summary.
- **Normal operation unchanged:** the rule only applies when work was delivered by another PR/agent; the agent's own issue-creation and comment flows for open issues are unaffected.

## Alternatives considered

- **Extend the ADR-0095 guard to also check PR authorship** — rejected; PR-authorship lookup adds complexity and the simpler instruction (log in summary, never comment) achieves the same result with no extra tool calls.
- **Add no explicit guidance and rely on ADR-0095 spirit** — rejected; the run-summary section is the natural place for output instructions, and ambiguity here was the root cause of the original spurious comment.

## Evidence

- `.github/agents/docs-improver.agent.md` — `## Run summary (always)` section, new bullet added as part of issue #627 (this PR).
- ADR-0095 (`docs/adrs/0095-docs-improver-closed-issue-comment-guard.md`) — the pre-comment state guard this ADR extends.
