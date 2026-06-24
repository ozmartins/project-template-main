# Temporal Worker

Python-free TypeScript Temporal worker powering DSL-driven workflows.

## Prerequisites

- Node 22+
- A running Temporal server (provided by `make up` via Docker Compose)

## Environment Variables

Copy `.env.example` at the repo root and fill in the values you need:

```bash
cp .env.example .env
```

Key variables:

| Variable | Required | Description |
|---|---|---|
| `TEMPORAL_ADDRESS` | Yes | Temporal server address (default `temporal:7233` inside Docker) |
| `PIAGENT_PROVIDER` | Yes (smoke test) | LLM provider — `anthropic`, `openai`, `azure-openai-responses`, etc. |
| `ANTHROPIC_API_KEY` | If using Anthropic | API key from [console.anthropic.com](https://console.anthropic.com) |
| `OPENAI_API_KEY` | If using OpenAI | API key from [platform.openai.com](https://platform.openai.com) |
| `AZURE_OPENAI_API_KEY` | If using Azure | Azure OpenAI key |
| `EXA_API_KEY` | Optional | Exa Search API key — enables real web search and site crawl in `search_web` / `crawl_site` tools. Without it both activities return empty stub results gracefully. |

### EXA_API_KEY — Web Search and Site Crawl

The `web_search` and `web_crawl` activities are powered by the [Exa Search API](https://exa.ai).

**Without `EXA_API_KEY`:** both activities log a warning and return empty results (`[]` / `pages: []`). Workflows and the smoke test still run to completion — they just receive no web data.

**With `EXA_API_KEY`:** `search_web` calls hit the Exa neural search API and return real ranked snippets; `crawl_site` fetches live page content from the target URL. LLM agents receive actual web context, which meaningfully enriches classification and research workflows.

#### Getting an Exa API key

1. Sign in at [dashboard.exa.ai](https://dashboard.exa.ai)
2. Create a new API key under **API Keys**
3. Add it to your `.env`:

```bash
EXA_API_KEY=your-key-here
```

#### Setting EXA_API_KEY as a GitHub secret (for CI smoke tests)

```bash
gh secret set EXA_API_KEY --repo <org>/<repo>
```

Then reference it in the workflow:

```yaml
env:
  EXA_API_KEY: ${{ secrets.EXA_API_KEY }}
```

## Running the Smoke Test

The smoke test starts a local Temporal `TestWorkflowEnvironment`, registers all real activities (including `llm_agent`, `web_search`, and `web_crawl`), and runs three DSL workflows against a real LLM:

| Test | Description |
|---|---|
| **Test 1** | Single-shot structured output — classifies Stripe Inc into an industry vertical |
| **Test 2** | Tool-use loop — classifies Linear using `search_web` (real results when `EXA_API_KEY` is set) |
| **Test 3** | `crawl_site` verification — crawls `stripe.com` and summarises content (real pages when `EXA_API_KEY` is set) |

```bash
# From the temporal/ directory:
cd temporal
EXA_API_KEY=your-key npx ts-node --project tsconfig.test.json scripts/smoke-test.ts
```

### Azure sandbox (issue #62 status)

**Evidence**: `gpt-5.4` returns `404 DeploymentNotFound` on `volarisiaisandboxazureopenai.openai.azure.com`.
The only confirmed active deployment on that resource is `gpt-4o`.

The `llm_agent` activity no longer silently falls back to `gpt-4o` — it requires an explicit
deployment name for `azure-openai-responses` and throws immediately when none is set.

To run the smoke test against the confirmed sandbox deployment:

```bash
cd temporal
PIAGENT_PROVIDER=azure-openai-responses \
PIAGENT_MODEL_ID=gpt-4o \
AZURE_API_BASE=https://volarisiaisandboxazureopenai.openai.azure.com \
AZURE_API_KEY=your-azure-key \
npx ts-node --project tsconfig.test.json scripts/smoke-test.ts
```

#### Expected failure when running with `PIAGENT_MODEL_ID=gpt-5.4`

Running the smoke test with `gpt-5.4` against the sandbox resource fails with a 404 from
the Azure OpenAI API (acceptance criterion #3 — failure evidence for issue #62):

```bash
cd temporal
PIAGENT_PROVIDER=azure-openai-responses \
PIAGENT_MODEL_ID=gpt-5.4 \
AZURE_API_BASE=https://volarisiaisandboxazureopenai.openai.azure.com \
AZURE_API_KEY=your-azure-key \
npx ts-node --project tsconfig.test.json scripts/smoke-test.ts
```

Expected output:
```
Error: 404 DeploymentNotFound: The API deployment for this resource does not exist.
If you created the deployment within the last 5 minutes, please wait a moment and try again.
```

This is a **provisioning gap**, not a code defect. The `llm_agent` activity throws
immediately with a clear error rather than silently falling back to a different model.

#### Unblocking `gpt-5.4`

To use `gpt-5.4` you must first provision it in Azure (requires subscription owner or
Cognitive Services Contributor role):

```bash
# Azure CLI — provision gpt-5.4 on the sandbox resource
az cognitiveservices account deployment create \
  --name volarisiaisandboxazureopenai \
  --resource-group <resource-group> \
  --deployment-name gpt-5.4 \
  --model-name gpt-4.5-preview \
  --model-version "2025-02-27" \
  --model-format OpenAI \
  --sku-capacity 10 \
  --sku-name Standard
```

Alternatively, point `AZURE_API_BASE` at a different Azure resource that already has
`gpt-5.4` deployed. Until that provisioning step is done the sandbox smoke path uses
`gpt-4o` as the proven working deployment.

The script auto-detects your LLM provider from environment variables (priority: `PIAGENT_PROVIDER` + `PIAGENT_MODEL_ID` > Azure > Anthropic > OpenAI > Groq).

### Expected output with EXA_API_KEY set

Test 2 and Test 3 tool call traces will show real web data:

```
── Tool calls executed: 2 ──
  [1] search_web(
        args:   {"query":"Linear app project management tool"}
        result: 5 result(s)
          [1] Linear – The new standard for modern software — https://linear.app
               Linear is designed for high-performance teams. Move fast with streamlined workflows...
          [2] Linear pricing — https://linear.app/pricing
               ...
  )
```

### Expected output without EXA_API_KEY

Tool calls still execute but return empty results:

```
  [1] search_web(
        args:   {"query":"Linear app project management tool"}
        result: 0 result(s)  [stub — EXA_API_KEY not set]
  )
```

## Running Tests

```bash
cd temporal
npm test                          # unit + integration tests
npm run typecheck                 # TypeScript type check
npm run lint                      # Biome lint
```
