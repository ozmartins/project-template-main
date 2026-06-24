# ADR-0048: TLS Certificate Strategy for Local Dev and Kubernetes

**Status:** Accepted  
**Date:** 2026-06-20  
**Deciders:** Ian Reay

---

## Context

The stack requires HTTPS locally (browsers gate clipboard, service workers, and secure cookies behind `https://`) and in Kubernetes (all traffic should be encrypted in transit). We need a cert strategy for both environments with two constraints:

1. **No domain ownership required.** We use `localhost` locally and cluster-internal hostnames in Kubernetes — no public DNS record or external CA involvement.
2. **Zero host prerequisites for Docker Desktop.** Developers clone and run `make up-https`; the cert must be available without installing extra tools.

We also have a secondary goal: no fake or external domains (e.g. `local.10xstack.dev`). Using a domain we don't control creates a dependency and breaks in air-gapped environments.

---

## Decision

### Docker Desktop: self-signed cert via openssl-in-Docker

`make certs` runs `openssl` inside the `alpine/openssl` Docker image to generate a self-signed cert for `localhost`. The cert is placed in `certs/local/` (git-ignored) and mounted read-only into the Traefik proxy container.

```bash
docker run --rm -v "$(pwd)/certs/local:/out" alpine/openssl req -x509 -nodes \
  -newkey rsa:2048 -days 825 \
  -keyout /out/key.pem -out /out/cert.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"
```

`make up-https` calls `make certs` automatically and skips generation if the cert already exists.

**Trade-off:** The browser shows a "connection not private" / "unsafe" warning once per browser profile. The developer clicks "Accept" (or "Proceed to localhost") once, and the browser remembers the exception. This is acceptable for local dev — it is not acceptable for production or shared envs.

**Optional upgrade — trusted cert with mkcert:** Developers who want to eliminate the browser warning can install `mkcert`, run `mkcert -install` (adds a root CA to the OS keychain), then replace the generated cert:
```bash
brew install mkcert && mkcert -install
mkcert -cert-file certs/local/cert.pem -key-file certs/local/key.pem localhost 127.0.0.1 ::1
```
The Traefik config is identical — it reads whatever cert is in `certs/local/`. No Makefile changes are needed.

### Kubernetes: cert-manager with self-signed ClusterIssuer

In Kubernetes, cert-manager is installed cluster-wide (one-time per cluster) and a `ClusterIssuer` of type `selfSigned` is defined. Each app namespace gets a CA `Certificate` (signed by the cluster issuer), and service certs are issued by that CA. This gives:

- Encrypted in-cluster traffic
- A cert structure that can be swapped for Let's Encrypt or an enterprise CA without changing the app chart

For production AKS environments, the `ClusterIssuer` switches to Let's Encrypt (ACME HTTP-01 or DNS-01 challenge) and certs are automatically renewed.

```yaml
# charts/app/templates/cluster-issuer.yaml  (deployed once per cluster, not per app)
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned-issuer
spec:
  selfSigned: {}
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: local-ca
  namespace: cert-manager
spec:
  isCA: true
  commonName: local-ca
  secretName: local-ca-key-pair
  issuerRef:
    name: selfsigned-issuer
    kind: ClusterIssuer
```

The Ingress resource requests a cert from this issuer via annotation:
```yaml
annotations:
  cert-manager.io/cluster-issuer: selfsigned-issuer   # dev
  # cert-manager.io/cluster-issuer: letsencrypt-prod  # production
```

### AKS + Azure Front Door

AFD terminates TLS at the edge. The AKS ingress (Nginx) uses HTTP internally between AFD and the cluster. TLS is re-enabled for intra-cluster traffic using the self-signed cert-manager approach above. The `ssl-redirect` annotation is set to `false` on the ingress for AFD origins to prevent redirect loops.

---

## Alternatives Considered

### `mkcert` as a hard prerequisite

Rejected. Requires `brew install mkcert && mkcert -install` (needs sudo to install root CA). This breaks in CI, air-gapped envs, and for new developers who haven't run the setup steps.

### Traefik's built-in ACME (Let's Encrypt) for local dev

Rejected. Requires a publicly routable domain and DNS/HTTP challenge. Doesn't work for `localhost`.

### Pre-committed self-signed cert in the repo

Rejected. Committing private keys to source control is a security anti-pattern even for dev-only certs, and it breaks key rotation.

### External CA for local dev (e.g. `step-ca` / Smallstep)

Rejected for now — adds significant operational complexity for local dev. May be revisited if the team grows and the one-click cert-trust story becomes important.

---

## Consequences

- Developers will see a browser cert warning on first access to `https://localhost` after a fresh clone. Documented in `README.md` and the `make up-https` output.
- No `/etc/hosts` entries required. All URLs use standard `localhost`.
- The `certs/` directory must remain in `.gitignore`.
- Cert rotation: delete `certs/local/` and re-run `make up-https`.
- CI does not use the HTTPS proxy overlay — it runs `make up` (plain HTTP on `127.0.0.1`), which is fine because CI traffic is local to the runner.
