# ADR-0080: OSV dependency review gate for PR lockfile changes

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot (implementation), @ianreay (review)
- **Supersedes / Superseded by:** —

## Context

This repository needs an open-source replacement for GitHub Advanced Security dependency review so pull requests can be blocked when they introduce new severe dependency vulnerabilities.

A naive dependency scan that fails on all currently-known vulnerabilities would deadlock development when baseline debt already exists on `main`. The gate must therefore compare the PR branch against its base branch and fail only on newly introduced `HIGH`/`CRITICAL` findings.

## Decision

We add a dedicated pull-request workflow (`.github/workflows/osv-scan.yml`) that uses `google/osv-scanner-action` pinned to a full commit SHA, scans `frontend/package-lock.json` and `temporal/package-lock.json`, compares base-vs-PR results with `osv-reporter-action`, and fails only when new `HIGH`/`CRITICAL` vulnerabilities are introduced.

The workflow publishes a minimal count-only summary table to the Actions step summary and uploads the generated SARIF file as a workflow artifact.

## Consequences

- PRs targeting `main` are protected against newly introduced severe dependency CVEs without requiring GHAS.
- Existing severe CVEs on `main` do not block unrelated pull requests.
- The gate remains least-privilege (`contents: read`) because SARIF is uploaded as an artifact rather than to code scanning.

## Alternatives considered

- Use GHAS Dependency Review. Rejected because the feature is not available for this repository tier.
- Fail on full-scan results without diffing against base. Rejected because existing baseline vulnerabilities would block all PRs.
- Scan only one lockfile. Rejected because both frontend and temporal services currently use npm lockfiles in this repository.

## Evidence

- `.github/workflows/osv-scan.yml`
- `frontend/package-lock.json`
- `temporal/package-lock.json`
