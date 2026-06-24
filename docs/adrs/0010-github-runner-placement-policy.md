# ADR-0010: GitHub Runner Placement Policy

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The factory runs a mix of workloads: standard CI (build, test, lint), GitHub-hosted agent sessions, and operations that require live cluster access (kubectl, Helm upgrades, private-network smoke tests). GitHub-hosted runners are ephemeral, unlimited in concurrency, and require no maintenance. Self-hosted runners provide cluster access but are a persistent, maintained resource.

Without a clear policy, workflows can drift toward always requiring self-hosted runners, which blocks the template from working in environments that haven't yet provisioned infrastructure.

## Decision

**GitHub-hosted runners are the default.** Every workflow that does not require live infrastructure MUST use `runs-on: ubuntu-latest`.

**Self-hosted runners are opt-in for a defined set of use cases only:**
- Live Kubernetes namespace access (kubectl, helm upgrade, pod exec)
- Private container registry push (if registry is on a private network)
- Private-network smoke tests (E2E against non-public environments)
- Host-level runner health and maintenance tasks

Self-hosted runner profiles are defined in `factory.yml` (`runner_profiles`). A workflow that needs a self-hosted runner must reference a named profile from that file — no hardcoded runner labels in workflow YAML.

**The devops-* category** (ADR-0003) is the natural home for self-hosted runner workflows. All other categories default to GitHub-hosted.

## Consequences

**Positive:**
- The template works out of the box without any self-hosted runner infrastructure. New forks are not blocked on runner provisioning.
- GitHub-hosted runner costs are predictable and tied to usage. Self-hosted runners add fixed infrastructure cost only when the project genuinely needs them.
- Centralising runner profiles in `factory.yml` means a single config change updates all workflows that use a profile.

**Negative:**
- GitHub-hosted runners cannot access private cluster APIs. Any workflow that grows a live-cluster dependency must be moved to a self-hosted profile and declared in `factory.yml`.
- GitHub-hosted runner IP ranges change periodically. If an external service requires IP allowlisting, it may block GitHub-hosted runners unexpectedly.

## Alternatives considered

**Self-hosted-first:** Provides maximum control but requires infrastructure before the repo can run any CI. Blocks forks on day one.

**Hardcoded runner labels per workflow:** Simple but creates a fragmented label namespace that diverges across environments. `factory.yml` profiles provide a single truth point.

## Evidence

- `.github/factory.yml` — `runner_profiles` section
- `.github/workflows/*.yml` — all current workflows use `runs-on: ubuntu-latest`
- `.github/FACTORY-CATEGORIES.md` — devops-* category defined as the self-hosted boundary
