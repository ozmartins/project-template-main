# Testing Guide

This guide explains how testing works in this project, what to write where, and what the quality bar is at each layer. Read this before adding tests.

**Architecture decisions:** ADR-0036 (strategy), ADR-0037 (E2E), ADR-0038 (environments), ADR-0039 (DB reset-path), ADR-0040 (Temporal contracts).

---

## The Test Pyramid

Four layers, each with a different speed/confidence trade-off:

```
Layer 4: E2E (Playwright)        — deployed env, slow, highest confidence
Layer 3: Integration / Reset-path — DB reset + Temporal contracts
Layer 2: Unit tests               — Vitest (frontend), pytest (worker)
Layer 1: Static / Build           — types, lint, helm
```

**Every PR runs layers 1–2 and the path-scoped subset of layer 3.** Layer 4 runs post-deploy.

---

## Layer 1 — Static & Build

These run automatically. You don't write them; you fix them.

| Check | Command | Gating |
|---|---|---|
| Frontend types | `npm --prefix frontend run build` | Yes |
| Frontend lint | `npm --prefix frontend run lint` | Yes |
| Python lint | `ruff check temporal/` | Yes |
| Shell lint | `shellcheck .github/scripts/*.sh` | Yes |
| Helm lint + render | `bash charts/app/ci-test.sh` | Yes |

If any of these fail, fix the error before adding tests.

---

## Layer 2 — Unit Tests

### Frontend (Vitest + Testing Library)

**Location:** `frontend/src/**/*.test.ts` (co-located with the source file)

> **Note — test files co-located under `routes/`:** TanStack Router scans every `.tsx` file under `src/routes/` looking for a `Route` export. Test files that do not export a `Route` trigger a build warning. To suppress this, either:
> - Prefix the test file name with `-` (e.g. `-myRoute.test.tsx`) — matched by `routeFileIgnorePrefix: "-"` in `vite.config.ts`, or
> - Place the test inside a `__tests__/` subdirectory — matched by `routeFileIgnorePattern: "__tests__"`.
>
> Both conventions are active. Prefer the `__tests__/` subdirectory with the `-` prefix for consistency with existing tests (e.g. `routes/workflows/__tests__/-workflowsIndexPage.test.tsx`).

**Run locally:**
```bash
npm --prefix frontend run test        # run once
npm --prefix frontend run test:watch  # watch mode
npm --prefix frontend run coverage    # coverage report
```

**What to test:**
- `src/engine/ExpressionEvaluator.ts` — expression evaluation edge cases
- `src/engine/useDataSources.ts` — data source resolution, error handling
- `src/data/queryBuilder.ts` — filter/order/pagination logic
- React components in `src/registry/` — render, props, interaction
- Auth context and role helpers

**What NOT to test in unit tests:**
- Full page renders that depend on a real Supabase connection — those are E2E
- The JSON engine rendering a full page definition — test the engine's individual responsibilities separately
- Things that are already covered by TypeScript types

**Targets (from `qa-targets.json`):**
- Line coverage ≥ 80%
- Branch coverage ≥ 65%

**Pattern:**
```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ExpressionEvaluator } from './ExpressionEvaluator'

describe('ExpressionEvaluator', () => {
  it('resolves a simple field reference', () => {
    const eval = new ExpressionEvaluator({ name: 'Alice' })
    expect(eval.evaluate('{{name}}')).toBe('Alice')
  })

  it('returns empty string for missing field', () => {
    const eval = new ExpressionEvaluator({})
    expect(eval.evaluate('{{name}}')).toBe('')
  })
})
```

---

### Python Worker (pytest)

**Location:** `temporal/tests/test_*.py`

**Run locally:**
```bash
cd temporal
python -m pytest tests/ -v                          # all tests
python -m pytest tests/ -v -k "not reset_validation" # skip heavy DB tests
python -m pytest tests/test_approval_workflow.py -v  # one file
```

**What to test:**

**Workflow behaviour** (use `WorkflowEnvironment`):
```python
import pytest
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker
from src.workflows.example.approval_workflow import ApprovalWorkflow

@pytest.mark.asyncio
async def test_approval_workflow_approves():
    async with await WorkflowEnvironment.start_local() as env:
        async with Worker(env.client, task_queue="test",
                          workflows=[ApprovalWorkflow],
                          activities=[mock_notify]):
            handle = await env.client.start_workflow(
                ApprovalWorkflow.run,
                id="test-approval-1",
                task_queue="test"
            )
            await handle.signal(ApprovalWorkflow.approve, "reviewer@example.com")
            result = await handle.result()
            assert result["approved"] is True
            assert result["approver"] == "reviewer@example.com"
```

**Activity registration audit** (`test_activity_registration.py`):
```python
from src.worker import get_registered_activities

def test_no_duplicate_activity_names():
    activities = get_registered_activities()
    names = [a.__temporal_activity_definition.name for a in activities]
    assert len(names) == len(set(names)), f"Duplicate activity names: {set(n for n in names if names.count(n) > 1)}"
```

**GitHub Actions workflow contracts** (`test_workflow_contracts/`):
```python
import yaml, pytest
from pathlib import Path

WORKFLOWS = Path(__file__).parent.parent.parent / ".github" / "workflows"

def test_pr_validation_has_summary_job():
    wf = yaml.safe_load((WORKFLOWS / "pr-validation.yml").read_text())
    summary = wf["jobs"]["validation-summary"]
    # All gating jobs must be in needs: so summary fails if any gate fails
    assert "frontend" in summary["needs"]
    assert "temporal" in summary["needs"]
    assert "helm-charts" in summary["needs"]

def test_pipeline_fast_never_cancels_trunk():
    wf = yaml.safe_load((WORKFLOWS / "pipeline-fast.yml").read_text())
    # Must not cancel in-progress trunk runs (ADR-0005)
    assert wf["concurrency"]["cancel-in-progress"] == "${{ github.event_name == 'pull_request' }}"
```

**Targets:** 100% pass rate (gating).

---

## Layer 3 — Integration / Reset-Path

### Supabase Reset-Path Gates

**When they run:** Any PR that modifies `supabase/` (migrations, seed, tests, config).

**How they work:** Each job runs `supabase db reset` (full clean apply) then runs a SQL contract test.

**Adding a new gate:**

1. Create the SQL test file:
```sql
-- supabase/tests/my_feature.sql
-- Tests that my_feature migration applied correctly

BEGIN;

-- Assert table exists
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'my_feature'
  ), 'my_feature table not created';
END $$;

-- Assert RLS is enabled
DO $$ BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE relname = 'my_feature'),
         'RLS not enabled on my_feature';
END $$;

ROLLBACK;
```

2. Create the runner script:
```bash
#!/usr/bin/env bash
# supabase/tests/run_my_feature_reset.sh
set -euo pipefail
supabase db reset --config supabase/config.toml
psql "$(supabase status | grep 'DB URL' | awk '{print $NF}')" \
  -f supabase/tests/my_feature.sql
```

3. Add a CI job to `pr-validation.yml`:
```yaml
supabase-my-feature-reset:
  name: Supabase my-feature reset-path validation
  runs-on: ubuntu-latest
  timeout-minutes: 20       # REQUIRED — prevents hung CLI from blocking for 6 hours
  steps:
    - uses: actions/checkout@v4
    - uses: supabase/setup-cli@v1
      with: { version: latest, github-token: "${{ secrets.GITHUB_TOKEN }}" }
    - run: bash supabase/tests/run_my_feature_reset.sh
```

4. Add the new job to `validation-summary`'s `needs:` array.

**Required always-on gates:**
- `supabase-seed` — baseline seed applies cleanly
- `supabase-rpc-guards` — write-guard RPC contracts enforced
- `supabase-seed-demo-users` — demo users and roles provision correctly

---

### Temporal Workflow Contracts

See Layer 2 (pytest) — contract tests live there. They are fast enough to run without path-scoping.

---

## Layer 4 — E2E (Playwright)

E2E tests run against a deployed environment. They never run against a local dev server.

### Setup

```bash
cd frontend
npm install                     # installs playwright
npx playwright install chromium # install browser
```

**Environment variables** (copy from `.env.e2e.example`):
```
E2E_BASE_URL=https://your-dev-app.example.com
E2E_AUTH_EMAIL=admin@example.com
E2E_AUTH_PASSWORD=...
E2E_READONLY_EMAIL=readonly@example.com
E2E_READONLY_PASSWORD=...
E2E_SUPABASE_URL=https://your-supabase-instance
E2E_SUPABASE_SERVICE_KEY=...   # service role key — for fixture seeding only
```

**Run locally against a deployed env:**
```bash
cd frontend
npx playwright test                         # all specs
npx playwright test e2e/smoke.spec.ts       # one file
npx playwright test --ui                    # interactive UI mode
npx playwright show-report                  # view last run report
```

### Which spec to write in

| Spec file | Tier | When it fails |
|---|---|---|
| `e2e/smoke.spec.ts` | Gating | Incident filed, build considered unhealthy |
| `e2e/auth-access-control.spec.ts` | Gating | Incident filed |
| `e2e/experience.spec.ts` | Non-gating | Improvement ticket filed |

**Gating smoke** — only add tests here if a failure means "the application is broken":
- Route renders without crash
- Core data visible
- Auth works for all roles

**Experience** — add tests here for "the application works but the UX is poor":
- Forms have visible validation
- Empty states have a CTA
- Journeys complete end-to-end

### Writing a new smoke test

```typescript
// e2e/smoke.spec.ts
import { test, expect } from '@playwright/test'

test('entities list loads for admin', async ({ page }) => {
  // Auth is set up in playwright.config.ts via storageState
  await page.goto('/entities')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByText('No data')).not.toBeVisible()
})
```

### Writing a test that needs specific data (fixture seeding)

```typescript
import { test, expect, request } from '@playwright/test'

test('entity detail shows current version', async ({ page }) => {
  const supabase = await request.newContext({
    baseURL: process.env.E2E_SUPABASE_URL,
    extraHTTPHeaders: {
      'apikey': process.env.E2E_SUPABASE_SERVICE_KEY!,
      'Authorization': `Bearer ${process.env.E2E_SUPABASE_SERVICE_KEY!}`,
    }
  })

  // Create fixture
  const { data } = await supabase.post('/rest/v1/entities', {
    data: { entity_type: 'test_entity' }
  })
  const entityId = data[0].id

  try {
    await page.goto(`/entities/${entityId}`)
    await expect(page.getByTestId('entity-version-data')).toBeVisible()
  } finally {
    // Always clean up, even on test failure
    await supabase.delete(`/rest/v1/entities?id=eq.${entityId}`)
    await supabase.dispose()
  }
})
```

**Rules:**
- Always create your own test data. Never assume pre-existing rows.
- Always delete in `finally`. Leaked rows accumulate and confuse other tests.
- Use the service-role key only for fixture seeding, never for assertions (assertions use normal auth).

### Tests that should skip when credentials are absent

```typescript
test.beforeAll(async () => {
  if (!process.env.E2E_AUTH_EMAIL) {
    test.skip(true, 'E2E_AUTH_EMAIL not configured — skipping E2E suite')
  }
})
```

This keeps CI green on a fresh fork before secrets are configured.

---

## Adding tests for a new feature

When you ship a new feature, the definition of done includes tests at each relevant layer:

| Feature type | Unit test | Reset-path gate | E2E smoke | E2E experience |
|---|---|---|---|---|
| New React component | ✅ Vitest | — | If adds a new route | Form/interaction journey |
| New Supabase migration | — | ✅ SQL contract | — | — |
| New Temporal workflow | ✅ pytest | — | — | If user-visible outcome |
| New user-facing route | ✅ component | — | ✅ Route renders | ✅ Full journey |
| New RLS policy | — | ✅ SQL contract | — | Role-based access test |
| New SECURITY DEFINER RPC | — | ✅ SQL contract | — | — |

---

## SLO reference

From `.github/qa-targets.json`:

| Metric | Target | Gating |
|---|---|---|
| Unit test pass rate | 100% | Yes |
| Temporal test pass rate | 100% | Yes |
| Helm test pass rate | 100% | Yes |
| Smoke E2E pass rate (7-day) | ≥ 98% | Yes |
| Unit line coverage | ≥ 80% | No (trend-tracked) |
| Unit branch coverage | ≥ 65% | No (trend-tracked) |
| E2E screen coverage | ≥ 85% | No (trend-tracked) |
| E2E journey coverage | 100% (all journeys) | No (trend-tracked) |
| TypeScript errors | 0 | No → gating once zero |
| Secrets found | 0 | No → gating once zero |

The QA Manager agent monitors these automatically and files work tickets on breaches. Never lower a floor to make a test pass — fix the test or fix the code.

---

## Troubleshooting

**"Supabase reset is taking > 5 minutes in CI"**
The setup-cli action makes an unauthenticated GitHub API call to resolve the latest release version. The shared runner IP may be rate-limited. Add `github-token: ${{ secrets.GITHUB_TOKEN }}` to the `supabase/setup-cli@v1` step.

**"E2E test fails with `Test timed out after 45000ms`"**
- Check the Playwright trace (`playwright-report/`) — the trace shows which `locator.waitFor()` or navigation is hanging.
- If the deploy is healthy (smoke passes), the test is likely waiting for an element that doesn't exist. Check whether the fixture seeding ran correctly.

**"pytest test fails with `asyncio.TimeoutError` after long run"**
The `timeout 600s` wrapper in CI applies to the full command tree. Locally, `pytest-timeout` applies the per-test limit. Set `@pytest.mark.timeout(120)` on individual tests to narrow the budget for fast tests.

**"Coverage job shows 0% even though tests pass"**
The coverage job runs on push-to-main only. It won't run on PRs. Run `npm --prefix frontend run coverage` locally to see current numbers.
