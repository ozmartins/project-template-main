# Network Exposure and Ingress Security — Implementation Spec

**ADR:** [ADR-0047](../adrs/0047-network-exposure-and-ingress-security-model.md)  
**Status:** Accepted  
**Last updated:** 2026-06-20

---

## Problem Statement

By default, any Kubernetes service of type `LoadBalancer` receives a public IP. Any docker-compose port mapping to `0.0.0.0` is reachable by all network interfaces on the host. Without deliberate constraints, all services (including Supabase Studio, Temporal UI, and internal APIs) are directly reachable by anyone with network access, bypassing any CDN/WAF layer.

The `mna-app` incident: Supabase Kong (the API gateway) and the frontend were both deployed as `LoadBalancer`, receiving public Azure IPs. Azure Front Door with a WAF IP-allowlist sat in front, but the raw IPs were bypassed. Fix: `loadBalancerSourceRanges` + `azure-allowed-service-tags: AzureFrontDoor.Backend` applied post-deploy. This spec makes the correct posture the default.

---

## Security Model: Default Posture

```
Internet
    │
    ▼
[ Ingress point ] ← single public IP (one per environment)
    │
    ├── /          → frontend (ClusterIP / docker internal)
    ├── /rest/v1   → supabase-kong (ClusterIP / docker internal)
    ├── /auth/v1   → supabase-kong (ClusterIP / docker internal)
    └── /temporal  → temporal-ui (ClusterIP / docker internal)

All other services: ClusterIP / no port binding. Not routable.
```

**Rule:** Nothing is reachable from outside the environment unless it is explicitly routed through the ingress point.

---

## Platform 1: Docker Desktop (Local Dev)

### Problem with current state

`docker-compose.yml` maps ports to `0.0.0.0` (e.g., `0.0.0.0:3000->3000/tcp`, `0.0.0.0:8080->8080/tcp`, `0.0.0.0:54321->54321/tcp`). This means all services are directly reachable from any interface on the developer's machine, including over the local network (coffee shop Wi-Fi, office LAN).

There is also no HTTPS. Browsers restrict certain APIs (clipboard, camera, service workers) to secure origins, which causes subtle bugs during development.

### Target state

A single Traefik reverse proxy container listens on `127.0.0.1:443` only. All other port bindings in `docker-compose.yml` are changed from `0.0.0.0` to `127.0.0.1`. Downstream services have no ports exposed externally — they communicate via the Docker bridge network.

```
Developer browser
    │  https://localhost  (self-signed cert)
    ▼
[ Traefik on 127.0.0.1:443 ]
    ├── /                    → frontend:3000
    ├── /rest/v1             → supabase-kong:8000
    ├── /auth/v1             → supabase-kong:8000
    ├── /storage/v1          → supabase-kong:8000
    ├── /functions/v1        → supabase-kong:8000
    ├── /temporal            → temporal-ui:8080
    └── /temporal-ui         → temporal-ui:8080 (alias)
```

### Implementation

#### 1. Prerequisites

None. `make up-https` generates the cert automatically on first run using `openssl` inside a Docker container — no host tools needed.

`make certs` (called automatically by `up-https`):
```bash
docker run --rm -v "$(pwd)/certs/local:/out" alpine/openssl req -x509 -nodes \
  -newkey rsa:2048 -days 825 \
  -keyout /out/key.pem -out /out/cert.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"
```

The cert is self-signed (browser will show an "unsafe" warning; click "Accept once"). The `certs/local/` directory is `.gitignore`d. See ADR-0048 for the cert strategy rationale and the optional `mkcert` upgrade path for trusted certs.

#### 2. `docker-compose.proxy.yml` overlay

This file is layered on top of `docker-compose.yml` using `make up-https`:

```yaml
# docker-compose.proxy.yml
# Adds a Traefik TLS termination proxy and locks all other services
# to 127.0.0.1 bindings. Apply with: make up-https

services:
  proxy:
    image: traefik:v3.0
    container_name: proxy
    ports:
      - "127.0.0.1:443:443"
      - "127.0.0.1:80:80"   # HTTP redirect to HTTPS
    volumes:
      - ./certs/local:/certs:ro
      - ./traefik/traefik.yml:/etc/traefik/traefik.yml:ro
      - ./traefik/dynamic.yml:/etc/traefik/dynamic.yml:ro
    networks:
      - default

  # Override port bindings to loopback-only
  temporal-ui:
    ports: []   # remove the 0.0.0.0:8080 binding; routed via proxy

  frontend:
    ports: []   # remove the 0.0.0.0:3000 binding; routed via proxy
```

#### 4. Traefik static config (`traefik/traefik.yml`)

```yaml
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

providers:
  file:
    filename: /etc/traefik/dynamic.yml
    watch: true

log:
  level: WARN
```

#### 5. Traefik dynamic config (`traefik/dynamic.yml`)

```yaml
tls:
  certificates:
    - certFile: /certs/cert.pem
      keyFile: /certs/key.pem

http:
  routers:
    frontend:
      rule: "PathPrefix(`/`)"
      priority: 1
      service: frontend
      tls: {}

    supabase:
      rule: "PathPrefix(`/rest/v1`) || PathPrefix(`/auth/v1`) || PathPrefix(`/storage/v1`) || PathPrefix(`/functions/v1`)"
      priority: 10
      service: supabase-kong
      tls: {}

    temporal-ui:
      rule: "PathPrefix(`/temporal`)"
      priority: 10
      service: temporal-ui
      tls: {}

  services:
    frontend:
      loadBalancer:
        servers:
          - url: "http://frontend:3000"

    supabase-kong:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:54321"

    temporal-ui:
      loadBalancer:
        servers:
          - url: "http://temporal-ui:8080"
```

#### 6. Makefile targets

```makefile
# Generate self-signed cert via openssl in Docker (no host tools required).
# Called automatically by up-https; skips if cert already exists.
certs:
	@if [ ! -f certs/local/cert.pem ]; then \
	  docker run --rm -v "$$(pwd)/certs/local:/out" alpine/openssl req -x509 -nodes \
	    -newkey rsa:2048 -days 825 \
	    -keyout /out/key.pem -out /out/cert.pem \
	    -subj "/CN=localhost" \
	    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"; \
	fi

# Start stack with HTTPS proxy (generates cert on first run)
up-https:
	supabase start --exclude studio
	@$(MAKE) --no-print-directory certs
	@eval "$$(./scripts/supabase-env.sh)"; \
	  docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d
	@echo "Stack up (HTTPS). App https://localhost (accept the self-signed cert warning)"
```

The original `make up` remains for teams that don't need HTTPS locally.

#### 7. Updated `docker-compose.yml` port bindings

Change all `0.0.0.0` bindings to `127.0.0.1`:

```yaml
# Before (insecure — listens on all interfaces)
ports:
  - "8080:8080"

# After (loopback only)
ports:
  - "127.0.0.1:8080:8080"
```

Apply to: `temporal-ui` (8080), `temporal-db` (5433), `temporal` (7234).  
The `frontend` container's port binding is removed in the proxy overlay. In the base `docker-compose.yml`, change it to `127.0.0.1:3000:3000`.

---

## Platform 2: Kubernetes (Provider-Agnostic)

### Default chart posture

All services in `charts/app/values.yaml` default to `ClusterIP`. This is already true. No changes required for service types.

### NetworkPolicy (new — `charts/app/templates/network-policy.yaml`)

A `NetworkPolicy` resource is added to the chart. When `networkPolicy.enabled: true` (the new default), the following policies are installed:

**Default deny all ingress** per namespace:
```yaml
# Deny all ingress by default; specific policies below grant exceptions
podSelector: {}
policyTypes: [Ingress]
ingress: []
```

**Allow ingress controller → frontend:**
```yaml
podSelector:
  matchLabels:
    app.kubernetes.io/component: frontend
ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: ingress-nginx
```

**Allow ingress controller → supabase-kong:**
```yaml
podSelector:
  matchLabels:
    app.kubernetes.io/component: supabase-kong
ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: ingress-nginx
```

**Allow temporal-worker → temporal server (cross-namespace):**
```yaml
podSelector:
  matchLabels:
    app.kubernetes.io/component: temporal-worker
egress:
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: "{{ .Values.temporal.namespace }}"
    ports:
      - port: 7233
```

**Important caveat:** NetworkPolicy is enforced only if the cluster's CNI plugin supports it (Calico, Cilium, Azure NPM, AWS VPC CNI with Calico, GKE Dataplane V2). `kind` and `k3d` require explicit CNI configuration. Operators must verify CNI support before relying on NetworkPolicy for security guarantees.

### Helm values: `networkPolicy`

```yaml
# charts/app/values.yaml (additions)
networkPolicy:
  # -- Enable NetworkPolicy resources. Requires a CNI that enforces NetworkPolicy.
  # Silently no-ops on clusters without a compatible CNI.
  enabled: true
  # -- Namespace where the ingress controller runs (used to allow ingress → app traffic)
  ingressControllerNamespace: ingress-nginx
```

### Ingress: `ingress-nginx` as the standard ingress controller

The chart assumes `ingress-nginx` as the ingress controller. This is the most widely supported provider-agnostic option. Operators install it once per cluster:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace
```

The Ingress resource in the chart uses `ingressClassName: nginx`:
```yaml
# values.yaml
frontend:
  ingress:
    enabled: true
    className: nginx
    annotations:
      nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
```

TLS is handled by `cert-manager` (installed separately, also cloud-agnostic):
```yaml
frontend:
  ingress:
    tls:
      - secretName: frontend-tls
        hosts:
          - app.example.com
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
```

---

## Platform 3: Kubernetes on Azure (AKS + Azure Front Door)

This is a specialisation of Platform 2. The Nginx Ingress `LoadBalancer` service receives a public Azure IP. AFD Standard sits in front.

### Values overlay: `values-azure.yaml`

```yaml
# Nginx Ingress controller values (applied when installing ingress-nginx on AKS)
# helm install ingress-nginx ingress-nginx/ingress-nginx -f values-azure-ingress.yaml
controller:
  service:
    annotations:
      # AKS: only allow traffic originating from AFD backend nodes.
      # This blocks direct IP access to the ingress LoadBalancer, forcing all
      # traffic through AFD (and its WAF policy).
      service.beta.kubernetes.io/azure-allowed-service-tags: "AzureFrontDoor.Backend"
    # Explicit CIDR allowlist as a belt-and-suspenders backup.
    # Keep in sync with the AzureFrontDoor.Backend service tag.
    # Source: https://www.microsoft.com/en-us/download/details.aspx?id=56519
    # This list is managed in the values file, not hardcoded in chart templates.
    loadBalancerSourceRanges:
      # Populated by the operator from the AFD backend CIDR list.
      # Run: az network list-service-tags --location eastus --query
      #   "values[?name=='AzureFrontDoor.Backend'].properties.addressPrefixes[]"
      #   to generate the current list.
      - "4.153.250.0/29"
      # ... (full list in deploy/azure/afd-backend-cidrs.txt, regenerated by CI)
```

### AFD → Ingress routing

- AFD origin points to the Nginx Ingress `LoadBalancer` public IP.
- AFD enforces WAF policy (OWASP ruleset + IP allowlist for operator-only paths like Temporal UI).
- AFD manages TLS — the origin uses HTTP internally (TLS is terminated at AFD). Set `nginx.ingress.kubernetes.io/ssl-redirect: "false"` for AFD origins.

### CIDR list maintenance

The AFD backend CIDR list changes periodically. A weekly CI job (`refresh-azure-frontdoor-cidrs.yml`) regenerates `deploy/azure/afd-backend-cidrs.txt` and opens a PR if the list has changed:

```bash
az network list-service-tags --location eastus \
  --query "values[?name=='AzureFrontDoor.Backend'].properties.addressPrefixes[]" \
  -o tsv | sort > deploy/azure/afd-backend-cidrs.txt
```

Operators applying this to the ingress controller values file is a manual step until Helm can template from a file reference.

---

## Services that must never be publicly exposed

| Service | Why | Correct exposure |
|---|---|---|
| `temporal-ui` | No authentication, full workflow history | Ingress with IP-allowlist annotation or VPN-only path rule |
| `supabase-db` (Postgres) | Raw database access | ClusterIP only, never exposed |
| `temporal-db` | Raw Temporal Postgres | ClusterIP only, never exposed |
| `temporal` (server) | Workflow control plane | ClusterIP only; worker connects internally |
| Supabase Studio | Admin UI, no prod data ACLs | Local dev: `127.0.0.1:54323` only; K8s: not deployed in prod |

For **Temporal UI** on Kubernetes, the recommended pattern is:
1. Expose via Ingress with a path prefix (e.g., `/temporal-ui`).
2. Add an annotation to restrict by source IP:
   ```yaml
   nginx.ingress.kubernetes.io/whitelist-source-range: "10.0.0.0/8,172.16.0.0/12"
   ```
3. Or route it behind a VPN/bastion by giving it its own Ingress on a separate host with no public DNS entry.

---

## `docker-compose.yml` changes required

| Service | Current binding | New binding |
|---|---|---|
| `temporal-ui` | `0.0.0.0:8080->8080/tcp` | `127.0.0.1:8080:8080` |
| `temporal-db` | `0.0.0.0:5433->5432/tcp` | `127.0.0.1:5433:5432` |
| `temporal` | `0.0.0.0:7234->7233/tcp` | `127.0.0.1:7234:7233` |
| `frontend` | `0.0.0.0:3000->3000/tcp` | `127.0.0.1:3000:3000` |

Supabase is managed by the Supabase CLI (`supabase start`) and already binds to `127.0.0.1` by default.

---

## Open items / follow-on work

- [ ] Implement `docker-compose.proxy.yml` + Traefik config files (tracked in GitHub issue)
- [ ] Add `NetworkPolicy` templates to `charts/app/templates/`
- [ ] Add `networkPolicy` values block to `charts/app/values.yaml`
- [ ] Update `docker-compose.yml` port bindings from `0.0.0.0` to `127.0.0.1`
- [ ] Add `make certs` target and `mkcert` setup to `Makefile` and `README`
- [ ] Add weekly CIDR-refresh job to `pipeline-weekly.yml`
- [ ] Document in `README.md`: "Temporal UI has no authentication — do not expose it publicly"
- [ ] Validate NetworkPolicy on kind cluster in CI (requires CNI setup in CI runner)
