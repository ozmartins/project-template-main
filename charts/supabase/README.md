# Supabase Deployment — `10x-stack-supabase` namespace

Deployment runbook for the self-hosted Supabase instance on `aks-selfheal-staging`.
The app chart (`charts/app/values-dev.yaml`) references this instance at
`http://supabase-supabase-kong.10x-stack-supabase.svc.cluster.local`.

---

## Prerequisites

### 1. Cluster access

```bash
export KUBECONFIG=/path/to/aks-selfheal-staging-kubeconfig
kubectl get ns 10x-stack-supabase   # must already exist
```

### 2. Secrets — OpenBao + ESO

All credentials are delivered via External Secrets Operator (ESO) pulling from OpenBao
(see [ADR-0042](../../docs/adrs/0042-openbao-external-secrets-operator.md)).

Apply the ESO `ExternalSecret` resources to the `10x-stack-supabase` namespace. Each
secret below must be populated in OpenBao before installation:

| Secret name | Keys | OpenBao path |
|---|---|---|
| `supabase-jwt` | `anon-key`, `service-key`, `secret` | `openbao/10x-stack-supabase/supabase-jwt` |
| `supabase-db` | `username`, `password`, `database` | `openbao/10x-stack-supabase/supabase-db` |
| `supabase-dashboard` | `username`, `password` | `openbao/10x-stack-supabase/supabase-dashboard` |
| `supabase-analytics` | `api-key` | `openbao/10x-stack-supabase/supabase-analytics` |

Verify the secrets are present before proceeding:

```bash
kubectl -n 10x-stack-supabase get secret supabase-jwt supabase-db supabase-dashboard supabase-analytics
```

### 3. DB bootstrap RBAC

Apply the least-privilege RBAC for the in-cluster migration job (substitute the
placeholder namespace). The template file lives at `deploy/k8s/rbac-dev-db-bootstrap.yaml`
in this repository:

```bash
sed 's/<SUPABASE_NAMESPACE>/10x-stack-supabase/g; s/<APP_NAME>/10x-stack-template/g' \
  deploy/k8s/rbac-dev-db-bootstrap.yaml | kubectl apply -f -
```

---

## Deploy Supabase Helm chart

```bash
helm repo add supabase https://supabase-community.github.io/supabase-kubernetes
helm repo update

helm upgrade --install supabase supabase/supabase-kubernetes \
  --namespace 10x-stack-supabase \
  -f charts/supabase/values-dev.yaml \
  --wait --timeout 15m
```

The release name **must** be `supabase` so Kubernetes names the Kong service
`supabase-supabase-kong` — the exact hostname referenced by
`charts/app/values-dev.yaml`.

---

## Post-deploy steps

### 1. Verify Kong is running

Kong is deployed as `ClusterIP` (ADR-0047: Kong must never be directly internet-accessible).
In-cluster services reach it at `http://supabase-supabase-kong.10x-stack-supabase.svc.cluster.local`.

```bash
kubectl get svc supabase-supabase-kong -n 10x-stack-supabase
# Expected: TYPE=ClusterIP
```

### 2. Expose Kong for browser access

**Option A — Port-forward (dev/testing, no persistent URL, HTTP only):**

```bash
kubectl port-forward -n 10x-stack-supabase svc/supabase-supabase-kong 8000:8000
# If local port 8000 is already in use, pick a different local port, e.g.:
#   kubectl port-forward -n 10x-stack-supabase svc/supabase-supabase-kong 8001:8000
```

Then set `supabaseUrl` in `charts/app/values-dev.yaml` to `http://localhost:8000`
(or `http://localhost:8001` if you used an alternate port).
Note: port-forward uses plain HTTP — only use this for local dev/testing.

**Option B — Cluster ingress (persistent HTTPS URL, required for deployed environments):**

Route external traffic through the cluster ingress controller (Istio Gateway or nginx Ingress).
Create an Ingress or VirtualService that forwards to `supabase-supabase-kong:8000` and
use the resulting HTTPS hostname as `supabaseUrl`. For Azure (AFD front), apply the
`values-azure.yaml` overlay to lock the ingress LoadBalancer to the AFD backend CIDR
(see ADR-0047 for details).

### 3. Update `supabaseUrl` in `charts/app/values-dev.yaml`

Replace `https://<SUPABASE_KONG_URL>` with the Kong hostname exposed via the ingress
(or `http://localhost:8000` for port-forward dev testing):

```yaml
# charts/app/values-dev.yaml
frontend:
  env:
    supabaseUrl: "https://<KONG_INGRESS_HOSTNAME>"
    apiUrl: "https://<KONG_INGRESS_HOSTNAME>/functions/v1"
```

Also update `GOTRUE_SITE_URL` and `GOTRUE_URI_ALLOW_LIST` in
`charts/supabase/values-dev.yaml` with the **frontend** public URL, then
re-run the Helm upgrade to apply the change to GoTrue.

### 3. Apply migrations

Migrations are applied automatically by the `bootstrap-db` job in `deploy-dev.yml`
(triggered on the next deploy). To apply them manually right now:

```bash
# From the repo root, with KUBE_CONFIG_DEV_DB_BOOTSTRAP kubeconfig
export SUPABASE_NAMESPACE=10x-stack-supabase
export DB_BOOTSTRAP_USER=supabase_admin
export DB_BOOTSTRAP_DB_NAME=postgres
# Then trigger the deploy-dev workflow, or run the bootstrap step locally.
```

### 4. Verify Kong is reachable in-cluster

From any pod in the dev namespace:

```bash
kubectl exec -n 10x-stack-dev <any-pod> -- \
  curl -sf http://supabase-supabase-kong.10x-stack-supabase.svc.cluster.local/rest/v1/
```

Expected: HTTP 200 or a JSON error (not a connection refused).

---

## Reference

All ADRs below exist in `docs/adrs/` at the repo root.

- [ADR-0015](../../docs/adrs/0015-self-hosted-supabase.md) — Supabase as auth and database layer
- [ADR-0016](../../docs/adrs/0016-self-hosted-supabase-in-cluster.md) — In-cluster Helm deployment decision
- [ADR-0042](../../docs/adrs/0042-openbao-external-secrets-operator.md) — OpenBao + ESO for secrets
- [ADR-0047](../../docs/adrs/0047-network-exposure-and-ingress-security-model.md) — Network security model
- `deploy/k8s/rbac-dev-db-bootstrap.yaml` — least-privilege RBAC template for the bootstrap job
- `.github/workflows/deploy-dev.yml` — DB bootstrap job (migrations + seed) runs on every deploy
