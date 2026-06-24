# Developer Documentation

How-to guides for engineers developing on and with this stack.

> **Note:** This folder is populated by the `developer-docs-manager` agent, which runs nightly via
> [`pipeline-nightly-devdocs.yml`](../../.github/workflows/pipeline-nightly-devdocs.yml). On the first
> run against an empty folder the agent enters bootstrap mode and files tickets covering all major
> system areas. Copilot then implements each ticket. Trigger the workflow manually to bootstrap
> coverage on a fresh fork.

## Guides

| Area | Guide | What it covers |
|---|---|---|
| Getting started | [getting-started.md](getting-started.md) | Prerequisites, `make up`, local Supabase, first run, common make targets, environment variables |
| Deployment | [`deployment.md`](./deployment.md) | Docker Desktop local; Azure AKS (Terraform, ACR, Helm, Front Door, secrets); AWS EKS (ECR, EKS Terraform, IRSA, Helm); env value profiles |
| Security & quality | [`security-and-quality.md`](./security-and-quality.md) | PR gates (Semgrep SAST, OSV dependency scan, container image scans, license compliance, E2E auth/access-control); nightly audits (CIS K8s, Azure benchmark, code-quality); Dependabot + patching SLA; architecture audit; trust model |
| GitHub Factory | [`github-factory.md`](./github-factory.md) | Issue lifecycle, label taxonomy, Copilot assignment, adding/modifying agents, pipeline cadences |
| Database development | [`database.md`](./database.md) | Additive migrations, SCD2 versioning, RLS, SECURITY DEFINER RPCs, local Supabase |
| Testing | *(ticket pending)* | Test pyramid (4 layers), running tests locally, E2E setup, reset-path gates, CI test gates |
| Temporal worker | *(ticket pending)* | Activities, workflows, DSL definitions, signal-driven patterns, local worker run |
| Frontend development | *(ticket pending)* | Vite + React, JSON UI engine, TanStack Router/Query, adding routes, Radix UI + Tailwind |
| Auth & RBAC | *(ticket pending)* | Supabase Auth, RLS policies, SECURITY DEFINER pattern, role constants, adding a role |
| JSON UI Engine | *(ticket pending)* | Engine architecture, component registry, schema shape, rendering pipeline, adding a component type |
| Troubleshooting | *(ticket pending)* | Common local-dev failures, Docker port conflicts, Supabase CLI issues, factory pipeline failures |

Links update as Copilot implements each ticket.
