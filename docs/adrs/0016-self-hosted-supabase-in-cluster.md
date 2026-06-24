# ADR-0016: Self-Host Supabase In-Cluster for Production

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

For production deployments (ADR-0013), the application needs Supabase running in the Kubernetes cluster rather than on a developer's machine. Supabase offers a managed cloud service, but the template needs to remain cloud-agnostic and avoid recurring SaaS costs for the infrastructure layer.

## Decision

Deploy Supabase in-cluster using the [Supabase Kubernetes Helm chart](https://github.com/supabase-community/supabase-kubernetes). The in-cluster Supabase runs in its own namespace (`supabase` or project-specific) with:

- Postgres as a StatefulSet with a PersistentVolumeClaim
- PostgREST, GoTrue (auth), Kong (API gateway), Studio (admin only) as Deployments
- Database bootstrap via a Kubernetes Job that applies the migration tarball (see ADR-0026)

The application chart (`charts/app/`) references Supabase via internal cluster DNS (`supabase-db.supabase.svc.cluster.local`) for the worker; the frontend continues to use PostgREST via the Kong gateway.

Supabase Cloud remains a valid alternative — replacing the in-cluster Supabase with Cloud requires only connection string changes in secrets. The template is compatible with both.

## Consequences

**Positive:**
- No external SaaS dependency in production. The entire application runs within one Kubernetes cluster.
- Supabase data stays within the cluster network — no cross-cloud data egress for database queries.
- The in-cluster Supabase is version-controlled (chart version pinned), making upgrades deliberate and auditable.
- Compatible with air-gapped or private-network deployments.

**Negative:**
- In-cluster Postgres requires a backup strategy (Kubernetes CronJob + cloud storage, or Velero). This is not provided by the template out of the box.
- Supabase in-cluster requires more memory and CPU than a managed service. Minimum cluster size is larger.
- Studio runs in-cluster and must be secured behind an ingress with authentication (OIDC — see future ADR). Leaving Studio exposed is a security risk.
- Connection pooling (PgBouncer) should be configured in production to prevent connection exhaustion under load.

## Alternatives considered

**Supabase Cloud:** Eliminates operational burden but introduces a paid external dependency and data residency questions. Valid choice for teams that prefer managed services — template is compatible.

**RDS / CloudSQL / Azure Database for PostgreSQL:** Managed Postgres but loses PostgREST and Supabase Auth. Requires writing those layers separately.

**CockroachDB / Neon:** Distributed Postgres options; not compatible with Supabase's PostgREST/Auth layer without significant adaptation.

## Evidence

- `charts/app/` — application chart (references Supabase endpoint via config)
- ADR-0015 — Supabase as the auth and database layer
- ADR-0013 — Helm chart environment profiles
