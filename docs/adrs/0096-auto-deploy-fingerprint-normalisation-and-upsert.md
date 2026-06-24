# ADR-0096: auto:deploy Fingerprint Normalisation and Pre-Dedup Upsert Gate

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Copilot coding agent (Issue #622)
- **Supersedes / Superseded by:** none

## Context

The `monitor-deploy.yml` workflow fires the `deploy-sentinel` agent on every
failed "Deploy - Dev" or "Test - E2E Dev" run. When the same deploy failure
recurs, the agent should update the existing open `auto:deploy` incident rather
than opening a second ticket. In practice five duplicate `auto:deploy` incidents
were filed in a 24-hour window (issues #357, #358, #370, #420, #519) because:

1. **Fingerprint drift** — the agent derived fingerprint strings from workflow
   job/step names, which can contain either `/` or `-` as separators depending
   on the run context. `bootstrap/secret` and `bootstrap-secret` hash to
   different values, producing no match and a fresh incident on every re-trigger.

2. **Pagination cutoff** — the agent's internal `gh issue list --limit 30`
   could miss existing incidents once the open `auto:deploy` backlog exceeded
   30 items.

3. **No workflow-level gate** — both a repeated deploy failure AND the
   subsequent E2E failure could independently trigger the sentinel, each
   potentially creating its own issue for the same underlying breakage.

## Decision

We add a two-phase incident emission pattern to `monitor-deploy.yml`.

**Phase 1 — pre-dedup upsert (`.github/tools/shared/src/upsert-deploy-incident.ts`):**
Before the deploy-sentinel agent runs, a lightweight TypeScript script is
executed. It:

- Maps the failing workflow's display name to a **canonical family
  fingerprint ID** (`deploy-dev-failure` for "Deploy - Dev"; `e2e-dev-failure`
  for "Test - E2E Dev") using `deployFamilyFingerprintId()`.
- Lists **all** open `auto:deploy` issues (`--limit 500`) via the LIST API
  (strongly consistent; no search-index lag or HTML-comment stripping).
- Finds the oldest existing incident by fingerprint-comment match first, then
  by title-keyword fallback for agent-created issues that predate this change.
- If found: appends a "still failing" comment that embeds the stable fingerprint
  so future runs match on fingerprint, not title. Outputs
  `issue_number=<N>` to `$GITHUB_OUTPUT`.
- If not found: outputs `issue_number=` (empty) and exits 0.

**Phase 2 — deploy-sentinel agent:**
Conditioned on `steps.precheck.outputs.issue_number == ''`. For repeat
failures the agent is skipped entirely. For new (first-occurrence) failures it
still runs and applies its root-cause analysis to produce the initial incident
body.

**Normalisation helpers added to `dedupe.ts`:**

- `normalizeFingerprintPart(part)` — lowercases and replaces any run of
  non-alphanumeric characters with a single hyphen, ensuring `bootstrap/secret`
  and `bootstrap-secret` produce identical slugs.
- `deployFamilyFingerprintId(workflowName)` — stable per-family fingerprint ID
  lookup with normalised fallback for unknown workflows.

**`fingerprint-cli.ts` updated** to apply `normalizeFingerPrintPart` to every
part before hashing, so cluster-guardian and any future callers also benefit
from stable cross-run fingerprints.

## Consequences

- Repeat deploy/E2E failures update one canonical incident instead of filing
  new ones, preventing backlog accumulation.
- The pre-dedup step runs in `<1 s` and uses only `github.token` (no PAT
  required for the dedup path).
- The deploy-sentinel agent still runs for genuinely new failure families,
  preserving root-cause analysis.
- `workflow_dispatch` triggers bypass the pre-dedup step and always run the
  agent, so operators can force a fresh investigation without waiting for an
  existing issue to close.
- The `normalizeFingerPrintPart` change to `fingerprint-cli.ts` alters the
  hash for any caller that previously passed parts containing `/` or other
  non-alphanumeric characters. The cluster-guardian agent is the only known
  caller; its fingerprint parts (`<DEV_NAMESPACE>`, `deployment/rental-app`,
  `CrashLoopBackOff`) will change hash on first run after this merge. Any
  existing open cluster incidents created before this change will not be matched
  by fingerprint, but title-keyword fallback in the guardian's own dedup logic
  or the next cycle's dedup scan will consolidate them.

## Alternatives considered

- **Modify the deploy-sentinel agent prompt** — rejected because agent files
  under `.github/agents/` are control-plane instruction files and editing them
  during a per-issue implementation cycle introduces prompt-engineering risk.
- **Post-creation dedup cleanup job** — reacting after duplicates are created
  and then closing the newer ones; rejected as it still allows the duplicate to
  exist briefly and complicates board hygiene.
- **Hash-only fingerprinting without normalization** — rejected because it would
  still produce different fingerprints for logically equivalent failures that
  differ only in separator characters.

## Evidence

- `monitor-deploy.yml` — updated workflow with Phase 1 pre-dedup step
- `.github/tools/shared/src/upsert-deploy-incident.ts` — new CLI script
- `.github/tools/shared/src/dedupe.ts` — `normalizeFingerPrintPart`, `deployFamilyFingerprintId`
- `.github/tools/shared/src/fingerprint-cli.ts` — normalised parts before hashing
- `.github/tools/shared/src/__tests__/dedupe.test.ts` — new normalisation tests
- `.github/tools/shared/src/__tests__/upsert-deploy-incident.test.ts` — new upsert tests
- Closing Issue #622 (trend roll-up: 5 duplicate `auto:deploy` tickets in 24 h)
