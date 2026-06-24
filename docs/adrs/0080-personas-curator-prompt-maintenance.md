# ADR-0080: Keep personas-curator prompt maintenance centralized and compact

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

`personas-curator.agent.md` is a factory control-plane prompt contract. The weekly
personas pipeline depends on that prompt continuing to preserve the same persona
file shape, evidence requirements, and retirement behavior.

The prompt had accumulated repeated copies of the same retention and evidence
guardrails across multiple sections. That made maintenance noisier and increased
the risk that a later edit would update one copy while leaving another behind.

## Decision

We keep the durable personas-curator guardrails centralized in one explicit
`Guardrails` section, and keep the persona file contract explicit but compact.

Prompt-maintenance refactors may remove duplicated wording and replace long inline
examples with a short frontmatter example plus an ordered section list, provided
they do not change the required persona sections, README index format, evidence-
first behavior, or `status: retired` retention model.

## Consequences

- Reviewers can audit the personas-curator contract by checking one canonical
  guardrails section instead of reconciling repeated copies.
- Future prompt cleanups remain allowed, but they must preserve the existing
  persona file/output contract from ADR-0076.
- Changes to `.github/agents/personas-curator.agent.md` continue to be treated as
  control-plane changes that require tight review and an ADR when they change the
  maintained prompt contract.

## Alternatives considered

- Leave duplicated guardrails in place: rejected because duplicated prompt rules
  are harder to maintain and easier to drift.
- Shorten the prompt by making persona file structure implicit: rejected because
  the agent must still receive an explicit, reviewable output contract.

## Evidence

- `.github/agents/personas-curator.agent.md` — consolidated guardrails and compact
  persona file guidance
- `docs/adrs/0076-pipeline-weekly-personas-curator.md` — existing weekly pipeline
  and persona-retention contract
- Commits `1b9817b` and `cafa813` — prompt refactor and follow-up stabilization on
  this branch
