# ADR-0002: GitHub as Autonomous Software Factory

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

A typical project repository is passive: it stores code and runs CI, but a human
coordinates every meaningful step — triage, review, merge, deploy, quality follow-up,
documentation. That coordination work scales poorly and is the first thing to be
skipped under deadline pressure.

This repository is a template for a different model: the `.github/` directory is a
self-contained software factory that runs continuously, coordinates the PR/issue
lifecycle autonomously, and escalates to humans only for decisions that genuinely
require human judgement (protected-environment deploys, policy changes, security
findings above a threshold).

## Decision

Structure `.github/` as a factory with four layers:

```
.github/
  factory.yml          ← Central config (repo identity, stack, max concurrency, runner profiles)
  agents/              ← Agent definitions (.agent.md), each a named actor with a role charter
  workflows/           ← Active pipelines (GitHub runs these on cadence or event)
  workflows-available/ ← Dormant pipelines (copy to workflows/ to activate; see ADR-0003)
  scripts/             ← Node.js helper scripts (coverage-compute, quality-compute, test-history-*)
  tools/shared/        ← Vitest-tested shared JS runtime used by scripts
  copilot-instructions.md  ← Copilot coding-agent behaviour contract
  qa-targets.json      ← SLO floors/ceilings (pass rate, coverage, quality ceilings)
```

Agents are GitHub Copilot SDK sessions. Each pipeline step calls one agent by
passing its `.agent.md` file and a context payload (issue list, PR diff, test
results, etc.). Agents act through tools: `gh` CLI, REST APIs, file reads.
They never push production code directly — they file issues, comment on PRs,
open draft PRs, and apply labels. Human (or tech-reviewer) approval gates all merges.

The factory runs on three cadence tiers:
- **Fast (*/15 min):** PR/issue triage, review, merge nudging
- **Hourly (:30 or :45):** QA scoring, operations/cluster health
- **Daily (06:00 UTC):** Architecture audit, documentation sweep, product pipeline

## Consequences

**Positive:**
- Coordination overhead moves from humans to agents. PRs don't sit waiting for
  an available reviewer; issues don't pile up untriaged.
- The factory is observable: every agent action is an auditable GitHub event
  (comment, label change, PR open, issue created).
- The template is portable — `factory.yml` is the only file a fork must edit to
  point the factory at a new repo.

**Negative:**
- The `.github/` layer is now load-bearing software, not just config. It requires
  the same care as application code: reviews, tests (`tools/shared/`), and ADRs for
  architectural changes.
- Any change to `.github/workflows/**` is a control-plane boundary (see
  `copilot-instructions.md`). An ADR must accompany the PR. Reviewers must block
  control-plane PRs that lack one.
- Agents can generate noise (duplicate tickets, redundant comments) if their
  deduplication logic is wrong. The factory includes dedup guards in each agent
  charter, but they must be maintained.

## Alternatives considered

**Plain CI + human review:** No agent coordination layer. Works for small teams
with reliable reviewer bandwidth. Does not scale; triage and quality gaps accumulate.

**External orchestration service (e.g. Linear automations, Zapier):** Moves
logic outside the repository, making it invisible to code review and harder to
audit. No version history, harder to test, requires external account management.

**Repository bots (Probot, Mergify, etc.):** Handles specific workflows well
(auto-merge, stale issues) but is not programmable enough for full-cycle agent
behaviour (spec authoring, cluster remediation, market research).

## Evidence

- `.github/factory.yml` — central factory config
- `.github/agents/*.agent.md` — 18 agent definitions (current count)
- `.github/workflows/*.yml` — active pipeline definitions
- `.github/copilot-instructions.md` — Copilot implementation contract
- `.github/tools/shared/` — Vitest-tested shared runtime
