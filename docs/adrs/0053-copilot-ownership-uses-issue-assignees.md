# ADR-0053: Copilot ownership uses GitHub issue assignees

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot
- **Supersedes / Superseded by:** Partially supersedes ADR-0011

## Context

ADR-0011 established labels as the factory's shared routing surface. One part of that model used the `assigned-to-copilot` label as the signal that an issue was actively owned by the Copilot coding agent.

In practice, Copilot assignment is performed through GitHub's issue assignee API, while the `assigned-to-copilot` label was written separately. Those two writes could diverge. When the assignee mutation failed or did not stick, the label could remain behind as a ghost ownership signal even though no Copilot assignee existed. The project-manager then treated the issue as already in flight and did not re-assign it, leaving pipeline capacity stranded.

The stale-cleanup logic also depended on that label and only reclaimed stuck issues after more than three days. That was too slow for a queue that runs every 15 minutes and is intended to keep Copilot slots full. Separately, the assignment loop only filled work after the queue fully cleared, which let open capacity sit idle between passes.

## Decision

We use GitHub's native issue assignee list as the source of truth for active Copilot ownership. The factory no longer relies on an `assigned-to-copilot` label in agent contracts or activation docs.

The project-manager now:

- assigns Copilot by setting `copilot-swe-agent[bot]` as the issue assignee;
- identifies stale owned work by querying issues assigned to `copilot-swe-agent[bot]`;
- returns an issue to `ready-for-dev` if it is still assigned but no linked open PR exists after four hours; and
- checks current open Copilot PR count on every pass and assigns enough ready issues to fill the remaining capacity up to `max_open_copilot_prs`.

## Consequences

**Easier:**
- Active Copilot ownership is represented by a single GitHub-native signal instead of a dual-write assignee-plus-label contract.
- Stuck slots are reclaimed within hours instead of days, reducing queue starvation.
- The fast pipeline can top up capacity continuously rather than waiting for all Copilot work to drain first.

**Harder:**
- Humans and agents can no longer filter Copilot-owned work through a dedicated `assigned-to-copilot` label.
- Stale cleanup depends on issue assignment state and age rather than a standalone routing label, so any future ownership-model change must update the cleanup query too.

**New obligations:**
- Active agent configs and docs must not re-introduce `assigned-to-copilot` as a live routing contract.
- If GitHub changes Copilot issue-assignment semantics, the ownership, cleanup, and capacity rules in the project-manager must be revisited together.

## Alternatives considered

| Option | Reason rejected |
|---|---|
| Keep `assigned-to-copilot` as the ownership signal | Ghost labels can survive failed or partial assignment flows and block re-assignment |
| Require both label and assignee to be present | Still relies on two independent writes that can drift out of sync |
| Track Copilot ownership in an external store | Adds infrastructure and breaks the GitHub-native audit trail for a narrow coordination problem |

## Evidence

- Pull request: `#203`
- Commit: `377f8b0` (`fix(factory): remove assigned-to-copilot label, fix stale cleanup threshold, and assign work whenever capacity exists`)
- Files updated by that change:
  - `.github/agents/project-manager.agent.md`
  - `.github/agents/pr-handler.agent.md`
  - `.github/FACTORY-ACTIVATION.md`
- ADR-0011: `docs/adrs/0011-github-label-driven-work-routing.md`
