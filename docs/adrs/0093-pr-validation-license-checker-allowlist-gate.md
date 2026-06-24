# ADR-0093: PR validation enforces npm license allowlist with license-checker

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The repository already uses Trivy for broad license and vulnerability scanning in CI, but developers lacked a fast local command for npm-only dependency license checks. This created friction: finding a non-allowlisted npm license could happen later in CI rather than at install time or before push.

This change touches `.github/workflows/pr-validation.yml`, which is a control-plane boundary in this repository and therefore requires an ADR in the same PR.

## Decision

We add `license-checker` as a dev dependency in `frontend/` and `temporal/`, add `licenses` and `licenses:check` scripts in both package manifests, and run `npm run licenses:check` in both existing PR validation jobs immediately after `npm ci`.

The `licenses:check` script runs in summary mode and enforces an SPDX-first allowlist with necessary metadata-expression variants currently present in the dependency trees (for example `MIT OR Apache-2.0`, `MIT-0`, `MPL-2.0`, and `Apache-2.0 AND MIT`). It also allows currently observed legacy metadata strings such as `MIT*`, `BSD*`, and `Custom: http://github.com/substack/node-bufferlist`.

`--excludePrivatePackages` avoids false failures on private workspace package entries.

## Consequences

- Frontend and Temporal dependency trees now fail PR validation when an unapproved npm license is introduced.
- Developers get a fast local audit command (`npm run licenses`) and a pre-push enforcement hook (`npm run licenses:check`) before CI.
- Scope remains explicit: this gate is npm dependency-tree coverage only and complements broader Trivy scanning.
- Where upstream metadata uses disjunctive strings (for example `MIT OR ...`), the gate allows only the exact observed expression; it does not allow the corresponding copyleft family as a standalone license.
- Any expansion of the allowlist becomes an explicit, reviewable policy change.

## Alternatives considered

- **Rely on Trivy only:** Rejected — slower feedback loop for day-to-day npm changes.
- **Create a separate workflow:** Rejected — unnecessary complexity since both affected jobs already install npm dependencies and can run the check inline.
- **Use a broader allowlist:** Rejected — the narrow SPDX list is easier to audit and aligns with current policy intent.

## Evidence

- `.github/workflows/pr-validation.yml` — adds `License compliance check` steps in frontend and temporal jobs
- `frontend/package.json` and `temporal/package.json` — adds `license-checker` dev dependency and `licenses*` scripts
- `lefthook.yml` — adds optional pre-push `licenses` command
- `README.md` — documents local `licenses` and `licenses:check` commands
- `temporal/tests/license_checker_contract.test.ts` and `temporal/tests/pr_validation_lint_contract.test.ts` — contract tests for this gate
- Issue: Volaris-AI/project-template#25
