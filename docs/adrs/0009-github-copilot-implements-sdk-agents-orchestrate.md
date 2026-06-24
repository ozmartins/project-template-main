# ADR-0009: GitHub Copilot Implements; SDK Agents Orchestrate

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The factory (ADR-0002) needs two distinct kinds of automated actors:

1. **Implementation workers** — entities that write and commit code, open PRs, run tests. These need deep IDE-grade context: file tree, symbol resolution, type checking, diff application.
2. **Orchestrators / reviewers** — entities that read state (issues, PRs, CI results, metrics), make decisions (approve/reject/route), and act through the GitHub API (labels, comments, reviews, assignments). They do not write production code.

Using the same tool for both roles conflates the concerns and creates either over-privileged orchestrators or under-capable implementation workers.

## Decision

**GitHub Copilot coding agent** handles implementation: it reads the issue, writes code, runs tests, opens a PR. It operates on a branch with full repo write access. It is kicked off by the `project-manager` agent assigning an issue.

**GitHub Copilot SDK agents** (session-based, defined by `.agent.md` files) handle orchestration: they read state, reason, and act through `gh` CLI and GitHub REST APIs. They do not commit code. They run inside GitHub Actions workflow steps.

The two layers interact via GitHub objects: an SDK agent files an issue → Copilot picks it up via assignment → SDK agent reviews the resulting PR. The handoff boundary is always a GitHub Issue or PR — never a direct API call between the two layers.

## Consequences

**Positive:**
- Implementation workers have full IDE context (file tree, LSP, test runner) appropriate to code authoring.
- Orchestrators are stateless session runners — easy to test, easy to audit (all actions are GitHub events), cheap to rerun on failure.
- The handoff via GitHub objects is durable and auditable; no in-memory coupling between the two layers.
- Concurrency limits are enforced at the GitHub layer: `max_open_copilot_prs` in `factory.yml` caps the implementation queue.

**Negative:**
- Copilot coding agent is a GitHub-product dependency. If the product changes capabilities or pricing, the implementation layer is affected.
- The latency of the handoff (SDK agent files issue → Copilot picks it up → opens PR) is measured in minutes, not seconds. This is by design for non-urgent work but unsuitable for time-critical automation.
- The boundary means SDK agents cannot directly inspect uncommitted code on in-progress Copilot branches.

## Alternatives considered

**Single agent type for both roles:** Either gives orchestrators dangerous write permissions or restricts implementation workers from doing their job.

**Custom CI bot:** Full control but requires implementing auth, session management, retry, and all the IDE context that Copilot provides — high engineering cost.

**GitHub Actions-native scripting (no SDK):** Works for simple rule-based automation; does not scale to reasoning tasks like reviewing code for architectural correctness.

## Evidence

- `.github/agents/*.agent.md` — SDK agent definitions
- `.github/factory.yml` — `max_open_copilot_prs` setting
- `.github/workflows/project-fast.yml` (target name) — orchestration pipeline that kicks off Copilot assignments
- ADR-0002 — factory architecture overview
