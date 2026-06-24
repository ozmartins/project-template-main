# Generalizable Data Template — Coding Agent Instructions

This document describes how to implement the **standard data template** consisting of:

- `entities` (already exists)
- `entity_versions` (already exists)
- `relationships_v2` (already exists)
- **New:** `fact_types`
- **New:** standardized `entity_facts`
- **New:** standardized time-series table (`time_series_points`)
- **No dimension tables included in the template** (added per product)

The goal is to provide a **minimal, extensible analytics foundation** (facts + time series) without assuming any specific dimensions.

---

## 1. Standardize the `entity_facts` Table

If `entity_facts` already exists, ensure it has these columns.
If it doesn’t exist, create it fresh.

### Schema Requirements

```sql
CREATE TABLE IF NOT EXISTS entity_facts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The entity this fact belongs to
    entity_id       uuid NOT NULL
                        REFERENCES entities(id)
                        ON DELETE CASCADE,

    -- Type of fact (links to fact_types)
    fact_type_id    uuid NOT NULL
                        REFERENCES fact_types(id),

    -- Main numeric measurement
    value           numeric NOT NULL,

    -- Optional linkage to future dimension tables (soft reference)
    dimension_type  text,
    dimension_id    uuid,

    -- Source system identifier
    source_id       text,

    -- Flexible JSON attributes
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Audit fields
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
```

### Usage Note: `value` vs `dimension_id`

The `value` column should store only numeric measurements (temperature, counts, percentages, flags like 0/1).
Categorical states (like "too warm") should never go into `value` — they should be stored via the `dimension_id` UUID pointing to a dimension table.
This keeps facts clean, consistent, and generalizable without forcing UUIDs or text into a numeric column.
It’s not over-complicated — it’s the cleanest, most scalable pattern for a reusable template.

### Update Timestamp Trigger

```sql
CREATE OR REPLACE FUNCTION set_timestamp_entity_facts()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_entity_facts_trg ON entity_facts;

CREATE TRIGGER set_timestamp_entity_facts_trg
BEFORE UPDATE ON entity_facts
FOR EACH ROW
EXECUTE FUNCTION set_timestamp_entity_facts();
```

### Recommended Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_entity_facts_entity_id
    ON entity_facts (entity_id);

CREATE INDEX IF NOT EXISTS idx_entity_facts_fact_type_id
    ON entity_facts (fact_type_id);

CREATE INDEX IF NOT EXISTS idx_entity_facts_dimension_type_dimension_id
    ON entity_facts (dimension_type, dimension_id);

-- Ensure one current fact per type/entity/dimension tuple
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_facts_unique
    ON entity_facts (entity_id, fact_type_id, dimension_id)
    NULLS NOT DISTINCT;
```

## 2. Create the `fact_types` Lookup Table

This is a simple reference table that defines what types of facts exist.

### Schema

```sql
CREATE TABLE IF NOT EXISTS fact_types (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key         text NOT NULL UNIQUE,        -- e.g., 'mrr', 'active_users'
    label       text NOT NULL,               -- human-readable
    description text,
    unit        text,                        -- e.g., 'USD', 'count'
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
```

### Update Timestamp Trigger

```sql
CREATE OR REPLACE FUNCTION set_timestamp_fact_types()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_fact_types_trg ON fact_types;

CREATE TRIGGER set_timestamp_fact_types_trg
BEFORE UPDATE ON fact_types
FOR EACH ROW
EXECUTE FUNCTION set_timestamp_fact_types();
```

### (Optional) Seed Example Fact Type

```sql
INSERT INTO fact_types (key, label, description, unit)
VALUES ('example_fact', 'Example Fact', 'Placeholder fact type', 'count')
ON CONFLICT (key) DO NOTHING;
```

## 3. Create the Generic Time-Series Table

This table is separate from `entity_facts` because time-series data represents raw domain-event measurements.

### Schema

```sql
CREATE TABLE IF NOT EXISTS time_series_points (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to entity (e.g. company, user, product)
    entity_id       uuid NOT NULL
                        REFERENCES entities(id)
                        ON DELETE CASCADE,

    -- Link to fact definition
    fact_type_id    uuid NOT NULL
                        REFERENCES fact_types(id),

    -- The actual domain timestamp for the measurement
    observed_at     timestamptz NOT NULL,

    -- Primary data content (store numeric or text values here)
    data_payload    jsonb NOT NULL,

    -- Optional metadata (context, source info)
    source_id       text,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
```

### Usage Note: `data_payload`

The `time_series_points` table uses a JSONB `data_payload` column instead of a fixed numeric value. This allows the table to act as a flexible event store.
- **Numeric Metrics:** Store as `{ "value": 123.45 }` or `{ "count": 1 }`.
- **Categorical Events:** Store as `{ "status": "active", "reason": "login" }`.
- **Complex Data:** Store arbitrary structures as needed.

### Update Timestamp Trigger

```sql
CREATE OR REPLACE FUNCTION set_timestamp_time_series_points()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_time_series_points_trg ON time_series_points;

CREATE TRIGGER set_timestamp_time_series_points_trg
BEFORE UPDATE ON time_series_points
FOR EACH ROW
EXECUTE FUNCTION set_timestamp_time_series_points();
```

### Recommended Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_time_series_points_entity_fact_time
    ON time_series_points (entity_id, fact_type_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_series_points_fact_time
    ON time_series_points (fact_type_id, observed_at DESC);
```

## 4. Dimension Tables Are Not Part of This Template

**Important:**

Do **NOT** create any `dim_*` tables in this template.

`dimension_type` + `dimension_id` in `entity_facts` act as future hooks.

Product-specific migrations will define & link their own dimension tables.

> **Note on Referential Integrity:**
> Since `dimension_id` is a "soft link" in this template, the database cannot automatically cascade deletes from future dimension tables.
> **Application Logic Requirement:** When deleting a record from a dimension table (e.g., a "Marketing Campaign"), the application or a specific migration must also delete or update any rows in `entity_facts` that reference it to prevent orphaned data.

## 5. Coding Agent Output Checklist

The agent must:

- [ ] **Standardize `entity_facts`**
    - Ensure all required columns exist
    - Add metadata + dimension hooks
    - Add update triggers
    - Add indexes

- [ ] **Create `fact_types`**
    - Create table
    - Add update triggers
    - Link from `entity_facts.fact_type_id`

- [ ] **Create `time_series_points`**
    - Create table
    - Add update triggers
    - Add indexes

- [ ] **Do not add any dimension tables**
