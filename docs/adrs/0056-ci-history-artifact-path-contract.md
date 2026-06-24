# ADR-0056: Fix ci-history artifact path contract for unit and temporal suites

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The `ci-history` durable feed on the `ci-history` branch is missing `unit` and `temporal`
suite records on every push-to-main run (issue #137). `helm` and `seed` records are written
correctly. Investigation of `.github/workflows/pr-validation.yml` identified two distinct bugs:

**Bug 1 — Temporal test step path mismatch (working-directory context)**

The `Test Temporal suite` step uses `working-directory: temporal`, but the test-discovery
`find` command passed `temporal/tests` as a relative path. Inside the `temporal/` working
directory that resolves to `<workspace>/temporal/temporal/tests`, which does not exist.
Because the `find` returns empty, the step always prints the "tests skipped" message and
never runs the suite. Consequently, no `pytest-report.json` is written. The Jest `--json`
output redirect also had the wrong path (`temporal/pytest-report.json` from the temporal/
working directory → `<workspace>/temporal/temporal/pytest-report.json`), and the `2>&1`
merge would have corrupted the JSON by interleaving Jest's progress output with the report.

**Bug 2 — upload-artifact path preserves subdirectory prefix**

`actions/upload-artifact` (v4+) preserves the workspace-relative path inside the artifact
archive. Because the unit test step wrote to `frontend/vitest-results.json` and the temporal
test step wrote to `temporal/pytest-report.json`, the artifacts stored those paths internally.
When `actions/download-artifact` extracted them to `artifacts/unit` and `artifacts/temporal`
respectively, the resulting paths were:
- `artifacts/unit/frontend/vitest-results.json`  (not `artifacts/unit/vitest-results.json`)
- `artifacts/temporal/temporal/pytest-report.json` (not `artifacts/temporal/pytest-report.json`)

The `publish-test-history` script probed the un-prefixed paths, so both `if [ -f … ]` checks
were always false and neither record was appended to `runs.jsonl`.

`helm` and `seed` worked because those steps write their result files at the workspace root
(`helm-results.json`, `seed-results.json`), producing artifacts with no directory prefix.

**Bug 3 — Unit test step produced no file when frontend has no test script**

Frontend `package.json` has no `test` script. The existing conditional only printed a summary
message when tests were skipped; it did not write a stub result file. With `if-no-files-found:
ignore` on the upload step, no artifact was created, so the unit probe in
`publish-test-history` always missed.

**Bug 4 — Temporal format mismatch**

The `publish-test-history` invocation used `--format pytest-json` for the temporal suite.
The temporal worker uses Jest (not pytest), and Jest `--json` output has the same shape as
Vitest JSON output, not the pytest-json-report shape. Using `--format vitest` extracts the
correct pass/fail counts from the Jest JSON report.

## Decision

We fix the artifact path contract and the temporal test step in
`.github/workflows/pr-validation.yml`:

1. **Unit test step**: Write a stub vitest-compatible JSON (`numPassedTests:0 …`) to the
   workspace root (`../vitest-results.json` relative to `working-directory: frontend`) when
   no `test` script is configured. When tests run, pass `--outputFile=../vitest-results.json`
   to Vitest so the file is also at the workspace root.

2. **Unit upload**: Change `path: frontend/vitest-results.json` to `path: vitest-results.json`
   (workspace root). The artifact now stores `vitest-results.json` without a directory prefix.

3. **Temporal test step**: Change `find temporal/tests` to `find tests` (correct path relative
   to `working-directory: temporal`). Change the output redirect to `../pytest-report.json`
   (workspace root). Remove `2>&1` so Jest's progress output does not corrupt the JSON file.
   Write the same stub file in the skip branch.

4. **Temporal upload**: Change `path: temporal/pytest-report.json` to `path: pytest-report.json`
   (workspace root). The artifact stores `pytest-report.json` without a directory prefix.

5. **publish-test-history format**: Change `--format pytest-json` to `--format vitest` for the
   temporal suite record so that Jest JSON pass/fail counts are parsed correctly.

With these changes, `actions/download-artifact` extracts:
- `unit-results` → `artifacts/unit/vitest-results.json` ✓ (matches existing probe)
- `temporal-results` → `artifacts/temporal/pytest-report.json` ✓ (matches existing probe)

No changes to `publish-test-history` path probes or to `helm`/`seed` paths are required.

## Consequences

- `unit`, `temporal`, `helm`, `seed`, and `coverage` records will all appear in `ci-history`
  for every push-to-main run, restoring full QA scorecard visibility.
- Temporal unit tests now actually run in CI. A failing temporal suite will gate merges as
  intended; previously the suite silently skipped on every run.
- When frontend has no `test` script, the unit record shows `outcome: "passed"` with
  `numPassedTests: 0`, accurately representing "no unit tests configured" without hiding
  regressions in the history feed.
- The `--format vitest` change produces correct pass/fail counts from Jest JSON output;
  `--format pytest-json` would have silently produced empty stats.
- Future additions of per-suite result files should write to the workspace root (not to a
  job-specific subdirectory) so the upload-artifact path contract remains consistent.

## Alternatives considered

- **Update publish-test-history path probes** to use the prefixed paths
  (`artifacts/unit/frontend/vitest-results.json`, `artifacts/temporal/temporal/pytest-report.json`):
  rejected because it hardcodes the subdirectory structure in two places, making future
  refactors fragile. Writing files at the workspace root is the same pattern already used by
  `helm` and `seed`.
- **Use `upload-artifact` root directory option** to strip the prefix at upload time: rejected
  because it requires additional per-job boilerplate and is less readable than writing to
  workspace root.
- **Add a frontend `test` script** rather than writing a stub: deferred; adding a full Vitest
  setup is out of scope for this history-gap fix. The stub approach records the accurate state
  ("0 tests configured") and can be replaced when a real test suite is added.

## Evidence

- `.github/workflows/pr-validation.yml` — unit/temporal test steps and upload paths
- Issue #137: "CI history gap: unit, temporal, and coverage records missing on main"
- `ci-history` branch `runs.jsonl` — `helm` and `seed` entries present; `unit` and `temporal`
  absent for recent main runs
