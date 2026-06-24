# ADR-0028: Standing Architecture Audits and Behaviour-Over-Existence Review

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

Point-in-time code review (reviewing a PR in isolation) cannot detect architectural drift: a component that no longer wires to anything, a migration that was applied but whose corresponding code was later deleted, an agent whose output is consumed by no downstream step. These issues accumulate silently across many small PRs, none of which individually looks wrong.

## Decision

The `architecture-audit.yml` workflow runs a whole-repo audit on a daily cadence and optionally on PRs touching structural files. The audit:

1. **Scans the full repo** — not just changed files. Every connection between components is checked: workflow → agent references, data source → schema table references, migration → application code references, chart values → secret name references.
2. **Checks behaviour, not just existence** — a file existing is not a quality signal. What matters is whether the file is wired into a live path. Orphaned files (agent definitions with no workflow reference, components with no page definition usage) are flagged as architectural debt.
3. **Produces findings as GitHub Issues** — one issue per finding, deduped by a fingerprint so the same finding is not filed twice. Issues are labelled `queue:architecture` and assigned to the backlog.
4. **Does not gate CI** — the audit is observational, not blocking. A finding means "this should be addressed eventually", not "this PR must be reverted". The tech-reviewer consumes audit findings when reviewing PRs.

The audit agent is `factory-architect` in behavioural audit mode. In normal operation it converts epics into specs; in audit mode it reads the codebase and produces findings.

## Consequences

**Positive:**
- Architectural drift is detected on a daily cadence, not only when an engineer happens to notice it.
- Findings are GitHub Issues — they enter the backlog, get prioritised, and are tracked to resolution like any other work.
- Non-gating: the audit can run on a PR to give early visibility without blocking the queue.
- The whole-repo scan catches cross-cutting issues that PR-level review misses by design.

**Negative:**
- The audit agent must understand the full wiring model: which workflow files reference which agent files, which YAML keys map to which resource names. This mapping must be maintained as the factory evolves.
- False positives (flagging a file as orphaned when it is actually used via a dynamic reference) create backlog noise. The agent must be calibrated to avoid this.
- Daily cadence means a newly introduced issue may persist for up to 24 hours before being filed. Real-time detection would require a more frequent schedule at higher compute cost.

## Alternatives considered

**PR-only reviews:** Catches issues introduced by the PR but misses drift from the interaction of multiple PRs over time.

**Static analysis tools (eslint, pyright, shellcheck):** Cover syntax and type errors within a file; do not understand cross-file wiring (which agent is called by which workflow step).

**Manual architecture reviews (quarterly):** Humans are good at this but the cadence is too slow for a continuously-deployed system. Automation shifts the burden from periodic manual review to continuous background checking.

## Evidence

- `.github/workflows/architecture-audit.yml` — audit workflow
- `.github/agents/factory-architect.agent.md` — dual-mode agent (spec authoring + architecture audit)
- ADR-0002 — factory architecture that this audit monitors
