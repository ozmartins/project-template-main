# ADR-0038: Environment-Graduated Testing Strategy (Dev / UAT / Production)

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

Three deployed environments exist: dev, test (UAT), and production (ADR-0013). Each has different stability characteristics, data freshness expectations, and risk tolerance. Running the same tests in the same way against all three environments would either be too slow for dev (blocking fast iteration) or too shallow for production (missing real risk).

A great QA manager thinks in layers of confidence: dev gives fast feedback, UAT gives deployment confidence, production confirms health. The test suite appropriate for each layer differs in depth, data assumptions, and consequence of failure.

## Decision

Each environment has an explicit testing contract:

---

### Dev Environment

**Purpose:** Fast feedback on every deploy. Catch regressions introduced by merged code before they reach UAT.

**Stability:** Low. Dev resets are frequent (DB resets, seed reloads, schema migrations in flight). Data is ephemeral.

**Testing contract:**
- **Hourly smoke E2E** (post-deploy + cron `*/60`): Gating smoke spec only. All defined routes render. Auth works. If smoke fails, a `priority:high` incident is filed and the deploy is considered unhealthy.
- **No full journey tests in dev.** The dev environment resets too frequently to have stable prerequisite data. Journey tests require provisioned fixtures (portal customers, specific entity states); dev provides service-role seeding per test instead.
- **Deterministic fixture seeding:** Every gating E2E test that needs specific data creates it via the service-role API before the test and destroys it after. Tests never assume pre-existing data survives between runs.
- **Non-gating experience spec** runs in dev for early signal, with `continue-on-error: true`. Failures are improvement backlog, not incidents.
- **CI unit/integration tests** run on every PR — dev is not involved in PR gating, but the PR gate must pass before deploy to dev triggers.

**Data policy:** Dev data can be reset at any time by a developer or migration. Tests must not depend on data persisting across runs.

**Incident trigger:** Any smoke failure that persists for 2 consecutive hourly runs triggers a `priority:high` incident via `monitor-deploy.yml`.

---

### UAT / Test Environment

**Purpose:** High-confidence validation before promoting to production. This is the primary quality gate for the delivery pipeline.

**Stability:** High. UAT is reset only on deliberate request, not on every deploy. Data is long-lived and representative of production structure.

**Testing contract:**
- **Full gating E2E suite** (smoke + auth-access-control + roles-data-access + all domain-specific gating specs): Must all pass before a release is eligible for production promotion.
- **Full non-gating experience suite** (all journey specs): Runs as part of UAT validation. Failures at this stage are **blocking** — unlike in dev where they are non-gating. A journey failure in UAT means the workflow doesn't work end-to-end and must be resolved before shipping.
- **Visual regression review:** The `visual-ux.yml` workflow runs its full Playwright screenshot suite against UAT and the UX vision reviewer inspects for regressions. Any high-severity UX finding blocks promotion.
- **Manual exploratory testing window:** UAT is the entry point for human QA. Before each production promotion, a defined exploratory window (minimum 1 business day) is recommended for non-automated scenario coverage.
- **Performance baseline:** The UAT run should include basic performance assertions: page load < 3s for primary screens, API response < 1s for list queries. These are informational initially and promoted to gating as baselines stabilise.
- **Full reset-path suite** runs after every schema migration deploy to UAT to confirm the migration applied cleanly to the long-lived UAT database.

**Data policy:** UAT has long-lived seed data representing realistic demo scenarios. Service-role seeding for E2E fixtures is still used, but background data (entity types, configuration, demo users) persists across deploys.

**Promotion gate:** A build cannot be promoted to production until:
1. Full gating E2E suite passes in UAT ✅
2. Full experience suite passes in UAT ✅
3. No open `priority:critical` or `priority:high` incidents against the UAT build ✅
4. Visual regression review completed with no high-severity findings ✅

---

### Production Environment

**Purpose:** Confirm that the promoted build is healthy in the live environment. Not a testing environment — a health monitoring environment.

**Stability:** Highest. Production resets are catastrophic events. Data is real customer data.

**Testing contract:**
- **Post-deploy canary smoke** (immediately after each production deploy): A strict subset of the smoke suite targeting routes and auth flows that do not write data or create side effects. Read-only operations only. Runs once; any failure triggers immediate rollback via the deployment gate.
- **Synthetic health probes** (every 5 minutes): A lightweight ping against `/health` (frontend) and Supabase PostgREST `/rest/v1/` to confirm services are responding. Not a Playwright test — a simple HTTP check. Failure pages on-call.
- **No data-writing tests in production.** No fixture seeding, no entity creation, no service-role writes. The only test user in production is a read-only monitoring identity with no write permissions.
- **No full E2E suite in production.** If the full suite passed in UAT against the same image digest, the build is assumed safe. Production smoke confirms the deploy itself succeeded.

**Data policy:** Real customer data. Tests must never write, modify, or read sensitive records. The monitoring identity is a read-only service account with no access to tenant data.

**Rollback trigger:** Any post-deploy canary failure triggers automated rollback to the previous digest (same Helm chart, previous `image.digest` value). No manual intervention required for this first line of defence.

---

### Summary

| | Dev | UAT | Production |
|---|---|---|---|
| **Smoke E2E** | Hourly (non-blocking deploy) | Gating before promotion | Post-deploy canary (rollback trigger) |
| **Auth / RBAC E2E** | On smoke suite | Gating | — |
| **Journey E2E** | Non-gating (improvement backlog) | **Gating** | — |
| **Visual UX review** | Non-gating | **Gating** | — |
| **Performance baseline** | — | Informational → gating | Synthetic probes |
| **Data policy** | Ephemeral, reset any time | Long-lived demo data | Real customer data, read-only |
| **Failure consequence** | Improvement ticket | Blocks promotion | Automated rollback |
| **Manual exploratory** | Ad hoc | Required window before promotion | — |

## Consequences

**Positive:**
- Dev velocity is preserved: dev tests are fast and shallow, designed for rapid iteration.
- UAT is the high-confidence gate where full-depth testing justifies the depth. A build that passes UAT fully has genuinely been exercised across all user journeys.
- Production testing is minimal and safe: no writes, fast fail, automated rollback. The right defence-in-depth posture for live customer data.
- The graduated contract makes "ready to ship" unambiguous: it is a checklist, not a judgement call.

**Negative:**
- UAT requires a stable, maintained environment. If UAT is neglected (outdated data, expired secrets, old image) the full-suite gate loses meaning. Maintaining UAT health is an ongoing operational responsibility.
- The 1-business-day exploratory testing window adds a non-automatable delay to the release pipeline. This is intentional — automated testing cannot replace human exploration for new features — but it slows throughput for teams that want continuous production deploys.
- Canary rollback is only automatic if the deployment workflow implements the rollback path. The template provides the workflow structure; the project must wire the actual rollback command.

## Alternatives considered

**Same tests in all environments:** Simple but slow in dev and risks writing test data in production.

**No UAT — deploy from dev directly to prod:** Works for trivial apps. Unacceptable for any app where a production incident has meaningful business impact.

**Blue/green production with live traffic testing:** More sophisticated — routes a small percentage of production traffic to the new version. Valid for high-scale applications; adds deployment complexity that is out of scope for the template.

## Evidence

- `charts/app/values-dev.yaml` — dev environment configuration
- `charts/app/values-test.yaml` — UAT environment configuration
- `charts/app/values-prod.yaml` — production environment configuration
- `.github/workflows/e2e-dev.yml` — dev hourly smoke
- ADR-0037 — real-environment E2E strategy
- ADR-0036 — testing pyramid (layer 4 gates per environment)
- ADR-0013 — Helm environment profile structure
