# ADR-0108: PR validation summary gates the Temporal DSL stub job

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

Issue `#63` already introduced a dedicated `temporal-dsl` job in
`.github/workflows/pr-validation.yml` for the public-safe Temporal DSL suites.
That job runs the five stub-based Jest files without LLM API keys, but the
workflow summary gate did not list `temporal-dsl` in its `needs:` set or status
table.

This repository uses `validation-summary` as the roll-up PR gate for
`pr-validation.yml`. If the dedicated DSL job is omitted from that summary, the
requested stub suite can pass or fail without being represented in the final
gating summary, weakening the contract promised by issue `#63`.

## Decision

We include `temporal-dsl` in the `validation-summary` job's `needs:` list and
status output, and we extend the Temporal workflow contract test to assert that
the dedicated stub-test job remains present, public-PR-safe, and wired into the
summary gate.

## Consequences

- The dedicated Temporal DSL stub suite now participates in the same summary
  gate as the repository's other required PR validation jobs.
- A future workflow edit that removes the dedicated stub-test job, drops one of
  the required files, or introduces LLM API key wiring will fail the contract
  test.
- Maintainers must update both the workflow and the contract test together if
  the dedicated stub-test job is intentionally renamed or reshaped.

## Alternatives considered

- Rely on the standalone `temporal-dsl` job status only: rejected because the
  repository's required roll-up gate is `validation-summary`.
- Fold the stub suites back into the broader `temporal` job only: rejected
  because issue `#63` explicitly asks for a dedicated GitHub Actions job.

## Evidence

- `.github/workflows/pr-validation.yml`
- `temporal/tests/pr_validation_lint_contract.test.ts`
- `docs/adrs/0064-temporal-dsl-stub-tests-ci-gate.md`
- Issue `#63`
