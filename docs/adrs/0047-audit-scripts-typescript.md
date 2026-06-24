# ADR-0047: Convert audit scripts from Python to TypeScript

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Copilot
- **Supersedes / Superseded by:** —

## Context

The repository standardises on TypeScript as its sole application language (frontend, Temporal worker, `.github/tools/shared`). The only remaining Python code was `scripts/audit/` — six files called by `architecture-audit.yml`. Keeping Python as an additional runtime creates CI setup overhead (setup-python, pip), prevents Biome linting and TypeScript type-checking on the audit code, and prevents reuse of shared utilities from `.github/tools/shared/`.

Changes to `.github/workflows/**` are control-plane changes and require an ADR in the same PR before platform review clears.

## Decision

We convert `scripts/audit/` from Python to TypeScript, using `tsx` (already in use in `.github/tools/shared/`) for zero-build execution. `architecture-audit.yml` is updated to replace the Python/pip setup steps with `actions/setup-node@v4` and `npm ci` / `npm run audit`.

## Consequences

- Python is no longer a runtime dependency in CI for the standing architecture audit.
- Audit scripts are covered by Biome lint and TypeScript type-checking alongside the rest of the repository.
- `scripts/audit/` is added to Dependabot's npm ecosystem watch so dependencies stay current.
- The same exit contract is preserved: report mode (exit 0) by default; `--strict` mode exits 1 when findings exist.
- Finding identifiers and check names are unchanged so downstream triage and summaries are not disrupted.

## Alternatives considered

Keep Python for the audit scripts: rejected because it leaves Python as a separate runtime dependency purely for tooling, adds CI overhead, and prevents consistent linting.

Embed audit logic in a GitHub Actions shell script: rejected because it would be harder to type-check, test, and maintain.

## Evidence

- `.github/workflows/architecture-audit.yml`
- `scripts/audit/index.ts`, `scripts/audit/common.ts`
- `scripts/audit/check-workflow-security.ts`
- `scripts/audit/check-view-security-invoker.ts`
- `scripts/audit/check-temporal-registration.ts`
- `.github/dependabot.yml` (added `/scripts/audit` npm entry)
- Issue: #96
