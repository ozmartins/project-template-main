-- Fixture: Rule 2 pass — fact_type key inserted before it is referenced.
INSERT INTO fact_types (key, label) VALUES ('revenue', 'Revenue');

INSERT INTO entity_facts (entity_id, fact_type_id, value)
SELECT
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM fact_types WHERE key = 'revenue'),
  100;
