# ADR-0018: JSON-Driven UI Engine

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

Traditional React applications hardwire page layouts, data sources, and component trees in code. Adding a new screen or changing the layout of an existing one requires a code change, a build, and a deploy. For applications where the domain model evolves rapidly (new entity types, new data relationships, new workflows), this coupling slows delivery and concentrates UI knowledge in the engineering team.

## Decision

All application screens are defined as **JSON page definitions** interpreted at runtime by a React engine. The engine (`frontend/src/engine/`) renders any conforming definition without requiring code changes.

A page definition specifies:
- **Data sources**: Supabase table queries (with filters, ordering, pagination), REST API calls, or static data. Resolved at runtime; results available to component expressions.
- **Component tree**: a recursive `ComponentRenderer` maps component type names to registered React components. Props can be literal values or **expressions** (evaluated by `ExpressionEvaluator.ts` against the resolved data context).
- **Actions**: navigation, API calls, Supabase mutations, state updates. Triggered by component events (clicks, form submits).
- **Conditionals and lists**: components can be conditionally rendered or repeated over a data source result.

The component registry (`frontend/src/registry/`) is code — adding a new reusable component type requires code. Adding a new screen that uses existing component types requires only a JSON definition.

JSON definitions are stored in Supabase (making them part of the application data) or in versioned JSON files (making them part of the codebase). Both modes are supported.

## Consequences

**Positive:**
- New screens are JSON documents — product owners and domain experts can contribute page definitions with minimal engineering involvement.
- Screen definitions are data; they can be stored, versioned, and managed in Supabase alongside domain data. A workflow can generate or modify screen definitions.
- The engine enforces consistency: all screens use the same data-fetching patterns, error states, and action contracts.
- The JSON DSL pattern (ADR-0001) extends this to backend workflows — consistent philosophy across layers.

**Negative:**
- Debugging a broken screen requires understanding the expression evaluator and component renderer, not just the component itself. The abstraction adds a layer to the mental model.
- Arbitrary React patterns (custom hooks, complex local state, refs) cannot be expressed in JSON. Screens with non-trivial interactive behaviour need custom components in the registry.
- The engine is bespoke. Engineers joining the project must learn it before they can be productive on UI work. Standard React patterns learned elsewhere apply only to the component registry, not to screen authoring.
- Schema validation of page definitions happens at runtime (or in a custom validator). Invalid definitions fail at render time, not at build time.

## Alternatives considered

**Standard React page components:** Maximum flexibility, zero learning curve for React engineers. Does not enable non-engineer screen authoring or workflow-driven screen generation.

**Low-code platform (Retool, Budibase, Appsmith):** Purpose-built for this use case but introduces a separate product dependency, separate auth model, and prevents the screens from living in the same codebase as the application.

**GraphQL + auto-generated CRUD UI:** Covers data management screens but cannot express custom layouts, business-specific interactions, or branded visual design.

## Evidence

- `frontend/src/engine/UIEngine.tsx` — top-level engine
- `frontend/src/engine/ComponentRenderer.tsx` — recursive component renderer
- `frontend/src/engine/ExpressionEvaluator.ts` — expression evaluation
- `frontend/src/engine/useDataSources.ts` — data source resolution
- `frontend/src/registry/` — registered component types
- ADR-0001 — JSON DSL for Temporal workflows (sister pattern)
