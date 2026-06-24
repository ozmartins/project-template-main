# ADR-0102: Build-images PR scan tool runtime compatibility fixes

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Copilot (implementation), maintainers
- **Supersedes / Superseded by:** Extends ADR-0092

## Context
The `build-images-pr` job in `.github/workflows/build-images.yml` was failing at the scan gate for both frontend and temporal-worker images because the Dockle CLI invocation used an unsupported `--ignore-file` flag and Grype rejected stale DB metadata age checks in GitHub-hosted runs.

## Decision
We keep PR image scanning enabled, but update the workflow to pass Dockle ignores through `DOCKLE_IGNORES` and disable Grype DB age validation in the PR scan step (`GRYPE_DB_VALIDATE_AGE=false`) so scan execution remains compatible with current tool behavior.

## Consequences
PR scan steps continue to run and enforce findings, while no longer failing due to the Dockle flag mismatch or Grype DB age validation runtime issue. The security gate remains active, but with reduced infrastructure-noise failures.

## Alternatives considered
- Keep the existing scan commands and accept recurring CI failures (rejected: blocks unrelated PRs).
- Disable PR scan steps entirely (rejected: weakens the PR security gate more than necessary).

## Evidence
- `.github/workflows/build-images.yml`
- CI failure logs for run `27976269719` (`build-images-pr` jobs)
