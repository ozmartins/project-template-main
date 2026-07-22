# Engineering health dashboard

Generated: 2026-07-22 08:20Z

## CI suites

| Suite | Last outcome | Last run | Pass 24h | Pass 7d | SLO | Streak |
|---|---|---|---:|---:|---|---:|
| `unit` | ✅ passed | 2026-07-17 00:24Z | 100% (1) | 100% (1) | — | 2 |
| `temporal` | ❌ failed | 2026-07-17 00:24Z | 0% (1) | 0% (1) | — | 0 |
| `helm` | ✅ passed | — | — | — | — | 2 |
| `seed` | ✅ passed | — | — | — | — | 2 |

## E2E suites

| Suite | Last outcome | Last run | Pass 24h | Pass 7d | SLO | Streak |
|---|---|---|---:|---:|---|---:|
| `smoke` | — | — | — | — | — | 0 |
| `experience` | — | — | — | — | — | 0 |

## Deployments

| Env×Cloud | Last deployed | SHA | Outcome | Pass 7d | Staleness |
|---|---|---|---|---:|---|
| `dev-azure` | 2026-07-17 00:28Z | `d70b7e6` | ✅ passed | 100% (1) | 128h |

## Code quality

| Workflow | Last run | Outcome | Metrics |
|---|---|---|---|
| `validate-ontology` | 2026-06-24 20:07Z | ❌ failed | failed_jobs=1, skipped_jobs=0 |
| `validate-dsl-definitions` | 2026-06-25 02:06Z | 🟠 error | failed_jobs=0, skipped_jobs=0 |
| `code-quality` | 2026-07-22 06:33Z | ❌ failed | failed_jobs=1, skipped_jobs=0 |

## Security & audits

| Workflow | Last run | Outcome | Finding count |
|---|---|---|---:|
| `architecture-audit` | 2026-07-21 08:25Z | ✅ passed | 0 |
| `audit-cis-kubernetes` | 2026-07-22 08:20Z | 🟠 error | 0 |
| `audit-azure-security` | 2026-07-21 09:09Z | 🟠 error | 0 |

## Ops workflows

| Workflow | Last run | Outcome |
|---|---|---|
| `pipeline-daily` | 2026-07-21 08:21Z | ✅ passed |
| `monitor-actions` | 2026-07-22 07:24Z | ✅ passed |
| `validate-dsl-definitions` | 2026-06-25 02:06Z | 🟠 error |
| `validate-ontology` | 2026-06-24 20:07Z | ❌ failed |

## Unstable tests

| Test | Suite | Failures (7d) |
|---|---|---:|
| Azure API version fallback contract in production call sites uses 2025-03-01-preview fallback in llm_agent when AZURE_OPENAI_API_VERSION is unset | `temporal` | 1 |
| Azure API version fallback contract in production call sites keeps llm_agent and probe-llm fallback versions aligned | `temporal` | 1 |
| lint-ontology script passes current migrations and seed | `temporal` | 1 |


## Open incidents

_No open `priority:critical` incidents._
