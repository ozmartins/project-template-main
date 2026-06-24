# Factory PR Coordination Gate

**Status:** Draft  
**Last updated:** 2026-06-24

---

## Goal

Stop open Copilot PRs from colliding on shared mutable surfaces by adding one queue-level coordination contract that:

- detects same-surface ownership conflicts before review churn starts
- detects stale or conflicting branches before a human leaves a conflict-only comment
- blocks contaminated post-conflict PRs from returning to review

This design is for trend issue #1049 and rolls up the same-cause ticket family under epic #555.

---

## Scope

In scope:

- queue-level coordination in the existing fast pipeline
- collision detection for:
  - explicitly registered shared files
  - protected and sensitive same-path edits
  - constrained namespaces starting with ADR numbers
- proactive stale-branch detection that feeds the existing PR-handler refresh path
- post-conflict changed-file baseline enforcement
- machine-readable PR evidence comments instead of a new persistence service
- nightly reporting for active collision groups

Out of scope:

- serializing all PRs or all documentation changes
- automatic content-level merge resolution
- broad application-file ownership rules outside the narrow shared-surface registry

---

## Approaches considered

| Approach | Trade-off |
|---|---|
| Reviewer-only or prompt-only coordination | Fastest to wire, but the same collisions are discovered after review starts and remain non-deterministic. |
| Separate fixes per symptom (`CONFLICTING` refresh, ADR numbering, docs collisions) | Catches some cases, but duplicates logic across agents and lets drift reappear in new shared surfaces. |
| Shared coordination gate in the fast pipeline with PR-comment evidence | **Recommended.** One contract covers collision detection, stale-branch detection, and post-conflict scope safety without adding a new service. |

---

## Recommended approach

Add one coordination gate ahead of normal PR review routing in the existing fast pipeline.

The coordinator reads the current open Copilot PR snapshot, classifies shared-surface claims, and emits one of these results per PR:

- `clear` - no collision and no stale-branch concern
- `hold_collision` - another open PR already owns the shared surface or constrained namespace
- `refresh_required` - the PR is stale or conflicting with `main` and must re-enter the existing refresh path
- `rekick_required` - post-conflict repair expanded the changed-file set beyond the approved baseline and the branch must be recreated from fresh `main`

The coordinator owns detection and evidence. The existing PR-handler keeps the refresh action so stale-branch ownership does not split across agents.

---

## Shared-surface contract

### 1. Explicit shared-path registry

Start with a narrow registry of files that are intentionally edited by many PRs and therefore need ownership coordination even when they are not in protected directories:

- `docs/adrs/README.md`
- `docs/developer/README.md`
- `docs/devsecops/README.md`

This registry must stay explicit. Do not generalize it to all docs paths.

### 2. Protected and sensitive same-path ownership

For files already governed as protected or sensitive by repository policy, same-path collisions are coordinated at the exact file-path level. This extends the existing protected-path collision rule into the queue-level gate rather than leaving it as a per-agent preflight only.

### 3. Constrained namespace ownership

The first constrained namespace is ADR numbering. A PR that introduces `docs/adrs/NNNN-*.md` claims ADR number `NNNN` until the PR closes. A later PR claiming the same number is held and pointed at the blocking PR.

The design is intentionally generic so other low-cardinality namespaces can be added later only when a real collision family appears.

---

## Branch freshness contract

The coordinator checks open Copilot PRs for branch freshness before review routing.

Detection rules:

1. If the snapshot shows `mergeable == CONFLICTING`, mark `refresh_required`.
2. If the snapshot or review tooling shows the PR is behind `main` and no mergeability signal is available yet, mark it for the same refresh path.
3. The coordinator records the evidence, but it does not post a second conflict-resolution instruction if the existing PR-handler path already owns the nudge.

This keeps one action path while making the stale-branch state visible earlier in the pipeline.

---

## Post-conflict scope contract

Conflict repair is safe only if the branch still matches its pre-repair scope.

### Baseline recording

Before a refresh or conflict-resolution instruction is issued, the coordinator records a machine-readable baseline comment containing:

- PR number
- reason (`collision`, `conflict`, or `stale`)
- sorted changed-file list
- constrained namespace claims
- timestamp

Marker:

```text
[factory-pr-coordination]
```

### Return-to-review rule

After conflict repair:

- if the current changed-file set is identical to the baseline, the PR may return to normal review
- if the current changed-file set is a strict subset of the baseline, the PR may return to normal review
- if the current changed-file set adds any new file outside the baseline, mark `rekick_required`

Expanded scope is treated as contamination because the factory cannot prove that the extra files were part of the original issue contract.

---

## Decision matrix

| Condition | Coordinator result | Required follow-up |
|---|---|---|
| No collision, no stale-branch signal | `clear` | Continue normal routing |
| Later PR touches registered shared path already claimed by another open PR | `hold_collision` | Leave machine-readable evidence and hold the later PR |
| Later PR claims an ADR number already claimed by another open PR | `hold_collision` | Leave evidence and point to the blocking PR |
| PR is conflicting or stale against `main` | `refresh_required` | Send through existing PR-handler refresh path |
| Post-conflict file set grows beyond baseline | `rekick_required` | Stop review and re-kick from fresh `main` |

---

## Implementation surfaces

Bounded implementation areas:

- `.github/tools/shared/src/` coordination classifier and tests
- `.github/workflows/pipeline-fast.yml` pre-review coordination stage
- `.github/agents/pr-handler.agent.md` post-conflict baseline enforcement
- `.github/agents/project-manager.agent.md` re-kick follow-up only when coordinator marks a branch unrecoverable
- nightly process-review reporting for active collision clusters

The design explicitly avoids a separate database or service. GitHub PR state plus machine-readable comments remain the source of truth.

---

## Test strategy

Required coverage for implementation:

1. Unit tests for path-claim classification, ADR-number reservation, and baseline comparison outcomes.
2. Pipeline-level tests or fixture coverage proving:
   - a later shared-path PR is held
   - a conflicting PR is routed to refresh
   - a post-conflict expanded file set forces re-kick
3. Regression coverage that the coordinator does not serialize unrelated PRs or all docs edits.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Over-coordination slows the queue by blocking unrelated work | Keep the shared-path registry narrow and explicit. |
| Two agents try to own stale-branch handling | Coordinator detects; PR-handler performs the refresh action. |
| Comment-based evidence drifts or duplicates | Use one fixed marker and overwrite-or-append rules in one helper. |
| Developers broaden a PR during conflict repair and hide contamination | Baseline comparison makes scope growth deterministic and blocks return to review. |

---

## Acceptance criteria mapping

- Open Copilot PRs that claim the same shared path or constrained namespace are detected before reviewer intervention.
- Coordination output names the blocking PR, shared surface, and chosen disposition.
- Unmergeable PRs are refreshed or flagged before a human conflict-only comment is required.
- After conflict repair, expanded file sets trigger a clean re-kick instead of returning to review.
