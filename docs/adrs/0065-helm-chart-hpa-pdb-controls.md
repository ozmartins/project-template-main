# ADR-0065: Helm chart exposes HPA and PDB controls

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot
- **Supersedes / Superseded by:** —

## Context

ADR-0013 established a single application Helm chart with environment-specific values files. That chart already owns deployment-time knobs such as replica counts, resource requests, ingress, and secret references for the frontend and Temporal worker.

The chart previously relied on static `replicaCount` settings only. That left production with no in-chart way to express horizontal autoscaling policy for load spikes or pod disruption budgets for voluntary node drains and rolling maintenance. Because these controls affect deploy-time reliability behavior for the same workloads already managed by `charts/app/`, exposing them outside the chart would split the release contract across multiple deployment surfaces.

The new reliability settings also need guardrails: invalid HPA ranges (`minReplicas > maxReplicas`) and impossible disruption budgets (`minAvailable` above the workload minimum) should fail during template rendering and CI validation rather than at runtime.

## Decision

We expose HorizontalPodAutoscaler and PodDisruptionBudget configuration directly in the `charts/app/` values contract for the frontend and Temporal worker. The chart renders HPA resources only when `hpa.enabled=true`, renders PDB resources from chart values, ships production reliability defaults in `values-prod.yaml`, and validates invalid HPA/PDB combinations in both template logic and chart CI.

## Consequences

**Easier:**
- Operators can configure autoscaling and voluntary-disruption safety in the same Helm chart surface they already use for replicas, resources, secrets, and ingress.
- Production-specific reliability posture is reviewable in `values-prod.yaml` instead of being hidden in ad hoc cluster-side manifests.
- Invalid reliability settings fail early during `helm template` and `charts/app/ci-test.sh`, reducing deploy-time surprises.

**Harder:**
- The chart contract grows, so defaults and environment profiles must stay aligned as reliability settings evolve.
- HPA enablement now carries an external prerequisite: the target cluster must provide the Kubernetes resource metrics API (for example via Metrics Server).

**New obligations:**
- Keep chart documentation current when HPA/PDB settings or prerequisites change.
- Extend chart validation whenever new reliability constraints are added to the values surface.

## Alternatives considered

| Option | Reason rejected |
|---|---|
| Keep static replica counts only | Does not let the chart express autoscaling or disruption-budget policy for the workloads it deploys |
| Manage HPA/PDB as separate hand-written cluster manifests | Splits one release contract across multiple deploy surfaces and makes environment drift easier |
| Enable HPA/PDB only in production automation without chart values | Hides reliability behavior outside the chart interface and makes review/validation harder |

## Evidence

- Pull request: `#274 Add HPA and PDB support to the app Helm chart`
- Template implementation:
  - `charts/app/templates/hpa.yaml`
  - `charts/app/templates/pdb.yaml`
- Values contract and production profile:
  - `charts/app/values.yaml`
  - `charts/app/values-prod.yaml`
- Validation:
  - `charts/app/ci-test.sh`
- Documentation:
  - `charts/app/README.md`
- Related prior ADRs:
  - ADR-0013 — Helm Chart with Per-Environment Value Profiles
  - ADR-0014 — Helm Manifest Validation in CI
