# ADR-0021: Core Entity + SCD2 Versioning Schema

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The template needs a foundational database schema that can represent any business object without prescribing a domain model. The schema must:
- Support schema evolution without breaking existing data (new attribute types should not require ALTER TABLE)
- Maintain a full history of changes (audit trail, point-in-time queries)
- Be generic enough to apply across domains (SaaS, ERP, marketplace, etc.)
- Work well with PostgREST's auto-generated REST API

## Decision

The core schema is built on three tables with Slowly Changing Dimension Type 2 (SCD2) semantics:

**`entities`** — identity layer. One row per real-world object, with an `entity_type` discriminator and optional `source_record_id` for upstream system mapping.

**`entity_versions`** — SCD2 snapshot layer. All business attributes live in a JSONB `data` column. Each insert closes the previous current version (`is_current=true → false`, `valid_to = now()`) via a before-insert trigger. A partial unique index enforces exactly one current version per entity. Historical versions are retained indefinitely.

**`relationships_v2`** — typed entity graph with the same SCD2 semantics. Edges have a `relationship_type` discriminator and a JSONB `metadata` column.

The relational layer stays stable across projects. Domain-specific attributes live inside `data` — adding a new attribute is a Supabase migration that updates JSON structure, not a schema migration that alters the table. The `DATABASE.md` guide explains conventions.

UUID primary keys via `gen_random_uuid()`. `created_at`/`updated_at` maintained by trigger.

## Consequences

**Positive:**
- Schema is domain-agnostic — forks can build any data model without altering the core tables.
- Full audit history: every state change is a new version row. Point-in-time queries use `WHERE valid_from <= t AND (valid_to IS NULL OR valid_to > t)`.
- Adding new attribute types to an entity kind requires only application-layer changes (new JSON structure in `data`), not DDL migrations.
- PostgREST exposes `entity_versions` as a queryable endpoint; the frontend data layer (ADR-0019) can filter and sort by `data->>'field'` via PostgREST's JSONB operators.

**Negative:**
- JSONB `data` is not typed at the Postgres layer. Type enforcement is the application's responsibility. Malformed JSON is caught at insert time, not at schema definition time.
- Point-in-time queries are more complex than `SELECT * FROM entity` — engineers must understand the SCD2 pattern to query correctly. `is_current = true` filters are required for "current state" queries.
- Aggregation and reporting across large entity populations is slower than a normalized schema. Columnar indexes on `data->>'field'` must be added explicitly for high-traffic query paths.
- The `relationships_v2` table represents all edge types — a single scan over a large relationship table may be slow for deeply connected graphs. Domain-specific junction tables remain valid for performance-critical paths.

## Alternatives considered

**Normalized relational schema per domain:** Maximum query performance and type safety, but requires DDL changes for every new attribute type. Unsuitable for a generic template.

**Event sourcing (append-only events, projections):** Strong audit model but significantly more complex to query. SCD2 rows are a lightweight middle ground — history without full event replay.

**Document database (MongoDB, Firestore):** Schema flexibility without Postgres SQL power. PostgREST, Supabase Auth, and RLS are all Postgres-native; switching stores would lose the entire Supabase stack.

## Evidence

- `supabase/migrations/20251202090000_core_entity_model.sql` — schema definition
- `DATABASE.md` — SCD2 conventions, query patterns, extension guidance
- ADR-0015 — Supabase as the database layer
