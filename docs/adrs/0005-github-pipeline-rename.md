# ADR-0005: GitHub Pipeline Rename (cadence names → category prefixes)

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The original pipeline names (`pipeline-fast.yml`, `pipeline-hourly.yml`,
`pipeline-daily.yml`) reflect only cadence. They say nothing about what the pipeline
does, what category it belongs to, or which workflows can be enabled/disabled
independently. As the factory adopts the category organisation defined in ADR-0003,
these names become misleading — `pipeline-fast.yml` is a `project-*` workflow, and
`pipeline-hourly.yml` is being split across two categories with different default states.

## Decision

Rename the three cadence monoliths to category-prefixed names. Split `pipeline-hourly.yml`
into two files because its two halves belong to categories with different prerequisites
and different default-ON / default-OFF states.

| Old name | New name | Category | Default |
|---|---|---|---|
| `pipeline-fast.yml` | `project-fast.yml` | `project-*` | ON |
| `pipeline-hourly.yml` (qa-manager step) | `testing-hourly.yml` | `testing-*` | ON |
| `pipeline-hourly.yml` (ops + cluster steps) | `devops-hourly.yml` | `devops-*` | OFF |
| `pipeline-daily.yml` | `docs-daily.yml` | `docs-*` | ON |

In addition, the three dormant workflows in `workflows-available/` are renamed to
match category conventions and reorganised into category subdirectories:

| Old location/name | New location/name |
|---|---|
| `workflows-available/agent-tech-reviewer.yml` | `workflows/project-tech-reviewer.yml` (activated, default ON) |
| `workflows-available/code-quality.yml` | `workflows/testing-quality.yml` (activated, default ON) |
| `workflows-available/visual-ux.yml` | `workflows-available/visual/visual-ux.yml` |

**Mechanical changes required for each rename:**
1. Rename the file.
2. Update the `concurrency.group:` key to use the new name (prevents orphaned
   concurrency locks from the old group name).
3. Update any `workflow_run: workflows: [...]` references in other workflow files
   that depend on the renamed workflow by its display name.
4. Update `FACTORY-STATUS.md` and `WORKFLOWS.md` entries.

**Files that keep their current names** (referenced by exact name in `workflow_run:`
triggers and therefore cannot be renamed without breaking those triggers):
- `pr-validation.yml`
- `pr-enrichment.yml`
- `build-images.yml`

## Consequences

**Positive:**
- Workflow file names and `concurrency.group:` keys now communicate category and
  purpose at a glance.
- `pipeline-hourly.yml`'s split cleanly separates qa-manager (no infra needed) from
  ops/cluster (infra required), enabling independent enabling/disabling.
- New workflows added in future can follow the naming convention without confusion
  about which group they belong to.

**Negative:**
- One-time rename churn. Each file rename requires a coordinated update to
  `concurrency.group:` and any `workflow_run:` references.
- Any external dashboards, Slack notifications, or monitoring that references workflow
  display names will need updating after the rename.
- GitHub's Actions run history is per-workflow-name. Renamed workflows start a fresh
  history; the old history remains browsable under the old name in the run list until
  it ages out.

## Alternatives considered

**Keep cadence names and add comments:** Zero churn, but doesn't solve the category
discoverability problem or the split/default-state problem for `pipeline-hourly.yml`.

**Keep a single `pipeline-hourly.yml` with job-level `if:` conditions:** Avoids the
split but requires adding infrastructure-check conditions to every ops job, making
the file harder to read and adding runtime complexity.

## Evidence

- `.github/FACTORY-CATEGORIES.md` — category spec with the canonical pipeline table
- `.github/FACTORY-STATUS.md` — migration checklist with per-file rename steps
- ADR-0003 — category organisation decision that motivates this rename
