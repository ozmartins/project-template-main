# ADR-0029: QA SLO Scorecard and Targets Framework

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

CI passes or fails on binary outcomes (tests passed/failed). But between "all tests pass" and "all tests fail" lies a large space of quality states: a test suite with 85% pass rate, coverage at 60% and declining, 12 skipped tests, 47 TypeScript errors. Without explicit thresholds, there is no signal to act on — the factory doesn't know whether the current quality state is acceptable or requires intervention.

## Decision

Quality targets are declared explicitly in `.github/qa-targets.json`. The QA Manager agent reads this file to build a per-SLO scorecard and file targeted work tickets when a threshold is breached.

**Four target categories:**

1. **Pass rate** — minimum pass percentage per test suite (smoke, unit, temporal, helm, seed). `gating: true` suites block CI; others are informational.
2. **Coverage** — minimums for unit line coverage, unit branch coverage, E2E screen coverage, E2E journey coverage (as ratios, e.g., `0.80` = 80%).
3. **Stability** — maximum count of unstable (flaky) tests, maximum skip percentage.
4. **Quality ceilings** — maximum counts for static analysis findings: TypeScript errors, Ruff errors, secret findings, SAST high-severity findings, vulnerability counts.

The `ci-history` branch holds a JSONL feed of test run results. The QA Manager reads this feed, computes the rolling score against `qa-targets.json`, and:
- Publishes the scorecard to `$GITHUB_STEP_SUMMARY` on every run
- Files a `priority:medium` issue for each threshold breach (deduped by fingerprint)
- Files a `priority:high` issue if a gating threshold would be breached by a trend (deteriorating, not yet below floor)

## Consequences

**Positive:**
- Quality state is continuously monitored without human review of dashboards. Deterioration triggers work tickets automatically.
- The thresholds are explicit, versioned, and reviewable — changing a threshold is a PR with a clear rationale.
- The scorecard in `$GITHUB_STEP_SUMMARY` is visible on every CI run in the GitHub Actions UI.
- Different threshold levels for different suites: unit tests must be at 100% pass rate (gating); smoke tests at 98% (still gating but tolerates rare infrastructure flake).

**Negative:**
- Thresholds require calibration. Setting them too high floods the issue tracker with breach tickets; too low and they provide no signal. Initial values are informed by the project's starting state and should be tightened over time.
- The QA Manager runs on the `ci-history` branch feed, which is only populated on pushes to main (not on PRs). Coverage and stability signals lag behind the current PR by one merge cycle.
- Coverage computation (particularly E2E screen coverage) requires parsing route files and Playwright `goto()` calls — this logic is in `coverage-compute.mjs` and must be kept in sync with routing conventions.

## Alternatives considered

**Ad-hoc quality thresholds in CI (hardcoded in workflow YAML):** Works for simple cases but distributes threshold configuration across many files. `qa-targets.json` centralises all thresholds in one reviewable file.

**External quality gates (SonarQube, Codecov):** Powerful tools but add external service dependencies and per-seat pricing. The factory achieves equivalent functionality using the CI history feed and the QA Manager agent.

**No thresholds (binary pass/fail only):** Simple but leaves a large quality blindspot between "everything passes" and "CI is red".

## Evidence

- `.github/qa-targets.json` — threshold definitions
- `.github/agents/qa-manager.agent.md` — QA Manager scorecard logic
- `.github/scripts/coverage-compute.mjs` — coverage calculation
- `.github/scripts/qa-targets.mjs` — shared SLO helpers
- `.github/workflows/pr-validation.yml` — `ci-history` feed populated here
