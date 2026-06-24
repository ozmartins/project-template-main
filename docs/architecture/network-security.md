# Network Architecture and Security Posture

This document describes how the stack is wired together at the network level and what controls prevent unauthorised access. Two deployment targets are covered: **Docker Desktop** (local dev) and **Kubernetes** (AKS/EKS or any cloud).

**Related:**
- [ADR-0047 — Network Exposure and Ingress Security Model](../adrs/0047-network-exposure-and-ingress-security-model.md)
- [ADR-0048 — TLS Certificate Strategy](../adrs/0048-tls-certificate-strategy.md)
- [Network Exposure Spec](../specs/network-exposure-spec.md)

---

## Core Principle

> **Nothing is reachable from outside the environment unless it passes through the single controlled ingress point.**

All services default to unexposed (Docker bridge / Kubernetes ClusterIP). A single reverse proxy or ingress controller is the only public listener. This was codified after the `mna-app` incident where services deployed as `LoadBalancer` received public IPs that bypassed Azure Front Door and its WAF.

---

## Docker Desktop

### Service topology

```mermaid
graph TB
    Browser["Developer Browser<br/>https://localhost"]

    subgraph Host ["Developer Machine (127.0.0.1 only)"]
        Proxy["Traefik Proxy<br/>127.0.0.1:443 / :80<br/>(self-signed TLS cert)"]

        subgraph Compose ["Docker Compose network (bridge)"]
            Frontend["frontend<br/>:3000"]
            TemporalUI["temporal-ui<br/>:8080"]
            Temporal["temporal server<br/>:7233"]
            TemporalDB["temporal-db (Postgres)<br/>:5432"]
            Worker["temporal-worker"]
        end

        subgraph Supabase ["Supabase CLI (supabase start)"]
            Kong["supabase-kong<br/>API gateway :54321"]
            Auth["supabase-auth"]
            Storage["supabase-storage"]
            SupaDB["supabase-db (Postgres)<br/>:54322"]
        end
    end

    LLM["LLM Provider<br/>(Anthropic / OpenAI / etc.)"]

    Browser -->|"HTTPS :443"| Proxy
    Proxy -->|"/ → :3000"| Frontend
    Proxy -->|"/temporal → :8080"| TemporalUI
    Proxy -->|"/rest/v1 /auth/v1<br/>/storage/v1 /functions/v1<br/>/realtime/v1 → :54321"| Kong

    Kong --> Auth
    Kong --> Storage
    Kong --> SupaDB

    Frontend -->|"Supabase JS SDK<br/>via :54321"| Kong
    Worker -->|"host.docker.internal:54321"| Kong
    Worker -->|"temporal:7233 (bridge)"| Temporal
    Temporal --> TemporalDB

    Worker -->|"HTTPS (outbound)"| LLM
```

### Port exposure

| Service | Host binding | Accessible from |
|---|---|---|
| Traefik (HTTPS) | `127.0.0.1:443` | Browser only, loopback |
| Traefik (HTTP→HTTPS redirect) | `127.0.0.1:80` | Loopback only |
| frontend | `127.0.0.1:3000` | Loopback (`make up` only, removed in HTTPS overlay) |
| temporal-ui | `127.0.0.1:8081` | Loopback (`make up` only, removed in HTTPS overlay) |
| temporal server | `127.0.0.1:7234` | Loopback (SDK access, not browser) |
| temporal-db | `127.0.0.1:5433` | Loopback (DB tooling only) |
| Supabase API (Kong) | `127.0.0.1:54321` | Loopback (managed by Supabase CLI) |
| Supabase DB | `127.0.0.1:54322` | Loopback (managed by Supabase CLI) |

All bindings use `127.0.0.1`, never `0.0.0.0`. Nothing is reachable from the local network or other machines on the same Wi-Fi.

### TLS and certificate flow

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Make as make up-https
    participant OpenSSL as alpine/openssl (Docker)
    participant Traefik as Traefik container
    participant Browser as Browser

    Dev->>Make: make up-https
    Make->>OpenSSL: generate self-signed cert<br/>SAN: localhost, 127.0.0.1
    OpenSSL-->>Make: certs/local/cert.pem + key.pem
    Make->>Traefik: docker compose up<br/>(mounts certs/local/ read-only)
    Traefik-->>Browser: TLS handshake (self-signed)
    Browser->>Browser: one-time "Accept" warning
    Browser->>Traefik: HTTPS requests
    Traefik->>Traefik: route by path prefix
```

The cert is generated once and cached in `certs/local/` (git-ignored). Delete the directory and re-run `make up-https` to rotate. See ADR-0048 for the optional `mkcert` upgrade to a browser-trusted cert.

### Traffic routing rules

```mermaid
flowchart LR
    req["Incoming request"]
    req --> r1{Path prefix?}
    r1 -->|"/rest/v1<br/>/auth/v1<br/>/storage/v1<br/>/functions/v1<br/>/realtime/v1"| Kong["supabase-kong<br/>:54321"]
    r1 -->|"/temporal"| TUI["temporal-ui<br/>:8080"]
    r1 -->|"/ (catch-all)"| FE["frontend<br/>:3000"]
```

Supabase and Temporal routes have priority 20; the frontend catch-all has priority 1.

### Authentication layers

```mermaid
flowchart TB
    Browser["Browser"]

    subgraph Auth ["Auth stack"]
        JWT["Supabase JWT<br/>(issued by supabase-auth)"]
        MFA["TOTP MFA<br/>(require_aal2 migration<br/>enforces aal2 on all sessions)"]
        RLS["Row Level Security<br/>(Postgres RLS policies)"]
    end

    Browser -->|"1. POST /auth/v1/token"| JWT
    JWT -->|"2. TOTP challenge"| MFA
    MFA -->|"3. aal2 JWT issued"| Browser
    Browser -->|"4. Bearer JWT on all requests"| RLS
    RLS -->|"5. Policy check: role + user_id"| DB[("supabase-db")]
```

Supabase Studio is disabled (`enabled = false` in `supabase/config.toml`, `--exclude studio` in `supabase start`). Use `make bootstrap-users` to create dev accounts.

---

## Kubernetes (Generic — AKS, EKS, GKE)

### Cluster network topology

```mermaid
graph TB
    Internet["Internet"]

    subgraph Cloud ["Cloud Provider"]
        LB["Load Balancer (public IP)<br/>managed by cloud provider"]

        subgraph Cluster ["Kubernetes Cluster"]
            subgraph NS_INGRESS ["ns: ingress-nginx"]
                Nginx["ingress-nginx controller<br/>ClusterIP (pod)"]
            end

            subgraph NS_APP ["ns: app (dev / test / prod)"]
                subgraph NP ["NetworkPolicy: default-deny ingress"]
                    Frontend["frontend<br/>ClusterIP"]
                    Kong2["supabase-kong<br/>ClusterIP"]
                    TemporalUI2["temporal-ui<br/>ClusterIP"]
                    Worker2["temporal-worker<br/>ClusterIP"]
                    SupaDB2[("supabase-db<br/>ClusterIP")]
                end
            end

            subgraph NS_TEMPORAL ["ns: temporal"]
                TemporalSvr["temporal server<br/>ClusterIP"]
                TemporalDB2[("temporal-db<br/>ClusterIP")]
            end
        end
    end

    CertMgr["cert-manager<br/>(ClusterIssuer)"]
    LLM2["LLM Provider (outbound)"]

    Internet -->|"HTTPS :443"| LB
    LB --> Nginx
    Nginx -->|"NetworkPolicy allows<br/>ingress-nginx ns → app ns"| Frontend
    Nginx --> Kong2
    Kong2 --> SupaDB2
    Worker2 -->|"NetworkPolicy allows<br/>egress to temporal ns :7233"| TemporalSvr
    TemporalSvr --> TemporalDB2
    Worker2 -->|"HTTPS (outbound)"| LLM2
    CertMgr -.->|"provisions TLS secret"| Nginx
```

### NetworkPolicy enforcement

```mermaid
flowchart TB
    subgraph Policies ["NetworkPolicy rules (shipped in Helm chart)"]
        DefaultDeny["Default deny all ingress<br/>podSelector: {} — applies to every pod in namespace"]
        AllowNginx["Allow ingress-nginx ns → frontend pod<br/>Allow ingress-nginx ns → supabase-kong pod"]
        AllowWorker["Allow temporal-worker → temporal server<br/>(egress, cross-namespace, port 7233)"]
        AllowKong["Allow supabase-kong ↔ supabase-db<br/>(internal namespace only)"]
    end

    DefaultDeny --> AllowNginx
    DefaultDeny --> AllowWorker
    DefaultDeny --> AllowKong
```

NetworkPolicy is enforced only when the cluster's CNI supports it (Calico, Cilium, Azure NPM, AWS VPC CNI with Calico, GKE Dataplane V2). Clusters using `flannel` (e.g. default k3d/kind) silently ignore it — verify your CNI before relying on these policies for security guarantees.

### TLS certificate lifecycle (Kubernetes)

```mermaid
sequenceDiagram
    participant Helm as helm install
    participant CM as cert-manager
    participant Issuer as ClusterIssuer (selfSigned / ACME)
    participant Secret as K8s Secret
    participant Nginx2 as ingress-nginx
    participant AFD as Azure Front Door (AKS only)

    Helm->>CM: deploy Certificate resource<br/>annotated with cluster-issuer
    CM->>Issuer: request cert
    Issuer-->>CM: signed cert + key
    CM-->>Secret: store in TLS Secret
    Nginx2->>Secret: mount TLS Secret
    AFD->>Nginx2: TLS terminated at AFD<br/>(HTTP internally to Nginx on AKS)
```

- **Dev/test:** `selfSigned` ClusterIssuer (no external CA required)
- **Production:** `letsencrypt-prod` ClusterIssuer via ACME HTTP-01 or DNS-01
- Switch by changing the `cert-manager.io/cluster-issuer` annotation in `values-*.yaml`

---

## Kubernetes on Azure (AKS + Azure Front Door)

### Traffic path

```mermaid
graph LR
    User["End User"]

    subgraph Azure ["Azure"]
        AFD["Azure Front Door Standard<br/>+ WAF policy (OWASP ruleset)"]
        LB2["AKS Load Balancer<br/>(public IP — locked to AFD CIDRs)"]

        subgraph AKS ["AKS Cluster"]
            Nginx3["ingress-nginx<br/>(receives HTTP, not HTTPS — AFD terminates TLS)"]
            App["App pods (ClusterIP)"]
        end
    end

    User -->|"HTTPS"| AFD
    AFD -->|"HTTP (TLS terminated)<br/>X-Forwarded-For + AFD headers"| LB2
    LB2 -->|"loadBalancerSourceRanges<br/>= AFD backend CIDRs only"| Nginx3
    Nginx3 --> App
```

### AKS-specific service annotation

The Nginx Ingress `LoadBalancer` service in `values-azure.yaml` carries two constraints that block all traffic that does not originate from Azure Front Door's backend nodes:

```yaml
controller:
  service:
    annotations:
      service.beta.kubernetes.io/azure-allowed-service-tags: "AzureFrontDoor.Backend"
    loadBalancerSourceRanges:
      - "4.153.250.0/29"   # example — full list in deploy/azure/afd-backend-cidrs.txt
      # regenerated weekly by pipeline-weekly.yml CI job
```

Even if an attacker learns the raw AKS load balancer IP, their traffic is dropped at the cloud networking layer before reaching any pod.

### Defence-in-depth layers on AKS

```mermaid
flowchart TD
    Internet2["Internet request"]

    L1["Layer 1: Azure Front Door WAF<br/>OWASP ruleset, DDoS protection, geo-filtering"]
    L2["Layer 2: AKS Load Balancer source ranges<br/>AFD backend CIDRs only (weekly refresh)"]
    L3["Layer 3: Azure service tag annotation<br/>AzureFrontDoor.Backend (cloud-enforced)"]
    L4["Layer 4: Kubernetes NetworkPolicy<br/>default-deny, ingress-nginx ns → app ns only"]
    L5["Layer 5: Supabase RLS + JWT<br/>row-level access control, MFA enforced"]
    L6["Layer 6: Application (no data returned<br/>without valid aal2 JWT)"]

    Internet2 --> L1 --> L2 --> L3 --> L4 --> L5 --> L6
```

---

## What is never publicly exposed

| Service | Risk if exposed | Mitigation |
|---|---|---|
| `temporal-ui` | No auth — full workflow history visible and mutable | ClusterIP; Nginx Ingress with IP-allowlist annotation or VPN-only path |
| `supabase-db` (Postgres) | Direct database access | ClusterIP only, never in ingress |
| `temporal-db` (Postgres) | Direct Temporal state access | ClusterIP only |
| `temporal` server | Workflow control plane | ClusterIP; only worker connects internally |
| Supabase Studio | Admin UI, no auth | Disabled in `supabase/config.toml` (`enabled = false`) and excluded via `--exclude studio` |

---

## Comparison: Docker Desktop vs Kubernetes

| Concern | Docker Desktop | Kubernetes |
|---|---|---|
| Ingress | Traefik container (`docker-compose.proxy.yml`) | ingress-nginx (Helm, one-time per cluster) |
| TLS termination | Traefik (self-signed cert, auto-generated) | cert-manager (selfSigned / Let's Encrypt) |
| External access | `127.0.0.1` bindings — loopback only | ClusterIP default + single LoadBalancer IP |
| Network isolation | Docker bridge (all containers on same network) | Kubernetes NetworkPolicy (default-deny) |
| AKS hardening | N/A | `loadBalancerSourceRanges` + AFD service tag |
| Auth enforcement | Supabase JWT + `require_aal2` migration | Same + RLS |
| Temporal UI protection | Port removed in proxy overlay — only via `/temporal` path | ClusterIP; IP-allowlist annotation recommended |
| Supabase Studio | Disabled (`config.toml` + `--exclude studio`) | Not deployed in production |
