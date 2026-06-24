# ADR-0088: QA-manager prompt compaction preserves evidence and scorecard contract

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

`.github/agents/qa-manager.agent.md` is a factory control-plane prompt. The refactor in
PR #561 intentionally compresses verbose tutorial-style guidance into a shorter rule set,
but reviewers still need a durable record of the QA-manager contract that must not drift.

That contract is not just formatting. The QA manager's value comes from preserving the
same evidence sources, deduplicated issue-filing behavior, live-behavior gating rules,
and per-run scorecard publication already established in the prompt and ADR-0029.

## Decision

We accept the shorter QA-manager prompt, with these contract invariants preserved:

1. `e2e-history` remains the canonical evidence source for deployed-experience review, and
   `ci-history` remains the canonical evidence source for CI suite health and score trends.
2. QA issue filing stays evidence-first and deduplicated: the agent must ground tickets in
   changed files, live verification, `e2e-history`, or `ci-history`, and refresh an
   existing issue instead of filing a duplicate when one already covers the gap.
3. Test-gap and test-plan expansion tickets must name the exact target spec file and must
   choose gating vs non-gating from current live dev behavior: verified-working behavior
   may be gating, while aspirational or currently broken behavior stays non-gating in
   `frontend/e2e/experience.spec.ts`.
4. Each QA-manager run still publishes the QA scorecard against the SLOs in
   `.github/qa-targets.json`, maps breaches to work, and avoids duplicate tickets when a
   breach is already represented elsewhere.

## Consequences

- The prompt may stay compact and prescriptive without losing the maintained QA-manager
  contract reviewers rely on.
- Future prompt cleanups may remove repetition, but they must not replace `e2e-history` or
  `ci-history`, weaken evidence-first dedup rules, or make gating decisions independent of
  live dev behavior.
- Reviewers can now audit future QA-manager edits against one explicit ADR instead of
  reconstructing the contract from prompt prose alone.

## Alternatives considered

- **Keep the longer tutorial-style prompt:** rejected because repeated guidance increases
  drift risk and makes future maintenance noisier without adding new behavior.
- **Rely on the prompt alone with no ADR:** rejected because `.github/agents/**` changes
  are control-plane changes and the preserved contract would remain implicit.

## Evidence

- `.github/agents/qa-manager.agent.md` — compacted prompt preserving evidence sources,
  ticketing rules, gating decisions, and scorecard publication.
- `docs/adrs/0029-github-qa-slo-scorecard.md` — existing QA scorecard and target contract.
- `doc_templates/ISSUE.md` — canonical issue structure referenced by QA-manager tickets.
- PR: #561
