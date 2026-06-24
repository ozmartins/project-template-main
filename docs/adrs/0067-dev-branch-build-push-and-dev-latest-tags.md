# ADR-0067: Dev branch push to ACR with dev-latest tags

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The `Build Images` workflow (`.github/workflows/build-images.yml`) was previously configured to push container images to Azure Container Registry (ACR) only on `push` to `main`. The `Deploy Dev` workflow (`deploy-dev.yml`) was correspondingly gated to trigger only when a `main`-branch Build Images run completed.

The dev environment is expected to track the `dev` branch continuously: every merged commit should produce fresh images and trigger a deploy. Without dev-branch push support, the dev environment can only be updated by commits landing on `main`, creating drift between what developers are testing on the `dev` branch and what is running in the dev cluster.

Additionally, the issue requested a clear mutable tag strategy so that consumers of the registry can pull the latest dev or main image without knowing the exact commit SHA:
- `dev` branch → `<registry>/<image>:dev-latest`
- `main` branch → `<registry>/<image>:latest`

SHA-pinned tags (`<sha>` and `<short_sha>`) continue to be produced and are used by the deploy workflows for digest-based promotion per ADR-0012.

This workflow file is a control-plane boundary (ADR-0044), so the change is captured here before merging.

## Decision

We extend `.github/workflows/build-images.yml` and `.github/scripts/build-images-metadata.sh` to:

1. **Trigger on `dev` branch pushes** in addition to `main`.
2. **Enable push on both `main` and `dev`** when `vars.ACR_LOGIN_SERVER`, `secrets.ACR_USERNAME`, and `secrets.ACR_PASSWORD` are all set.
3. **Produce a mutable convenience tag** alongside the immutable SHA tags:
   - `refs/heads/dev` → `<registry>/<image>:dev-latest`
   - `refs/heads/main` → `<registry>/<image>:latest`
4. **Trigger `Deploy Dev`** from completed Build Images runs on both `main` and `dev`.

The deploy workflow consumes image digests from build artifacts (not the mutable tags), preserving the immutable promotion guarantee from ADR-0012.

## Consequences

**Easier:**
- Dev environment is updated on every merge to `dev`, not just on `main`.
- Operators can pull `acrselfhealstg.azurecr.io/frontend:dev-latest` for quick local testing without looking up a SHA.
- `K8S_DEPLOY_ENABLED=true` enables end-to-end deploys from both `main` and `dev` branches.

**Harder / New obligations:**
- `dev-latest` and `latest` are mutable tags and must not be used as the source of truth for deploy promotion — only digests from workflow artifacts should be used for cluster deployments (ADR-0012).
- Any future branches that need push support must be explicitly added to both `build-images.yml` and `build-images-metadata.sh`; the workflow does not support wildcard branch patterns.

## Alternatives considered

| Option | Reason rejected |
|---|---|
| Keep push limited to `main` only | Dev environment can only be updated from main commits; defeats the purpose of a separate dev branch |
| Use a wildcard branch filter (`**`) | Over-broad: would push images from all feature branches, creating registry noise and unnecessary ACR storage consumption |
| Use a separate workflow for dev-branch builds | Adds maintenance overhead; the single `build-images.yml` with a conditional push gate is simpler and already handles PR builds cleanly |

## Evidence

- Workflow changed: `.github/workflows/build-images.yml`
- Script changed: `.github/scripts/build-images-metadata.sh`
- Deploy trigger changed: `.github/workflows/deploy-dev.yml`
- ACR login server variable: `vars.ACR_LOGIN_SERVER` (`acrselfhealstg.azurecr.io`)
- Registry secrets consumed: `secrets.ACR_USERNAME`, `secrets.ACR_PASSWORD`
- Policy references: [ADR-0012](./0012-immutable-image-builds-digest-promotion.md), [ADR-0044](./0044-github-actions-control-plane-major-upgrades.md)
- Issue: Volaris-AI/project-template#125
