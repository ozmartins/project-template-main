# ADR-0091: Build images workflow signs digests and publishes provenance

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Copilot coding agent
- **Supersedes / Superseded by:** None
- **Extends:** ADR-0012 and ADR-0070

## Context

The `CICD - Build Images` workflow already produces immutable image digests and can push them to Azure Container Registry and Amazon ECR. However, the pushed ACR images did not carry a signed identity binding back to this repository's workflow run, and the build produced no SBOM artifact for operators or auditors.

Issue #31 requires supply-chain evidence for each pushed image digest: keyless image signing with GitHub OIDC, registry-attached SLSA provenance, and an uploaded SPDX SBOM. This is a control-plane workflow change, so the security model and any pinning exceptions must be recorded in an ADR.

## Decision

We extend `.github/workflows/build-images.yml` so that pull requests build the Dockerfiles in a no-push, no-OIDC job, while trusted `main`/`dev` pushes run the supply-chain publication path. Each pushed ACR image digest is then:

1. signed with Cosign keyless signing from the `build-images.yml` workflow identity;
2. scanned into an SPDX JSON SBOM artifact uploaded with the workflow run; and
3. attested with GitHub's native attestation API for the pushed digest; and
4. attested with SLSA provenance via `slsa-framework/slsa-github-generator`.

The workflow keeps repository write scopes off and uses explicit job permissions only:
- workflow-level permissions stay at `contents: read` so OIDC and attestation scopes are not granted to unrelated jobs;
- `build-images-pr`: no extra permissions; it just builds PR-controlled Dockerfiles without push or OIDC;
- `build-images`: `contents: read`, `id-token: write` for trusted push-only registry publication (including optional ECR OIDC auth);
- `sign-images`: `attestations: write`, `id-token: write`
- provenance jobs: `actions: read`, `id-token: write`, `packages: write`

All added step-level actions are pinned to full commit SHAs. The SLSA generator remains referenced by the full semver tag `v2.1.0` because the upstream reusable workflow explicitly does not support hash references for this entrypoint.

## Consequences

**Better:**
- Operators can verify that a running ACR digest was signed by this repository's `build-images.yml` workflow on `main` or `dev`.
- Each pushed digest now has both an attached provenance attestation and a downloadable SPDX SBOM artifact.
- The signing and provenance paths continue to use ephemeral GitHub OIDC identity instead of long-lived signing keys.
- PR-controlled Dockerfile builds no longer run in a job that carries OIDC or attestation permissions.

**Trade-offs / obligations:**
- Provenance generation requires a follow-up job per image because the upstream SLSA generator is a reusable workflow, not a single workflow step.
- The SLSA generator consumes existing ACR credentials to attach the attestation in the registry.
- Future upgrades of the SLSA generator tag must be reviewed carefully because this reusable workflow cannot currently be SHA-pinned like ordinary step actions.

## Alternatives considered

| Option | Reason rejected |
|---|---|
| Keep unsigned images and rely on registry access controls alone | Does not provide tamper-evident provenance or satisfy the issue's SLSA/cosign acceptance criteria |
| Sign mutable tags instead of digests | Conflicts with ADR-0012 and weakens verification because tags can move |
| Replace the SLSA generator with a custom provenance script | Adds bespoke supply-chain logic when the issue explicitly asked for `slsa-github-generator` |
| SHA-pin the SLSA reusable workflow | Upstream container generator documentation states this entrypoint must be referenced by a full `vX.Y.Z` tag rather than a commit SHA |

## Evidence

- `.github/workflows/build-images.yml`
- `.github/workflows/WORKFLOWS.md`
- `README.md`
- ADR-0012: `docs/adrs/0012-immutable-image-builds-digest-promotion.md`
- ADR-0070: `docs/adrs/0070-build-images-ecr-oidc-authentication.md`
- Issue: `Volaris-AI/project-template#31`
