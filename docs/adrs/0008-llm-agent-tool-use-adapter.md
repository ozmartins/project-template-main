# ADR-0008: LLM Agent Loop via Tool-Use Adapter

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The factory's GitHub-based agents (ADR-0002) run as Copilot SDK sessions, which handle their own LLM calls. However, the Temporal worker tier needs an agentic loop too: Temporal activities that call an LLM, receive tool-call responses, execute tools, and iterate until the model signals completion or a budget is exhausted.

Different projects will use different LLM providers (Azure OpenAI, Anthropic, OpenAI, local models). The worker must not hardwire one provider's SDK throughout the codebase.

## Decision

Implement a provider-neutral `chat_with_tools` adapter in `temporal/src/activities/`. The adapter wraps any chat-completion API behind a uniform interface:

```
chat_with_tools(messages, tools, config) -> (final_message, tool_call_history)
```

The adapter executes the agentic loop internally: call model → if tool_calls in response, dispatch each tool, append results → repeat until no tool calls or max_turns reached. Callers receive the final assistant message and the full call history.

Provider selection is driven by configuration (environment variable `LLM_PROVIDER`). The default implementation targets Azure OpenAI; swapping providers requires only a new adapter implementation behind the same interface, not changes to callers.

## Consequences

**Positive:**
- Activities that need LLM reasoning are single Temporal activity invocations — the agentic loop is contained within the activity timeout, not spread across multiple workflow steps.
- Provider swap is isolated to the adapter; workflow and activity code is provider-agnostic.
- The full tool-call history is available for observability and debugging without re-running the loop.
- Max-turns guard prevents runaway loops consuming unbounded tokens.

**Negative:**
- A long agentic loop inside a single activity must complete within Temporal's activity timeout. Activities with many tool-call rounds need either a generous timeout or heartbeating.
- Tool implementations live inside the activity — they are not Temporal activities themselves, so they do not get Temporal's retry/durable guarantees. Long-running tools should be extracted into separate activities.
- The adapter interface is minimal; streaming, embeddings, and multimodal inputs are out of scope unless extended.

## Alternatives considered

**Direct provider SDK calls in activities:** Works but scatters provider-specific code across the codebase, making provider swap expensive.

**LangChain / LlamaIndex agent frameworks:** Heavy dependencies; opinionated about memory and tool registries in ways that conflict with Temporal's durable state model. Prefer thin adapters.

**Separate agentic microservice:** Adds a network hop and another deployment unit for logic that fits comfortably inside a Temporal activity.

## Evidence

- `temporal/src/activities/` — activity directory where adapter lives
- `temporal/src/config.py` — `LLM_PROVIDER` and related settings
- ADR-0006 — Temporal orchestration foundation
- ADR-0007 — signal-driven human approval (complement: agent proposes, human approves)
