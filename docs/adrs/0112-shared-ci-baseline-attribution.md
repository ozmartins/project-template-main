# ADR-0112: Shared CI Baseline-Attribution Step for Factory Reviewers and Monitors

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Factory Process Reviewer, Development
- **Supersedes / Superseded by:** None

## Context

The factory was producing multiple overlapping tickets around the same control-plane gap: it did not consistently separate pre-existing `main` failures from PR-introduced failures before asking Copilot branches to remediate CI or before the actions-monitor filed incident tickets. Trend issue #1033 captured three member tickets in 24 hours (Volaris-AI/project-template#853, #855, #995) caused by this attribution defect.

Two failure classes were being conflated:
1. **Pre-existing `main` failures** — checks that are already failing on the default branch independent of any PR. Asking Copilot PRs to fix these expands unrelated PR diffs and spawns churn.
2. **PR-layer `action_required` runs** — same-repo workflow runs that are waiting for a maintainer approval gate. These are a CI governance state, not a code failure. They require a trusted rerun or settings change, not a code change.

Existing instructions referenced comparing failing checks against `main`, but the tooling did not expose a shared, callable function to do it, so each agent had to re-derive the same information separately, leading to inconsistent attribution decisions.

## Decision

We add a shared `attributeCiFailures` pure function in `.github/tools/shared/src/ci-baseline.ts` and a corresponding `get_ci_baseline_attribution` SDK tool in `factory-tools.ts`.

The tool accepts a PR number, fetches the PR's failing and `action_required` checks, fetches recent workflow runs on the default branch, and returns per-check attribution:
- `pre_existing_on_main: true` — suppress branch-fix nudges; update or link the existing baseline incident instead.
- `is_action_required: true` — route to the trusted-rerun path (ADR-0104, ADR-0108), not to a code-change request.
- Neither flag — genuine PR-introduced failure; normal remediation path applies.

Factory agents that review CI state (pr-handler, actions-monitor) call this tool before posting review comments or opening incident tickets so the attribution decision is made once per check, not rediscovered per agent.

## Consequences

- PR-handler and actions-monitor agents have one canonical tool for CI attribution, reducing the chance of per-agent inconsistency.
- Pre-existing `main` failures no longer generate branch-fix nudges on unrelated PRs.
- `action_required` gates stay in their own incident family and are not conflated with code failures.
- The pure `attributeCiFailures` function is unit-testable in isolation without needing live GitHub API calls, reducing test fragility.
- Agents that previously did ad-hoc baseline comparisons must be updated to call `get_ci_baseline_attribution` instead; until that update propagates through agent prompts, the tool is available but not mandatory.

## Alternatives considered

- **Add attribution logic to each agent prompt separately**: rejected because this would replicate the same gap — multiple agents re-deriving the same fact, with no shared test surface.
- **Emit a baseline-attribution step as a workflow job**: rejected because it adds workflow-layer complexity and an ADR for a workflow change; the tool layer is the right abstraction boundary for the factory.
- **Filter at the `get_pr_investigation` level**: rejected because that tool already has a broad investigation scope; attribution is a distinct, reusable concern that other monitors also need.

## Evidence

- `.github/tools/shared/src/ci-baseline.ts` — pure `attributeCiFailures` function and exported types.
- `.github/tools/shared/src/__tests__/ci-baseline.test.ts` — unit tests covering all attribution cases.
- `.github/tools/shared/src/factory-tools.ts` — `get_ci_baseline_attribution` tool added to the `factoryTools()` return array.
- Trend issue #1033 and member tickets #853, #855, #995.
- CI run IDs cited in issue comments: `28039343996`, `28039337780`, `28038854288` (Semgrep on `main`), `28038855972`, `28038784316` (Build Images on `main`).
