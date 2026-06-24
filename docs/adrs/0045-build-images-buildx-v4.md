# ADR-0045: Build Images workflow uses docker/setup-buildx-action v4

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The `build-images` control-plane workflow builds and optionally pushes the frontend and temporal worker container images. This workflow currently relies on `docker/setup-buildx-action` to provision Buildx on GitHub-hosted runners.

The dependency update in this PR moves `docker/setup-buildx-action` from major version 3 to 4 in `.github/workflows/build-images.yml`. Because workflow files are control-plane boundaries in this repository, this major action-version change must be explicitly captured as an ADR in the same PR.

## Decision

We use `docker/setup-buildx-action@v4` in `.github/workflows/build-images.yml` for the Build Images workflow.

## Consequences

- Keeps the workflow aligned with the latest major release for Buildx setup.
- Requires tracking future major action upgrades through the ADR process when they touch control-plane workflow files.
- Introduces potential merge-drift risk with concurrent workflow-bump PRs touching the same file, so rebasing may be required before merge.

## Alternatives considered

- Keep `docker/setup-buildx-action@v3`: rejected because this PR is explicitly a dependency major-version update.
- Defer ADR creation: rejected because control-plane workflow changes in this repository require ADR coverage in the same PR.

## Evidence

- `.github/workflows/build-images.yml`
- Pull request: `chore(deps): Bump docker/setup-buildx-action from 3 to 4`
