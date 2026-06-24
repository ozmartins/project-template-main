INSERT INTO entity_facts (entity_id, fact_type_id, value)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM fact_types WHERE key = 'missing_fact_key'),
  1
);
