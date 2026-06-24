begin;

-- table and expected column shape
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'workflow_classifications'
  ), 'workflow_classifications table missing';

  ASSERT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workflow_classifications'
      AND column_name = 'domain'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ), 'workflow_classifications.domain must be NOT NULL text';

  ASSERT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workflow_classifications'
      AND column_name = 'updated_at'
      AND data_type = 'timestamp with time zone'
      AND is_nullable = 'NO'
  ), 'workflow_classifications.updated_at must be NOT NULL timestamptz';
END
$$;

-- unique(domain) contract
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'workflow_classifications'
      AND c.contype = 'u'
      AND a.attname = 'domain'
      AND array_length(c.conkey, 1) = 1
  ), 'workflow_classifications must enforce unique(domain)';
END
$$;

-- trigger wiring + updated_at behavior
DO $$
DECLARE
  inserted_id uuid;
  before_updated_at timestamptz;
  after_updated_at timestamptz;
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM pg_trigger trg
    JOIN pg_class t ON t.oid = trg.tgrelid
    JOIN pg_proc p ON p.oid = trg.tgfoid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'workflow_classifications'
      AND trg.tgname = 'trg_workflow_classifications_updated_at'
      AND NOT trg.tgisinternal
      AND p.proname = 'update_updated_at'
  ), 'workflow_classifications updated_at trigger is missing or miswired';

  INSERT INTO workflow_classifications (domain, name, confidence)
  VALUES ('trigger-check.example', 'Trigger Check', 0.42)
  RETURNING id, updated_at INTO inserted_id, before_updated_at;

  PERFORM pg_sleep(0.02);

  UPDATE workflow_classifications
  SET confidence = 0.84
  WHERE id = inserted_id
  RETURNING updated_at INTO after_updated_at;

  ASSERT after_updated_at >= before_updated_at,
    'workflow_classifications.updated_at moved backwards on update';
END
$$;

rollback;
