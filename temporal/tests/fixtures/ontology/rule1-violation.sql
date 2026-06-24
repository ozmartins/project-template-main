-- Fixture: Rule 1 violation — entity_facts.value declared as text (not numeric).
CREATE TABLE entity_facts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id uuid NOT NULL,
  fact_type_id uuid NOT NULL,
  value text NOT NULL,
  recorded_at timestamptz DEFAULT now()
);
