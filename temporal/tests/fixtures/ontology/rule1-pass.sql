-- Fixture: Rule 1 pass — entity_facts.value declared as numeric.
CREATE TABLE entity_facts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id uuid NOT NULL,
  fact_type_id uuid NOT NULL,
  value numeric NOT NULL,
  recorded_at timestamptz DEFAULT now()
);
