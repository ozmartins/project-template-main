-- Baseline assertions after applying seed.sql.
-- Verifies the database is in the expected post-seed state.
-- This is a template placeholder — add project-specific assertions here.

DO $$
BEGIN
  -- Confirm we are connected to the expected database
  IF current_database() NOT IN ('postgres') THEN
    RAISE EXCEPTION 'Unexpected database: %', current_database();
  END IF;
END $$;
