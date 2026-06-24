-- 1. Standardize the entity_facts Table

CREATE TABLE IF NOT EXISTS fact_types (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key         text NOT NULL UNIQUE,        -- e.g., 'mrr', 'active_users'
    label       text NOT NULL,               -- human-readable
    description text,
    unit        text,                        -- e.g., 'USD', 'count'
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

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

-- (Optional) Seed Example Fact Type
INSERT INTO fact_types (key, label, description, unit)
VALUES ('example_fact', 'Example Fact', 'Placeholder fact type', 'count')
ON CONFLICT (key) DO NOTHING;


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


-- 3. Create the Generic Time-Series Table

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

    -- Optional metadata
    source_id       text,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

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

CREATE INDEX IF NOT EXISTS idx_time_series_points_entity_fact_time
    ON time_series_points (entity_id, fact_type_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_series_points_fact_time
    ON time_series_points (fact_type_id, observed_at DESC);
