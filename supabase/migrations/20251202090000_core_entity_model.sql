-- Core entity + SCD2 versioning + relationships template
-- Created: 2025-12-02
-- Purpose: minimal reusable schema for generic entity graph with slowly changing dimensions (Type 2)

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Utility: auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Entities (identity layer)
create table if not exists entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  source_record_id text, -- optional link to upstream system id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_entities_source unique (entity_type, source_record_id)
);
create trigger trg_entities_updated_at
  before update on entities
  for each row execute function update_updated_at();

-- Entity Versions (SCD2)
create table if not exists entity_versions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  version_number int not null,
  data jsonb not null default '{}',
  is_current boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_entity_versions_version unique (entity_id, version_number),
  -- >= (not >) so a version superseded in the same transaction it was created
  -- (valid_to == valid_from == transaction now()) is a legal zero-duration record.
  constraint chk_valid_range check (valid_to is null or valid_to >= valid_from)
);
create trigger trg_entity_versions_updated_at
  before update on entity_versions
  for each row execute function update_updated_at();

-- Enforce exactly one current version per entity (partial unique index, so an
-- entity can still accumulate unlimited historical is_current=false versions).
create unique index if not exists uq_entity_versions_current
  on entity_versions(entity_id) where is_current;

-- Helper function: close existing current version when inserting a new version
create or replace function set_entity_version_validity()
returns trigger as $$
begin
  -- Close existing current version for this entity
  update entity_versions ev
    set is_current = false,
        valid_to = coalesce(new.valid_from, now())
  where ev.entity_id = new.entity_id
    and ev.is_current = true
    and ev.id <> new.id;

  return new;
end;
$$ language plpgsql;

create trigger trg_entity_versions_scd2
  before insert on entity_versions
  for each row execute function set_entity_version_validity();

-- Relationships (entity graph with version awareness)
create table if not exists relationships_v2 (
  id uuid primary key default gen_random_uuid(),
  relationship_type text not null,
  parent_id uuid not null references entities(id) on delete cascade,
  child_id uuid not null references entities(id) on delete cascade,
  metadata jsonb not null default '{}',
  is_current boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_rel_valid_range check (valid_to is null or valid_to >= valid_from)
);
create trigger trg_relationships_v2_updated_at
  before update on relationships_v2
  for each row execute function update_updated_at();

-- Enforce one current relationship per (type, parent, child); history is unbounded.
create unique index if not exists uq_relationship_current
  on relationships_v2(relationship_type, parent_id, child_id) where is_current;

-- Optional helper to enforce single current relationship per pair/type
create or replace function set_relationship_current_flag()
returns trigger as $$
begin
  update relationships_v2 r
     set is_current = false,
         valid_to = coalesce(new.valid_from, now())
   where r.parent_id = new.parent_id
     and r.child_id = new.child_id
     and r.relationship_type = new.relationship_type
     and r.is_current = true
     and r.id <> new.id;
  return new;
end;
$$ language plpgsql;

create trigger trg_relationships_v2_scd2
  before insert on relationships_v2
  for each row execute function set_relationship_current_flag();

-- Indexes for common access patterns
create index if not exists idx_entity_versions_entity_id on entity_versions(entity_id);
create index if not exists idx_entity_versions_current on entity_versions(entity_id, is_current);
create index if not exists idx_relationships_parent on relationships_v2(parent_id, relationship_type) where is_current;
create index if not exists idx_relationships_child on relationships_v2(child_id, relationship_type) where is_current;
