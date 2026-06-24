# ADR-0047: Network Exposure and Ingress Security Model

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

In the mna-app deployment we discovered that services deployed as Kubernetes `LoadBalancer` type receive public cloud IP addresses that are reachable directly, bypassing Azure Front Door (AFD) and its WAF/IP-allowlist policies. The fix was applied reactively: `loadBalancerSourceRanges` was set to the AFD backend CIDR list, and the AKS-specific annotation `service.beta.kubernetes.io/azure-allowed-service-tags: AzureFrontDoor.Backend` was added. Both constraints are cloud-specific and fragile — the AFD CIDR list rotates, and the annotation only works on AKS.

The root issue is that the template had no **opinionated default egress posture**: services were created as `LoadBalancer` without forcing any routing through a controlled ingress point, and there was no network policy layer preventing lateral movement inside the cluster.

The same risk applies to any platform this template runs on:
- **Docker Desktop (local dev)**: by default all ports mapped to `localhost` are reachable by any process on the developer's machine. There is no HTTPS, no single entry point, and no credential for the Supabase Studio or Temporal UI is required beyond knowing the port.
- **Kubernetes (any cloud)**: `LoadBalancer` services receive a routable IP. Without an allowlist or network policy, any internet host can reach them. The AFD/CDN layer is bypassed.

This template is used across multiple cloud providers (ADR-0033). The fix must be platform-agnostic at the chart/compose level, with provider-specific details isolated to values files.

## Decision

**All application services default to `ClusterIP`** (already true). No service type other than `ClusterIP` appears in chart defaults or docker-compose defaults. Exposure is explicit and requires opt-in configuration.

**A single controlled ingress point handles all external traffic per environment:**

| Environment | Ingress mechanism | TLS |
|---|---|---|
| Docker Desktop (local dev) | Traefik reverse proxy container on port 443 with a locally-trusted self-signed cert | Self-signed (mkcert) |
| Kubernetes (any cloud) | Nginx Ingress Controller (`ingress-nginx`) — standard, provider-agnostic | cert-manager with Let's Encrypt or cloud-native cert service |
| Kubernetes (Azure) | Azure Front Door Standard → Nginx Ingress (or AFD directly via Private Link) | AFD-managed TLS |

**A Kubernetes NetworkPolicy is shipped in the chart** that enforces the following by default:
- All pods default-deny ingress from outside their namespace.
- Only the ingress controller namespace may reach application pods on their service port.
- Temporal worker → Supabase: allowed. Temporal worker → Temporal server: allowed. All other east-west is denied.
- Supabase Kong is never reachable directly from the internet — only through the ingress controller.

**For Docker Desktop**, a `docker-compose.proxy.yml` override adds a Traefik container that:
- Listens on `127.0.0.1:443` only (not `0.0.0.0`).
- Terminates TLS using a locally-generated cert (mkcert, checked in as `certs/local/`).
- Routes `/` → frontend, `/rest/v1` and `/auth/v1` → Supabase Kong, `/temporal-ui` → Temporal UI.
- Requires no changes to downstream service configuration.

**For Kubernetes on Azure**, a values overlay (`values-azure.yaml`) provides:
- `service.beta.kubernetes.io/azure-allowed-service-tags: AzureFrontDoor.Backend` on the Nginx Ingress `LoadBalancer` service.
- `loadBalancerSourceRanges` set to the AFD backend CIDR block (sourced from the well-known `AzureFrontDoor.Backend` service tag, not hardcoded CIDRs).
- WAF policy enforced at AFD, not in-cluster.

**What is NOT done:**
- No `LoadBalancer` service in chart defaults or docker-compose defaults.
- No port mapping to `0.0.0.0` in docker-compose defaults (all map to `127.0.0.1`).
- No cloud-specific network policy implementations (Calico, Cilium) — standard `networking.k8s.io/v1` NetworkPolicy only.

## Consequences

**Positive:**
- Zero exposed services by default. A fresh `helm install` with default values cannot be accidentally reached from the internet.
- The local dev environment gets HTTPS from day one — browser warnings for mixed content and cookie security are eliminated.
- Network policy is shipped and enforced, not aspirational — lateral movement inside the cluster is blocked.
- The Azure-specific fix (AFD backend tag + source ranges) is codified in `values-azure.yaml` rather than applied ad hoc.

**Negative:**
- Local dev setup requires `mkcert` and running `make certs` once to generate a trusted cert. This is a one-time operation but adds a step.
- NetworkPolicy enforcement requires a CNI that supports it (Calico, Cilium, Azure NPM). Clusters without a supporting CNI silently ignore NetworkPolicy. This is documented in the spec.
- The Traefik proxy container adds latency on local dev (< 1 ms in practice).
- Operators deploying to a new Kubernetes environment must install `ingress-nginx` before deploying the chart. This is a dependency that must be documented.

## Alternatives considered

**Istio service mesh:** Full mutual TLS between all pods, rich traffic policies. Rejected — too heavy for a template starter. Adds 2–4 pods per node, complex to operate, and obscures the network model for teams learning the stack. Can be layered on by operators who need it.

**Cloud-native ingress only (Azure Application Gateway Ingress Controller, AWS ALB Ingress):** Provider-specific. Breaks ADR-0033 (portability). Rejected.

**Keep the reactive fix (source ranges + service tag annotation):** Only works on AKS, fragile as AFD CIDRs rotate, gives no defence-in-depth inside the cluster. Rejected.

**Dual ingress (internal + external):** Separate ingress controllers for internal traffic (monitoring, Temporal UI) and external traffic (frontend, API). More precise but significant operational complexity for a template. Deferred — operators can add it when needed.

## Evidence

- `mna-app` production: `kubectl get svc mna-app-frontend -n mna-dev` shows `loadBalancerSourceRanges` and `azure-allowed-service-tags` annotation applied reactively.
- `charts/app/values.yaml` — `service.type: ClusterIP` as default (already correct).
- `docs/specs/network-exposure-spec.md` — implementation spec for this ADR.
- `docker-compose.proxy.yml` — Traefik overlay for local dev HTTPS.
- `charts/app/templates/network-policy.yaml` — default-deny NetworkPolicy.
- `charts/app/values-azure.yaml` — AFD source range lock for AKS.
