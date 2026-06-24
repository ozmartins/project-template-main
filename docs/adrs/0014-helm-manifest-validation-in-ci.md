# ADR-0014: Helm Manifest Validation in CI

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

Helm chart changes — template edits, new values keys, environment file overrides — can produce invalid Kubernetes YAML that is not caught until a live deploy fails. A failed production deploy is expensive; a failed dev deploy wastes developer time. Schema errors in rendered manifests should be caught at PR time, not at deploy time.

## Decision

The `pr-validation.yml` CI pipeline includes a `helm-charts` job that runs on every PR and push to main. It executes `charts/app/ci-test.sh` which:

1. `helm lint` — validates chart structure and required values
2. `helm template` — renders all three environment profiles (dev, test, prod)
3. Schema validation against the Kubernetes API schemas (via `kubeconform` or equivalent)
4. Records pass/fail outcome to `helm-results.json` for the CI history trend

This job runs on a GitHub-hosted runner with `azure/setup-helm` — no live cluster required. It is **gating**: a chart error blocks the PR.

## Consequences

**Positive:**
- Chart errors are caught at PR time, before they can reach any live environment.
- No live cluster is needed; the validation is pure static analysis on rendered YAML.
- All three environment profiles are tested, so a prod-specific misconfiguration is caught on a dev-focused PR.
- Results feed the CI history trend dashboard, making chart health observable over time.

**Negative:**
- `helm lint` and `helm template` do not catch runtime errors (missing secrets, wrong image pull policy for the node's pull capabilities). Live testing still matters for those.
- Schema validation depends on keeping the Kubernetes schema version used for validation current. An outdated schema version will not catch new API deprecations.
- The test is limited to the chart itself — it does not validate that the Temporal server is reachable or that deployed secrets exist.

## Alternatives considered

**Validate only on push to main:** Catches errors earlier (PR time) at essentially no extra cost, since the runner is GitHub-hosted.

**Live cluster dry-run (`helm upgrade --dry-run`):** More thorough (server-side validation) but requires cluster credentials in CI. Out of scope for the default GitHub-hosted runner policy (ADR-0010).

**No chart CI validation:** Status quo before this ADR. Chart errors reached dev deploys regularly, wasting 20–40 minutes per incident.

## Evidence

- `.github/workflows/pr-validation.yml` — `helm-charts` job
- `charts/app/ci-test.sh` — lint + render + validate script
- ADR-0013 — chart structure this validation covers
