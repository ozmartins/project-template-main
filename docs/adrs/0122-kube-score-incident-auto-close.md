# ADR-0122: Auto-close kube-score incident issues on clean scan

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Copilot (implementation), platform-engineer review
- **Supersedes / Superseded by:** none

## Context

The architecture-audit workflow (`architecture-audit.yml`) has a `helm-best-practice-scan` job that runs kube-score across the base, dev, and test Helm profiles. When CRITICAL findings are detected the job files a GitHub issue titled `[kube-score] CRITICAL Helm best-practice findings detected`.

Before this change the workflow had no inverse step: once the CRITICAL chart bug was fixed (probe differentiation, see PR #1008, issue #1012) the open incident remained open indefinitely and required manual triage to close. This created noise in the issue tracker and left the factory pipeline chasing the stale incident via repeated re-kick cycles.

The constraint driving the change is: the auto-close must not require a label filter because incidents can be re-labelled from `queue:platform` to `queue:development` during triage, and a label-scoped search would miss them.

## Decision

We add a single step `Auto-close kube-score incident on clean scan` to the `helm-best-practice-scan` job that runs only when `critical_count == 0`. The step searches for any open GitHub issue whose title matches the known incident title (without label restriction), then closes it with a comment linking the confirming run URL. If no open incident is found the step exits cleanly.

## Consequences

- **Easier:** Open kube-score incidents are closed automatically as soon as the scan confirms the fix, without manual triage or a dedicated close PR.
- **Harder:** A new CRITICAL finding that is immediately re-fixed in the same scan run would never leave an open issue. This is acceptable — if the scan is clean the incident is resolved.
- **New obligations:** The step uses `issues: write` permission, which was already granted on the `helm-best-practice-scan` job for the issue-filing step, so no permission change is needed.
- **Trade-off accepted:** The auto-close comment is informational only (no `resolved` label added). Label hygiene after close is left to the triage agents.

## Alternatives considered

- **Manual close via PR comment**: previous approach — required a Copilot re-kick cycle for every clean scan. Rejected because it is high-friction and caused repeated factory overhead (see issue #1012 comment history).
- **Label-filtered search**: searching only `queue:platform` issues to limit scope. Rejected because issues are routinely re-labelled to `queue:development` during triage and the filter would miss them.
- **Separate cleanup workflow**: a dedicated scheduled job to close stale kube-score issues. Rejected as over-engineering for a single-incident pattern.

## Evidence

- `architecture-audit.yml`: `helm-best-practice-scan` job — `Auto-close kube-score incident on clean scan` step
- Issue #1012: kube-score CRITICAL incident that triggered this ADR
- PR #1008: chart fix (probe differentiation) that cleared the CRITICAL findings
