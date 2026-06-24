# ADR-0037: Real-Environment E2E Testing with Playwright

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

End-to-end tests can be run against: (a) a locally-started dev server with mocked API responses, (b) a locally-started dev server against a real database, or (c) a fully deployed environment with real authentication, real networking, and real infrastructure. Each choice involves a trade-off between speed, realism, and maintenance cost.

The core problem with mocking in E2E tests is that the thing being tested disappears: authentication flows through GoTrue, RLS enforcement in Postgres, nginx proxy routing, browser security policies, real JWT handling — none of these are exercised when the API is mocked. The tests pass but the system has not been tested.

## Decision

**All E2E tests run against a fully deployed environment.** No mocking, no local dev server as the test target. Playwright connects to the real app URL, authenticates via real GoTrue sessions, and exercises the full stack.

**Two tiers, separating what blocks merges from what builds the improvement backlog:**

**Tier 1 — Gating smoke** (`smoke.spec.ts`, `auth-access-control.spec.ts`): These must pass before a build is considered healthy. They run on every post-deploy trigger and hourly in dev, and as a required gate in UAT before promotion to production. They cover:
- All defined routes render without crashes, error boundaries, or console errors
- Navigation between routes works
- Role-based access control: screens visible/hidden correctly per role
- Data loads for each role (RLS enforcement visible at the browser layer)

**Tier 2 — Non-gating experience** (`experience.spec.ts`): These run alongside smoke but with `continue-on-error: true`. Failures are recorded to the `e2e-history` branch and filed as improvement issues by the QA Manager. They cover:
- Multi-step user journeys (the application's primary workflows end-to-end)
- UX quality assertions: forms have validation, empty states have CTAs, tables show human names not UUIDs, loading states are visible
- These will fail initially on a new project — that is expected and is the signal that drives product work

**Playwright configuration:**
- `timeout: 45_000` per test (network + auth latency)
- `retries: 2` for transient infrastructure flakiness (not for logic failures)
- `workers: 1` (serial) — tests run against a shared deployed environment; parallel tests would create state interference
- `trace: 'retain-on-failure'` for debugging failures without re-running
- `screenshot: 'only-on-failure'`
- Browser: Chromium only (representative of 90%+ of users; cross-browser testing is a separate concern)

**Deterministic fixture seeding:** Tests that depend on specific data must create it themselves via the Supabase service-role API before the test runs, and delete it in a `finally` block. Opportunistic use of pre-existing data leads to non-deterministic tests that fail when the environment is reset.

**Authentication:** Real Supabase GoTrue sessions. Credentials stored as GitHub Actions secrets (`E2E_AUTH_EMAIL`, `E2E_AUTH_PASSWORD`, etc. per role). Tests `skip()` cleanly when credentials are absent — CI remains green on a fresh fork before secrets are configured, with explicit skip messages.

**Results recording:** Every run appends to the `e2e-history` branch (JSONL), which feeds the QA Manager's scorecard and the `qa-targets.json` SLO breach detection.

## Consequences

**Positive:**
- Tests exercise the real authentication, networking, and data stack. A passing smoke suite means the application actually works, not that a mock said it would.
- Failures in the deployed environment are directly actionable: the URL is live, the trace is attached, and the fixture state is known.
- The two-tier model gives honest signal: tier 1 failures are incidents; tier 2 failures are improvement work.

**Negative:**
- E2E tests are slow (45 seconds per test, serial, against a network). The full smoke suite takes 5–10 minutes. This is too slow for per-PR gating — it runs post-deploy, not on every PR.
- Tests depend on the deployed environment being up. If dev is down for a deploy, the hourly smoke will fail. This is expected; the QA Manager distinguishes infrastructure downtime from test failures via consecutive-failure patterns.
- Service-role seeding requires `E2E_SUPABASE_SERVICE_KEY` as a secret. This key has elevated privileges. It must be stored as a protected secret and rotated per the security posture of the project.
- Shared environment + serial execution means the test suite can take 15–25 minutes for a full experience run. UAT runs the full suite; dev runs only smoke.

## Alternatives considered

**Mock Service Worker (MSW) in E2E tests:** Fast and hermetic but tests the mock, not the real API. Auth, RLS, and routing are all bypassed. A test that passes against a mock can fail against the real app.

**Local dev server as the test target:** Faster than a deployed environment but misses nginx routing, production-mode bundle behaviour, real GoTrue session management, and cross-origin policies.

**Cypress instead of Playwright:** Both are valid. Playwright is chosen for its native multi-browser support, better parallelism model, and first-class trace viewer. The decision is not strongly opinionated; Playwright can be replaced without changing the strategy.

## Evidence

- `frontend/playwright.config.ts` — Playwright configuration
- `frontend/e2e/smoke.spec.ts` — gating smoke suite
- `frontend/e2e/experience.spec.ts` — non-gating experience suite
- `.github/workflows/e2e-dev.yml` — E2E workflow (post-deploy + hourly)
- `.github/scripts/e2e-history-record.mjs` — results recording
- ADR-0036 — layer 4 of the testing pyramid
- ADR-0038 — which environment each tier runs against
