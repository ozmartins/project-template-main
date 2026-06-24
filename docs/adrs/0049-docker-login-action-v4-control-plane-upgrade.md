# ADR-0049: Use docker/login-action v4 in control-plane workflows

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The `build-images` workflow (`build-images.yml`) uses `docker/login-action` to authenticate against the container registry before pushing images. This action is a control-plane dependency: it gates registry write access on every main-branch push.

This PR moves `docker/login-action` from major version 3 to 4. Under ADR-0044, any control-plane workflow major-version action bump requires an in-PR ADR documenting the rationale, security posture, and rollback path before the PR can clear platform review.

The workflow retains `permissions: contents: read` at the job level. Registry login is conditional: the `push-gate` step only enables it when the event is a push to `main` **and** the required repository variables (`vars.ACR_LOGIN_SERVER`) and secrets (`secrets.ACR_USERNAME`, `secrets.ACR_PASSWORD`) are all present. No new credential surface is introduced; the action consumes the same existing registry secrets.

## Decision

We use `docker/login-action@v4` in `.github/workflows/build-images.yml` for registry authentication.

## Consequences

**Easier:**
- Keeps the workflow aligned with the current supported major release of `docker/login-action`.
- Reduces exposure to unsupported-version risk and ensures Node.js runtime compatibility with GitHub-hosted runners.

**Harder:**
- Future major bumps will again require an ADR under the same ADR-0044 policy.

**New obligations:**
- If registry authentication regresses on main-branch pushes, roll back by pinning `docker/login-action@v3` in `build-images.yml` and document the regression in a superseding ADR.

## Alternatives considered

| Option | Reason rejected |
|---|---|
| Keep `docker/login-action@v3` | Leaves a known drift against the latest supported release; v3 may eventually receive reduced maintenance |
| Defer to a platform sweep PR | Increases batch-risk by combining unrelated control-plane changes; ADR-0044 prefers isolated, reviewable bumps |

## Evidence

- Workflow file changed: `.github/workflows/build-images.yml`
- Existing registry secrets consumed: `ACR_USERNAME`, `ACR_PASSWORD`, `ACR_LOGIN_SERVER`
- Workflow permissions unchanged: `contents: read`
- Push gate remains conditional on `github.event_name == 'push' && github.ref == 'refs/heads/main'`
- Pull request: `chore(deps): Bump docker/login-action from 3 to 4`
- Policy reference: [ADR-0044](./0044-github-actions-control-plane-major-upgrades.md)
