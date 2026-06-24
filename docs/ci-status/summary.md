# Engineering health dashboard

Generated: 2026-06-24 20:23Z

## CI suites

| Suite | Last outcome | Last run | Pass 24h | Pass 7d | SLO | Streak |
|---|---|---|---:|---:|---|---:|
| `unit` | ✅ passed | 2026-06-24 20:06Z | 100% (1) | 100% (1) | — | 1 |
| `temporal` | ❌ failed | 2026-06-24 20:07Z | 0% (1) | 0% (1) | — | 0 |
| `helm` | ✅ passed | — | — | — | — | 1 |
| `seed` | ✅ passed | — | — | — | — | 1 |

## E2E suites

| Suite | Last outcome | Last run | Pass 24h | Pass 7d | SLO | Streak |
|---|---|---|---:|---:|---|---:|
| `smoke` | — | — | — | — | — | 0 |
| `experience` | — | — | — | — | — | 0 |

## Deployments

| Env×Cloud | Last deployed | SHA | Outcome | Pass 7d | Staleness |
|---|---|---|---|---:|---|
| `dev-azure` | 2026-06-24 20:23Z | `f36d6a4` | ✅ passed | 100% (1) | 0h |

## Code quality

| Workflow | Last run | Outcome | Metrics |
|---|---|---|---|
| `validate-ontology` | 2026-06-24 20:07Z | ❌ failed | failed_jobs=1, skipped_jobs=0 |

## Security & audits

| Workflow | Last run | Outcome | Finding count |
|---|---|---|---:|

## Ops workflows

| Workflow | Last run | Outcome |
|---|---|---|
| `pipeline-daily` | — | — |
| `monitor-actions` | — | — |
| `validate-dsl-definitions` | — | — |
| `validate-ontology` | 2026-06-24 20:07Z | ❌ failed |

## Unstable tests

| Test | Suite | Failures (7d) |
|---|---|---:|
| Azure API version fallback contract in production call sites uses 2025-03-01-preview fallback in llm_agent when AZURE_OPENAI_API_VERSION is unset | `temporal` | 1 |
| Azure API version fallback contract in production call sites keeps llm_agent and probe-llm fallback versions aligned | `temporal` | 1 |
| lint-ontology script passes current migrations and seed | `temporal` | 1 |


## Open incidents

_No open `priority:critical` incidents._
