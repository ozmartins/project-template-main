# ADR-0033: Kubernetes Deployment Portability Across Cloud Providers and Self-Hosted

- **Status:** Accepted (partially superseded by ADR-0068 for dev/test image-pull-secret provisioning)
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** Partially superseded by ADR-0068 — image-pull-secret creation for `10x-stack-dev` and `10x-stack-test` is now an automated deploy-workflow step, not an operator responsibility

## Context

This template is designed to be forked and used across different organisations, teams, and infrastructure environments. Teams operate on different cloud platforms (Azure, AWS, GCP) or run self-managed Kubernetes clusters via Rancher or k3s. The deployment layer must not assume any single cloud provider — hardwiring Azure-specific resources (ACR, AKS-specific ingress annotations, Azure Front Door) would prevent the template from working on AWS EKS or a Rancher-managed bare-metal cluster.

The goal of this template is to enable teams to rapidly build and operate software regardless of which infrastructure platform they have chosen.

## Decision

The deployment layer is written against **standard Kubernetes APIs only**. Cloud-provider specifics are isolated to configuration — they are not baked into chart templates.

**What is cloud-agnostic in the chart:**
- Deployments, Services, ConfigMaps, Secrets — all standard Kubernetes resources
- Ingress using `kubernetes.io/ingress.class` annotation (or `ingressClassName` field) — provider-specific ingress controllers implement the same API
- PersistentVolumeClaims using `storageClassName` — populated per-environment in values files
- HorizontalPodAutoscaler — standard Kubernetes resource

**What is provider-specific and lives in values files only:**
- Container registry URL (`image.repository`) — `myacr.azurecr.io/app` vs `123456789.dkr.ecr.us-east-1.amazonaws.com/app` vs `registry.example.com/app`
- `storageClassName` — `managed-premium` (AKS), `gp3` (EKS), `pd-ssd` (GKE), `longhorn` (Rancher/self-hosted)
- Ingress annotations — cloud load balancer annotations vary by provider
- Node pool / availability zone labels — cloud-specific node selector keys

**Supported target environments:**

| Platform | Kubernetes | Registry | Notes |
|---|---|---|---|
| Azure | AKS | ACR | Values template in `values-azure.yaml` (example) |
| AWS | EKS | ECR | Values template in `values-aws.yaml` (example) |
| GCP | GKE | Artifact Registry | Values template in `values-gcp.yaml` (example) |
| Self-hosted (Rancher) | RKE2 / k3s | Harbor / any OCI registry | Values template in `values-rancher.yaml` (example) |
| Local (dev) | kind / k3d | Local registry or `docker load` | Covered by existing `values-dev.yaml` |

**Container registry credentials** are provisioned as Kubernetes Secrets (`imagePullSecrets`) before the first deploy — the chart references the secret name, not the registry credentials directly. Creating the secret is the operator's responsibility and is documented per-platform.

**CI/CD credentials** use OIDC workload identity where the cloud provider supports it (Azure federated credentials, AWS OIDC, GCP Workload Identity) to avoid long-lived secrets in GitHub. On Rancher/self-hosted, a ServiceAccount token with the RBAC policy from ADR-0017 is used.

## Consequences

**Positive:**
- The same chart deploys to AKS, EKS, GKE, and Rancher without modification. Only values files change.
- Teams can start on a local k3d cluster and promote the same chart to a cloud provider when they are ready — no deployment layer rewrite required.
- The factory agents (deploy-dev, deploy-test, deploy-prod workflows) are also provider-agnostic — they run `helm upgrade` with the appropriate values file; the cloud credentials are in secrets.
- Organisations with multi-cloud or hybrid strategies can run the same template across environments.

**Negative:**
- Provider-specific features (Azure Managed Identity pod annotations, AWS IRSA, GKE Workload Identity binding) require additional configuration that is not covered by the chart defaults. Teams that need these features must add the annotations to their environment values files.
- Ingress configuration is the most common source of provider-specific complexity. The chart provides a generic Ingress resource; TLS termination, certificate management (cert-manager, cloud-native certificate services), and custom annotations vary significantly by provider.
- The template does not include provider-specific CI steps (Azure login, AWS configure credentials, GCP auth). These must be added to the deploy workflow for each environment. The `factory.yml` `runner_profiles` section is the intended configuration point.

## Alternatives considered

**Pulumi / Terraform for deployment:** Infrastructure-as-code tools provide cloud-native abstractions but add a second language and tool chain to the stack. Helm is sufficient for the application layer; cloud resources (VPCs, node pools) are outside the template's scope.

**Separate chart per cloud provider:** Complete flexibility but high maintenance burden. A fix to a deployment template must be applied to all variants. One chart with provider-specific values is strictly better.

**Helm + Helmfile for environment management:** Helmfile adds per-environment release management and dependency graphs. Valid for complex multi-chart deployments; the single-chart approach is simpler and sufficient for the template's scope.

## Evidence

- `charts/app/values.yaml` — cloud-agnostic defaults
- `charts/app/values-dev.yaml`, `values-test.yaml`, `values-prod.yaml` — environment overrides (no provider-specific keys in defaults)
- `charts/app/templates/` — standard Kubernetes resources only
- `.github/factory.yml` — `runner_profiles` for provider-specific CI credentials
- ADR-0013 — Helm chart environment profile structure
- ADR-0017 — namespace-scoped RBAC (provider-agnostic)
