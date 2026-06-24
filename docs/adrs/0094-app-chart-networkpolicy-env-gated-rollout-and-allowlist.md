# ADR-0094: App chart NetworkPolicy env-gated rollout and minimal allowlist

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

The app Helm chart previously rendered no `NetworkPolicy`, leaving workloads open to unrestricted pod-to-pod traffic by default. This PR introduces default-deny isolation and explicit per-component exceptions, which is a deploy/network boundary decision and must be recorded in-PR.

The rollout also needs to remain environment-gated: local/base installs should stay non-disruptive while test/prod can enforce default-deny behavior. In addition, chart defaults for `temporalWorker.supabase.url` and `opsApi.supabase.url` use `http://supabase:8000`, so the policy contract must preserve that data-plane path when network policies are enabled.

## Decision

We adopt an environment-gated NetworkPolicy model in `charts/app`:

1. `networkPolicy.enabled: false` in base `values.yaml` and `values-dev.yaml`.
2. `networkPolicy.enabled: true` in `values-test.yaml` and `values-prod.yaml`.
3. `frontend-policy` allows ingress only from the configured ingress-controller namespace and limits egress to DNS.
4. `temporal-worker-policy` and `ops-api-policy` deny ingress and allow only DNS plus TCP `8000`, `443`, and `7233` egress.
5. A chart CI contract test (`charts/app/ci-test.sh`) must assert both gating behavior and the rendered allowlist shape.

## Consequences

- Test/prod receive default-deny isolation with explicit least-privilege connectivity rules.
- Base/dev remain opt-in, reducing rollout risk for local development and ad-hoc installs.
- Worker and ops-api keep the chart’s documented default Supabase connectivity (`http://supabase:8000`) when NetworkPolicies are enabled.
- Any future dependency-path changes (new ports or ingress requirements) must update both policy templates and contract assertions in `charts/app/ci-test.sh`.

## Alternatives considered

- **Enable NetworkPolicies by default in base values:** Rejected. This is not environment-gated and can unexpectedly disrupt installs that do not layer env profiles.
- **Allow broad egress (all TCP or all destinations):** Rejected. It weakens isolation and does not encode a minimal allowlist contract.
- **Rely on resource-presence checks only in CI:** Rejected. Names-only checks do not protect against policy-shape regressions.

## Evidence

- `charts/app/templates/networkpolicies.yaml`
- `charts/app/values.yaml`
- `charts/app/values-dev.yaml`
- `charts/app/values-test.yaml`
- `charts/app/values-prod.yaml`
- `charts/app/ci-test.sh`
- `charts/app/README.md`
- Commits: `6a559bd`, `2257a80`, `a2d249f`
