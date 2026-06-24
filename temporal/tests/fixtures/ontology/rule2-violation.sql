-- Fixture: Rule 2 violation — references a fact_type key that has never been inserted.
INSERT INTO entity_facts (entity_id, fact_type_id, value)
SELECT
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM fact_types WHERE key = 'nonexistent_key'),
  42;
