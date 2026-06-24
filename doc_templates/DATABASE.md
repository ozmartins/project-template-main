# Database Documentation Template

## Overview
Describe the database system, version, and overall architecture.

- **Database System**: PostgreSQL 15+
- **Connection Pooling**: PgBouncer / Supabase Pooler
- **Migrations**: Managed via Supabase migrations

## Schema Overview

### Entity Relationship Diagram
```
[Include a link to or embed an ERD diagram here]
```

### Core Tables

#### `entities`
The central table for all trackable entities in the system.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique identifier |
| entity_type | text | NOT NULL | Type of entity (e.g., 'user', 'project') |
| name | text | NOT NULL | Display name |
| metadata | jsonb | DEFAULT '{}' | Flexible metadata storage |
| created_at | timestamptz | DEFAULT now() | Creation timestamp |
| updated_at | timestamptz | DEFAULT now() | Last update timestamp |

**Indexes:**
- `idx_entities_type` on `entity_type`
- `idx_entities_created` on `created_at`
- `idx_entities_metadata` (GIN) on `metadata`

#### `entity_relationships`
Defines relationships between entities.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique identifier |
| source_entity_id | uuid | FOREIGN KEY REFERENCES entities(id) | Source entity |
| target_entity_id | uuid | FOREIGN KEY REFERENCES entities(id) | Target entity |
| relationship_type | text | NOT NULL | Type of relationship |
| created_at | timestamptz | DEFAULT now() | Creation timestamp |

**Indexes:**
- `idx_relationships_source` on `source_entity_id`
- `idx_relationships_target` on `target_entity_id`
- `idx_relationships_type` on `relationship_type`

#### `entity_versions`
Tracks historical versions of entities using SCD2 (Slowly Changing Dimension Type 2).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | Version identifier |
| entity_id | uuid | FOREIGN KEY REFERENCES entities(id) | Referenced entity |
| data | jsonb | NOT NULL | Full entity state snapshot |
| valid_from | timestamptz | DEFAULT now() | Version start timestamp |
| valid_to | timestamptz | | Version end timestamp (NULL for current) |
| is_current | boolean | DEFAULT true | Current version flag |

**Indexes:**
- `idx_versions_entity` on `entity_id`
- `idx_versions_current` on `entity_id, is_current` (WHERE is_current = true)
- `idx_versions_valid` on `valid_from, valid_to`

#### `entity_facts`
Stores numeric facts and metrics about entities.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique identifier |
| entity_id | uuid | FOREIGN KEY REFERENCES entities(id) | Referenced entity |
| fact_type | text | NOT NULL | Type of fact |
| value | numeric | NOT NULL | Numeric value |
| unit | text | | Unit of measurement |
| recorded_at | timestamptz | DEFAULT now() | Recording timestamp |

**Indexes:**
- `idx_facts_entity` on `entity_id`
- `idx_facts_type` on `fact_type`
- `idx_facts_recorded` on `recorded_at`

#### `time_series_points`
Stores time-series data points for entities.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique identifier |
| entity_id | uuid | FOREIGN KEY REFERENCES entities(id) | Referenced entity |
| metric_name | text | NOT NULL | Name of the metric |
| value | numeric | NOT NULL | Metric value |
| data | jsonb | DEFAULT '{}' | Additional data payload |
| timestamp | timestamptz | DEFAULT now() | Data point timestamp |

**Indexes:**
- `idx_timeseries_entity_metric` on `entity_id, metric_name`
- `idx_timeseries_timestamp` on `timestamp`
- Hypertable optimization (if using TimescaleDB)

## Relationships

### One-to-Many Relationships
- `entities` → `entity_versions`: One entity has many versions
- `entities` → `entity_facts`: One entity has many facts
- `entities` → `time_series_points`: One entity has many time series points

### Many-to-Many Relationships
- `entities` ↔ `entities` (via `entity_relationships`): Entities can have multiple relationships

## Common Queries

### Get Current Entity State
```sql
SELECT e.*, ev.data
FROM entities e
LEFT JOIN entity_versions ev ON e.id = ev.entity_id AND ev.is_current = true
WHERE e.id = $1;
```

### Get Entity History
```sql
SELECT *
FROM entity_versions
WHERE entity_id = $1
ORDER BY valid_from DESC;
```

### Get Related Entities
```sql
SELECT e.*, er.relationship_type
FROM entities e
JOIN entity_relationships er ON e.id = er.target_entity_id
WHERE er.source_entity_id = $1;
```

### Get Latest Facts for Entity
```sql
SELECT DISTINCT ON (fact_type) *
FROM entity_facts
WHERE entity_id = $1
ORDER BY fact_type, recorded_at DESC;
```

### Get Time Series Data
```sql
SELECT metric_name, value, timestamp
FROM time_series_points
WHERE entity_id = $1
  AND metric_name = $2
  AND timestamp >= $3
  AND timestamp <= $4
ORDER BY timestamp;
```

## Row-Level Security (RLS)

### Enable RLS on Tables
```sql
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_series_points ENABLE ROW LEVEL SECURITY;
```

### Example RLS Policies
```sql
-- Allow users to read their own entities
CREATE POLICY "Users can read own entities"
ON entities
FOR SELECT
USING (auth.uid()::text = metadata->>'owner_id');

-- Allow users to insert their own entities
CREATE POLICY "Users can insert own entities"
ON entities
FOR INSERT
WITH CHECK (auth.uid()::text = metadata->>'owner_id');
```

## Backup and Recovery

### Backup Strategy
- **Frequency**: Daily automated backups via Supabase
- **Retention**: 7 days point-in-time recovery
- **Location**: Encrypted cloud storage

### Restore Procedure
```bash
# Using Supabase CLI (local development)
supabase db dump --config supabase/config.toml > backup.sql
psql $DATABASE_URL < backup.sql
```

## Migrations

### Creating a Migration
```bash
# Generate a new migration file
supabase migration new migration_name --config supabase/config.toml
```

### Applying Migrations
```bash
# Apply all pending migrations
supabase db reset --config supabase/config.toml
```

### Migration Best Practices
- Always use transactions for migrations
- Include rollback instructions in comments
- Test migrations on staging before production
- Keep migrations idempotent where possible
- Never edit existing migrations that have been deployed

## Performance Optimization

### Indexing Strategy
- Index foreign keys for join performance
- Use GIN indexes for JSONB columns with queries
- Use partial indexes for filtered queries
- Monitor index usage with `pg_stat_user_indexes`

### Query Optimization
- Use `EXPLAIN ANALYZE` to understand query plans
- Avoid N+1 queries with proper joins or batch loading
- Use connection pooling to reduce overhead
- Consider materialized views for complex aggregations

### Vacuum and Analyze
```sql
-- Regular maintenance
VACUUM ANALYZE entities;
VACUUM ANALYZE entity_relationships;
```

## Monitoring

### Key Metrics
- Connection pool usage
- Query performance (slow queries)
- Table sizes and growth
- Index usage and effectiveness
- Replication lag (if applicable)

### Useful Queries
```sql
-- Find slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Check table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan;
```

## Connection Information

### Environment Variables
```bash
DATABASE_URL=postgresql://user:password@host:port/database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Connection Pooling
- Transaction mode: For short-lived transactions
- Session mode: For long-lived connections with session state

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for database-specific issues.
