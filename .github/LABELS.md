# Label Reference

Every label used in this repository, what it means, who sets it, and what happens when it is set.

---

## Routing labels — where does this issue go?

These are set by the **Product Owner** agent at triage time. An issue should carry exactly one `queue:*` label.

| Label | Meaning | Who sets it | Who acts on it |
|---|---|---|---|
| `queue:development` | Concrete, well-scoped work ready to be coded | Product Owner (triage) | Project Manager (assigns Copilot) |
| `queue:architecture` | Needs design, ADR, or scoping before coding | Product Owner (triage) | Factory Architect |
| `queue:security` | Raised by a security finding or audit | Product Owner / Security Reviewer | Security Reviewer |
| `queue:database` | Schema, migration, or data-model work requiring expert review | Product Owner (triage) | DB Steward |
| `queue:platform` | Infrastructure, CI/CD, K8s, or deployment work | Product Owner (triage) | Platform Engineer |
| `queue:docs` | Internal developer documentation gap | Product Owner / Docs Improver | Docs Improver |
| `queue:ops` | Operational incident or environment health issue | Operations Manager | Operations Manager |
| `queue:product` | Needs product clarification before any technical work can start | Product Owner (triage) | Human / Product Owner |

---

## Lifecycle labels — where is this work in its lifecycle?

| Label | Meaning | Who sets it | Who removes it |
|---|---|---|---|
| `needs-triage` | Newly filed; not yet reviewed by the Product Owner | Author / auto | Product Owner (at triage) |
| `ready-for-dev` | Triaged, scoped, unblocked — ready for Copilot assignment | Product Owner | Project Manager (when Copilot is assigned) |
| `needs-design` | Blocked on an ADR or architecture decision | Product Owner / Factory Architect | Factory Architect (when design is approved) |
| `design-approved` | ADR/design is accepted; implementation can begin | Factory Architect | — |
| `design-in-progress` | An ADR is being drafted for this issue | Factory Architect | Factory Architect (when ADR is accepted) |
| `blocked` | Blocked on an external dependency or decision | Any agent | Agent that unblocks it |
| `needs-info` | Needs more information before work can start | Product Owner | Author / Product Owner |

---

## Specialist review gate labels

Set on a **PR** to route it to a specialist lane. The PR must not be merged until the owning agent clears the lane.

| Label | Meaning — PR must not merge until… | Set by | Cleared by |
|---|---|---|---|
| `needs-security-review` | Security Reviewer has not yet reviewed | PR Handler / Product Owner | Security Reviewer (adds `security-reviewed`, removes this) |
| `needs-database-review` | DB Steward has not yet reviewed | PR Handler / Product Owner | DB Steward (adds `database-reviewed`, removes this) |
| `needs-platform-review` | Platform Engineer has not yet reviewed | PR Handler / Product Owner | Platform Engineer (adds `platform-reviewed`, removes this) |
| `queue:review` | Ready for Tech Reviewer deep architectural review | PR Handler | Tech Reviewer (approves or requests changes) |

---

## Specialist review completion labels

Companion to the gate labels above. Set when a lane is cleared.

| Label | Meaning | Set by |
|---|---|---|
| `security-reviewed` | Security Reviewer approved — no blocking security concerns | Security Reviewer |
| `database-reviewed` | DB Steward approved — migration/schema is safe | DB Steward |
| `platform-reviewed` | Platform Engineer approved — infra/CI impact is acceptable | Platform Engineer |

---

## PR state labels

Used on PRs to signal review state between agent passes.

| Label | Meaning | Set by | Who acts on it |
|---|---|---|---|
| `changes-requested` | A specialist reviewer has requested changes on a PR | Security Reviewer / DB Steward / Platform Engineer | Project Manager / PR Handler (wakes Copilot via `@copilot` mention) |

---

## Classification labels

Set by the Product Owner at triage. Descriptive only — do not gate on these.

| Label | Meaning |
|---|---|
| `bug` | Something isn't working correctly |
| `enhancement` | New feature or improvement |
| `documentation` | Documentation gap or improvement |
| `ux` | User experience issue or improvement |
| `good first issue` | Low-risk, well-scoped, suitable for a new contributor |
| `help wanted` | Extra attention or outside contribution welcome |
| `duplicate` | This issue/PR duplicates an existing one |
| `invalid` | Not a valid bug or feature request |
| `wontfix` | Will not be addressed |
| `question` | Needs clarification before it can be triaged |

---

## Quality labels

| Label | Meaning | Set by | Who acts on it |
|---|---|---|---|
| `test-gap` | Missing or inadequate test coverage for a specific screen, journey, or behaviour | QA Manager / Tech Reviewer / PR Handler | Copilot (development queue item) |
| `needs-test-coverage` | Auto-applied by the `test-gap` GitHub issue form template to flag new test-gap issues at creation time | Issue form template | QA Manager / Copilot |
| `user-docs` | End-user documentation is missing or out of date for this feature | User Docs Manager | User Docs Manager / Copilot |

---

## Priority labels

Set by the Product Owner at triage. Used to order the development queue.

| Label | Meaning |
|---|---|
| `priority:critical` | Must be addressed immediately — blocks the product or production |
| `priority:high` | High value / high urgency |
| `priority:medium` | Standard queue priority |
| `priority:low` | Nice to have; will be addressed when higher priority work is clear |

---

## Automated / system labels

Set automatically by GitHub or agents. Do not set these manually.

| Label | Set by | Meaning |
|---|---|---|
| `auto:alert` | Operations Manager / any agent | Automated incident or alert filed by the factory |
| `auto:cluster` | Cluster Guardian | K8s namespace health alert |
| `auto:ops` | Operations Manager | Operational incident (env health, cost, backup) |
| `dependencies` | Dependabot | PR updates a dependency |
| `github_actions` | Dependabot | PR updates a GitHub Actions workflow dependency |
| `javascript` | Dependabot | PR updates a JavaScript/npm dependency |

---

## Removed labels

These labels existed and have been removed. Do not recreate them.

| Label | Why removed |
|---|---|
| `assigned-to-copilot` | Redundant with GitHub's native assignee list. The GraphQL assignment mutation could fail silently, leaving ghost labels with no actual assignee, which stalled the PM assignment loop. Removed in PR #203. |
| `needs-tests` | Duplicate of `test-gap`. Merged into `test-gap` (PR #TBD). |
| `risk:high` / `risk:medium` / `risk:low` | No agent set these programmatically; they blurred with `priority:*`. Removed to reduce label noise. |
