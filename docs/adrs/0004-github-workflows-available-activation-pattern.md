# ADR-0004: GitHub Workflows-Available Activation Pattern

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The factory template must ship workflows that require infrastructure or domain content
that teams won't have on day one (Kubernetes, container registry, Playwright visual
config, populated `docs/discovery/`). If those workflows live in `workflows/`, GitHub
runs them immediately — and they fail, create noise, or silently no-op in ways that
obscure whether the system is healthy.

The factory needs a way to ship dormant workflows that are clearly discoverable,
have explicit prerequisites listed, and can be activated with a single understood
operation that is auditable through version control.

## Decision

Use the filesystem as the activation gate:

- **`.github/workflows/`** — Active. GitHub runs everything here. No conditions required.
- **`.github/workflows-available/<category>/`** — Dormant. GitHub ignores subdirectories
  of `workflows/` (workflow files must be directly in `.github/workflows/`, not nested).
  Dormant workflows are full, valid YAML — they're just not in the path GitHub scans.

**Activation:** copy or move the file into `workflows/`:

```bash
cp .github/workflows-available/devops/devops-hourly.yml .github/workflows/
```

**Deactivation:** move it back:

```bash
mv .github/workflows/product-discovery.yml .github/workflows-available/product/
```

**WORKFLOWS.md:** A catalog file at `.github/workflows-available/WORKFLOWS.md` lists
every dormant workflow, its prerequisites, and its one-line activation command. It
is the single reference a new team member needs to understand what's available.

**ADR requirement:** Any PR that copies a file from `workflows-available/` into
`workflows/` is a control-plane boundary change. Per `copilot-instructions.md`, it
requires an ADR in the same PR. The activation step is always deliberate and
reviewable.

## Consequences

**Positive:**
- No custom tooling. The activation mechanism is a file copy — any developer
  understands it immediately without reading docs.
- Dormant workflows are visible in the repository and versioned alongside active
  ones. They don't disappear into a feature-flag system or a separate repo.
- The activation path is auditable: the git commit that copies a file is the
  activation record. Roll back by reverting the commit.
- Prerequisites are co-located with the workflow in `WORKFLOWS.md`, not buried
  in separate docs that drift.

**Negative:**
- A workflow file moved out of `workflows/` while it has active scheduled runs will
  leave orphaned run history in GitHub Actions. This is cosmetic — the runs complete
  or time out naturally — but can confuse the Actions tab briefly.
- The `workflows-available/` catalog (`WORKFLOWS.md`) requires manual maintenance.
  When a new dormant workflow is added, its entry in `WORKFLOWS.md` must be updated
  in the same PR.
- GitHub Actions does not enforce the ADR requirement automatically — it is a
  social contract enforced by the tech-reviewer agent and PR review policy.

## Alternatives considered

**`if: vars.ENABLED == 'true'` conditionals in every workflow:** All files live in
`workflows/` but only run when a repository variable is set. The workflow appears
in the Actions tab even when disabled, creating a confusing display of perpetually-
skipped runs. Prerequisites remain hidden unless documented elsewhere.

**Separate `workflows-disabled/` branch or repo:** Keeps dormant workflows visible
but makes them harder to discover and update alongside active ones. Activation
requires a cross-branch or cross-repo cherry-pick.

**Monorepo toggle file (`.github/ENABLED_WORKFLOWS.txt`):** A CI step reads the file
and conditionally skips jobs. Adds runtime complexity to every workflow and makes the
gate invisible to static analysis.

## Evidence

- `.github/workflows-available/WORKFLOWS.md` — current activation catalog
- `.github/workflows-available/code-quality.yml` — example dormant workflow (testing category)
- `.github/workflows-available/agent-tech-reviewer.yml` — example dormant workflow (project category)
- `.github/workflows-available/visual-ux.yml` — example dormant workflow (visual category)
- `.github/copilot-instructions.md` — ADR requirement for control-plane PRs
