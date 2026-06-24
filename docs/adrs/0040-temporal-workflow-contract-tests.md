# ADR-0040: Temporal Workflow Contract Tests

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

Temporal workflows have two distinct correctness concerns that require different testing approaches:

1. **Workflow behaviour:** Does the workflow do the right thing — execute activities in the right order, handle signals correctly, produce the right output? This is testable in process using `temporalio.testing.WorkflowEnvironment` (fast, hermetic, no Temporal server).

2. **Registration correctness:** Is every workflow class registered with the worker? Is every activity registered? Are there duplicate `@activity.defn` names that would cause a worker crash at startup? These are structural, not behavioural — they require inspecting the worker registration code.

Additionally, the factory's GitHub Actions workflows are themselves software (ADR-0002). A change to `pr-validation.yml` that accidentally removes a gating job, changes a concurrency key, or breaks an event trigger is a regression just like a code bug — but there are no tests for workflow YAML by default.

## Decision

**Two categories of Temporal contract tests:**

**Category 1 — Behavioural workflow tests** (`temporal/tests/test_*.py`):
- Use `temporalio.testing.WorkflowEnvironment.start_local()` for hermetic execution
- Activities are mocked at the registration level — inject mock implementations that return deterministic results without side effects
- Test: signal handling, activity invocation sequence, timer behaviour, child workflow spawning, error handling paths
- Target: every `@workflow.defn` class has a corresponding test file
- 100% pass rate required; these are gating

**Category 2 — Worker registration audit** (`temporal/tests/test_activity_registration.py`):
- Import the worker module; reflect on registered activities
- Assert: no duplicate `@activity.defn` names (duplicates cause silent worker startup crash)
- Assert: every expected activity class is in the registered set
- Fast, pure-Python — no Temporal server or environment needed
- Runs on every PR as part of the unit test suite

**Category 3 — GitHub Actions workflow contract tests** (`temporal/tests/test_*_workflow_contract.py`):
- Parse the relevant `*.yml` file using a YAML library
- Assert specific structural properties that encode ADR decisions:
  - `pr-validation.yml` must have a `validation-summary` job with `needs:` covering all gating jobs
  - `pipeline-fast.yml` must have `cancel-in-progress: false` (never cancel trunk runs)
  - `e2e-dev.yml` must run on both `schedule` and `workflow_run` triggers
  - Concurrency group keys follow the naming convention from ADR-0005
- These tests make ADRs executable: a workflow change that violates an ADR fails CI until the ADR is updated and the contract test amended
- They run on every PR; changes to `.github/workflows/*.yml` must pass their contract tests

**Test file organisation:**
```
temporal/tests/
  conftest.py                          ← shared fixtures (WorkflowEnvironment, mock activities)
  test_activity_registration.py        ← registration audit (category 2)
  test_workflow_contracts/
    test_pr_validation_contract.py     ← pr-validation.yml structure (category 3)
    test_pipeline_fast_contract.py     ← pipeline-fast.yml structure (category 3)
    test_e2e_dev_contract.py           ← e2e-dev.yml structure (category 3)
  workflows/
    test_approval_workflow.py          ← approval workflow behaviour (category 1)
    test_dsl_workflow.py               ← DSL interpreter behaviour (category 1)
```

**Timeout configuration:**
- `pytest.ini_options timeout = 600` (10 minutes per test, thread method)
- The full test pipeline must be wrapped: `timeout 600s pytest ...` at the shell level to ensure the timeout applies to the entire process tree including logging, not just the pytest process

**Path-scoping:** Like reset-path gates, heavy integration tests that require a running environment should be skipped when the PR does not touch `temporal/` or workflow YAML. Use the same three-dot git diff approach as ADR-0039.

## Consequences

**Positive:**
- Worker startup crashes from duplicate activity registration are caught in CI, not in production at 3am.
- GitHub Actions workflow structure regressions are caught like code bugs. A PR that silently breaks the agent pipeline's concurrency semantics fails CI.
- `WorkflowEnvironment` tests are fast (< 1 minute for most) and hermetic — no Temporal server, no network, no database.
- Contract tests make ADRs executable: the ADR text says "never cancel trunk runs", the contract test enforces it. Both must be updated together.

**Negative:**
- Mocked activity tests prove the workflow logic but not the activity implementations. Activities must have their own unit tests; the mock boundary must be placed carefully so real I/O paths are tested separately.
- GitHub Actions workflow contract tests are YAML-parsing tests. They are fragile to YAML formatting changes (key order, comment presence) if not written carefully. Use deep key access (`workflow['jobs']['validation-summary']['needs']`), not line-number assertions.
- Adding a new workflow file requires also adding a contract test for its key structural properties. This is a review discipline concern — the tech-reviewer should flag new workflow files without corresponding contract tests.

## Alternatives considered

**No registration audit — rely on worker startup to detect duplicates:** Worker startup is tested only when the Docker image is run. A duplicate registration introduced in a PR would pass CI and only be caught in dev post-deploy — a 10–20 minute delay.

**No GitHub Actions workflow tests — rely on human review:** Human review misses subtle structural regressions (a `needs:` array missing one job, a `cancel-in-progress` value changed from false to true). These bugs are easy to introduce and hard to spot in YAML review.

**Test workflows using act (local GitHub Actions runner):** `act` provides a more realistic simulation but is slower, more complex to set up in CI, and is not hermetic. YAML contract tests are faster and sufficient for the structural properties that matter.

## Evidence

- `temporal/tests/` — test directory
- `temporal/tests/conftest.py` — shared fixtures
- `temporal/pyproject.toml` — pytest config (timeout, deps)
- ADR-0006 — Temporal orchestration foundation
- ADR-0007 — signal-driven approval gates (tested in category 1)
- ADR-0036 — layer 2–3 of the testing pyramid
