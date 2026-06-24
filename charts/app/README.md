# charts/app

Helm chart that deploys the two stateless application components to Kubernetes:

| Component | Description |
|-----------|-------------|
| **frontend** | React static bundle served by nginx (`frontend/Dockerfile`) — exposed via `Service` and optionally an `Ingress` |
| **temporal-worker** | TypeScript/Node Temporal worker (`temporal/Dockerfile`) — headless; no `Service` or `Ingress` |

---

## Prerequisites

- Helm 3.x
- Kubernetes 1.24+
- External Secrets Operator + namespace `SecretStore` (see [Required Secrets](#required-secrets))
- Kubernetes Metrics Server (or another provider for the resource metrics API) when `hpa.enabled=true`

---

## Required Secrets

This chart now renders `ExternalSecret` resources (ADR-0042). ESO syncs values from OpenBao
into Kubernetes `Secret` objects that the Deployments continue to consume via `secretKeyRef`.

Before installing:

1. Install External Secrets Operator in the cluster (see `deploy/eso/values.yaml`).
2. Create a namespace-scoped `SecretStore` (template at `deploy/openbao/secretstore-prod-template.yaml`).
3. Ensure OpenBao KV paths exist for:
   - `secret/data/project-template/<env>/frontend` → `anon_key`
   - `secret/data/project-template/<env>/backend` → `service_role_key`

Example:

```bash
bao kv put secret/project-template/dev/frontend anon_key="<SUPABASE_ANON_KEY>"
bao kv put secret/project-template/dev/backend service_role_key="<SUPABASE_SERVICE_ROLE_KEY>"
```

The generated target Secret names/keys are still controlled by `frontend.secrets.*`
and `temporalWorker.secrets.*`, so existing Deployment templates remain stable.

---

## Installing the Chart

```bash
# Render manifests to stdout (dry-run)
helm template my-release charts/app

# Render using environment profiles
helm template my-release charts/app -f charts/app/values-dev.yaml
helm template my-release charts/app -f charts/app/values-test.yaml
helm template my-release charts/app -f charts/app/values-prod.yaml

# Install into the current namespace
helm install my-release charts/app

# Install with custom image tags
helm install my-release charts/app \
  --set frontend.image.repository=ghcr.io/your-org/frontend \
  --set frontend.image.tag=1.2.3 \
  --set temporalWorker.image.repository=ghcr.io/your-org/temporal-worker \
  --set temporalWorker.image.tag=1.2.3

# Install with image digests (ADR-0010 digest-pinning — preferred for test/prod)
# When image.digest is set, the image is referenced as repo@sha256:… and the tag
# is used for audit/display only. Use pullPolicy: IfNotPresent with digests.
helm install my-release charts/app \
  --set frontend.image.repository=ghcr.io/your-org/frontend \
  --set frontend.image.digest=sha256:abc123... \
  --set frontend.image.pullPolicy=IfNotPresent \
  --set temporalWorker.image.repository=ghcr.io/your-org/temporal-worker \
  --set temporalWorker.image.digest=sha256:def456... \
  --set temporalWorker.image.pullPolicy=IfNotPresent

# Enable the frontend Ingress
helm install my-release charts/app \
  --set frontend.ingress.enabled=true \
  --set frontend.ingress.className=nginx \
  --set frontend.ingress.hosts[0].host=app.example.com \
  --set frontend.ingress.hosts[0].paths[0].path=/ \
  --set frontend.ingress.hosts[0].paths[0].pathType=Prefix
```

---

## Environment Profiles

The chart includes static values profiles for the proposed namespaces:

- `charts/app/values-dev.yaml` (`<DEV_NAMESPACE>`)
- `charts/app/values-test.yaml` (`<TEST_NAMESPACE>`)
- `charts/app/values-prod.yaml` (`<PROD_NAMESPACE>`)

By default, `networkPolicy.enabled` is `false` in the base chart and in `values-dev.yaml` (to avoid blocking local/non-enforcing development clusters); test/prod explicitly set it to `true`.

Use them with explicit namespace selection:

```bash
helm upgrade --install app-dev charts/app -n <DEV_NAMESPACE> -f charts/app/values-dev.yaml
helm upgrade --install app-test charts/app -n <TEST_NAMESPACE> -f charts/app/values-test.yaml
helm upgrade --install app-prod charts/app -n <PROD_NAMESPACE> -f charts/app/values-prod.yaml
```

---

## Values Reference

### Global

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `nameOverride` | string | `""` | Override chart name |
| `fullnameOverride` | string | `""` | Override full release name |
| `imageRegistry` | string | `""` | Global image registry prefix (e.g. `ghcr.io`) |

### External Secrets

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `externalSecrets.enabled` | bool | `false` | Render `ExternalSecret` resources |
| `externalSecrets.refreshInterval` | string | `"5m"` | ESO sync interval |
| `externalSecrets.environment` | string | `"dev"` | OpenBao environment path segment |
| `externalSecrets.basePath` | string | `"secret/data/project-template"` | OpenBao KV base path |
| `externalSecrets.secretStoreRef.name` | string | `"openbao-dev"` | Namespace-scoped SecretStore name |
| `externalSecrets.secretStoreRef.kind` | string | `"SecretStore"` | Secret store kind |
| `externalSecrets.frontend.supabaseAnonKeyProperty` | string | `"anon_key"` | Frontend property in OpenBao KV |
| `externalSecrets.backend.supabaseServiceRoleKeyProperty` | string | `"service_role_key"` | Backend property in OpenBao KV |

### NetworkPolicy

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `networkPolicy.enabled` | bool | `false` | Render namespace default-deny and component-level allowlist policies |
| `networkPolicy.ingressControllerNamespace` | string | `"ingress-nginx"` | Namespace allowed to send ingress traffic to frontend pods |

### Frontend

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `frontend.replicaCount` | int | `1` | Number of pod replicas. When `> 1`, a `preferredDuringSchedulingIgnoredDuringExecution` podAntiAffinity rule is automatically injected to spread pods across nodes (satisfies kube-score best-practice check) |
| `frontend.image.registry` | string | `""` | Registry (overrides `imageRegistry`) |
| `frontend.image.repository` | string | `"your-org/frontend"` | Image repository |
| `frontend.image.tag` | string | `"latest"` | Image tag |
| `frontend.image.pullPolicy` | string | `"IfNotPresent"` | Image pull policy |
| `frontend.imagePullSecrets` | list | `[]` | Pull-secret names |
| `frontend.podSecurityContext` | object | `runAsNonRoot`, uid/gid `101`, `seccompProfile: RuntimeDefault` | Pod security context |
| `frontend.securityContext` | object | `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, `capabilities.drop: [ALL]` | Container security context |
| `frontend.service.type` | string | `"ClusterIP"` | Service type |
| `frontend.service.port` | int | `3000` | Service port |
| `frontend.ingress.enabled` | bool | `false` | Enable Ingress |
| `frontend.ingress.className` | string | `""` | Ingress class |
| `frontend.ingress.annotations` | object | `{}` | Ingress annotations |
| `frontend.ingress.hosts` | list | see values.yaml | Ingress host rules |
| `frontend.ingress.tls` | list | `[]` | Ingress TLS config |
| `frontend.resources` | object | 100m/128Mi req, 500m/512Mi lim | Pod resource requests/limits |
| `frontend.livenessProbe` | object | tcpSocket :8080 | Liveness probe config |
| `frontend.readinessProbe` | object | HTTP GET `/` :8080 | Readiness probe config |
| `frontend.env.supabaseUrl` | string | `"http://supabase:8000"` | `VITE_SUPABASE_URL` value |
| `frontend.env.apiUrl` | string | `"http://supabase:8000/functions/v1"` | `VITE_API_URL` value |
| `frontend.secrets.supabaseAnonKey.secretName` | string | `"frontend-secrets"` | Secret containing anon key |
| `frontend.secrets.supabaseAnonKey.key` | string | `"VITE_SUPABASE_ANON_KEY"` | Key within the Secret |

### Temporal Worker

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `temporalWorker.replicaCount` | int | `1` | Number of pod replicas |
| `temporalWorker.image.registry` | string | `""` | Registry (overrides `imageRegistry`) |
| `temporalWorker.image.repository` | string | `"your-org/temporal-worker"` | Image repository |
| `temporalWorker.image.tag` | string | `"latest"` | Image tag |
| `temporalWorker.image.pullPolicy` | string | `"IfNotPresent"` | Image pull policy |
| `temporalWorker.imagePullSecrets` | list | `[]` | Pull-secret names |
| `temporalWorker.podSecurityContext` | object | `runAsNonRoot`, uid/gid `10001`, `seccompProfile: RuntimeDefault` | Pod security context |
| `temporalWorker.securityContext` | object | `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, `capabilities.drop: [ALL]` | Container security context |
| `temporalWorker.resources` | object | 100m/128Mi req, 500m/512Mi lim | Pod resource requests/limits |
| `temporalWorker.livenessProbe` | object | exec `sh -c "kill -0 1"` | Liveness probe config |
| `temporalWorker.readinessProbe` | object | exec `sh -c "kill -0 1 2>/dev/null"` | Readiness probe config |
| `temporalWorker.temporal.address` | string | `"temporal:7233"` | Temporal server address |
| `temporalWorker.temporal.namespace` | string | `"default"` | Temporal namespace |
| `temporalWorker.temporal.taskQueue` | string | `""` | Temporal task queue. When empty, the chart defaults to `<release-namespace>-main` via `.Release.Namespace`. |
| `temporalWorker.supabase.url` | string | `"http://supabase:8000"` | `SUPABASE_URL` value |
| `temporalWorker.secrets.supabaseServiceRoleKey.secretName` | string | `"temporal-worker-secrets"` | Secret containing service-role key |
| `temporalWorker.secrets.supabaseServiceRoleKey.key` | string | `"SUPABASE_SERVICE_ROLE_KEY"` | Key within the Secret |

### Reliability

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `hpa.enabled` | bool | `false` | Enable HorizontalPodAutoscaler resources for frontend and temporal-worker |
| `hpa.frontend.minReplicas` | int | `2` | Frontend HPA minimum replicas |
| `hpa.frontend.maxReplicas` | int | `10` | Frontend HPA maximum replicas |
| `hpa.frontend.targetCPUUtilization` | int | `70` | Frontend HPA target average CPU utilization percentage |
| `hpa.temporalWorker.minReplicas` | int | `1` | Temporal-worker HPA minimum replicas |
| `hpa.temporalWorker.maxReplicas` | int | `5` | Temporal-worker HPA maximum replicas |
| `hpa.temporalWorker.targetCPUUtilization` | int | `70` | Temporal-worker HPA target average CPU utilization percentage |
| `pdb.enabled` | bool | `true` | Enable PodDisruptionBudget resources for frontend and temporal-worker |
| `pdb.frontend.minAvailable` | int | `1` | Frontend PDB minimum available pods |
| `pdb.temporalWorker.minAvailable` | int | `1` | Temporal-worker PDB minimum available pods |

When customizing reliability values, keep `minReplicas <= maxReplicas` for each HPA, and keep each PDB `minAvailable` less than or equal to the corresponding deployment's minimum replica count (`replicaCount` when HPA is disabled, `hpa.*.minReplicas` when HPA is enabled). The chart fails template rendering early if those constraints are violated.

### Operations API

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `opsApi.replicaCount` | int | `1` | Number of pod replicas. When `> 1`, a `preferredDuringSchedulingIgnoredDuringExecution` podAntiAffinity rule is automatically injected to spread pods across nodes (satisfies kube-score best-practice check) |
| `opsApi.image.registry` | string | `""` | Registry (overrides `imageRegistry`) |
| `opsApi.image.repository` | string | `"your-org/temporal-worker"` | Image repository (same image as worker) |
| `opsApi.image.tag` | string | `"latest"` | Image tag |
| `opsApi.image.pullPolicy` | string | `"Always"` | Image pull policy |
| `opsApi.imagePullSecrets` | list | `[]` | Pull-secret names |
| `opsApi.podSecurityContext` | object | `runAsNonRoot`, uid/gid `10001`, `seccompProfile: RuntimeDefault` | Pod security context |
| `opsApi.securityContext` | object | `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, `capabilities.drop: [ALL]` | Container security context |
| `opsApi.service.type` | string | `"ClusterIP"` | Service type |
| `opsApi.service.port` | int | `8000` | Service port |
| `opsApi.resources` | object | 100m/128Mi req, 500m/512Mi lim | Pod resource requests/limits |
| `opsApi.livenessProbe` | object | tcpSocket :8000 | Liveness probe config |
| `opsApi.readinessProbe` | object | HTTP GET `/health` :8000 | Readiness probe config |
| `opsApi.temporal.address` | string | `"temporal:7233"` | Temporal server address |
| `opsApi.temporal.namespace` | string | `"default"` | Temporal namespace |
| `opsApi.supabase.url` | string | `"http://supabase:8000"` | `SUPABASE_URL` value |
| `opsApi.secrets.supabaseServiceRoleKey.secretName` | string | `"temporal-worker-secrets"` | Secret containing service-role key |
| `opsApi.secrets.supabaseServiceRoleKey.key` | string | `"SUPABASE_SERVICE_ROLE_KEY"` | Key within the Secret |

### Network egress ports by component

| Component | Allowed egress | Why |
|---|---|---|
| `frontend` | TCP/UDP 53 | DNS resolution for ingress-served frontend pods |
| `temporal-worker` | TCP 8000, TCP 443, TCP 7233, TCP/UDP 53 | Supabase default in-cluster HTTP path, HTTPS APIs (Supabase/LLM providers), Temporal frontend gRPC, DNS |
| `ops-api` | TCP 8000, TCP 443, TCP 7233, TCP/UDP 53 | Supabase default in-cluster HTTP path, HTTPS APIs (Supabase), Temporal frontend gRPC, DNS |

---

## Validation

```bash
# Lint the chart
helm lint charts/app

# Render all manifests with default values
helm template my-release charts/app

# Render with ingress enabled
helm template my-release charts/app --set frontend.ingress.enabled=true
```
