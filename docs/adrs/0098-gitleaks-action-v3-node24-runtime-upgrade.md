# ADR-0098: Upgrade gitleaks/gitleaks-action from v2.3.9 to v3.0.0 (Node 24 runtime)

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

ADR-0090 introduced a dedicated `.github/workflows/gitleaks.yml` secret-scan gate using `gitleaks/gitleaks-action@v2.3.9` (SHA-pinned per ADR-0080). That action uses the Node 20 runtime.

GitHub is deprecating Node 20 for Actions on a fixed schedule:

| Date | Effect |
|---|---|
| 2 June 2026 | GitHub-hosted runners default to Node 24; Node 20 actions require `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` to continue running |
| 16 September 2026 | Node 20 is removed from GitHub-hosted runners entirely; `gitleaks-action@v2` stops working regardless of any opt-out flag |

The first deadline (2 June 2026) has already passed. Remaining on `gitleaks-action@v2.3.9` therefore blocks the workflow from running reliably on GitHub-hosted runners without an unsupported workaround, and will hard-fail after September 2026.

Under ADR-0044, any control-plane workflow major-version action bump requires a same-PR ADR documenting the rationale, compatibility assessment, and rollback path.

## Decision

We upgrade `gitleaks/gitleaks-action` from `v2.3.9` to `v3.0.0` in `.github/workflows/gitleaks.yml`, pinned to the immutable SHA `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` per ADR-0080.

## Compatibility assessment

Per the upstream release notes for v3.0.0:

- **Runtime change only:** `node20` → `node24` in `action.yml`. No changes to inputs, outputs, or scanning behavior.
- **Gitleaks binary:** unchanged; the same gitleaks version and ruleset are used.
- **`GITLEAKS_LICENSE` behavior:** unchanged; audit mode (no license key) continues to work as before.
- **Workflow permissions:** unchanged; `permissions: contents: read` is retained.
- **Self-hosted runners:** Node 24 support requires runner version `>= v2.327.1`. GitHub-hosted runners already satisfy this.

The upgrade is a forced runtime migration with no behavioral delta.

## Consequences

**Easier:**
- The `Gitleaks secret scan` CI gate continues to run on current GitHub-hosted runners without requiring `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true`.
- Avoids a hard workflow failure after the September 2026 Node 20 removal deadline.

**Harder:**
- Self-hosted runner environments must be on runner `>= v2.327.1` for Node 24 support (this repository currently uses GitHub-hosted runners; no action required today).

**New obligations:**
- If the gitleaks scan regresses after this upgrade, roll back by pinning `gitleaks-action@v2.3.9` at its original SHA (`b298d3a3…`) in `gitleaks.yml` and document the regression in a superseding ADR.

## Alternatives considered

| Option | Reason rejected |
|---|---|
| Remain on `gitleaks-action@v2.3.9` | Requires `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` workaround today and hard-fails after September 2026 |
| Defer to a platform sweep PR | Increases batch-risk; the Node 20 deprecation is already active and the fix is isolated to one workflow file |
| Pin to a pre-release or intermediate SHA | No intermediate v2.x release resolves the Node 20 deprecation; v3.0.0 is the supported migration path |

## Evidence

- Workflow file changed: `.github/workflows/gitleaks.yml`
- Action pinned SHA: `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` (`v3.0.0`)
- Upstream release notes: https://github.com/gitleaks/gitleaks-action/releases/tag/v3.0.0
- Policy references: [ADR-0044](./0044-github-actions-control-plane-major-upgrades.md), [ADR-0080](./0080-workflow-actions-pinned-to-commit-shas.md), [ADR-0090](./0090-gitleaks-dedicated-ci-workflow-and-pre-push-hook.md)
