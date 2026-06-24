# Database Template Guide

This template provides only the minimal, reusable pieces for a generic entity graph with SCD2 history.

## Included schema
- `entities`: identity layer for any business object (`entity_type`, optional `source_record_id`).
- `entity_versions`: SCD2 snapshots; one current row per entity; JSONB `data` for flexible shape; `valid_from/valid_to` for history.
- `relationships_v2`: typed edges between entities with SCD2 semantics (`is_current`, validity window, metadata JSONB).
- Utility trigger `update_updated_at` plus helper triggers to auto-close current versions/relationships when new ones are inserted.

## How SCD2 works here
1) Insert a new row into `entity_versions` for an `entity_id`.
2) The `trg_entity_versions_scd2` trigger closes any existing current version (`is_current=true`) by setting `is_current=false` and `valid_to = new.valid_from` (defaults to now).
3) The new row becomes the current version (`is_current=true`, `valid_from` defaults to now).
4) Relationship inserts behave the same way for the same `(parent, child, relationship_type)` tuple.

## Conventions
- UUID primary keys via `gen_random_uuid()` (pgcrypto).
- `data` and `metadata` are JSONB; validate in app layer or add JSON Schema later.
- Use `entity_type` + `source_record_id` to map back to upstream systems.
- Prefer storing business attributes inside `data` to keep the relational layer stable across projects.

## Local workflow
- Start Supabase locally: `npx supabase@latest start`
- Apply migrations + (empty) seed: `npx supabase@latest db reset --yes`
- Export envs for the app: `npx supabase@latest status --output env > .env.local`

## Extending
- Add per-entity kind constraints by introducing `entity_kinds` and JSON Schema validation triggers.
- Add fact tables (e.g., `entity_facts`) keyed to `entities(id)` with registries for `fact_type` and dimensions.
- Add role-based access policies (RLS) per project requirements.
