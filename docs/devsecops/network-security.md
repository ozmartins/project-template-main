# Network Security Guide (DevSecOps)

This guide turns [ADR-0047](../adrs/0047-network-exposure-and-ingress-security-model.md), [ADR-0048](../adrs/0048-tls-certificate-strategy.md), and the [network architecture guide](../architecture/network-security.md) into an operator runbook for reviewing exposure changes and triaging bypasses.

## Trusted ingress path by environment

### Docker Desktop (local)

Trusted path: browser → Traefik on `127.0.0.1:443` / `127.0.0.1:80` → internal Docker/Supabase services.

Verify:
- `docker-compose.proxy.yml` binds only loopback: `127.0.0.1:443:443` and `127.0.0.1:80:80`.
- `docker-compose.proxy.yml` removes direct host ports from `frontend` and `temporal-ui` with `ports: []`.
- Local routing stays path-based behind Traefik (`/` to frontend, `/temporal` to `temporal-ui`, Supabase API paths to Kong) rather than exposing extra host ports.

```bash
# Confirm Traefik only binds loopback
grep "127.0.0.1:" docker-compose.proxy.yml
# Expected: 127.0.0.1:443:443 and 127.0.0.1:80:80 — no 0.0.0.0 entries

# Confirm direct host ports are removed from frontend and temporal-ui
grep -A2 "temporal-ui:\|^  frontend:" docker-compose.proxy.yml | grep "ports: \[\]"
# Expected: two matches for ports: []
```

### Kubernetes (generic ingress-nginx pattern)

Trusted path: internet/edge → cloud load balancer → `ingress-nginx` → app `ClusterIP` services.

Verify:
- `charts/app/values.yaml` keeps services private by default, especially `frontend.service.type: ClusterIP`.
- `charts/app/values-test.yaml` and `charts/app/values-prod.yaml` use `frontend.ingress.enabled: true` with `className: nginx`.
- `charts/app/templates/networkpolicies.yaml` keeps the namespace on default-deny and only allows ingress from the ingress controller namespace.

### AKS with Azure Front Door

Trusted path in the accepted architecture: internet → Azure Front Door + WAF → Azure LoadBalancer restricted to `AzureFrontDoor.Backend` origins → `ingress-nginx` → app `ClusterIP` services.

Current repository evidence to inspect:
- `docs/architecture/network-security.md` and ADR-0047 describe the intended Azure Front Door → ingress-nginx posture.
- `charts/app/values-dev.yaml` currently applies the Azure-specific source restrictions directly to `frontend.service.type: LoadBalancer` and sets `frontend.ingress.enabled: false`. Treat this as a current dev-environment exception, not a reason to weaken the generic ingress model elsewhere.
- `charts/app/values-dev.yaml` must keep both of these controls:
  - `service.beta.kubernetes.io/azure-allowed-service-tags: "AzureFrontDoor.Backend"`
  - `loadBalancerSourceRanges:` entries sourced from `deploy/azure/afd-backend-cidrs.txt`

### EKS / non-Azure cloud equivalent

Trusted path: internet/edge → provider-specific WAF/CDN/LB controls → controlled ingress path → private app services.

Verify:
- The same intent still applies: keep internal services private and centralize public entry.
- Azure-only controls do **not** carry across: `AzureFrontDoor.Backend` and Azure service-tag enforcement have no AWS equivalent.
- `charts/app/values-aws-dev.yaml` currently shows another provider-specific exception: `frontend.service.type: LoadBalancer`, `aws-load-balancer-type: "nlb"`, `aws-load-balancer-scheme: "internet-facing"`, and `frontend.ingress.enabled: false`. The `internet-facing` scheme means the NLB receives a public IP — operators must verify the compensating AWS controls (for example CloudFront/WAF and security-group restrictions) before accepting that exposure.

## Defence-in-depth verification order

Review and triage in this order. When a bypass happens, start at the highest failed layer.

| Layer | What to verify before merge | What to verify after deploy |
|---|---|---|
| Edge WAF / CDN | `docs/architecture/network-security.md`, ADR-0047, and the target environment values file still assume a single edge entry point. | Confirm the public hostname resolves through the expected edge service and that direct origin access is still blocked. |
| Load balancer source restrictions | `charts/app/values-dev.yaml` or cloud-specific overlays keep `loadBalancerSourceRanges` / equivalent origin allowlists. | Inspect the rendered service or cloud LB config and confirm only approved source ranges remain. |
| Service-tag enforcement | AKS keeps `service.beta.kubernetes.io/azure-allowed-service-tags: "AzureFrontDoor.Backend"` in `charts/app/values-dev.yaml`. | `kubectl describe svc` (or cloud console) still shows the Azure Front Door service-tag restriction. |
| Kubernetes `NetworkPolicy` | `charts/app/templates/networkpolicies.yaml` still contains `default-deny-all` plus component allowlists (`frontend-policy`, `temporal-worker-policy`, `ops-api-policy`). No new pod type is added without a corresponding allowlist. See [NetworkPolicy enforcement](#networkpolicy-enforcement) for per-policy detail and CNI requirements. | `kubectl get networkpolicy -n <namespace>` shows all expected policies. `kubectl describe networkpolicy default-deny-all -n <namespace>` confirms `podSelector: {}` covers all pods. |
| Supabase JWT / MFA / RLS | `docs/architecture/network-security.md` still documents JWT + MFA + RLS as part of the trusted path; `supabase/config.toml` still keeps Studio disabled. | Confirm sign-in still requires the expected auth posture and that application data is only reachable through Supabase-authenticated paths. |
| Application-layer auth | No PR change introduces an unauthenticated path around the intended ingress/auth flow. | Exercise the changed endpoint from the deployed environment and confirm anonymous access is rejected where expected. |

## Services that must never be internet-exposed

| Service | Why never public | Repository evidence |
|---|---|---|
| `temporal-ui` | It exposes workflow history and operational controls and has no repository-defined public-auth boundary. Local loopback access through Traefik is acceptable for a single developer machine; public/shared ingress is not. | `docker-compose.proxy.yml` removes direct host ports (`ports: []`); `docs/architecture/network-security.md` treats it as internal-only in Kubernetes. |
| `supabase-db` (Postgres) | Direct database exposure bypasses Supabase Auth, JWT checks, MFA enforcement, and RLS. | ADR-0047 and `docs/architecture/network-security.md` keep database access on private/cluster-only paths. |
| `temporal-db` (Postgres) | Direct Temporal state access — exposes all workflow execution history and state to arbitrary reads/writes. | `ClusterIP` only in Kubernetes; Docker-only port is loopback-bound. |
| `temporal` server (gRPC) | Workflow control plane — allows arbitrary workflow submission and cancellation. | `ClusterIP` only; only the temporal-worker connects internally. Never in ingress; blocked by default-deny NetworkPolicy. |
| Supabase Studio | Admin UI with no authentication — full database browser with read/write access. | `supabase/config.toml` sets `[studio] enabled = false` and documents that it must never be enabled in shared or cloud environments. Excluded via `--exclude studio` in `supabase start`. |
| `ops-api` | Internal operations API that communicates with Temporal and external services. Has no public ingress — its `ops-api-policy` NetworkPolicy allows egress only (ports 7233, 443, 8000, DNS) and denies all inbound traffic. | `charts/app/values.yaml` defaults `opsApi.service.type: ClusterIP`; `charts/app/templates/networkpolicies.yaml` sets `ingress: []` on `ops-api-policy`. No ingress resource is defined for it in any values file. |

**Quick verification commands:**

```bash
# Verify Studio is disabled
# The [studio] section has multi-line comments before enabled = so use -A10
grep -A10 "\[studio\]" supabase/config.toml | grep "^enabled"
# Expected: enabled = false

# Verify temporal-db is loopback-only in Docker
grep "5433" docker-compose.yml
# Expected: 127.0.0.1:5433:5432

# Verify supabase-db port (managed by Supabase CLI, not docker-compose.yml)
grep -A3 "^\[db\]" supabase/config.toml
# Expected: port = 54322 (Supabase CLI binds this to 127.0.0.1 by default)

# Verify temporal-ui is ClusterIP only (Kubernetes)
kubectl get svc -n <namespace> | grep temporal-ui
# Expected: ClusterIP — no EXTERNAL-IP

# Verify temporal server is ClusterIP only
kubectl get svc -n temporal | grep temporal
# Expected: all entries show ClusterIP

# Verify ops-api service type and absence of ingress
kubectl get svc -n <namespace> | grep ops-api
# Expected: ClusterIP — no EXTERNAL-IP
kubectl get ingress -n <namespace> | grep ops-api
# Expected: no output (ops-api has no ingress)
```

## TLS strategy by environment

| Environment | TLS mechanism | Termination point | How to rotate / verify |
|---|---|---|---|
| **Docker Desktop** | Self-signed cert generated by `alpine/openssl` in-container (`make certs` / `make up-https`) | Traefik (`docker-compose.proxy.yml`) | Delete `certs/local/` and run `make up-https`. Optional: use `mkcert` for a browser-trusted cert (see ADR-0048). |
| **Kubernetes dev/test** | cert-manager `selfSigned` ClusterIssuer | ingress-nginx | `kubectl get certificate -n <namespace>`; check annotation `cert-manager.io/cluster-issuer: selfsigned-issuer` on the ingress resource. |
| **Kubernetes production** | cert-manager `letsencrypt-prod` ClusterIssuer (ACME HTTP-01 or DNS-01) — auto-renewed | ingress-nginx | `kubectl get certificate -n <namespace>`; annotation `cert-manager.io/cluster-issuer: letsencrypt-prod`; `kubectl describe certificate <name> -n <namespace>` for renewal status. |
| **AKS + Azure Front Door** | AFD-managed TLS at the edge; cert-manager self-signed for in-cluster traffic; `ssl-redirect: false` on the ingress (prevents redirect loops) | Azure Front Door (edge), ingress-nginx (cluster-internal) | AFD certificate settings in Azure portal; `kubectl get certificate -n <namespace>`; confirm `nginx.ingress.kubernetes.io/ssl-redirect: "false"` annotation is present on the AKS ingress. |

**To verify the active issuer annotation:**

```bash
kubectl get ingress -n <namespace> -o yaml | grep "cluster-issuer"

kubectl get certificate -n <namespace>
kubectl describe certificate <name> -n <namespace>
```

For full TLS decision rationale see [ADR-0048](../adrs/0048-tls-certificate-strategy.md).

## NetworkPolicy enforcement

`charts/app/templates/networkpolicies.yaml` ships the following policies (enabled when `networkPolicy.enabled: true`, which is the default):

| Policy name | Selector | Allowed ingress | Allowed egress |
|---|---|---|---|
| `default-deny-all` | All pods (`podSelector: {}`) | None | None (baseline deny) |
| `frontend-policy` | `component: frontend` | From `ingress-nginx` namespace only | DNS (UDP/TCP 53) |
| `temporal-worker-policy` | `component: temporal-worker` | None — headless worker | Port 7233 (Temporal), 443 (HTTPS/LLM), 8000, DNS |
| `ops-api-policy` | `component: ops-api` | None — headless | Port 7233, 443, 8000, DNS |

**CNI requirement:** NetworkPolicy is only enforced by CNIs that support it. Supported CNIs: Calico,
Cilium, Azure NPM, AWS VPC CNI with Calico, GKE Dataplane V2. Clusters using `flannel` (default
`k3d` / `kind`) silently ignore NetworkPolicy — verify your CNI before relying on these policies for
security guarantees.

```bash
# Confirm networkPolicy.enabled is true in the deployed release
helm get values <release-name> -n <namespace> | grep -A3 networkPolicy

# Confirm all expected policies are present
kubectl get networkpolicy -n <namespace>
# Expected: default-deny-all, frontend-policy, temporal-worker-policy, ops-api-policy

# Verify default-deny covers all pods
kubectl describe networkpolicy default-deny-all -n <namespace>
# Look for: podSelector: {} and policyTypes: [Ingress, Egress]
```

## Azure Front Door CIDR refresh runbook

**Workflow:** `.github/workflows/refresh-azure-frontdoor-cidrs.yml`

| Attribute | Value |
|---|---|
| Schedule | Weekly — Monday at 05:00 UTC; also `workflow_dispatch` |
| Source | `az network list-service-tags` → `AzureFrontDoor.Backend` service tag |
| Output file updated | `deploy/azure/afd-backend-cidrs.txt` |
| Automated PR branch | `automation/azure-frontdoor-cidrs` (deleted after merge) |
| PR raised by | `PROJECT_MANAGER_PAT` identity — labelled `queue:platform` |

**Required secrets** (missing secrets fail the workflow at the validation step with a clear error):

| Secret | Purpose |
|---|---|
| `AZURE_CLIENT_ID` | Federated OIDC identity for `az login` |
| `AZURE_TENANT_ID` | Azure tenant scope for service tag query |
| `AZURE_SUBSCRIPTION_ID` | Subscription scope for service tag API |
| `PROJECT_MANAGER_PAT` | PAT for creating the automated PR |

**Optional variable:**

| Variable | Default | Purpose |
|---|---|---|
| `AZURE_SERVICE_TAGS_LOCATION` | `eastus` | Azure region used to scope the service-tag query (`az network list-service-tags --location`). Set this repository variable if your cluster is in a different region and you need region-specific CIDR data. |

**Important:** The workflow updates `deploy/azure/afd-backend-cidrs.txt` only. It does **not**
automatically rewrite `charts/app/values-dev.yaml`. A platform engineer must review the refreshed
CIDR list, update `loadBalancerSourceRanges` in the relevant values file, and run `helm upgrade`
to apply the change to the live cluster.

**Verification steps:**

```bash
# 1. Confirm the latest refresh run succeeded
gh run list --workflow=refresh-azure-frontdoor-cidrs.yml --limit 5

# 2. Check when the CIDR file was last updated
git log --oneline deploy/azure/afd-backend-cidrs.txt | head -3

# 3. Compare the file against what is live on the ingress controller service
# Requires bash (uses process substitution)
diff \
  <(sort deploy/azure/afd-backend-cidrs.txt) \
  <(kubectl get svc -n ingress-nginx ingress-nginx-controller \
      -o jsonpath='{.spec.loadBalancerSourceRanges[*]}' \
      | tr ' ' '\n' | sort)
# No diff = CIDR file and live service are in sync

# 4. Confirm the service-tag annotation is still present on the live ingress controller
kubectl get svc -n ingress-nginx ingress-nginx-controller -o yaml \
  | grep "azure-allowed-service-tags"
# Expected: AzureFrontDoor.Backend
```

## Exposure review checklist

### Before merge

- [ ] The change preserves a single trusted ingress path for the target environment.
- [ ] `docker-compose.proxy.yml` remains loopback-only for local ingress.
- [ ] `charts/app/values.yaml` keeps default service exposure private (`ClusterIP`) unless the issue explicitly approves an exception.
- [ ] `charts/app/values-test.yaml` / `charts/app/values-prod.yaml` still route internet traffic through `frontend.ingress.enabled: true` and `className: nginx`.
- [ ] `charts/app/templates/networkpolicies.yaml` still enforces default-deny plus the minimum component allowlists.
- [ ] AKS-specific changes preserve both `AzureFrontDoor.Backend` service-tag enforcement and reviewed source ranges.
- [ ] The change does not internet-expose `temporal-ui`, `supabase-db`, `temporal-db`, `temporal` server, `ops-api`, or Supabase Studio.
- [ ] TLS termination and issuer choices still match ADR-0048 for the affected environment.

### After deploy

- [ ] `kubectl get svc,ingress,networkpolicy -n <namespace>` shows only the intended public entry points.
- [ ] Direct access to the origin/LB IP is blocked when an edge service is supposed to front it.
- [ ] The public hostname works through the trusted edge path.
- [ ] Internal-only services (`temporal-ui`, database surfaces, admin surfaces) remain unreachable from the public internet.

## Exact files and values to inspect

| File | Values / sections to inspect |
|---|---|
| `docker-compose.proxy.yml` | `127.0.0.1:443:443`, `127.0.0.1:80:80`, `frontend.ports: []`, `temporal-ui.ports: []` |
| `charts/app/values.yaml` | `networkPolicy.enabled`, `networkPolicy.ingressControllerNamespace`, `frontend.service.type`, `frontend.ingress.enabled`, `opsApi.service.type` |
| `charts/app/values-dev.yaml` | `frontend.service.type: LoadBalancer`, `frontend.service.annotations.service.beta.kubernetes.io/azure-allowed-service-tags`, `frontend.service.loadBalancerSourceRanges`, `frontend.ingress.enabled: false` |
| `charts/app/values-aws-dev.yaml` | `frontend.service.type: LoadBalancer`, `service.beta.kubernetes.io/aws-load-balancer-type: "nlb"`, `service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"`, `frontend.ingress.enabled: false` |
| `charts/app/values-test.yaml` | `frontend.ingress.enabled: true`, `frontend.ingress.className: nginx` |
| `charts/app/values-prod.yaml` | `frontend.ingress.enabled: true`, `frontend.ingress.className: nginx` |
| `charts/app/templates/networkpolicies.yaml` | `default-deny-all`, `frontend-policy`, `temporal-worker-policy`, `ops-api-policy` |
| `docs/architecture/network-security.md` | Environment diagrams, trusted ingress narrative, and the "nothing reachable except through the controlled ingress point" rule |
| `docs/adrs/0047-network-exposure-and-ingress-security-model.md` | `ClusterIP` defaults, single-ingress model, Azure Front Door restrictions |
| `docs/adrs/0048-tls-certificate-strategy.md` | Local self-signed certs, cert-manager issuer model, Azure Front Door TLS termination |
| `.github/workflows/refresh-azure-frontdoor-cidrs.yml` | Weekly schedule, required secrets, `deploy/azure/afd-backend-cidrs.txt` update path |
| `supabase/config.toml` | `[studio] enabled = false` |
| `charts/temporal/values.yaml` | Temporal services use default-ClusterIP Kubernetes service types — confirm no `type: LoadBalancer` or `type: NodePort` in the upstream chart for the temporal namespace |
