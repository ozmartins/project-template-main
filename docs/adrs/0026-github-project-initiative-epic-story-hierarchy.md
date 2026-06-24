# ADR-0026: GitHub Project — Initiative → Epic → Story Hierarchy

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The factory's agents (product-owner, project-manager, roadmap-curator) must share a consistent mental model of work organisation. Without a shared hierarchy, agents make conflicting decisions: what constitutes a "story" ready for implementation vs an "epic" that needs decomposition vs an "initiative" that needs strategy first. Humans reviewing agent output also need a consistent structure to evaluate.

## Decision

All work is organised in a strict three-level hierarchy on the GitHub Project board:

**Initiative** — a strategic outcome (3–12 month horizon). Examples: "Self-service onboarding", "Analytics dashboard". Initiatives are GitHub Issues with the `initiative` label. They contain no implementation details — only the desired outcome, success metrics, and child epic links.

**Epic** — a capability increment that delivers part of an initiative (2–8 week horizon). GitHub Issues with the `epic` label. An epic has acceptance criteria but is still too large to implement in one PR. The `factory-architect` agent converts epics into implementation-ready specs.

**Story** — a unit of work implementable in one PR (1–3 day horizon). GitHub Issues with `queue:development` + `ready-for-dev` labels once fully specified. The `project-manager` assigns stories to Copilot.

**Linking convention:**
- Initiative issues reference their child epics in the body (`- [ ] #<epic-number>`)
- Epic issues reference their parent initiative and child stories
- Stories reference their parent epic

The `roadmap-curator` agent (product-* category) maintains this hierarchy, promoting and demoting issues as they evolve. The `product-owner` agent enforces it during triage — an issue that is too vague for a story becomes an epic; an epic without a parent initiative is flagged.

## Consequences

**Positive:**
- Agents share a single work model. The project-manager knows a story is implementation-ready when it has `ready-for-dev`. The factory-architect knows an epic needs specs when it has `queue:architecture`.
- The hierarchy is visible and navigable in the GitHub Project board without any external tooling.
- Roadmap visibility: filtering GitHub Issues by `initiative` shows the strategic roadmap; filtering by `epic` shows delivery progress; filtering by `queue:development` shows the implementation queue.

**Negative:**
- Maintaining the hierarchy requires discipline from both agents and humans. An issue that escapes triage without correct labels will be invisible to the relevant agent.
- GitHub's native issue hierarchy is loose — child references are body text, not a first-class parent/child relationship. Agents must parse issue bodies to traverse the tree.
- Large initiatives with 20+ epics become unwieldy in a single issue body. The convention scales to tens of issues per level without tooling, but not hundreds.

## Alternatives considered

**Linear / Jira for project tracking:** Richer hierarchy models and better native parent/child support. Breaks the GitHub-native audit trail and requires agents to use a separate API. The factory is intentionally GitHub-native.

**Flat issue list with labels only:** Simpler but loses the strategic context. An agent assigned a story cannot see what initiative it contributes to without traversing the hierarchy.

**GitHub Projects custom fields (Priority, Effort):** Good complement to this hierarchy for prioritisation, but not a replacement for the structural parent/child model.

## Evidence

- `.github/agents/product-owner.agent.md` — triage and hierarchy enforcement
- `.github/agents/project-manager.agent.md` — story assignment rules
- `.github/agents/factory-architect.agent.md` — epic → spec conversion
- `.github/copilot-instructions.md` — Copilot's ticket-readiness gate rules
