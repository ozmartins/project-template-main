# ADR-0003: GitHub Category Pipeline Organization

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

As the factory grew to ~15 active workflows and 18 agents, the original naming convention
(`pipeline-fast`, `pipeline-hourly`, `pipeline-daily`) stopped communicating anything
useful about a workflow's purpose, dependencies, or whether it was safe to enable on a
fresh fork. Every team forking the template received the complete stack — including
workflows that require Kubernetes, a container registry, or product domain content —
with no activation guidance and no clear path to enabling subsets incrementally.

## Decision

Organise all factory workflows into six named categories. Each category is a
self-contained, independently enable/disable-able slice of factory capability.

| Category | Default | Purpose | Infra required |
|---|---|---|---|
| `project-*` | **ON** | PR/issue lifecycle, review, merge, triage | None |
| `testing-*` | **ON** | Test coverage, quality, trends | None (degraded without live env) |
| `docs-*` | **ON** | Documentation drift detection | None |
| `devops-*` | **OFF** | Cluster health, deploy pipelines | Kubernetes, container registry |
| `product-*` | **OFF** | Market research, roadmap, release notes | Domain content in `docs/discovery/` |
| `visual-*` | **OFF** | Visual UX review via vision model | Deployed dev env, Playwright visual config |

The category prefix is the primary signal: `project-fast.yml`, `testing-hourly.yml`,
`devops-cluster-guardian.yml`. Active (default ON) workflows live in `workflows/`.
Dormant (default OFF) workflows live in `workflows-available/<category>/`. The activation
mechanism is described in ADR-0004.

**Open question resolutions:**
- `architecture-audit.yml` → `project-*`. Zero infra deps, always-on, feeds tech-reviewer.
- `factory-architect` agent → `project-*`. Converts epics into specs and ADRs — planning
  work, not ops. Runs in `project-fast.yml` with a backlog-threshold guard.
- `pipeline-hourly.yml` → split into `testing-hourly.yml` (qa-manager only, default ON)
  and `devops-hourly.yml` (ops + cluster, default OFF), because the two halves have
  different prerequisites and independent on/off needs.

## Consequences

**Positive:**
- A new fork can run the full `project-*` + `testing-*` + `docs-*` stack immediately
  with only `COPILOT_TOKEN` and `PROJECT_MANAGER_PAT` set. No infra required.
- Categories communicate intent at a glance. A reviewer can immediately tell that
  `devops-cluster-guardian.yml` requires live cluster access without reading the file.
- Teams can enable capabilities incrementally as their infra matures.

**Negative:**
- The pipeline rename (`pipeline-fast` → `project-fast`, etc.) is a one-time breaking
  change that requires coordinated updates to `concurrency.group:` keys and any
  downstream `workflow_run:` references. Covered by ADR-0005.
- `pipeline-hourly.yml` must be split, not just renamed. The split creates a second
  concurrency group and a second workflow file to maintain.
- Agent `.agent.md` files are **not** reorganised by category — they are referenced by
  name from pipeline steps, so renaming them would require coordinated pipeline edits.
  Category assignment for agents exists only in `FACTORY-STATUS.md` for human reference.

## Alternatives considered

**Keep cadence-based names (`pipeline-fast`, `pipeline-hourly`, `pipeline-daily`):**
Simple to implement (no rename) but communicates nothing about content, deps, or
activation order. All-or-nothing — you can't disable devops without removing it
from a monolith that also contains project and testing steps.

**Feature flags in YAML (`if: vars.TESTING_ENABLED == 'true'`):** Avoids renaming
but adds conditional logic to every workflow. `vars.*` lookups are per-workflow (not
centrally managed), invisible to code review tooling, and harder to audit than a
simple filesystem check.

**Single `ENABLED_CATEGORIES` repository variable:** Readable from any workflow but
creates a single global toggle that can't be partially enabled (e.g., devops with k8s
but not devops-cluster). Less transparent than the filesystem pattern.

## Evidence

- `.github/FACTORY-CATEGORIES.md` — full category design spec with per-category
  agent/workflow tables, prerequisites, and directory layout
- `.github/FACTORY-STATUS.md` — current-state inventory with migration checklist
- `.github/workflows-available/` — dormant devops/visual workflows already following
  this pattern
