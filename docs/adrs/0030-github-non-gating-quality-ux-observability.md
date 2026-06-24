# ADR-0030: Non-Gating Quality and UX Observability Lanes

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

Some quality signals are valuable for awareness and trend-tracking but should not block a PR merge: code coverage metrics, static analysis finding counts, visual UX screenshots. Gating CI on these signals would slow the merge queue for non-critical quality signals, creating friction without proportionate safety benefit.

## Decision

Quality and UX observability runs are explicitly **non-gating**. They run on a separate cadence from the merge-blocking CI pipeline and feed the QA Manager (ADR-0029) for trend-based action, not immediate CI failure.

**Non-gating lanes:**

| Workflow | Cadence | Feeds |
|---|---|---|
| `testing-quality.yml` | Nightly 04:00 UTC | Static analysis findings → `ci-history` quality record → `code-quality-reviewer` agent files tickets |
| `visual-ux.yml` | Daily 05:00 UTC | Playwright screenshots → `ux-vision-reviewer` agent files UX tickets |
| `coverage` job in `pr-validation.yml` | Push to main only | Unit + E2E coverage → `ci-history` coverage record |

**The rule:** if a signal would block a PR merge, it goes in `pr-validation.yml` as a gating job. If it is informational (useful to know but acceptable to have temporarily), it runs in the non-gating lanes and files backlog tickets.

**Quality ceilings** in `qa-targets.json` (TypeScript errors, Ruff errors, secret findings, SAST highs) ARE gating via the `testing-quality.yml` → QA Manager path — but they gate via ticket priority and escalation, not direct CI failure. A ceiling breach files a `priority:high` issue that the factory prioritises; it does not immediately block unrelated work.

## Consequences

**Positive:**
- The merge queue is not blocked by coverage metrics, static analysis counts, or UX visual changes. These signals are valuable but not reasons to halt a deploy.
- Long-running analysis (CodeQL, Semgrep, Playwright screenshots) runs overnight rather than on every PR, reducing CI minute consumption.
- The non-gating lanes feed the same `ci-history` branch as the gating lanes — all trends are visible in one dashboard.

**Negative:**
- A coverage regression introduced in a PR is not immediately visible — it surfaces on the next push-to-main coverage run. This is a deliberate trade-off for merge speed.
- "Non-gating" lanes require the factory to remain active and the QA Manager to run regularly. If the agent stops running, quality drift accumulates silently.
- The distinction between gating and non-gating must be actively maintained as new quality checks are added. Every new check needs a conscious decision about which lane it belongs in.

## Alternatives considered

**Gate everything:** Zero quality blindspot in CI but slows the merge queue and breaks frequently on infrastructure flake in coverage runs.

**Don't run non-gating checks:** Simpler CI but loses the trend visibility that enables the QA Manager to act proactively.

## Evidence

- `.github/workflows-available/code-quality.yml` — non-gating static analysis lane
- `.github/workflows-available/visual-ux.yml` — non-gating UX lane
- `.github/workflows/pr-validation.yml` — coverage job (non-gating, push-to-main only)
- ADR-0029 — QA SLO targets that consume these lanes
