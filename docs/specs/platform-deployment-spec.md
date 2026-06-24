# Platform Deployment Spec

**Status:** Draft  
**Last updated:** 2026-06-21

---

## Goal

Every app instance in this template must be fully deployable to three targets:

| Target | Runtime | CDN/Edge | Database | Secrets |
|--------|---------|----------|----------|---------|
| **Local** | Docker Desktop | — (localhost) | Supabase CLI | `.env` file |
| **Azure** | AKS (shared cluster) | Azure Front Door | Supabase in-cluster (Helm) | OpenBao + ESO |
| **AWS** | EKS (shared cluster) | CloudFront | Supabase in-cluster (Helm) | OpenBao + ESO |

The differences between targets must be minimal and fully documented. No component should be shared between app instances — each gets its own independent Supabase, secrets store, and CDN endpoint.

---

## Shared Platform vs. Per-App Resources

### What the platform owns (prereqs — exists before `terraform apply`)

These are shared infrastructure resources. This template asserts they exist; it does not create or manage them.

| Resource | Azure | AWS |
|----------|-------|-----|
| Kubernetes cluster | `aks-selfheal-staging` (rg-selfheal-staging) | EKS cluster (TBD) |
| Container registry | `acrselfhealstg.azurecr.io` | ECR registry (TBD) |
| Temporal server | `temporal-frontend.dev.svc.cluster.local:7233` | same in-cluster DNS |
| AFD profile (shell) | `10x-stack-afd` (Standard_AzureFrontDoor) | CloudFront distribution (shell) |
| ESO operator | `external-secrets` namespace | `external-secrets` namespace |
| Storage backend for TF state | Azure Storage Account | S3 bucket + DynamoDB table |

**Platform contract:** The `terraform/platform/` directory documents these prereqs as data sources. If a prereq is missing, Terraform fails with a clear error. This is intentional — it surfaces broken assumptions instead of silently creating shared resources.

### What each app instance owns (per-app — created by `terraform apply`)

| Resource | Description |
|----------|-------------|
| Kubernetes namespaces | `{app}-dev`, `{app}-test`, `{app}-supabase` |
| RBAC | `gha-deployer` SA + Role + RoleBinding per namespace |
| ACR pull secret | `acr-pull` in each app namespace |
| Supabase | Full Helm release in `{app}-supabase`; own DB, own JWT creds (auto-generated) |
| OpenBao | Deployment in `{app}-vault` namespace; initialized once and unsealed from a bootstrap secret |
| ESO SecretStore | Wired to this app's OpenBao instance |
| ExternalSecrets | `frontend-secrets-{ns}`, `temporal-worker-secrets-{ns}`, `ops-api-secrets-{ns}` |
| AFD endpoint | One endpoint per environment on the shared AFD profile |
| AFD origin + route | Points at the app's LoadBalancer IP |
| GitHub secrets/variables | `KUBE_CONFIG_DEV`, `ACR_LOGIN_SERVER`, etc. — output by Terraform |
| Temporal namespace | Registered in the shared Temporal server |

---

## Target Differences

The goal is to minimize surface area of per-target differences. All differences must be expressed in `terraform/stacks/{app}/terraform.tfvars` or the equivalent cloud-specific values file — not scattered across code.

| Concern | Local | Azure | AWS |
|---------|-------|-------|-----|
| Image registry | Local Docker build (`localhost`) | ACR (`acrselfhealstg.azurecr.io`) | ECR |
| Supabase URL (browser) | `http://localhost:54321` | AFD endpoint HTTPS | CloudFront HTTPS |
| Supabase URL (worker, internal) | `http://supabase-kong:8000` | `http://supabase-supabase-kong.{ns}.svc.cluster.local` | same |
| Secret delivery | `.env` file | ExternalSecret → OpenBao | ExternalSecret → OpenBao |
| TLS | Self-signed via Traefik (see network-exposure-spec.md) | AFD-managed | CloudFront-managed |
| Load balancer type | `docker compose` port binding | Azure `LoadBalancer` svc + AFD CIDR restriction | AWS `LoadBalancer` svc + CloudFront prefix list |
| Service annotations | — | `azure-allowed-service-tags: AzureFrontDoor.Backend` | `service.beta.kubernetes.io/aws-load-balancer-type: nlb` |

---

## Terraform Structure

```
terraform/
  modules/
    app-instance/           # Reusable module: one complete app stack
      variables.tf          # app_name, environment, cloud (azure|aws), cluster prereqs
      namespaces.tf         # k8s namespaces + RBAC
      acr_pull.tf           # acr-pull imagePullSecret
      supabase.tf           # Supabase Helm release; auto-generates creds via random_*
      vault.tf              # OpenBao deployment + kubernetes auth config
      external_secrets.tf   # SecretStore + ExternalSecrets for app secrets
      frontdoor_azure.tf    # AFD endpoint + origin + route (Azure only)
      cloudfront_aws.tf     # CloudFront behavior (AWS only)
      temporal_ns.tf        # Registers Temporal namespace via null_resource
      github_outputs.tf     # Writes KUBE_CONFIG_DEV etc. to GitHub via gh CLI
      outputs.tf
  platform/
    azure-staging/          # Documents and validates shared prereqs for Azure staging
      main.tf               # data sources: AKS, ACR, AFD profile, ESO
      README.md             # How to bootstrap this platform from scratch
    aws-staging/            # Same for AWS (stub)
      main.tf
      README.md
  stacks/
    10x-stack-dev/          # This template on Azure staging
      main.tf               # calls app-instance module
      terraform.tfvars      # app_name=10x-stack, environment=dev, cloud=azure
      backend.tf            # Azure Storage state backend
    10x-stack-aws-dev/      # This template on AWS (stub)
      main.tf
      terraform.tfvars
      backend.tf
```

---

## Credential Generation

All credentials are generated by Terraform using `random_password` and `random_bytes`. They are never:
- Committed to git
- Manually created
- Copied from another app

**Supabase JWT secret:** `random_bytes(48)` → base64url  
**Supabase DB password:** `random_password(length=32, special=false)`  
**Supabase anon/service JWTs:** computed from the JWT secret using `local` values (standard HS256 structure)  
**OpenBao bootstrap secret:** `bao operator init -format=json` generates the root token + unseal key once, and Terraform stores them in the `{app}-vault/openbao-bootstrap` Kubernetes secret

All credentials land in OpenBao first. ESO syncs them into Kubernetes Secrets. Runtime identities are split per workload (`frontend`, `temporal-worker`, `ops-api`) so the frontend can read only the anon key, while the service-role key is limited to the worker and ops-api identities.

---

## Platform Bootstrap (one-time, per cluster)

Before any app stack can be applied, the following must exist on the cluster:

1. **ESO operator** — `helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace`
2. **Supabase Helm repo** — `helm repo add supabase https://supabase.github.io/supabase-kubernetes`
3. **AFD profile** (Azure) — one Standard_AzureFrontDoor profile per cluster (not per app)
4. **Temporal server** — shared across all apps in the cluster
5. **ACR** (Azure) / **ECR** (AWS) — one registry per platform; GitHub Actions reaches ECR via GitHub OIDC + a scoped AWS role, not long-lived repository secrets

These are documented in `terraform/platform/azure-staging/README.md`. A GitHub Actions workflow (`bootstrap-platform.yml` — to be created) validates that all prereqs exist before any app stack apply can run.

---

## Local Development

Local is the simplest target and must work without any cloud credentials:

```bash
make up          # docker compose up (HTTP only)
make up-https    # docker compose up with Traefik TLS proxy (see network-exposure-spec.md)
```

Differences from cloud:
- Supabase credentials come from `supabase start` output → written to `.env`
- No AFD/CloudFront layer
- Temporal runs in Docker alongside the app

---

## Open Items / Follow-on Work

- [ ] Write `terraform/modules/app-instance/` (all .tf files)
- [ ] Write `terraform/platform/azure-staging/main.tf`
- [ ] Write `terraform/stacks/10x-stack-dev/` and apply to provision the live 10x-stack instance
- [ ] Wire Terraform outputs → GitHub secrets (automate the `gh secret set` calls)
- [ ] AWS stub: `terraform/platform/aws-staging/` and `terraform/stacks/10x-stack-aws-dev/`
- [ ] `bootstrap-platform.yml` workflow: validates prereqs before stack apply
- [ ] Document `make up` / `make up-https` local target in README
- [ ] Update README.md to reference this spec and the three deployment targets
