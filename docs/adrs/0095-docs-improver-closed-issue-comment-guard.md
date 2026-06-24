# ADR-0095: docs-improver closed-issue guard — check state before any write action

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** docs-improver agent, factory maintainers
- **Supersedes / Superseded by:** —

## Context

The docs-improver agent posted a "Closed — work delivered" comment on issue #516 after it was already closed by a human following the merge of PR #517. Because the agent did not verify the issue's current state before commenting, it created a misleading audit entry that implied the agent had delivered the work (it had not — it only added missing workflow rows in PR #532). The project-manager agent can misread such comments as evidence of a resolved linkage.

Two distinct problems were identified:

1. The agent did not check `gh issue view <n> --json state` before posting any comment.
2. The agent posted a work-delivery/credit comment on an issue it neither opened nor implemented, when the real work was done by a different PR.

## Decision

We add a mandatory pre-action state guard to the docs-improver agent contract (`.github/agents/docs-improver.agent.md`): before any write operation on an issue (`gh issue comment`, `gh issue edit`, `gh issue close`) the agent must verify the issue is `OPEN`; if the issue is `CLOSED` the agent skips the action entirely and records the skip in the run summary only. The agent is also explicitly prohibited from posting work-delivery or credit-claiming comments on issues closed by other agents or humans — those observations belong in the step summary only.

The guard also explicitly addresses a race-condition risk: an issue returned by `gh issue list --state open` may have been closed by the time the agent acts on it, so the state check must happen immediately before each write call.

## Consequences

- **Easier:** audit trail stays clean; no false credit attribution in closed-issue comment threads.
- **Harder:** nothing — the guard is a single `gh issue view` call before every write action.
- **New obligations:** the agent must always resolve the issue number and call the state check before any `gh issue comment`, `gh issue edit`, or `gh issue close` invocation.
- **Normal operation unchanged:** the guard only fires when the issue is already closed; open-issue flows are unaffected.

## Alternatives considered

- **Post the comment then immediately delete it** — rejected; leaves a transient misleading notification.
- **Trust that `gh issue list --state open` will always return only open issues** — rejected; the agent also looks up issues by number via other paths where state is not pre-filtered, and `gh issue list` output can be stale.
- **Add the guard only to closure/credit comments** — rejected; the acceptance criteria require the guard before *any* write action to prevent the same class of issue re-emerging in future comment types.

## Evidence

- Issue #516 (already closed) received a spurious closure comment from docs-improver after PR #532 merged.
- Fix: `.github/agents/docs-improver.agent.md` — `## Before any write action on an issue` section (updated in issue #627, this PR) extends the guard from comments-only to all write operations.
