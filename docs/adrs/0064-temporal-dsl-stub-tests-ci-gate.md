# ADR-0064: Temporal DSL stub tests CI gate

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

Issue #63 asks for a public-PR-safe CI gate for the core Temporal DSL regression tests.
The repository already has Jest + `ts-jest` coverage for the interpreter, expression
evaluator, schema validator, duration parser, and stub-based `llm_agent` integration.
Those tests exercise the DSL against `TestWorkflowEnvironment` with stub activities and
must not depend on `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or other LLM credentials.

Changes to `.github/workflows/**` are control-plane changes and require an ADR in the same PR.

## Decision

We add a dedicated `Temporal DSL stub tests` job to `.github/workflows/pr-validation.yml`
that installs `temporal/` dependencies and runs only the five public-safe DSL suites:
`interpreter.test.ts`, `expression.test.ts`, `schema.test.ts`, `duration.test.ts`, and
`llm_agent.test.ts`. The job passes no LLM API key environment variables and relies on the
existing `ts-jest` configuration instead of compiled output.

## Consequences

- Core DSL regressions now have a focused CI gate that is safe to run on public pull requests.
- Real-key E2E coverage remains out of scope for this job, so existing `describe.skip`
  blocks stay skipped unless a developer opts into local key-backed runs.
- The repository now owns a second Temporal PR-validation job; if additional public-safe DSL
  suites become required, this explicit Jest file list must be updated alongside them.

## Alternatives considered

- Reuse the existing broad Temporal test job only: rejected because issue #63 asks for an
  explicit stub-based DSL gate with a tightly defined suite.
- Add LLM credentials to CI so real-key tests can run: rejected because the job must remain
  safe for public PRs.
- Create a separate workflow file instead of extending `pr-validation.yml`: rejected because
  the requirement is a new validation job and the existing PR gate is the narrowest place to add it.

## Evidence

- `.github/workflows/pr-validation.yml`
- `temporal/package.json`
- `temporal/tests/interpreter.test.ts`
- `temporal/tests/expression.test.ts`
- `temporal/tests/schema.test.ts`
- `temporal/tests/duration.test.ts`
- `temporal/tests/llm_agent.test.ts`
- Issue #63
