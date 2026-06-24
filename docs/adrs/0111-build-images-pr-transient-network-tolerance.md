# ADR-0111: Build-images PR path tolerates transient network/cache failures

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Copilot coding agent
- **Supersedes / Superseded by:** N/A

## Context
PR image builds failed on transient upstream/network conditions unrelated to repository code: Buildx cache export returned a 503 upstream timeout, and `npm ci --include=dev` failed with `ECONNRESET` during the Temporal image build. These failures block draft PR verification even when source changes are unrelated.

## Decision
We tolerate transient GitHub Actions cache-export failures in the PR-only image build path and configure npm fetch retries/timeouts in the Temporal Docker image builds.

## Consequences
PR image builds are more resilient to temporary infrastructure/network instability and less likely to fail spuriously. Cache export may be skipped when unavailable, so some PR builds may run slower due to reduced cache warm-up.

## Alternatives considered
- Keep strict cache-export failure behavior and rely only on manual reruns. Rejected because the same transient failures repeatedly block CI and require human intervention.
- Replace Docker build action with custom retry wrappers. Rejected as broader scope and higher maintenance than targeted hardening.

## Evidence
- `.github/workflows/build-images.yml`
- `temporal/Dockerfile`
- PR comment on `Volaris-AI/project-template#1024` describing `buildx` 503 and `npm ci` `ECONNRESET` failures.
