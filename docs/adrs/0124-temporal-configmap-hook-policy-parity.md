# ADR-0124: Temporal ConfigMap hook policy parity across AKS and EKS dev

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Copilot (implementation), platform-engineer review
- **Supersedes / Superseded by:** none

## Context

The local Temporal wrapper chart already renders the `temporal-config` ConfigMap as a Helm hook with `helm.sh/hook-delete-policy: before-hook-creation` in `charts/temporal/templates/configmap.yaml`. That makes the hook safe to recreate on retries and removes the original reason AWS EKS dev had `configMap.hook.enabled: false`.

Leaving AKS dev and EKS dev on different hook settings violates the repository's multi-cloud parity principle and creates environment-specific rollout behavior for the same chart.

## Decision

We enable `configMap.hook.enabled: true` in `charts/temporal/values-aws-dev.yaml` so both AKS dev and EKS dev use the same Temporal ConfigMap hook behavior.

## Consequences

- **Easier:** Temporal rolling upgrades behave the same on both supported cloud dev targets.
- **Harder:** Fresh-cluster and retry behavior now depends on the hook template keeping `before-hook-creation`; removing that annotation would reintroduce the AWS-specific failure mode.
- **New obligations:** Future changes to the Temporal ConfigMap hook must preserve cross-cloud compatibility instead of adding cloud-specific overrides without an ADR.

## Alternatives considered

- **Keep AWS hook disabled:** Rejected because it preserves environment drift for the same chart and leaves AWS without the pre-upgrade ConfigMap protection used on AKS dev.
- **Use separate cloud-specific hook behavior in templates:** Rejected because the hook template is already safe for retries and does not need a cloud split.

## Evidence

- `charts/temporal/templates/configmap.yaml`
- `charts/temporal/values-dev.yaml`
- `charts/temporal/values-aws-dev.yaml`
- Issue #1214
