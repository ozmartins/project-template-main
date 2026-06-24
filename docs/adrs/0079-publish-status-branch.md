# ADR-0079: Publish unified CI & environment status to a `status` branch

- **Status:** Superseded by ADR-0104
- **Date:** 2026-06-21
- **Deciders:** Copilot (implementation), @ianreay (review)
- **Supersedes / Superseded by:** Superseded by ADR-0104

## Context

The project already maintains two append-only JSONL history feeds on dedicated branches:
- `ci-history` — one record per CI test suite run (unit, temporal, helm, …)
- `e2e-history` — one record per E2E suite run (smoke, experience)

Both branches have auto-generated `README.md` and `trend.svg` files rendered by
`.github/scripts/test-history-render.mjs` and `.github/scripts/e2e-history-render.mjs`
respectively. However, there is no single view that combines both feeds, and the main
`README.md` has no links to any live health data.

Engineers and stakeholders asked for a single, always-current status page that shows
pass rates, last-run outcomes, and weekly trends across all suites — linked from the
main `README.md` — without requiring GitHub Pages or any external hosting.

## Decision

We add a `publish_status` job to `pipeline-daily.yml` that:
1. Shallow-clones the `ci-history` and `e2e-history` branches to extract their JSONL feeds.
2. Runs `.github/scripts/status-render.mjs` (a new script adapting the existing render pattern)
   to produce `index.html` (Chart.js dashboard, data baked in), `trend.svg` (dependency-free
   SVG), and `README.md` (GitHub-renderable summary).
3. Pushes the three files to the `status` branch using the same concurrent-safe 5-attempt retry
   loop used in `e2e-dev.yml`'s `publish-history` job.
4. The job runs with `continue-on-error: true` so status-page failures never block the pipeline.

We also add a static `## Status` section near the top of the main `README.md` with links to
the rendered page (via `raw.githack.com`) and the GitHub Actions run list.

## Consequences

**Easier:**
- Single URL shows all suite health at a glance.
- No GitHub Pages required — `raw.githack.com` serves the `status` branch HTML directly.
- The `status` branch's `README.md` renders natively in GitHub's branch browser.
- The main `README.md` status links are static and never stale.

**New obligations:**
- The `status` branch must be bootstrapped on first run (the script handles orphan creation).
- The `publish_status` job adds ~5 minutes to the daily pipeline wall time.
- JSONL feed branches (`ci-history`, `e2e-history`) must exist before the status job
  produces meaningful output; the job tolerates their absence gracefully.

## Alternatives considered

- **GitHub Pages** — requires enabling Pages in repo settings, adds complexity, out of scope per issue spec.
- **Live fetch in `index.html`** — fetching `runs.jsonl` at runtime from `raw.githubusercontent.com`
  risks CORS issues and rate limiting; baking data into the HTML is simpler and more reliable.
- **Single combined JSONL on the status branch** — copying data across branches creates duplication
  and merge complexity; the render script reads the data at publish time and discards it afterwards.

## Evidence

- `.github/scripts/status-render.mjs` — new rendering script
- `.github/workflows/pipeline-daily.yml` — `publish_status` job
- `README.md` — `## Status` section
- Pattern reference: `.github/workflows/e2e-dev.yml` lines 312–410 (`publish-history` job)
- Closes Volaris-AI/project-template#430
