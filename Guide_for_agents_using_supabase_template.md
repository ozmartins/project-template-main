# 📘 Implementation Guide: How to Use the Core + Analytics Template
*(with JSONB time-series, numeric-only facts, and dimension support)*

This guide explains how to use the provided schema in a generalisable, product-agnostic way.
Agents should follow this when implementing any use case.

You have these core tables:
- `entities`
- `entity_versions`
- `relationships_v2`
- `fact_types`
- `entity_facts`
- `time_series_points` (JSONB event stream)

You may create product-specific `dim_*` tables when needed.

---

## 0. Mental Model

Three layers exist:

### 1. Core Entity Model
- `entities` → “What is this thing?”
- `entity_versions` → “What is its state over time?” (JSON snapshots, SCD2)
- `relationships_v2` → “How are things connected?” (graph-like, historical)

### 2. Metric Definitions
- `fact_types` → registry of all metrics, states, and event types

### 3. Metrics & Event Data
- `time_series_points` → generic JSONB event stream
- `entity_facts` → clean numeric-only current metrics (+ optional dimension)

**Rule of thumb:**
- **Entity modelling** = identity + configuration
- **Time-series** = any time-based input
- **Facts** = numeric KPIs derived from events or logic

---

## 1. Creating & Managing Entities

### 1.1 Create an entity
```sql
INSERT INTO entities (entity_type, source_record_id)
VALUES ('room', 'upstream-id-123')
RETURNING id;
```
Use the UUID everywhere else.

### 1.2 Storing entity state: `entity_versions`
Store entity state snapshots as JSON.
Every change = a new row.

```sql
INSERT INTO entity_versions (entity_id, version_number, data)
VALUES (
  :entity_id,
  1,
  jsonb_build_object(
    'name','Room A',
    'capacity',10,
    'location','1st Floor'
  )
);
```
SCD2 logic updates `is_current`, `valid_from`, `valid_to`.
**Use this for slowly changing attributes, not high-frequency updates.**

---

## 2. Modelling Relationships

Use `relationships_v2` for any parent→child link.

```sql
INSERT INTO relationships_v2 (
  relationship_type,
  parent_id,
  child_id,
  metadata
) VALUES (
  'room_in_building',
  :building_id,
  :room_id,
  jsonb_build_object('level','1')
);
```
Each update = new row; triggers handle current vs historical.

---

## 3. Defining Metrics: `fact_types`

Register all metrics, states, or event types.

```sql
INSERT INTO fact_types (key, label, description, unit)
VALUES (
  'room_temperature_c',
  'Room Temperature (°C)',
  'Temperature readings',
  'celsius'
)
ON CONFLICT DO NOTHING
RETURNING id;
```
Use `fact_types.key` as a stable identifier.

---

## 4. Using `time_series_points` (JSONB Event Stream)

✔ A generic place to put **any** time-ordered event payload
✔ Numeric, text, structured, unstructured – all allowed
✔ Whether you store long-term history is up to the product
✔ Typically used as input to derive facts, not as your “final” table

The template does not require time-series retention. Products may:
- Keep all events
- Purge old events
- Downsample
- Or only use events as a staging source for deriving `entity_facts`

### 4.1 Conceptual schema
```sql
CREATE TABLE time_series_points (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid not null references entities(id) on delete cascade,
  fact_type_id uuid not null references fact_types(id),
  observed_at  timestamptz not null,
  data         jsonb not null,   -- full event payload
  source_id    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
```

### 4.2 What goes in `data`?
Everything related to the event:
- Numeric fields (`value`)
- Text fields (`state_key`)
- Raw sensor payloads
- Complex webhook events
- Flags, scores, states

**Examples:**

*Numeric:*
```json
{ "value": 23.4, "unit": "celsius" }
```

*State:*
```json
{ "state_key": "too_warm", "state_code": 2 }
```

*Mixed / complex:*
```json
{
  "value": 23.4,
  "raw": { "sensor": "s-123", "payload": {...} }
}
```

### 4.3 Insert example
```sql
INSERT INTO time_series_points (
  entity_id,
  fact_type_id,
  observed_at,
  data,
  source_id
) VALUES (
  :room_id,
  :fact_type_id_room_temperature_c,
  :ts,
  jsonb_build_object(
    'value', :temp,
    'unit', 'celsius'
  ),
  'sensor-123'
);
```

---

## 5. `entity_facts`: Numeric Current Snapshot

✔ **Numeric-only**
✔ Clean, query-friendly fact table
✔ Often derived from latest time-series events
✔ **Supports non-numeric concepts via dimension references**

A row in `entity_facts` means:
> “As of now, entity X has fact Y = numeric value V, optionally associated with a dimension that gives the non-numeric meaning.”

### 5.1 Numeric-only value
`value` must always be numeric:
- metrics
- scores
- percentages
- counts
- flags (0/1)
- codes for states (0=cold,1=comfortable,2=warm)

### 5.2 How it supports non-numeric meaning
Even though `value` is numeric-only, the meaning can be non-numeric:
- A state like “comfortable” is stored in a `dim_room_state` table
- `entity_facts.value` stores the numeric code (e.g. 1)
- `dimension_id` points to the dimension row that holds the text label + attributes

This preserves:
1. numeric consistency
2. fast analytical queries
3. rich descriptive meaning via dimensions

**Example:**

| Concept | Where Stored |
| :--- | :--- |
| State meaning (“too_warm”) | `dim_room_state.label` |
| State code (2) | `entity_facts.value` |
| Additional attributes | `dim_room_state` columns |
| Observed timestamp | `entity_facts.metadata` |

### 5.3 Upsert example
```sql
INSERT INTO entity_facts (
  entity_id,
  fact_type_id,
  value,
  dimension_type,
  dimension_id,
  source_id,
  metadata
)
VALUES (
  :room_id,
  :fact_type_id_room_state,
  :state_code_numeric,
  'room_state',
  :dim_room_state_id,
  'comfort-service-v1',
  jsonb_build_object('observed_at', :ts)
)
ON CONFLICT (entity_id, fact_type_id, dimension_id)
DO UPDATE SET
  value = EXCLUDED.value,
  metadata = EXCLUDED.metadata,
  updated_at = now();
```

---

## 6. Dimension Tables (`dim_*`)

### 6.1 When to create a dimension?
Create a `dim_*` table when:
- the category/state is reused
- you want to group/filter by it
- or it has descriptive attributes

If it’s a one-off string → keep it in `time_series_points.data`.

### 6.2 Dimension structure pattern
```sql
CREATE TABLE dim_room_state (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  label       text not null,
  sort_order  int,
  description text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
```

### 6.3 Connecting to `entity_facts`
```sql
entity_facts.dimension_type = 'room_state'
entity_facts.dimension_id = dim_room_state.id
```
This lets your numeric fact (`value`) have a rich non-numeric meaning.

---

## 7. How Time-Series and Facts Work Together

| `time_series_points` | `entity_facts` |
| :--- | :--- |
| JSONB | Clean numeric fact table |
| Any event shape | Supports dimensional meaning |
| May be high-frequency | Drives dashboards and analytics |
| May or may not be kept long-term | |
| Used to derive “current” facts | |

**Typical pipeline:**
1. Event arrives → insert into `time_series_points.data`
2. Service derives numeric values / state codes
3. Upsert into `entity_facts`
4. Dashboards query `entity_facts` (not time_series)

---

## 8. End-to-End Example
**Scenario: A room with temperature & comfort state**

1. **Create entities** row for the room
2. **Store configuration** in `entity_versions.data`
3. **Define metrics:**
   - `room_temperature_c`
   - `room_comfort_score`
   - `room_state`
4. **Create `dim_room_state`**: too_cold, comfortable, too_warm
5. **Insert temperature events** into `time_series_points.data`
6. **Insert state-change events** into `time_series_points.data`
7. **Derive current state:**
   - `entity_facts.value` = numeric code
   - `dimension_id` = row in `dim_room_state`
8. **Dashboard reads from:**
   - `entity_facts` (current KPIs)
   - `dim_room_state` for labels

---

## 9. Quick Decision Checklist for Agents

When implementing a feature:

**Entity modeling**
- “Does something exist?” → `entities`
- “Does its config change slowly?” → `entity_versions`
- “Are things connected?” → `relationships_v2`

**Time-series (JSONB)**
- Any event with a timestamp → put full payload in `time_series_points.data`

**Facts (numeric-only)**
- Need a current KPI? → upsert to `entity_facts.value`
- Non-numeric concept? → use numeric code + dimension reference

**Dimensions**
- Reusable category or state? → create `dim_*`
- One-off text? → keep inside JSON event

**When unsure:**
- Always put raw input into `time_series_points`
- Only put numeric summaries into `entity_facts`

---

## 10. Implementation Safety & Best-Practice Tips (Important)

These are practical rules that prevent breakages, data inconsistencies, and security problems when an agent actually starts using the template.

### 10.1 Seed / Migration Order
When implementing a new domain into this template, always create objects in this order:

1. **Create `fact_types` first**
   *These define what metrics/states/events exist.*
2. **Create `dim_` tables (if needed)**
   *Before inserting any facts that reference them.*
3. **Create dimension rows (seed data)**
   *e.g. `too_cold`, `comfortable`, `too_warm`.*
4. **Create entities**
   *Rooms, users, companies, sensors, etc.*
5. **Insert time-series events (optional)**
   *These can be used to derive facts.*
6. **Insert / upsert `entity_facts`**
   *Numeric facts that represent “current state”.*

**Rule:** Never insert an `entity_fact` that references a dimension before the dimension exists.

### 10.2 JSON Payload Validation (Recommended)
Because `time_series_points.data` is fully flexible JSON:
- The database does **NOT** validate its shape
- The agent **must** validate JSON in application code before inserting

**Recommended validation includes:**
- Required fields (`value`, `state_key`, etc.)
- Correct types (numbers, strings)
- Expected enum values
- No unexpected keys (if your service enforces contracts)

This ensures consistent analytics and prevents corrupt data.

### 10.3 Entity Type Normalisation
`entities.entity_type` is free text. To avoid inconsistent casing (`Room`, `room`, `rooms`), agents should:
- Define supported `entity_types` as constants in code
- Enforce lowercase snake_case convention (e.g. `'room'`, `'company'`, `'subscription_plan'`)

### 10.4 Security: Enable RLS (Supabase-Specific)
All template tables should have RLS enabled unless explicitly designed to be public.
If the product uses Supabase, the agent must:

**Enable RLS on:**
- `entities`
- `entity_versions`
- `relationships_v2`
- `fact_types`
- `entity_facts`
- `time_series_points`
- all `dim_*` tables they create

**Define policies depending on the app’s rules:**
- restrict by organisation
- restrict by authenticated user
- or restrict by admin role

**Never** rely on client-side filtering alone.

### 10.5 Use Transactions When Performing Multi-Step Writes
If your implementation:
1. Inserts into `time_series_points`
2. Derives a fact
3. And upserts into `entity_facts`

**Do all of this in a single transaction:**
```sql
BEGIN;
  -- insert event
  -- derive values (app code)
  -- upsert fact
COMMIT;
```
This prevents orphaned time-series points, stale facts, and partial writes.

### 10.6 Use Indexes for Any High-Frequency Metric
For high-frequency ingestion (temperature sensors, logs, state changes), create or rely on:

```sql
CREATE INDEX idx_tsp_entity_fact_time
ON time_series_points (entity_id, fact_type_id, observed_at DESC);
```
This ensures efficient querying and downsampling.

### 10.7 Keep Dim Tables Stable
Dimensions should:
- rarely change
- maintain consistent keys
- preserve meaning over time

Dimension rows are not meant to be edited frequently. If semantics change, create a new row instead of mutating the old one.

### 10.8 SQL Validation Responsibilities (`sqlfluff` vs ontology lint)
- `sqlfluff` (tracked under issue #37) should enforce SQL style and generic SQL correctness.
- `temporal/scripts/lint-ontology.ts` enforces ontology-specific semantic invariants that `sqlfluff` does not model:
  1. `entity_facts.value` must be numeric.
  2. `entity_facts` / `time_series_points` lookups of `fact_types.key` must reference keys inserted earlier in migration order.
  3. New top-level tables must stay within the ontology naming shape (`entities`, `entity_versions`, `entity_facts`, `fact_types`, `relationships(_v2)`, `time_series_points`, `dim_*`, `fact_*`, or approved application tables in the script allowlist).