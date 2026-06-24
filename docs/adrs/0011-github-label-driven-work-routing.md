# ADR-0011: GitHub Label-Driven Work-Routing Model

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** Partially superseded by ADR-0053 (Copilot ownership tracking only)

## Context

The factory runs multiple specialist agents (tech-reviewer, database-steward, security-reviewer, platform-engineer, qa-manager) alongside a general project pipeline. These agents need a shared coordination mechanism: a way to signal what work is queued for them, what state that work is in, and who owns it at any moment. Direct agent-to-agent calls would create tight coupling and break the stateless session model.

## Decision

All work routing is expressed through GitHub labels. Two label namespaces:

**Queue labels** (`queue:<lane>`) — declare what specialist action is needed:
- `queue:development` — issue is ready for Copilot implementation
- `queue:architecture` — design/spec/ADR work needed before implementation
- `queue:security` — security review needed
- `queue:database` — database steward review needed
- `queue:platform` — platform engineer review needed
- `queue:qa` — QA review or test-gap work needed
- `queue:release` — release coordination needed

**State labels** signal current status:
- `ready-for-dev` — issue has complete acceptance criteria, safe to implement
- `needs-triage`, `needs-info`, `needs-design` — blockers before work can start
- `needs-security-review`, `needs-database-review`, `needs-platform-review` — specialist review gates on a PR
- `tech-approved` — tech-reviewer has approved (used as self-approval fallback when PR author = factory PAT)
- `needs-adr` — a PR introduced an architectural decision without an ADR

Agents read labels to determine their scope and write labels to signal outcomes. A specialist agent removes its own `needs-*` label when it completes its review. No agent removes another specialist's label.

## Consequences

**Positive:**
- Every routing decision is a visible, auditable GitHub event. No hidden state.
- Agents are stateless — they reconstruct work state from labels on each run. A missed run or a retry is safe.
- The label model is extensible: adding a new specialist lane requires adding a `queue:` label and a new agent definition, with no changes to existing agents.
- Labels can be filtered in GitHub's project board, making the work queue visible to humans without any additional tooling.

**Negative:**
- Label management requires discipline: stale labels left on closed issues create noise in agent queries. The product-owner sweep should prune them.
- Label names are not validated by GitHub. A typo in an agent's `gh issue edit --add-label` creates a phantom label that silently fails to route.
- There is no enforced ordering within a queue — two agents could process the same issue concurrently. Agents must guard against this (check label still present before acting).

## Alternatives considered

**GitHub Projects custom fields for state:** Richer data types, but only queryable via GraphQL Projects API. Label queries are simpler and available via basic `gh issue list --label` CLI.

**External queue (Redis, SQS):** Durable ordering guarantees but requires additional infrastructure, breaks the GitHub-native audit trail, and is disproportionate for this fan-out level.

**Commit status checks for routing:** Wrong layer — checks are per-commit, not per-issue, and cannot carry specialist-assignment semantics.

## Evidence

- `.github/agents/*.agent.md` — each agent's label read/write contracts
- `.github/workflows/project-fast.yml` (target name) — pipeline that routes based on labels
- `.github/copilot-instructions.md` — Copilot's label-gate rules (stop if `needs-triage`, etc.)
