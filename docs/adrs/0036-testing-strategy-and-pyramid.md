# ADR-0036: Testing Strategy and Test Pyramid

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

A software factory that autonomously merges PRs (ADR-0002) needs a testing strategy that gives it high confidence before merging, not just detection after the fact. Without an explicit, layered strategy, tests accumulate in ad-hoc ways: too many slow integration tests blocking fast feedback, too many mocked unit tests that diverge from reality, and no clear answer to "is this safe to merge?"

The strategy must also work for a template: it must describe what to build first, how each layer relates to the others, and how to ratchet quality gates upward as the project matures.

## Decision

We use a four-layer test pyramid with explicit gating contracts at each layer.

```
                         ┌──────────────────┐
                         │  E2E (Playwright) │  ← deployed env; slow; few
                         │  smoke + journey  │    but highest confidence
                         ├──────────────────┤
                  ┌──────┤  Integration      ├──────┐
                  │      │  Temporal + DB    │      │
                  │      ├──────────────────┤      │
                  │      │  Unit             │      │
                  │      │  frontend / python│      │
                  │      ├──────────────────┤      │
                  └──────┤  Static / Build   ├──────┘
                         │  types, lint, helm│
                         └──────────────────┘
```

**Layer 1 — Static & Build (fastest, always gating)**
- TypeScript type check, ESLint, Ruff, ShellCheck, Helm lint + render
- Run on every PR, < 2 minutes
- Failure = structural error, not a test that needs investigation

**Layer 2 — Unit Tests (fast, always gating)**
- Frontend: Vitest + @testing-library/react; target ≥ 80% line coverage, ≥ 65% branch
- Python worker: pytest against mocked Temporal + Supabase clients; target 100% pass rate
- Run on every PR, < 5 minutes
- Must be hermetic: no network, no database, no Temporal server

**Layer 3 — Integration / Reset-Path (medium, path-scoped gating)**
- Supabase reset-path CI gates: `supabase db reset` + SQL contract tests per feature migration (ADR-0039)
- Temporal workflow contract tests: Python/pytest asserting workflow behaviour and GitHub Actions workflow structure (ADR-0040)
- Skipped by path-scoping when PR touches no DB or Temporal files — `git diff --name-only base...head` (three-dot)
- Takes 15–45 minutes when triggered; must not block frontend-only PRs

**Layer 4 — E2E / Deployed Environment (slow, tier-dependent gating)**
- Playwright against a live deployed environment — never against a local build
- Two tiers: gating smoke + non-gating experience (ADR-0037)
- Full suite runs in UAT; fast subset runs in dev (ADR-0038)

**Gating contract:**
| Layer | PR gate | Dev post-deploy | UAT gate | Prod canary |
|---|---|---|---|---|
| Static + Build | ✅ blocking | — | — | — |
| Unit | ✅ blocking | — | — | — |
| Integration / Reset-path | ✅ blocking (path-scoped) | — | ✅ full run | — |
| E2E smoke | — | ✅ hourly | ✅ full gating | ✅ canary subset |
| E2E experience | — | 📊 non-gating | ✅ gating | — |

**Report-first, ratchet-later model:**
New quality checks start as `continue-on-error: true` (report-only). Once the check passes cleanly for a sustained window (typically 7 days), it is promoted to gating by removing `continue-on-error`. This decouples introducing measurement infrastructure from the moment it becomes a merge gate — preventing a new check from immediately blocking all work due to existing debt.

**SLOs live in `.github/qa-targets.json`.** The QA Manager agent reads this file, computes the rolling scorecard, and files work tickets for breaches. Never lower a floor to hide a regression — only raise floors as the codebase clears them.

## Consequences

**Positive:**
- Each layer has a clear role. Engineers know where a given test belongs without a meeting.
- Path-scoping keeps the PR feedback loop fast: a frontend-only change gets sub-5-minute feedback; a DB migration gets the full reset-path suite.
- The ratchet model gives new projects a clean bootstrapping path: measure first, gate later.
- The QA Manager automates threshold monitoring — humans aren't scanning dashboards.

**Negative:**
- Four layers require four distinct test setups (Vitest, pytest, supabase CLI, Playwright). Initial setup cost is real.
- Layer 3 (reset-path) can take 45+ minutes when many migrations are touched. A PR that modifies 10 migrations runs 10 reset-path jobs in parallel, each ~2 minutes; CI must support sufficient concurrency.
- The four-environment gating contract (PR / dev / UAT / prod) requires that UAT is a stable, long-lived environment. Teams that don't maintain a stable UAT lose the high-confidence gate.

## Alternatives considered

**Single gating suite (all tests on every PR):** Maximally safe but unacceptably slow for a high-velocity factory. 45 minutes of reset-path tests on a CSS change is waste.

**Test only in production (Netflix model):** Valid at hyperscale with feature flags and fast rollback. Not appropriate for a template targeting teams without that infrastructure.

**No explicit pyramid — write tests wherever:** Results in accidental heavy coupling in unit tests, insufficient E2E coverage, and no shared language for "is this safe?"

## Evidence

- `.github/qa-targets.json` — SLO floors and ceilings
- `.github/workflows/pr-validation.yml` — layer 1–3 gating implementation
- `.github/workflows/e2e-dev.yml` — layer 4 dev post-deploy implementation
- `docs/testing.md` — practical guide for writing tests in each layer
- ADR-0037, ADR-0038, ADR-0039, ADR-0040 — layer-specific decisions
