# Dependency Update Scope Contract

**Status:** Draft  
**Last updated:** 2026-06-24

---

## Goal

Keep dependency update work narrowly scoped by defining one authoritative diff contract that both Dependabot and Copilot dependency PRs follow.

The contract must:

- map each dependency PR to exactly one package lane
- allow the minimal lane-local changes needed for compatibility
- block unrelated lockfile drift, control-plane edits, and cross-lane changes before review churn starts

This design addresses trend issue #1080 and the related ticket family #204, #814, and #881.

---

## Scope

In scope:

- lane modeling from `.github/dependabot.yml`
- shared diff classification for dependency PRs
- PR-time enforcement for Copilot and Dependabot dependency work
- repo-owned lane-integrity preflight before scheduled Dependabot updates
- explicit exception handling for justified lockfile-only Copilot changes

Out of scope:

- choosing which package versions to upgrade
- Dependabot cadence or grouping policy beyond what is needed for valid lane modeling
- broad repository policy for non-dependency PRs

---

## Approaches considered

| Approach | Trade-off |
|---|---|
| Prompt-only or reviewer-only enforcement | Cheap, but leaves the rule soft and repeats the same drift in review. |
| Separate rules per workflow or agent | Catches some cases, but the logic drifts between Dependabot handling, PR review, and policy checks. |
| Shared lane classifier plus preflight and PR diff gate | **Recommended.** One contract covers both the no-PR failure mode and mixed-diff PR churn. |

---

## Recommended approach

Use `.github/dependabot.yml` as the canonical dependency lane model and enforce a single lane-local diff envelope with two repository-owned enforcement points:

1. **Lane-integrity preflight** before the scheduled Dependabot window.
2. **PR diff classification gate** in the fast pipeline for dependency PRs.

This split covers both failure classes seen in the trend:

- invalid lane layout or overlapping ownership before Dependabot even attempts PR creation
- mixed-diff or unrelated-repo drift after a dependency PR exists

---

## Lane model

Each lane is identified by:

- ecosystem
- directory
- optional group name

Example identity:

```text
npm:/frontend:frontend-runtime
```

Lane rules:

1. A dependency PR must map to exactly one lane.
2. Lane roots must not overlap unless one is explicitly excluded from dependency automation.
3. The lane root defines the maximum allowed compatibility-fix surface.
4. Protected paths are allowed only when they are inside the same lane root and the lane itself is intentionally rooted there.

This keeps package-local shared tooling lanes such as `.github/tools/shared` valid without permitting repository-wide drift.

---

## Allowed diff envelope

### Always allowed inside the lane root

- package manifest updates
- corresponding lockfile updates
- package-manager metadata required by the updated dependency
- tests, fixtures, or config files inside the same root when they must change to keep the package green

### Conditionally allowed

Package-local compatibility fixes are allowed only when all of the following are true:

1. the files stay inside the same lane root
2. the change is required to compile, type-check, lint, or test against the new dependency version
3. the PR body explains the compatibility fix in plain language

### Out of contract

- changes outside the lane root
- edits to workflows, charts, Terraform, or other control-plane files outside the lane root
- mixed-lane dependency bumps in one PR
- lockfile churn with no manifest anchor for Copilot-created dependency PRs unless an explicit justification trailer is present

---

## Dependabot and Copilot differences

The diff envelope is shared, but the enforcement details differ by producer.

### Dependabot

- lane ownership comes from `.github/dependabot.yml`
- lane-local lockfile diffs are allowed by default when the PR maps cleanly to one lane
- the repo-owned lane preflight validates lane structure before the weekly update window because Dependabot's internal `create_pull_request` step cannot be intercepted directly

### Copilot dependency PRs

- a lockfile diff must have a matching manifest anchor in the same lane, or the PR body must include:

```text
Dependency-Scope-Justification: <reason>
```

- the justification trailer is for rare cases such as deterministic lockfile regeneration after a package-manager correction inside the same lane
- the trailer does not authorize cross-root or protected-path drift outside the lane

---

## Lane-integrity preflight

Before scheduled dependency update attempts, a repo-owned check validates:

1. every configured lane has a unique identity
2. lane roots do not overlap accidentally
3. each lane can resolve its expected manifest and lockfile anchors
4. protected-path lanes are intentional and still rooted locally

Failures do not open a dependency PR. They file or update one issue with actionable lane-integrity evidence.

---

## PR classifier contract

The PR classifier returns:

- lane identity
- changed-file classification
- whether a manifest anchor exists
- whether the justification trailer is present
- violation list

Deterministic outcomes:

| Condition | Result |
|---|---|
| One lane, lane-local diff, valid anchors | continue normal dependency review |
| Lockfile-only Copilot diff with justification trailer | continue with warning-free review |
| Lockfile-only Copilot diff without anchor or trailer | hold with remediation message |
| Protected-path drift outside the lane root | block and route to explicit follow-up issue/ADR path |
| Mixed-lane diff | close or split; do not silently broaden scope |

---

## Implementation surfaces

Bounded implementation areas:

- `.github/dependabot.yml` lane parsing
- `.github/tools/shared/src/` dependency lane model and classifier
- `run-pr-pipeline` or equivalent fast-pipeline routing
- `pr-handler` enforcement and remediation messages
- weekly lane-integrity preflight and issue-based reporting

The design does not require a new service or a second source of lane truth.

---

## Test strategy

Required coverage for implementation:

1. Unit tests for lane identity parsing, overlapping-root detection, manifest-anchor detection, and trailer parsing.
2. Fixture tests for:
   - valid lane-local manifest and lockfile diffs
   - lockfile-only Copilot diffs with and without justification
   - protected-path drift outside the lane root
   - mixed-lane diffs
3. Preflight tests proving invalid lane configuration is surfaced before Dependabot PR creation attempts.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| The lane model becomes stale or duplicated | `.github/dependabot.yml` stays the single canonical source. |
| Compatibility fixes become a loophole for broad refactors | Require same-root only plus explicit PR-body explanation. |
| Lockfile-only Dependabot changes are blocked incorrectly | Keep Dependabot and Copilot anchor rules separate while sharing the same lane envelope. |
| Protected-path dependency lanes are blocked even when legitimate | Allow them only when the lane root itself is intentionally under the protected path. |

---

## Acceptance criteria mapping

- Dependency update jobs and PRs are checked against one explicit allowed-diff contract before review or PR creation.
- Lockfile drift without required anchors or justification is rejected with a deterministic remediation message.
- Protected-path or unrelated repository drift outside the lane is blocked or routed to an explicit follow-up path.
- Dependabot lane failures surface as actionable preflight findings rather than vague PR-creation errors.
