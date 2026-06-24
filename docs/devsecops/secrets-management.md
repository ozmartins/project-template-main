# Secrets management

This guide traces secrets end to end in this template: Terraform generation, OpenBao storage, External Secrets Operator (ESO) sync, Kubernetes Secret materialization, workload consumption, and GitHub Actions runtime use.

## 1) End-to-end secret flow (source to pod)

1. **Terraform generates sensitive values**
   - `terraform/modules/app-instance/supabase.tf` creates random credentials (`random_password`, `random_bytes`) and derives Supabase JWT keys.
   - JWTs are staged into local temporary files (`.supabase_anon_key`, `.supabase_service_key`) for Terraform ingestion (`data.local_file`).
2. **OpenBao is deployed and bootstrapped**
   - `terraform/modules/app-instance/vault.tf` deploys single-node OpenBao (`replicas = 1`) in the vault namespace (`<app_name>-vault`) and exposes `http://openbao.<vault_ns>.svc.cluster.local:8200` (current non-TLS in-cluster default, so traffic is plaintext inside the cluster).
   - Namespace derivation is defined in `terraform/modules/app-instance/locals.tf` (`<vault_ns> = "<app_name>-vault"`).
   - Terraform initializes/unseals OpenBao and stores bootstrap material in Kubernetes secret `openbao-bootstrap`.
3. **Secrets are seeded into OpenBao KV v2**
   - Seeded today:
     - `secret/<app_ns>/frontend` → `supabase_anon_key`
     - `secret/<app_ns>/service-role` → `supabase_service_role_key`
4. **Policies and auth roles enforce least privilege**
   - Policies are path-scoped and read-only (for frontend, temporal-worker, ops-api).
   - Kubernetes auth roles bind each policy to one workload service account in one namespace.
5. **ESO reads from OpenBao and writes Kubernetes Secrets**
   - `terraform/modules/app-instance/external_secrets.tf` creates per-workload `SecretStore` and `ExternalSecret` resources (`refreshInterval: 5m`).
   - ESO writes target Kubernetes secrets owned by the `ExternalSecret`.
6. **Pods consume Kubernetes Secrets**
   - Helm values keep secret names/keys stable (`secretKeyRef` paths in chart values) while ESO continuously reconciles content.

## 2) OpenBao role model and bootstrap details

From `terraform/modules/app-instance/vault.tf`:

- **Service account + TokenReview**
  - OpenBao runs as service account `openbao`.
  - ClusterRoleBinding to `system:auth-delegator` enables Kubernetes TokenReview for SA token validation.
- **Single-node characteristics**
  - One deployment replica, file storage (`/openbao/data`), internal cluster service URL.
  - > **⚠️ SECURITY WARNING:** current template defaults use no TLS on the OpenBao listener (`tls_disable = 1`). This is a known security risk for production traffic and must be remediated (enable in-cluster TLS) before production use; treat this as a required production security gate item.
- **Initialization/unseal/bootstrap flow**
  - Terraform waits for pod readiness.
  - If uninitialized: runs `bao operator init`, captures `root_token` + `unseal_key`, persists in `openbao-bootstrap` secret.
  - If sealed: runs `bao operator unseal`.
- **Auth backends and seeding**
  - Enables KV v2 at `secret/` and Kubernetes auth at `auth/kubernetes` (idempotent).
  - Writes seeded app secrets listed above.
- **Per-workload policy + auth role model**
  - Policies:
    - `<app_ns>-frontend-read` → `secret/data/<app_ns>/frontend`
    - `<app_ns>-temporal-worker-read` → `secret/data/<app_ns>/service-role`
    - `<app_ns>-ops-api-read` → `secret/data/<app_ns>/service-role`
  - Roles bind policy to explicit service accounts (`<app_release_name>-frontend`, `<app_release_name>-temporal-worker`, `<app_release_name>-ops-api`) and namespace `<app_ns>`, with `ttl=24h`.

## 3) ESO wiring and authorization boundaries

From `terraform/modules/app-instance/external_secrets.tf`:

- **SecretStores (one per workload identity)**
  - `openbao-frontend-<app_ns>` with role `<app_ns>-frontend-read`
  - `openbao-temporal-worker-<app_ns>` with role `<app_ns>-temporal-worker-read`
  - `openbao-ops-api-<app_ns>` with role `<app_ns>-ops-api-read`
- **ExternalSecrets (reconcile every 5m)**
  - `frontend-secrets` reads `<app_ns>/frontend:supabase_anon_key` into `VITE_SUPABASE_ANON_KEY`
  - `temporal-worker-secrets` reads `<app_ns>/service-role:supabase_service_role_key` into `SUPABASE_SERVICE_ROLE_KEY`
  - `ops-api-secrets` reads `<app_ns>/service-role:supabase_service_role_key` into `SUPABASE_SERVICE_ROLE_KEY`
- **Boundary summary**
  - Frontend can only read anon key path.
  - Worker + ops-api can read service-role path.
  - Each boundary is enforced by (SA name + namespace + OpenBao role + policy path).

## 4) Chart-side ExternalSecret contract (`charts/app/templates/externalsecrets.yaml`)

Use this when enabling chart-managed ESO resources (`externalSecrets.enabled: true`):

- `externalSecrets.secretStoreRef.{name,kind}` selects the SecretStore.
- `externalSecrets.refreshInterval` controls sync frequency.
- For chart-managed ExternalSecrets, `externalSecrets.basePath` must include the KV v2 `/data/` API segment (default `secret/data/project-template` as defined in `charts/app/values.yaml`).
- Chart `basePath` is a path prefix and is separate from Terraform runtime namespace values like `<app_ns>`.
- `externalSecrets.environment` is appended between base path and component path.
- Generated remote paths:
  - Frontend: `<basePath>/<environment>/frontend` with property `externalSecrets.frontend.supabaseAnonKeyProperty` (default: `anon_key`).
  - Backend: `<basePath>/<environment>/backend` with property `externalSecrets.backend.supabaseServiceRoleKeyProperty` (default: `service_role_key`).

**Critical path-format distinction (common sync-failure source):**

- Terraform-managed ESO (`external_secrets.tf`) uses provider-level KV config (`path = "secret", version = "v2"`), so `remoteRef.key` values do **not** include `/data/`.
- Chart-managed ESO (`charts/app/templates/externalsecrets.yaml`) builds direct KV v2 API-style paths, so generated keys **do** include `/data/` via `externalSecrets.basePath`.
- Example comparison:
  - Terraform-managed remote key: `<app_ns>/frontend` (provider handles KV v2 mount/version)
  - Chart-managed remote key: `secret/data/project-template/dev/frontend` (full KV v2 API path)
- If paths are wrong, start troubleshooting with this distinction before deeper auth/policy checks (see section 9).

**Property name defaults differ between ESO patterns:**

- Terraform-managed ESO seeds and reads with `supabase_anon_key` / `supabase_service_role_key` at paths under `secret/<app_ns>/`.
- Chart-managed ESO defaults to `anon_key` / `service_role_key` at paths under `secret/data/project-template/`.
- These are separate OpenBao data sources. If switching from Terraform-managed to chart-managed ESO (or vice versa), ensure the OpenBao path and property name at the target path match the ESO configuration — a property name mismatch causes a silent sync failure where the Kubernetes Secret is created but the key is missing.

## 5) Never-in-plaintext operational rule

Plaintext secrets must **never** appear in:

- Repository files (including docs, SQL, Helm values, Terraform vars, manifests)
- Committed/generated manifests in git history
- Workflow YAML inline literals

Where sensitive values are generated/staged instead:

- Terraform runtime: `random_password`, `random_bytes`, `set_sensitive` in `terraform/modules/app-instance/supabase.tf`
- Local transient files: `**/.supabase_anon_key`, `**/.supabase_service_key` (git-ignored in `.gitignore`)
- Cluster bootstrap storage: Kubernetes secret `openbao-bootstrap` in vault namespace
- Runtime delivery: ESO materializes Kubernetes Secrets; pods consume via `secretKeyRef`

Repository controls:

- `.github/SECURITY.md` Active Security Controls table documents **Secret scanning** and **Secret scanning push protection** as enabled controls in this repository.
- For operational verification, confirm repository security settings and review any open secret-scanning alerts before/after secret changes.

Related runtime credential path:

- `terraform/modules/app-instance/registry.tf` creates `acr-pull` image pull secret in the app namespace.
  - Azure: stores ACR credentials in `kubernetes.io/dockerconfigjson`.
  - AWS: uses node IAM/ECR auth, so the secret is an empty placeholder to keep chart wiring stable.

## 6) GitHub Actions secrets in current workflow evidence

From `.github/workflows/refresh-azure-frontdoor-cidrs.yml`:

- `AZURE_CLIENT_ID` — workload identity principal for `azure/login`
- `AZURE_TENANT_ID` — Azure Entra tenant context for `azure/login`
- `AZURE_SUBSCRIPTION_ID` — Azure subscription scope for service-tag query
- `PROJECT_MANAGER_PAT` — trusted GitHub token used by `peter-evans/create-pull-request` to open/update automation PRs

Operationally:

- Workflow explicitly validates all four secrets before execution.
- Missing values fail fast with actionable errors.
- This is workflow-backed evidence from `.github/workflows/refresh-azure-frontdoor-cidrs.yml`; treat it as a current inventory snapshot and audit all `.github/workflows/*.yml` files for a full repository-wide secret inventory.

## 7) Rotation procedure (existing secret)

Example: rotate Supabase service-role key consumed by temporal-worker + ops-api.

1. **Generate new source credential** through the authoritative control path (Terraform input/state-backed generation for this stack).
2. **Write new value to OpenBao** at existing key/property:
   - path: `secret/<app_ns>/service-role`
   - property: `supabase_service_role_key`
3. **Confirm OpenBao policy/role unchanged** (same least-privilege boundary).
4. **Wait for ESO refresh** (default 5m) or force reconcile.
5. **Verify Kubernetes target secrets updated**:
   - `temporal-worker-secrets-<app_ns>`
   - `ops-api-secrets-<app_ns>`
6. **Restart consuming workloads** so pods reload environment variables from updated Secrets (temporal-worker and ops-api deployments for this example).
7. **Validate application paths** that require service-role access.
8. **Revoke/retire old credential** in source system if applicable.
9. **Record evidence** (timestamp, operator, paths changed, verification output).

## 8) Add-a-new-secret checklist (source system to pod)

1. Define owner, purpose, blast radius, and rotation target.
2. Add/write secret in OpenBao KV v2 under an app/environment path.
3. Create or update OpenBao policy with minimal read path.
4. Create or update Kubernetes auth role bound to the exact workload SA + namespace.
5. Add/update `SecretStore` (if new workload identity needed).
6. Add/update `ExternalSecret` mapping:
   - target Kubernetes secret name/key
   - `remoteRef.key` and `remoteRef.property`
   - refresh interval
7. Ensure Helm/Terraform workload secret references point to that target secret/key.
8. Deploy and verify ESO sync status/events.
9. Verify pod can read value and workload behavior is correct.
10. Add rotation instructions and incident notes to docs.

## 9) Failure evidence and incident response

If ESO sync fails or workload cannot read secret, inspect in this order:

1. **ExternalSecret status + events** (sync errors, auth/path/property failures).
2. **SecretStore readiness** (provider auth/role mismatch).
3. **OpenBao auth role and policy path** (SA name, namespace, path capability).
4. **OpenBao secret path/property existence** (exact key names).
5. **Kubernetes target Secret materialization** (exists, expected key present).
6. **Workload SA and secretKeyRef alignment** (names must match deployed chart values/Terraform locals).

Leak detection and response:

- GitHub push protection blocks newly pushed secrets where detected.
- Secret scanning detects committed secrets and opens alerts.
- On detection:
  1. Revoke/rotate exposed secret immediately.
  2. Remove leaked value from reachable configs/artifacts.
  3. Re-run affected workflows/deployments with rotated credentials.
  4. Document scope, timeline, and remediation evidence.
