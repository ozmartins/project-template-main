# ADR-0103: Gitleaks PR scan uses pull-request read scope and secretless PR path

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Copilot coding agent
- **Supersedes / Superseded by:** Extends ADR-0090

## Context

The `Security - Gitleaks secret scan` workflow failed on pull requests with `403 Resource not accessible by integration` when `gitleaks-action` requested `GET /repos/Volaris-AI/project-template/pulls/<number>/commits`. The workflow had only `permissions: contents: read`, which does not grant pull-request API read access for that endpoint. A prior attempt added `GITLEAKS_LICENSE` to the PR path, but logs showed the failure persisted even with the license present.

## Decision

We keep PR scans secretless and grant only the missing API scope required for PR commit enumeration:

- Add `pull-requests: read` to workflow permissions.
- Remove `GITLEAKS_LICENSE` from the Gitleaks step environment for PR-triggered execution.

## Consequences

- Gitleaks PR scans can read PR commit deltas using the default `GITHUB_TOKEN` without broadening write capabilities.
- Fork-triggered PR runs remain secretless.
- The workflow keeps least-privilege read scopes (`contents: read`, `pull-requests: read`) and does not introduce additional secrets on the PR path.

## Alternatives considered

- Keep `contents: read` only and retry with `GITLEAKS_LICENSE`: rejected because run logs confirmed the failure was token scope (`403`), not licensing.
- Switch to elevated tokens/PATs: rejected because read-only `pull-requests: read` is sufficient and lower risk.

## Evidence

- `.github/workflows/gitleaks.yml`
- Failed run showing root cause: `actions/runs/27988667558` (`GET /pulls/771/commits` returned `403`)
- PR comment thread on `fix(ci): pass GITLEAKS_LICENSE secret to gitleaks-action for org repos`
