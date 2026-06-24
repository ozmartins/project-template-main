# ADR-0089: Tech-reviewer prompt compaction preserves review contract

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

`.github/agents/tech-reviewer.agent.md` is a factory control-plane prompt. The refactor in
PR #502 reduced it from 167 to 110 lines by eliminating six restatements of the approve-ready
conditions, four occurrences of "reach a terminal verdict", and 18-line prose domain rubrics
that checked 3–5 things each.

The prompt's review contract — which PRs to approve, when to block, what domain checks to
apply, and how to reach terminal decisions — must remain intact even as prose is compacted.

## Decision

We accept the shorter tech-reviewer prompt, with these contract invariants preserved:

1. The approve-ready conditions (not a draft; CI green; MERGEABLE; no open specialist lanes;
   ADR/security-reviewed for boundary PRs; not already APPROVED) are the single source of
   truth for fast-approve decisions and are defined once in the named `## Approve-ready
   conditions` block at the top of the file.
2. Every run starts with a full approve-ready sweep over all open `queue:review` PRs before
   any deep review; the run must never end with merge-ready PRs left unapproved.
3. The self-approval label fallback (`tech-approved`) is the canonical path when GitHub
   rejects `--approve` on the agent's own PRs.
4. Domain rubrics for Temporal, Frontend engine, and Deployment-risk paths are retained as
   explicit bullet checklists covering registration, RetryPolicy/timeout, idempotency,
   non-determinism, SCD2 writes, role gates, worker boot risks, and seed invariants.
5. The agent reaches a terminal verdict — APPROVE or `--request-changes` — every run.
   Specialist-lane ownership (platform/security/database) and the no-repeat-nag rule are
   unchanged.

## Consequences

- The prompt may stay compact without losing the review contract reviewers rely on.
- Future prompt edits must not remove or conflate the approve-ready conditions, the
  domain rubric checks, or the self-approval fallback.
- Reviewers can audit future tech-reviewer edits against this ADR instead of
  reconstructing intent from prompt prose alone.

## Alternatives considered

- **Keep the longer verbose prompt:** rejected because repeated conditions increase drift
  risk and make the file harder to scan without adding new behaviour.
- **Rely on the prompt alone with no ADR:** rejected because `.github/agents/**` changes
  are control-plane changes that require a preserved contract record per project policy.

## Evidence

- `.github/agents/tech-reviewer.agent.md` — compacted prompt preserving all review criteria.
- `docs/adrs/0027-github-factory-reviewers-reach-terminal-decisions.md` — existing terminal
  decision contract.
- PR: Volaris-AI/project-template#502
