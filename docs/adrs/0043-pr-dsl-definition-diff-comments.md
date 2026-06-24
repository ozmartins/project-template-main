# ADR-0043: PR DSL Definition Diff Summary Comments

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Repository maintainers (via PR review)
- **Supersedes / Superseded by:** N/A

## Context
Reviewers currently need to inspect raw JSON under `temporal/definitions/**` to understand behavior changes in DSL workflow definitions. This slows review and makes model/tool/runtime impacts easy to miss. The PR enrichment workflow already has write permissions and access to PR file diffs.

## Decision
We add a PR enrichment step that runs a TypeScript summarizer for changed DSL definition files and posts or updates a structured PR comment via `gh pr comment`.

## Consequences
Reviewers get an always-updated, human-readable summary of DSL execution steps, LLM call counts, tools, and external services whenever definitions change. PR enrichment now installs shared TypeScript tooling before running. If no definition files changed, no DSL comment is posted.

## Alternatives considered
- Do nothing and keep reviewing raw JSON only (rejected: low review ergonomics and higher miss risk).
- Summarize in CI job summary only (rejected: less visible than in-thread PR comments).
- Use a standalone workflow for comments (rejected: additional workflow complexity for a PR-enrichment concern).

## Evidence
- `.github/workflows/pr-enrichment.yml`
- `.github/tools/shared/src/dsl-definition-summary.ts`
- `.github/tools/shared/src/render-dsl-definition-comment.ts`
- `.github/tools/shared/src/__tests__/dsl-definition-summary.test.ts`
