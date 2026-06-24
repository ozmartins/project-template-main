# Software Factory

The Software Factory is a set of scheduled GitHub Actions pipelines that run
role-based AI agents on a fixed cadence. Once the repository secrets and
labels are in place (see
[`FACTORY-ACTIVATION.md`](../../.github/FACTORY-ACTIVATION.md)), no further
configuration is needed — the factory is self-healing and self-scheduling.
Every issue filed in the repository will be triaged, assigned, implemented,
reviewed, and merged entirely by the factory with no human required in the
critical path. Maintainers interact with the factory by filing issues and
setting guardrails; the agents handle the rest.

## The three pipeline cadences

| Pipeline | Schedule | Workflow file | Agents |
|---|---|---|---|
| **Fast** | Every 15 min | [`pipeline-fast.yml`](../../.github/workflows/pipeline-fast.yml) | Stale re-kick → PR Handler → Product Owner → Project Manager → DB Steward* → Security Reviewer* → Platform Engineer* |
| **Hourly** | Every :30 | [`pipeline-hourly.yml`](../../.github/workflows/pipeline-hourly.yml) | Factory Architect → QA Manager → Operations Manager → Cluster Guardian* |
| **Daily** | 06:00 UTC | [`pipeline-daily.yml`](../../.github/workflows/pipeline-daily.yml) | Docs Improver → User Docs Manager |

*conditional: only runs when relevant issues/PRs exist

## Issue-to-merge lifecycle

```mermaid
flowchart TD
    A([Issue opened\nno labels]) -->|Product Owner triages; adds queue:development, ready-for-dev, priority:*| B[Issue triaged and ready for assignment]
    B -->|Project Manager assigns Copilot| C[Copilot opens\ndraft PR]
    C -->|PR Handler detects settled\ngreen draft| D[PR marked\nready for review]
    D -->|PR Handler reviews| E{Review\noutcome}

    E -->|approves| F{Specialist\nlabels?}
    E -->|adds changes-requested| G[Project Manager wakes\nCopilot via @copilot mention]
    G --> C

    F -->|none| M[PR Handler merges\nsquash]
    F -->|needs-database-review| DB[DB Steward\nreviews]
    F -->|needs-security-review| SEC[Security Reviewer\nreviews]
    F -->|needs-platform-review| PLAT[Platform Engineer\nreviews]

    DB -->|adds database-reviewed\nremoves needs-database-review| F
    SEC -->|adds security-reviewed\nremoves needs-security-review| F
    PLAT -->|adds platform-reviewed\nremoves needs-platform-review| F

    D -->|adds queue:review| TR[Tech Reviewer\ndeep-reviews]
    TR -->|removes queue:review| E

    M --> N[Branch deleted]
    N --> O([Issue closed])
```

## Specialist review lanes

The DB Steward, Security Reviewer, and Platform Engineer run conditionally in
the fast pipeline. When a PR carries a `needs-database-review`,
`needs-security-review`, or `needs-platform-review` label, the PR Handler will
not merge it. The relevant specialist agent reviews the PR, removes the
`needs-*-review` label, and adds the corresponding `*-reviewed` label. Only
once all specialist labels are cleared will the PR Handler proceed to merge.

## How work is prioritised

- The Project Manager fills Copilot slots up to `max_open_copilot_prs`
  (configured in [`.github/factory.yml`](../../.github/factory.yml)).
- Work is assigned in priority order: `priority:critical` → `priority:high` →
  `priority:medium` → `priority:low`.

## Key configuration files

| File | Purpose |
|---|---|
| [`.github/factory.yml`](../../.github/factory.yml) | Concurrency limits, runner profiles, stack config |
| [`.github/LABELS.md`](../../.github/LABELS.md) | Full label taxonomy with who sets / who clears |
| [`.github/FACTORY-ACTIVATION.md`](../../.github/FACTORY-ACTIVATION.md) | Secrets checklist and activation verification |
| [`.github/agents/`](../../.github/agents/) | One `.agent.md` per role — the agent's full instruction set |
| [`.github/copilot-instructions.md`](../../.github/copilot-instructions.md) | Rules for the Copilot coding agent |

← [Architecture overview](./README.md)
