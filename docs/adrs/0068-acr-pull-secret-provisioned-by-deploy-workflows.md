# ADR-0068: ACR Pull Secret Provisioned as Idempotent Preflight in Deploy Workflows

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot (implementation), @ianreay (product direction)
- **Supersedes / Superseded by:** Partially supersedes ADR-0033 (image-pull-secret provisioning for dev/test is now a deploy-workflow responsibility, not the operator's)

## Context

Container deployments to `10x-stack-dev` and `10x-stack-test` fail with `ImagePullBackOff` because
the Helm chart references `imagePullSecrets: [{name: acr-pull}]` (wired in `values-dev.yaml` and
`values-test.yaml`) but the corresponding `kubernetes.io/dockerconfigjson` secret does not exist in
those namespaces.

The secret must exist in the target namespace before `helm upgrade --install` runs. Two strategies
were considered: a one-time bootstrap applied by a human operator, or an idempotent step executed
by the deploy workflow itself before every Helm upgrade.

## Decision

We add an **"Ensure acr-pull imagePullSecret exists"** step to both `deploy-dev.yml` and
`deploy-test.yml`, placed immediately after the kubeconfig is configured and before the Helm
upgrade. The step uses `kubectl create secret docker-registry … --dry-run=client -o yaml | kubectl
apply -f -` to be fully idempotent: it creates the secret on first run and is a no-op on subsequent
runs when the secret is already up-to-date.

Registry credentials (`ACR_USERNAME`, `ACR_PASSWORD`) are injected as step-scoped environment
variables sourced from existing GitHub secrets of the same name. The registry server is taken from
the existing `ACR_LOGIN_SERVER` repository variable, already used by the Helm upgrade step.

`deploy-test.yml` did not previously install kubectl; a matching `azure/setup-kubectl@v4` step is
added alongside the new secret step, consistent with `deploy-dev.yml`.

## Consequences

**Positive:**
- Image pull errors in `10x-stack-dev` and `10x-stack-test` are eliminated without requiring manual
  cluster access or a separate bootstrap step.
- Idempotency means re-runs and re-deployments are safe — the step never fails if the secret already
  exists and matches.
- Credentials are never written to disk or logs; they live only in step-scoped environment
  variables, consumed by kubectl and then discarded.

**Negative:**
- Each deploy run issues one extra `kubectl apply` call. The overhead is negligible.
- The `gha-deployer` service account must have `create` and `patch` RBAC on `secrets` in each
  namespace. This is already required by the Helm deploy itself; no RBAC changes are needed.

## Alternatives considered

1. **One-time human operator bootstrap** — Simpler in the workflow, but fragile: the secret is lost
   if the namespace is recreated and requires manual intervention to recover. Rejected in favour of
   self-healing automation.

2. **Sealed Secrets / ExternalSecrets** — More consistent with ADR-0042 (OpenBao ExternalSecrets),
   but adds operator setup complexity (SecretStore, ExternalSecret manifest) for a single pull
   credential. Appropriate for future consolidation; out of scope for this unblocking fix.

## Evidence

- `charts/app/values-dev.yaml` — `imagePullSecrets: [{name: acr-pull}]`
- `charts/app/values-test.yaml` — `imagePullSecrets: [{name: acr-pull}]`
- `.github/workflows/deploy-dev.yml` — "Ensure acr-pull imagePullSecret exists" step
- `.github/workflows/deploy-test.yml` — "Ensure acr-pull imagePullSecret exists" step
- GitHub issue #122
