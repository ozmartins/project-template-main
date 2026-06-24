# Deployment — Contributor Guide

This guide explains how deployment is structured in this template so contributors can safely change deployment behavior in code and configuration.

It is intentionally scoped to development and change-planning. It does **not** cover day-2 operations, incident response, or production approval flow. See `docs/devsecops/` for those.

---

## Contents

- [Supported deployment targets](#supported-deployment-targets)
- [Common deployment model](#common-deployment-model)
- [Helm charts](#helm-charts)
  - [Chart structure](#chart-structure)
  - [Environment value profiles](#environment-value-profiles)
  - [Helm design patterns](#helm-design-patterns)
- [Terraform layout](#terraform-layout)
  - [Reusable module: app-instance](#reusable-module-app-instance)
  - [Platform prereqs stacks](#platform-prereqs-stacks)
  - [Per-app environment stacks](#per-app-environment-stacks)
- [Image registry differences (ACR vs ECR)](#image-registry-differences-acr-vs-ecr)
- [Secrets management](#secrets-management)
  - [Local: .env file](#local-env-file)
  - [Cloud: OpenBao and External Secrets Operator](#cloud-openbao-and-external-secrets-operator)
- [Validate deployment changes without cluster access](#validate-deployment-changes-without-cluster-access)
- [Key paths at a glance](#key-paths-at-a-glance)

---

## Supported deployment targets

This template supports three deployment paths:

| Target | Runtime | Image registry | Secret delivery | CDN/edge |
|--------|---------|----------------|-----------------|----------|
| **Local (Docker Desktop)** | Docker Compose + Supabase CLI | Local Docker build | `.env` file | None (localhost) |
| **Azure (AKS)** | `aks-selfheal-staging` (rg-selfheal-staging, eastus2) | ACR (`acrselfhealstg.azurecr.io`) | OpenBao + ESO | Azure Front Door |
| **AWS (EKS)** | `dev-eks-cluster` (us-east-1) | ECR (`354918379520.dkr.ecr.us-east-1.amazonaws.com`) | OpenBao + ESO | CloudFront |

For the full target-differences matrix and credential flow, see [`docs/specs/platform-deployment-spec.md`](../specs/platform-deployment-spec.md).

---

## Common deployment model

All three targets share the same conceptual flow:

```
Build image → Push to registry → Helm upgrade (values profile) → Runtime reads secrets
```

- **Build and push** is handled by GitHub Actions (`build-images.yml`). The image digest is passed at deploy time via `--set frontend.image.digest=sha256:…`.
- **Helm** applies the same `charts/app/` chart with a different values profile for each environment.
- **Secrets** are either injected from `.env` (local) or resolved from OpenBao by the External Secrets Operator (cloud).
- **Terraform** does not deploy application pods directly. It provisions namespaces, RBAC, the Supabase Helm release, OpenBao, and the CDN endpoint, then writes GitHub secrets so deploy workflows can reach the cluster.

The target-specific variation is fully expressed in two places:

1. A Helm values profile file under `charts/app/`.
2. A Terraform stack directory under `terraform/stacks/`.

No target-specific logic lives inside Helm templates or application code.

---

## Helm charts

### Chart structure

The main application chart lives at [`charts/app/`](../../charts/app/). Supporting platform charts used by Terraform (not by contributors directly) are at `charts/temporal/` and `charts/supabase/`.

```
charts/app/
  Chart.yaml
  values.yaml               # canonical defaults — all keys documented inline
  values-dev.yaml           # Azure AKS dev profile
  values-aws-dev.yaml       # AWS EKS dev profile (note -aws- infix)
  values-test.yaml          # Azure AKS test profile
  values-prod.yaml          # Azure AKS production profile
  templates/
    frontend-deployment.yaml
    temporal-worker-deployment.yaml
    ops-api-deployment.yaml
    frontend-service.yaml
    ops-api-service.yaml
    frontend-ingress.yaml
    serviceaccounts.yaml    # one ServiceAccount per workload identity
    networkpolicies.yaml    # default-deny + component allowlists
    externalsecrets.yaml    # ExternalSecret resources (cloud profiles only)
    hpa.yaml
    pdb.yaml
    _helpers.tpl
  ci-test.sh                # local CI validation (no cluster needed)
  README.md
```

`values.yaml` is the canonical key reference. Read it before adding or changing a key in any profile.

### Environment value profiles

Each environment has its own values file. The split is intentional — contributors can see exactly what differs between environments without reading template conditionals.

| File | Target | Key differences |
|------|--------|----------------|
| `values.yaml` | Defaults only | Not used as a standalone profile; provides fallback for all keys |
| `values-dev.yaml` | Azure AKS dev | `acr-pull` imagePullSecret, AFD source range restrictions |
| `values-aws-dev.yaml` | AWS EKS dev | No pull secret (node IAM role), NLB annotations, `externalSecrets.enabled: true` |
| `values-test.yaml` | Azure AKS test | Similar to dev, stricter replica counts |
| `values-prod.yaml` | Azure AKS prod | Higher replicas, PDB, full external secrets |

When adding a new configurable behavior:

1. Add the key and a doc comment to `values.yaml`.
2. Add environment-appropriate overrides to each profile file.
3. Run `bash charts/app/ci-test.sh` to confirm rendering is correct across all Azure profiles.
4. Run `helm lint charts/app -f charts/app/values-aws-dev.yaml` separately for the AWS profile.

### Helm design patterns

Understanding these patterns matters when adding new workloads or ports.

**NetworkPolicies** — `templates/networkpolicies.yaml` renders a default-deny ingress/egress policy plus component-specific allowlists. Enabled by default, controlled by `networkPolicy.enabled`. When you add a new workload or upstream dependency, add the corresponding allow rule to the template and update the values files. Do not disable the policy globally.

**ServiceAccounts** — `templates/serviceaccounts.yaml` creates one `ServiceAccount` per workload (`frontend`, `temporal-worker`, `ops-api`) with `automountServiceAccountToken: false`. This prevents ambient token injection for workloads that do not need cluster API access. Keep this per-workload pattern when adding new components.

**Resource limits and probes** — every workload must define CPU/memory requests and limits, plus liveness and readiness probes. The `ci-test.sh` script asserts these fields are present. Omitting them fails the CI check.

---

## Terraform layout

```
terraform/
  modules/
    app-instance/           # Reusable module — one complete app stack
  platform/
    azure-staging/          # Documents and validates Azure shared prereqs
    aws-staging/            # Same for AWS
  stacks/
    10x-stack-dev/          # This template on Azure staging (dev)
    10x-stack-aws-dev/      # This template on AWS (dev stub)
```

### Reusable module: app-instance

[`terraform/modules/app-instance/`](../../terraform/modules/app-instance/) is the single reusable module. Each per-app stack calls it with target-specific variable values. The module provisions:

| Module file | What it provisions |
|------------|-------------------|
| `namespaces.tf` | Kubernetes namespaces (`{app}-dev`, `{app}-test`, `{app}-supabase`) and RBAC |
| `registry.tf` | `acr-pull` imagePullSecret for Azure (no-op for AWS) |
| `supabase.tf` | Supabase Helm release with auto-generated credentials (`random_password`, `random_bytes`) |
| `vault.tf` | OpenBao deployment and Kubernetes auth configuration |
| `external_secrets.tf` | ESO `SecretStore` and `ExternalSecret` resources |
| `frontdoor_azure.tf` | Azure Front Door endpoint, origin, and route |
| `cloudfront_aws.tf` | CloudFront behavior override (AWS only) |
| `temporal_ns.tf` | Registers Temporal namespace in the shared Temporal server |
| `github_outputs.tf` | Writes Terraform outputs (`KUBE_CONFIG_DEV`, `ACR_LOGIN_SERVER`, etc.) to GitHub secrets |

All credentials are generated by Terraform — never committed to git, manually created, or copied across environments.

### Platform prereqs stacks

[`terraform/platform/azure-staging/`](../../terraform/platform/azure-staging/) and [`terraform/platform/aws-staging/`](../../terraform/platform/aws-staging/) use `data` sources to validate that shared cluster resources exist before any app stack can be applied. They create nothing. If a prerequisite is missing, Terraform fails with a clear error.

You do not need to modify these stacks for normal application development.

### Per-app environment stacks

[`terraform/stacks/10x-stack-dev/`](../../terraform/stacks/10x-stack-dev/) is the concrete Azure dev instance. It calls `app-instance` with Azure-specific variables. [`terraform/stacks/10x-stack-aws-dev/`](../../terraform/stacks/10x-stack-aws-dev/) is the AWS equivalent.

When forking this template for a new application:

1. Copy a stack directory and rename it.
2. Update `terraform.tfvars` with your `app_name`, `environment`, and `cloud`.
3. Update `backend.tf` to point at your Terraform state bucket.

Differences between a fork and this template belong in `terraform.tfvars` and the Helm values profile — not in the `app-instance` module.

---

## Image registry differences (ACR vs ECR)

The registry choice is the most visible target-specific difference. Both targets use the same chart templates; only the image pull mechanism and the registry URL differ.

| Concern | Azure AKS | AWS EKS |
|---------|-----------|---------|
| Registry | `acrselfhealstg.azurecr.io` | `354918379520.dkr.ecr.us-east-1.amazonaws.com` |
| Pull auth | `acr-pull` imagePullSecret (created by Terraform) | EKS node IAM role (no pull secret needed) |
| Helm values | `imagePullSecrets: [{name: acr-pull}]` in `values-dev.yaml` | `imagePullSecrets: []` in `values-aws-dev.yaml` |
| Deploy-time override | `--set imageRegistry=acrselfhealstg.azurecr.io` | `--set imageRegistry=354918379520.dkr.ecr.us-east-1.amazonaws.com` |

Registry URLs are never hard-coded in `values.yaml` or templates. They are always injected at deploy time via `--set imageRegistry=…`.

When adding a new container image to the chart:

1. Set `imagePullSecrets` references in `values-dev.yaml` and `values-test.yaml` (Azure).
2. Leave `imagePullSecrets` empty in `values-aws-dev.yaml` (AWS).
3. Reference the registry prefix via `{{ .Values.imageRegistry }}` in the template.

---

## Secrets management

### Local: .env file

Locally, all secrets come from `.env` (copied from `.env.example`). `supabase start` emits the anon key and service role key; `make up` reads them via `scripts/supabase-env.sh` and injects them into the Docker Compose environment. No Kubernetes secrets or ESO is involved.

```bash
cp .env.example .env
make up
```

### Cloud: OpenBao and External Secrets Operator

In cloud environments, secrets flow through two layers:

```
Terraform generates credentials (random_password / random_bytes)
  → stored in OpenBao (KV v2)
    → ExternalSecret (ESO) reads OpenBao
      → Kubernetes Secret materialized in namespace
        → Deployment reads Secret via secretKeyRef
```

`templates/externalsecrets.yaml` renders ExternalSecret resources only when `externalSecrets.enabled: true`. The `SecretStore` named `openbao-dev` (or `openbao-test`/`openbao-prod`) must already exist — Terraform creates it.

The `secretKeyRef` names (`frontend-secrets-{ns}`, `temporal-worker-secrets-{ns}`) are stable contracts shared by the ExternalSecret templates and the Deployment specs. Do not rename them without updating both.

Workload identities are split: the frontend reads only the anon key; the temporal-worker and ops-api read the service-role key. This split is enforced in the ExternalSecret definitions.

When adding a new application secret:

1. Add a new property to `externalSecrets.frontend` or `externalSecrets.backend` in `values.yaml`.
2. Add the corresponding `secretKeyRef` in the Deployment template.
3. Update all environment value profiles with the new property name.
4. Ensure Terraform writes the secret to OpenBao (add to `external_secrets.tf` for new credential categories).

---

## Validate deployment changes without cluster access

You do not need access to a live cluster to validate most deployment changes.

### Chart validation (no cluster required)

```bash
# Lint and render all Azure profiles — same script as CI
bash charts/app/ci-test.sh

# Validate the AWS profile separately (not covered by ci-test.sh)
helm lint charts/app -f charts/app/values-aws-dev.yaml
helm template ci-test charts/app -f charts/app/values-aws-dev.yaml
```

`ci-test.sh` runs `helm lint` and `helm template` for `values-dev.yaml`, `values-test.yaml`, and `values-prod.yaml`, and asserts required fields (resource limits, probes, NetworkPolicy presence) are set.

### Schema validation with kubeconform

CI runs `kubeconform` against rendered output in `k8s-render-validate.yml`. Run it locally before pushing:

```bash
helm template ci-test charts/app -f charts/app/values-dev.yaml \
  | kubeconform -strict -summary
```

Install: `brew install kubeconform` (macOS) or download from [releases](https://github.com/yannh/kubeconform/releases).

### CI checks that run automatically

When a PR touches `charts/**` or `deploy/k8s/**`, these CI jobs run without cluster access:

| Check | Workflow | What it validates |
|-------|----------|------------------|
| YAML lint | `pr-validation.yml` | Chart YAML formatting |
| Helm lint + profile tests | `pr-validation.yml` (`helm-charts` job) | All Azure profiles render without errors |
| K8s render + schema validation | `k8s-render-validate.yml` | Rendered manifests conform to Kubernetes API schemas |

### Other relevant local checks

For changes outside the chart:

```bash
# Local runtime wiring (docker-compose, Makefile)
make up             # or: USE_DEV=1 make up
make down

# Frontend and Temporal code checks
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix temporal run lint
npm --prefix temporal run typecheck

# Supabase schema changes
supabase db reset --config supabase/config.toml
```

Terraform changes under `terraform/` are not covered by automated render checks. Use `terraform validate` locally (requires provider credentials) or review the diff manually.

---

## Key paths at a glance

| What you want to change | Path |
|------------------------|------|
| Default Helm values / add a new config key | `charts/app/values.yaml` |
| Azure dev overrides | `charts/app/values-dev.yaml` |
| AWS dev overrides | `charts/app/values-aws-dev.yaml` |
| Test overrides | `charts/app/values-test.yaml` |
| Production overrides | `charts/app/values-prod.yaml` |
| Kubernetes Deployment templates | `charts/app/templates/` |
| NetworkPolicy rules | `charts/app/templates/networkpolicies.yaml` |
| ServiceAccount definitions | `charts/app/templates/serviceaccounts.yaml` |
| ExternalSecret wiring (ESO) | `charts/app/templates/externalsecrets.yaml` |
| Chart CI validation script | `charts/app/ci-test.sh` |
| Terraform reusable module | `terraform/modules/app-instance/` |
| Azure dev app stack | `terraform/stacks/10x-stack-dev/` |
| AWS dev app stack | `terraform/stacks/10x-stack-aws-dev/` |
| Azure shared platform prereqs | `terraform/platform/azure-staging/` |
| AWS shared platform prereqs | `terraform/platform/aws-staging/` |
| Local stack orchestration | `docker-compose.yml`, `Makefile` |
| Full deployment specification | `docs/specs/platform-deployment-spec.md` |
| CI deploy workflows | `.github/workflows/deploy-dev.yml`, `deploy-test.yml`, `deploy-prod.yml` |
| K8s render + schema CI | `.github/workflows/k8s-render-validate.yml` |
