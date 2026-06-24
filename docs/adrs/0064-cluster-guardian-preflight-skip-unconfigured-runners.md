# ADR-0064: Cluster Guardian skips preflight on runners without cluster access

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

`cluster-guardian` runs from the shared control-plane launcher in
`.github/tools/shared/src/run-agent.ts`. The hourly workflow can still invoke
that launcher from GitHub-hosted infrastructure or from runners that do not yet
expose a usable kubeconfig and current context.

Without an early gate, the guardian continues into live Kubernetes discovery and
produces noisy localhost or unreachable-cluster failures even though the problem
is runner placement or runner setup, not cluster health. That misroutes a
control-plane configuration problem into false runtime incidents.

## Decision

We make `run-agent.ts` fail closed for `cluster-guardian` before opening a
Copilot session when live cluster access is unavailable. The launcher now writes
a skip summary and exits successfully when any of these are true:

- `factory.active_runner_profile` is `github-hosted-mvp`
- no kubeconfig exists from `KUBECONFIG` or `~/.kube/config`
- `kubectl config current-context` does not return a usable context

## Consequences

- The hourly Cluster Guardian stage still executes, but it now reports an
  explicit skip reason instead of attempting unreachable-cluster discovery.
- False cluster incidents caused by GitHub-hosted routing or incomplete runner
  bootstrap are suppressed at preflight.
- Live guardian discovery now depends on the runner contract being satisfied
  before the shared launcher step runs, so any future workflow or runner change
  must keep kubeconfig and current context wiring intact.

**Rollback:** If Cluster Guardian must probe from a different runner profile or
bootstrap path, update the preflight contract and its tests in the same PR. Do
not remove the guard without replacing it with an equally explicit access check,
or the hourly workflow will regress to noisy false incidents.

## Alternatives considered

- Allow the guardian to attempt discovery and rely on runtime errors: rejected
  because it conflates control-plane misconfiguration with actual cluster
  incidents.
- Skip only on `github-hosted-mvp` and ignore kubeconfig or context checks:
  rejected because self-hosted or future runner profiles can still be
  unconfigured at job start.
- Move the skip logic into the agent prompt instead of the launcher: rejected
  because the shared launcher can exit before creating a Copilot session, which
  is cheaper and keeps the failure mode deterministic.

## Evidence

- `.github/tools/shared/src/run-agent.ts` — shared launcher preflight gate via
  `getClusterGuardianPreflightSkipReason(...)`
- `.github/tools/shared/src/__tests__/run-agent.test.ts` — skip coverage for
  github-hosted, missing kubeconfig, missing current context, and allowed run
- `.github/tools/shared/src/__tests__/cluster-guardian-foundation.test.ts` —
  hourly stage contract keeps Cluster Guardian isolated in the shared launcher
- `.github/workflows/pipeline-hourly.yml` — scheduled workflow step that invokes
  `npx tsx src/run-agent.ts --agent cluster-guardian`
- `.github/factory.yml` — `factory.active_runner_profile` and runner placement
  inputs consumed by the preflight decision
