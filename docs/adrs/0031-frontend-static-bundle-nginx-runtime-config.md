# ADR-0031: Frontend Static Bundle with Nginx and Runtime Browser Config

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The React frontend is compiled by Vite into a static bundle (HTML, JS, CSS). In production this bundle is served from a container. The bundle must be configurable for different environments (different Supabase URLs, different API endpoints) without a full rebuild per environment — rebuilding for each environment defeats the digest-based promotion strategy (ADR-0012).

The frontend also needs to proxy `/api/*` traffic to the in-cluster ops API service, since CORS restrictions prevent browser-direct calls to internal cluster endpoints.

## Decision

The frontend Docker image uses **nginx** to:
1. Serve the static bundle from `/usr/share/nginx/html`
2. Inject runtime configuration via a small entrypoint script that writes `window.__RUNTIME_CONFIG__` into `index.html` at container start — after environment variables are available, before the first request is served
3. Proxy `/api/*` to the `ops-api` service in-cluster via `nginx.conf`

The Vite build itself uses no environment-specific values — all config is deferred to runtime injection. The same build artifact (same digest) is promoted through dev → test → prod; only the container's environment variables change.

**Entrypoint test:** `frontend/docker/test-entrypoint.sh` is a CI-gated test that validates the runtime config injection works correctly. It runs in `pr-validation.yml` as part of the helm-charts job.

## Consequences

**Positive:**
- One build artifact for all environments. The digest promoted from test to prod is byte-for-byte identical.
- Runtime config injection is standard nginx + shell — no custom framework, no external secrets manager required for browser-visible config.
- The `/api/` proxy eliminates CORS configuration for ops API calls; the browser always talks to the same origin.
- Security: the nginx container runs read-only root filesystem (ADR-0013 chart security context).

**Negative:**
- The runtime config injection script must be maintained. A bug in the entrypoint (e.g., malformed JSON in a config value) breaks the container start silently if the test is not run.
- `window.__RUNTIME_CONFIG__` is visible to any user who opens DevTools. Only non-sensitive config values (API URLs, feature flags) should be injected this way. Secrets must never go into runtime config.
- The nginx proxy adds a hop for `/api/` traffic. This is negligible latency for in-cluster calls but adds an nginx configuration file that must be maintained alongside the application.

## Alternatives considered

**Build-time env var injection (Vite's `import.meta.env`):** Requires a separate build per environment. Breaks digest-based promotion.

**Server-side rendering (Next.js):** Solves config injection naturally but is a major framework change. The JSON engine (ADR-0018) is built on Vite/React; switching to Next.js would require significant rework.

**ConfigMap-mounted config file:** Valid Kubernetes alternative. Mounts a JSON config file into the container and the app reads it on load. Requires Helm values for the config content — similar complexity to runtime injection but cloud-platform-specific.

## Evidence

- `frontend/docker/` — Dockerfile and entrypoint script
- `frontend/docker/test-entrypoint.sh` — CI-gated entrypoint test
- `charts/app/templates/frontend-deployment.yaml` — nginx container, security context, `/api/` proxy config
