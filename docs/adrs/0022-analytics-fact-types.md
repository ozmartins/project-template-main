# ADR-0022: Analytics Layer — Fact Types and Time-Series Points

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The entity/SCD2 schema (ADR-0021) stores the current and historical state of business objects well, but it is not optimised for analytics: aggregating metrics over time, tracking counts and measurements per entity, or ingesting time-ordered event streams. These patterns need a separate layer that is designed for fast aggregation rather than point-in-time lookup.

## Decision

Two additional tables in the core schema:

**`fact_types`** — a registry of named numeric measurements. Each fact type has a `key`, `label`, `description`, and `unit`. Examples: `mrr`, `active_users`, `order_count`. Adding a new metric type is an insert, not a schema change.

**`entity_facts`** — numeric facts linked to `entities(id)` and `fact_types(id)`. One row per entity per fact per time point. Values are strictly numeric (`numeric` column). Categorical attributes use a `dimension_type` / `dimension_id` soft reference. Flexible `metadata` JSONB for additional context.

**`time_series_points`** — generic JSONB event stream for time-ordered signals that don't fit the entity model (system metrics, external API events, raw telemetry). No schema enforcement; useful for ingestion before structure is known.

The split between `entity_facts` (structured numeric) and `time_series_points` (raw JSONB) is deliberate: fact queries can use standard SQL aggregations with full index support; raw signals can be ingested without up-front schema design.

## Consequences

**Positive:**
- `SUM`, `AVG`, `COUNT` over `entity_facts.value` use standard Postgres aggregations — no custom analytics engine needed.
- Fact types are registered data, not code. Adding a new metric requires no deploy.
- Time-series points provide a landing zone for raw signals before they are structured into facts.
- Both tables reference `entities(id)`, connecting analytics back to the identity layer.

**Negative:**
- Numeric-only `entity_facts` values means categorical breakdowns (e.g., status distribution) must use dimension tables or `time_series_points`. This is more complex than a single generic value column.
- There is no built-in time-bucketing or rollup. High-cardinality fact series (per-second sensor data) will grow large quickly. Downsampling or partitioning must be added explicitly.
- The `time_series_points` JSONB column is opaque to the schema — queries must know the expected JSON structure. This is a trade-off for ingestion flexibility.

## Alternatives considered

**TimescaleDB:** Excellent for time-series but adds a Postgres extension dependency. `entity_facts` is sufficient for the analytics needs of most applications at the template's scale target.

**Separate analytics database (ClickHouse, Redshift):** Appropriate for very large fact volumes but disproportionate for a greenfield project. Postgres handles millions of rows without issue; move to a columnar store when query performance demands it.

**Everything in `entity_versions.data` JSONB:** Possible but conflates operational state (SCD2 entity history) with analytics (numeric aggregations). Querying aggregations from JSONB is significantly slower than from a typed `numeric` column.

## Evidence

- `supabase/migrations/20251203090000_analytics_foundation.sql` — fact types, entity facts, time series points
- ADR-0021 — entity model that `entity_facts` references
