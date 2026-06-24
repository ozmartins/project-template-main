# ADR-0059: Run stub-based Temporal DSL tests in PR Validation

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

Issue `#63` requires CI coverage for the Temporal DSL test set that uses
`TestWorkflowEnvironment` plus stub activities, so these tests are safe for
public pull requests and do not require provider credentials.

The required suite is:

- `temporal/tests/interpreter.test.ts`
- `temporal/tests/expression.test.ts`
- `temporal/tests/schema.test.ts`
- `temporal/tests/duration.test.ts`
- `temporal/tests/llm_agent.test.ts`

Because this change updates `.github/workflows/pr-validation.yml`, repository
policy requires an in-PR ADR.

## Decision

We add a dedicated `Run Temporal DSL tests` step to the `temporal` PR-validation
job that executes Jest only for the required DSL-related test files via
`--testPathPatterns`, with `--passWithNoTests`.

We do not set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or other LLM API-key
variables in this CI step.

## Consequences

- The requested DSL interpreter/expression/schema/duration/llm-agent tests are
  explicitly executed in PR validation.
- The tests remain safe for public PRs because they use stubs and no LLM API
  keys are injected by CI.
- Existing broader Temporal suite execution remains unchanged.

**Rollback:** remove the dedicated DSL step from `pr-validation.yml` and record
the replacement approach in a superseding ADR.

## Alternatives considered

- Rely only on the existing general Temporal `npm test` step: rejected because
  the issue requires explicit stub-based DSL test coverage in CI.
- Add a separate workflow file: rejected as unnecessary scope expansion when the
  existing PR-validation workflow already hosts Temporal checks.

## Evidence

- `.github/workflows/pr-validation.yml` — `temporal` job DSL test step
- `temporal/tests/interpreter.test.ts`
- `temporal/tests/expression.test.ts`
- `temporal/tests/schema.test.ts`
- `temporal/tests/duration.test.ts`
- `temporal/tests/llm_agent.test.ts`
- `docs/adrs/0044-github-actions-control-plane-major-upgrades.md`
- Issue: `#63`
