# ADR-0070: Build Images Uses GitHub OIDC for ECR Authentication

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot (implementation), @ianreay (security review)
- **Supersedes / Superseded by:** Supersedes the previous long-lived AWS key path in `build-images.yml`

## Context

The build-images workflow can publish container images to Azure Container Registry and Amazon ECR. The prior ECR path depended on repository secrets for `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, which created a long-lived credential boundary inside GitHub Actions and did not align with the repository's least-privilege workflow policy.

This repository already requires explicit workflow permissions and treats `.github/workflows/**` as a control-plane boundary. The ECR publish path therefore needs an in-PR ADR that records the credential model and the minimum GitHub token permissions required by the workflow.

## Decision

The `build-images.yml` workflow now uses GitHub OIDC plus `aws-actions/configure-aws-credentials` to assume a scoped AWS role when ECR publishing is enabled.

- The workflow declares only `contents: read` and `id-token: write`.
- ECR authentication is enabled only when `vars.AWS_ECR_REGISTRY`, `vars.AWS_ECR_PUSH_ROLE_ARN`, and `vars.AWS_REGION` are configured.
- The workflow no longer reads repository secrets for AWS access keys.
- The assumed role is expected to be limited to the ECR push actions required for the target registry.

## Consequences

**Better:**
- No reusable AWS access keys are stored in repository secrets for image publishing.
- The credential lifetime is bound to the workflow run.
- AWS access can be narrowed to a single role per environment/registry.

**Trade-offs:**
- Operators must provision and trust an AWS IAM role for GitHub's OIDC provider before ECR publishing will activate.
- ACR-only publishing still works without any AWS configuration.

## Evidence

- `.github/workflows/build-images.yml`
- `.github/scripts/build-images-metadata.sh`
- PR #375 security review feedback
